# 聚合登录接入参考（佛系云 a.idcfx.net）

> 上游文档：<https://a.idcfx.net/doc.php> · 本文对照 2026-11-22 抓取的页面内容整理，并针对本项目（Cloudflare Pages Functions + D1）给出落地方式与防护要求。
> 本文是参考实现说明，不是已上线的功能；按第 8 节的顺序落地。

## 0. 三条硬规则

1. **appkey 只能待在服务端。** 上游把 `appid`/`appkey` 放在 query 上，浏览器一旦请求 `connect.php` 就等于把密钥写进地址栏、Referer 和 CDN 日志。所有上游请求必须由 Pages Function 转发，前端只拿 `url`/`qrcode`。
2. **上游回调不回传 `state`。** 文档 Step3 的回调只有 `type` 和 `code`，没有 OAuth 标准里的 `state`。因此 CSRF 防护不能靠 query 里的 `state`，只能靠「发起时写进浏览器的 cookie + 服务端一次性记录」。
3. **不自动建号。** `users` 表 `email NOT NULL UNIQUE` 且注册要走邮箱验证码；第三方登录直接建号会绕过邮箱验证，等于开了一个不需要邮箱的后门。默认策略：第三方登录只用于**登录已绑定账号**和**给已登录用户绑定**。

## 1. 上游协议速查

### 1.1 接口

| 步骤 | 请求 | 用途 |
|---|---|---|
| 1 | `GET https://a.idcfx.net/connect.php?act=login&appid=&appkey=&type=&redirect_uri=` | 取第三方跳转地址 |
| 2 | 浏览器跳转到返回的 `url` | 用户在第三方完成授权 |
| 3 | 第三方回调 `redirect_uri?type=&code=` | 拿到 Authorization Code |
| 4 | `GET https://a.idcfx.net/connect.php?act=callback&appid=&appkey=&type=&code=` | 用 code 换用户信息 |
| 补充 | `GET ...?act=query&appid=&appkey=&type=&social_uid=` | 事后再次查询该用户资料 |

### 1.2 `type` 取值

`qq` `wx` `alipay` `douyin` `google` `twitter` `feishu`

### 1.3 关键返回字段

`act=login`：`code`、`msg`、`type`、`url`、`qrcode`（仅微信/支付宝返回）
`act=callback` / `act=query`：`code`、`msg`、`type`、`access_token`、`social_uid`、`nickname`、`faceimg`、`gender`、`location`（仅支付宝/微信）、`ip`

- `code=0` 成功
- `code=2` **未完成登录**（用户还没扫完/还没确认），不是错误，允许用户重试
- 其它值为失败

### 1.4 文档没写、实测补上的

- 上游虽然写「传输方式：HTTP」，但 **HTTPS 可用**：`https://a.idcfx.net/connect.php` 返回 `200 application/json`。一律走 HTTPS，禁止 HTTP 降级。
- 失败返回体比文档多一个字段：`{"code":-1,"errcode":102,"msg":"应用appid不存在"}`。**失败时 `code=-1`，真正的原因在 `errcode`**，日志里两个都要记。
- 校验顺序是「先验 appid 再验 type」，所以用假 appid 测不出非法 type 的报错。
- 已知 `errcode 301` = 应用下账号数量达到上限（该服务商 1000 个账号/应用），排障时优先怀疑额度而不是密钥。

### 1.5 上游协议的两个缺陷（决定了我们的设计）

| 缺陷 | 后果 | 我们的对策 |
|---|---|---|
| 回调不带 `state` | 无法用标准 state 参数防 CSRF；攻击者可把自己的 `code` 诱导受害者浏览器打开，从而以攻击者身份登录受害者会话 | 发起时下发 `glol_social` cookie（HttpOnly，10 分钟），服务端存 `social_states`；回调必须同时具备「同浏览器 cookie」+「未消费的 state 记录」 |
| `appkey` 在 URL 上 | 泄露到日志/Referer/CDN | 服务端代理，前端与 CDN 永远看不到 appkey |

## 2. 在本项目的落点

### 2.1 路由

`functions/api/[[path]].ts` 的 `methods` 表里新增两条（都要进白名单，否则会被 404 挡掉）：

```ts
const methods: Record<string, string[]> = {
  // …现有 me / auth/*
  'auth/social/start': ['POST'],
  'auth/social/callback': ['GET'],
};
```

- `auth/social/start` 用 POST，复用现有 `request.headers.get('Origin') !== url.origin` 的同源校验，避免被第三方页面直接触发。
- `auth/social/callback` 是上游重定向回来的 GET，**不能**套用「非 GET 才校验 Origin」的规则，改为校验 `Sec-Fetch-Site`（`same-origin` / `none`）或 `Referer` 域名白名单。

### 2.2 环境变量（`wrangler.toml` / Pages 环境变量）

> **生产部署（2026-11-20 起）**：glol.rcpd.cc 已从 Cloudflare Pages/D1 迁到 hk01 k3s（ns `idoknow`，Node `server/index.mjs` + PostgreSQL，见 `docs/deploy-hk.md`）。
> 生产表结构走 `deploy/postgres/004-social.sql`（`deploy/deploy-hk.sh` 自动执行），`migrations/0007_social.sql` 只用于本地 wrangler。
> `SOCIAL_APPID` / `SOCIAL_APPKEY` / `SOCIAL_ENABLED` / `SOCIAL_REDIRECT` 放 k8s secret `glol-env`（api 容器以 `process.env` 读取），不是 Pages secret。


```
SOCIAL_APPID      = "…"
SOCIAL_APPKEY     = "…"   # 用 secret，不要写进 wrangler.toml 的明文 vars
SOCIAL_HOST       = "https://a.idcfx.net"
SOCIAL_REDIRECT   = "https://<正式域名>/api/auth/social/callback"
```

- `SOCIAL_APPKEY` 必须 `wrangler pages secret put`，与 `RESEND_API_KEY` 同等对待。
- `SOCIAL_REDIRECT` 写死常量值参与比对，**不要**用请求里的 `Host`/`Referer` 拼，否则等于开放重定向。
- `SOCIAL_ENABLED` 只列启用的平台（`qq,wx,alipay`），未配置时聚合登录整体返回 503 `social_unconfigured`，等于关闭入口。

### 2.3 迁移 `migrations/0007_social.sql` + `0008_social_pending.sql`

```sql
CREATE TABLE social_identities (
  type          TEXT NOT NULL CHECK(type IN ('qq','wx','alipay','douyin','google','twitter','feishu')),
  social_uid    TEXT NOT NULL,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname      TEXT NOT NULL DEFAULT '',
  faceimg       TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL,
  PRIMARY KEY(type, social_uid)
);
-- 一个用户每种第三方最多绑一个
CREATE UNIQUE INDEX social_owner ON social_identities(user_id, type);
CREATE INDEX social_user ON social_identities(user_id);

CREATE TABLE social_states (
  state      TEXT PRIMARY KEY,      -- 32 字节 hex
  type       TEXT NOT NULL,
  intent     TEXT NOT NULL DEFAULT 'login' CHECK(intent IN ('login','bind')),
  user_id    TEXT,                  -- intent='bind' 时必填，回调核对当前会话
  expires    INTEGER NOT NULL,      -- now + 600
  used       INTEGER NOT NULL DEFAULT 0,
  ip         TEXT NOT NULL,
  CHECK(intent <> 'bind' OR user_id IS NOT NULL)
);
CREATE INDEX social_states_expires ON social_states(expires);
```

- `0008_social_pending.sql` 建 `social_pending`：回调换到的身份先落这里，用户点确认才写 `social_identities`。
- 主键 `(type, social_uid)` 保证同一个第三方账号不会被绑到两个人；重复回调靠唯一约束天然幂等。
- `social_states.used` 做一次性消费；过期行随用随删，不需要定时任务。
- 不存 `access_token`：本项目不需要代表用户调用第三方接口，存了只是多一份泄露面。要展示头像就存 `faceimg` 的**域名白名单校验后**的 URL。

## 3. 流程

### 3.1 `POST /api/auth/social/start`

1. 校验 `type` 在白名单内（不在就直接 400，不要回显用户输入）
2. `limit(db, 'social:start:'+ip, 20, 60)` 限流
3. 生成 `state = random(32)`，写 `social_states(state, type, now+600, 0, ip)`
4. `Set-Cookie: glol_social=<state>; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`
5. 服务端 `fetch` 上游 `act=login`（带 appkey），校验 `code === 0` 且 `type` 与请求一致
6. 只回 `{ url, qrcode }`；上游 `msg`/`errcode` 只进服务端日志

### 3.2 `GET /api/auth/social/callback?type=&code=`

**这一步只做「换用户信息 + 落 pending」，不直接登录、不直接绑定。** 原因见 1.5：上游回调不带 `state`，协议无法证明这个 `code` 属于本次流程；直接落库就等于允许攻击者把自己的 `code` 塞进受害者的流程。

1. 校验 `type` 白名单、`code` 正则 `^[A-Za-z0-9_-]{8,128}$`
2. 读 `glol_social` cookie（可含最多 3 个 state，`.` 分隔），逐个查未 `used`、未过期、`type` 一致的行；一个都没有 → 302 `expired`
3. 调上游 `act=callback` 换用户信息：失败 → 302 `unavailable`（**此时不消费 state**，用户重来仍可继续）；`code===2` → 302 `pending`
4. 换取成功后 `UPDATE … SET used=1 WHERE state=? AND used=0 RETURNING state` 一次性消费；改不到行 → 302 `expired`
5. 校验 `social_uid` 非空且 `^[A-Fa-f0-9]{16,64}$`
6. 决定归属：`intent='bind'` 要求当前会话存在、已验证、且等于 state 记录的用户（否则 302 `expired`）；`intent='login'` 要求存在绑定（否则 302 `unbound`），账号必须已验证
7. 写 `social_pending`（`token = sha256(随机值)`、`intent`、`social_uid`、平台昵称、头像、目标 `user_id`、5 分钟 TTL），并下发 `glol_social_pending` cookie（HttpOnly/Secure/SameSite=Lax）
8. 302 到 `/?social=confirm`，前端据此弹出「确认以『微信 · 昵称』登录/绑定」

### 3.2.1 `GET /api/auth/social/pending`

返回当前浏览器的待确认授权（`intent`、平台名、平台昵称、头像），供确认框展示；不消费，404 `no_pending` 表示没有待确认项。

### 3.2.2 `POST /api/auth/social/confirm`

用户点「确认」后才真正生效，顺序是**先校验、后消费**（校验不过的请求不能把别人的授权烧掉）：

1. 读 pending（不消费），没有 → 404 `no_pending`
2. `intent='bind'`：
   - 当前会话必须存在（否则 401），且与 `pending.user_id` 一致（否则 403 `forbidden`）
   - `UPDATE social_pending SET used=1 WHERE token=? AND user_id=?` 消费
   - `INSERT INTO social_identities … SELECT … WHERE EXISTS(SELECT 1 FROM sessions WHERE digest=? AND user_id=? AND expires>?)`——会话在写入这一刻仍然存在才落库（防登出竞态），`changes===0` → 409 `expired`
   - 唯一约束冲突 → 409 `conflict`；其它数据库错误照常抛出
3. `intent='login'`：消费 pending，建新 session（`random(32)`+`hash`），**只删除同一个人的旧 session**（避免把别人或没拿到 Set-Cookie 的访客踢下线），更新 `nickname`/`faceimg`/`last_login_at`
4. 清 `glol_social_pending`，返回 `{ ok, intent, redirect }`（前端跳 `/?social=bound` 或 `/?social=login`）

### 3.3 账号策略

| 方案 | 做法 | 评价 |
|---|---|---|
| **A（推荐）** | 第三方只做「登录已绑定账号」+「已登录用户绑定」，永不自动建号 | 不绕过邮箱验证，不改 `users` 表结构，最省事 |
| B | 给第三方登录用户建 `email = social+<hash>@social.invalid` 的占位账号，后续引导补邮箱 | 要改 `users.email` 语义、注册流程、邮件通知逻辑，且占位邮箱容易污染通知与后台统计 |

除非明确要「零邮箱注册」，走 A。

### 3.4 解绑

- 只有**已设置密码**（`digest` 有效）的账号允许解绑，避免把账号锁死
- 解绑写一条审计（复用 `feedback_events` 之外的独立日志或直接 `console.log` 结构化日志，字段：`user_id`、`type`、`social_uid` 后 6 位）

## 4. 代码骨架

`lib/social.ts`（新增）：

```ts
import { type Env, Problem, hash, limit, now, random } from './auth';

export const SOCIAL_TYPES = ['qq','wx','alipay','douyin','google','twitter','feishu'] as const;
export type SocialType = typeof SOCIAL_TYPES[number];
export const isSocialType = (value: unknown): value is SocialType =>
  typeof value === 'string' && (SOCIAL_TYPES as readonly string[]).includes(value);

const endpoint = (env: Env, params: Record<string,string>) => {
  const url = new URL('/connect.php', env.SOCIAL_HOST);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
};

/** 服务端调用上游；appkey 只出现在这一层。 */
export async function callUpstream(env: Env, action: 'login'|'callback'|'query', params: Record<string,string>) {
  const url = endpoint(env, { act: action, appid: env.SOCIAL_APPID, appkey: env.SOCIAL_APPKEY, ...params });
  const response = await fetch(url, { headers: { 'User-Agent': 'guilinol/1.0' }, redirect: 'manual' });
  if (!response.ok) throw new Problem(502, 'social_unavailable', '登录服务暂时不可用');
  const body = await response.json<{ code?: number; errcode?: number; msg?: string; type?: string; url?: string; qrcode?: string;
    social_uid?: string; nickname?: string; faceimg?: string }>();
  if (body.code !== 0) {
    // 只记服务端，不回显上游原文
    console.log(JSON.stringify({ scope: 'social', action, code: body.code, errcode: body.errcode, msg: body.msg }));
  }
  return body;
}

export const socialCookie = (state: string, age = 600) =>
  `glol_social=${state}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;

export async function startSocial(env: Env, db: D1Database, type: SocialType, ip: string, redirect: string) {
  await limit(db, `social:start:${ip}`, 20, 60);
  const state = random(32);
  await db.prepare('DELETE FROM social_states WHERE expires<=?').bind(now()).run();
  await db.prepare('INSERT INTO social_states(state,type,expires,used,ip) VALUES(?,?,?,0,?)')
    .bind(state, type, now() + 600, ip).run();
  const body = await callUpstream(env, 'login', { type, redirect_uri: redirect });
  if (body.code !== 0 || body.type !== type || typeof body.url !== 'string' || !/^https:\/\//.test(body.url))
    throw new Problem(502, 'social_unavailable', '登录服务返回异常，请稍后再试');
  return { state, url: body.url, qrcode: typeof body.qrcode === 'string' ? body.qrcode : null };
}
```

`functions/api/[[path]].ts` 里接两条路由（片段）：

```ts
if (path === 'auth/social/start') {
  const type = body.type;
  if (!isSocialType(type)) invalid();
  const ip = request.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
  const { state, url, qrcode } = await startSocial(env, db, type, ip, env.SOCIAL_REDIRECT);
  return json({ url, qrcode }, 200, socialCookie(state));
}

if (path === 'auth/social/callback' && method === 'GET') {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') throw new Problem(403, 'origin', '请求来源不符');
  const type = url.searchParams.get('type'), code = url.searchParams.get('code') ?? '';
  if (!isSocialType(type) || !/^[A-Za-z0-9_-]{8,128}$/.test(code)) invalid();
  const state = request.headers.get('Cookie')?.match(/(?:^|;\s*)glol_social=([a-f0-9]{64})(?:;|$)/)?.[1] ?? '';
  if (!state) throw new Problem(403, 'state', '登录会话已失效，请重新发起');
  const consumed = await stmt('UPDATE social_states SET used=1 WHERE state=? AND type=? AND used=0 AND expires>?',
    state, type, now()).run();
  if (!consumed.meta.changes) throw new Problem(403, 'state', '登录会话已失效，请重新发起');
  const profile = await callUpstream(env, 'callback', { type, code });
  if (profile.code === 2) throw new Problem(409, 'social_pending', '尚未完成授权，请重试');
  if (profile.code !== 0 || profile.type !== type || !/^[A-Fa-f0-9]{16,64}$/.test(profile.social_uid ?? ''))
    throw new Problem(502, 'social_unavailable', '登录失败，请稍后再试');
  // …查绑定 / 建 session / 绑定当前用户（见 3.2）
}
```

> 片段是接线示意：`db`、`stmt`、`json`、`invalid` 都是 `[[path]].ts` 里已有的东西，`socialCookie` / `startSocial` / `callUpstream` 从 `lib/social.ts` 引入。`Env` 要补上 `SOCIAL_APPID`、`SOCIAL_APPKEY`、`SOCIAL_HOST`、`SOCIAL_REDIRECT`。

## 5. 防护清单

### 必须（缺一条就不许上线）

| # | 防护 | 做法 | 防的是什么 |
|---|---|---|---|
| 0 | **登录/绑定必须二次确认** | 回调只落 `social_pending`，用户点确认（POST，Origin 校验，绑定还要会话一致）才生效 | 上游无 state 导致的 code 串号 / 登录绑定 CSRF |
| 1 | 密钥不出服务端 | 前端只收 `url`/`qrcode`；`SOCIAL_APPKEY` 用 secret | appkey 从地址栏/CDN 日志泄露 |
| 2 | 回调必须有同浏览器凭据 | `glol_social` cookie（HttpOnly、Secure、SameSite=Lax、600s）+ `social_states` 一次性消费 | 上游无 state 导致的登录 CSRF |
| 3 | state 一次性 | `UPDATE … WHERE used=0` 看 `changes` | code/回调重放 |
| 4 | `redirect_uri` 写死 | 常量 `env.SOCIAL_REDIRECT`，不接受请求传入 | 开放重定向 |
| 5 | `code` 严格校验 | `^[A-Za-z0-9_-]{8,128}$`，不做字符串拼接 | 注入、超长输入 |
| 6 | 不自动建号 | 未绑定 → 引导先登录再绑定 | 绕过邮箱验证的后门账号 |
| 7 | 绑定唯一 | 主键 `(type, social_uid)` + 唯一索引 `(user_id, type)` | 一个第三方号绑多人 / 一人绑多个同类 |
| 8 | 会话轮换 | 登录成功建新 session 并删旧 digest | 会话固定攻击 |
| 9 | 限流 | `limit(db,'social:start:'+ip,20,60)`，callback 同 IP 20 次/分钟；全站已用 `rate_limits` 表 | 刷接口、探测绑定关系 |
| 10 | 错误不泄露 | 上游 `msg`/`errcode` 只进日志，用户侧统一文案 | 枚举「该 QQ 是否已注册」 |
| 11 | 不存 token | `access_token` 不落库 | 少一份可被盗的凭据 |
| 12 | 配置只认 https | `SOCIAL_HOST`/`SOCIAL_REDIRECT` 非 https 一律视为未配置 | appkey 与 code 走明文 |
| 12b | `Cache-Control: no-store` | 复用现有 `json()` | 代理缓存带 Set-Cookie 的响应 |
| 13 | 日志脱敏 | 只记 `type`、`code`、`errcode`、`social_uid` 后 6 位；不记 `code`、`appkey` | 日志变成凭据仓库 |

### 建议（下一轮做）

| # | 防护 | 做法 |
|---|---|---|
| 14 | 头像域白名单 | `faceimg` 只接受 `thirdqq.qlogo.cn`、`wx.qlogo.cn` 等已知域，否则丢弃；前端 `img-src` 同步加域 |
| 15 | 昵称清洗 | 去控制字符、限长 32、禁止换行；渲染仍由前端转义 |
| 16 | 绑定二次确认 | 已登录用户绑定时要求页面显式点一次「确认绑定」，避免静默绑上攻击者的 QQ |
| 17 | 异地登录提示 | 记录 `profile.ip`，与上次登录不同则邮件提醒（复用 `sendMail`） |
| 18 | 解绑保护 | 无密码账号禁止解绑最后一个登录方式；解绑写审计 |
| 19 | CSP | `connect-src` 不含 `a.idcfx.net`（全走服务端代理）；`img-src` 加第三方头像域 |
| 20 | 监控 | `errcode` 非 0 计数告警；`errcode 301` 单独标记为额度问题 |

## 6. 验收用例

| 场景 | 操作 | 期望 |
|---|---|---|
| 正常绑定 | 登录 → 点「绑定 QQ」→ 授权 → 确认框点确认 | 200 `{ok,intent:'bind'}`，`social_identities` 多一行，pending `used=1` |
| 正常登录 | 点「QQ 登录」→ 授权 → 确认框点确认 | 200 + 新 `glol_session`，`/api/me` 返回该账号 |
| **不点确认** | 只走完授权、不确认 | 不登录不绑定，`social_identities` 无变化（这是防 code 串号的关键） |
| **别人的会话确认** | pending 属于 A，用 B 的会话 POST confirm | 403 `forbidden`，且 pending **不被消费**（A 仍可确认） |
| 跨站发起 | 第三方页面 `fetch` POST `/api/auth/social/start` | 403 `origin` |
| 缺 cookie 回调 | 直接 `GET …/social/callback?type=qq&code=xxx` | 302 `/?social=expired` |
| 重放回调 | 同一 code 连发两次 | 第二次 302 `/?social=expired` |
| 重放确认 | 同一 pending 连点两次 | 第二次 404 `no_pending` |
| 未绑定登录 | 未绑定账号走登录流程 | 302 `/?social=unbound`，不建号 |
| 重复绑定 | 同一 QQ 再绑另一个用户 | 409 `conflict` |
| 一人两号 | 同一用户绑第二个 QQ | 409 `conflict`（唯一索引 `(user_id,type)`） |
| 上游宕机 | 断网或 `SOCIAL_HOST` 指向黑洞 | 502 `social_unavailable`；回调侧 302 `/?social=unavailable` 且 state 未消费 |
| 未完成授权 | 授权页挂着不点 | `code=2` → 302 `/?social=pending`，可重试 |
| 配置成 http | `SOCIAL_HOST`/`SOCIAL_REDIRECT` 用 http | 视为未配置：start 503，callback 302 `/?social=disabled` |
| 超频 | 1 分钟打 30 次 start | 429 `rate_limited`；回调侧 302 `/?social=busy` |

本地验证：`npm run check:api` 必须过；`scripts/auth-test.mjs` 增加一条 `--social` 分支，按上表演进（该脚本已有 `--ui`/`--bridge`/`--admin-ui` 的写法可照抄）。

## 7. 已知坑

- **回调没有 state**：别写成 `if (query.state !== stored) reject` 那种标准写法——上游压根不传，会变成永远失败，或者被人加个「没传就跳过」的补丁，把防护彻底废掉。凭据一律走 cookie。
- **`code=2` 不是错误**：微信/支付宝扫码场景经常出现，要允许用户重试，不要清掉 state 记录就完事（应让用户重新 `start`）。
- **`qrcode` 只有微信/支付宝有**，QQ/飞书等只能跳转，前端不要写死「显示二维码」。
- **`location` 只有支付宝/微信返回**，别当必填字段建表。
- **额度**：该服务商单应用约 1000 个账号，超了报 `errcode 301`，表现为所有登录突然失败。上线前确认 appid 的余量。
- **不要用上游返回的 `ip` 做风控依据**：它是第三方侧的出口 IP，不是用户真实 IP；风控用 `CF-Connecting-IP`。
- **`social_uid` 是十六进制串不是数字**，别用 `parseInt`，也别当整数主键。

## 8. 落地顺序

1. `migrations/0007_social.sql` + 本地 `wrangler d1 migrations apply glol --local` 验证
2. `lib/social.ts`（上面的骨架）
3. `[[path]].ts` 接 `auth/social/start`、`auth/social/callback`、`auth/social/pending`、`auth/social/confirm`，`methods` 白名单同步
4. 前端登录页加「QQ / 微信 / 支付宝」按钮（只调本项目 API，不直接连上游）
5. 账号设置页加「绑定/解绑第三方账号」，未设置密码的账号禁用解绑
6. 前端：首页读 `?social=confirm` 时拉 `GET auth/social/pending` 弹确认框，点确认调 `POST auth/social/confirm`
7. `scripts/auth-test.mjs --social` 跑第 6 节用例
8. 生产配置 `SOCIAL_*` secret，先在预览环境验证一次真实授权，再打开入口
