/**
 * 市民身份卡：姓名 + 密码 → 开卡/登录。
 *
 * 后端：本地 `本地入口/serve.mjs` 的 /api/register、/api/login（scrypt 加盐存 JSON）。
 * 上线后可换成 MySQL，接口形状不变。
 */
const KEY = 'guiling.civic.v1'

export interface Civic {
  uid: string
  name: string
}

export function civicUser(): Civic | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Civic) : null
  } catch {
    return null
  }
}

let panel: HTMLElement | null = null

export function openCivicCard(onDone?: (user: Civic | null) => void) {
  const current = civicUser()
  if (current) {
    onDone?.(current)
    return
  }
  if (panel) {
    panel.style.display = 'flex'
    return
  }
  panel = document.createElement('div')
  panel.style.cssText =
    'position:fixed;inset:0;z-index:130;display:flex;align-items:stretch;justify-content:flex-end;background:rgba(6,10,9,.5);backdrop-filter:blur(4px)'
  panel.innerHTML = `
    <section style="width:min(440px,100%);height:100%;overflow:auto;padding:34px 30px;box-sizing:border-box;
      background:linear-gradient(165deg,#14342f,#0a1a18 60%,#07100f);color:#e8f4ef;
      border-left:1px solid rgba(255,255,255,.12);box-shadow:-30px 0 80px rgba(0,0,0,.45)">
      <p style="margin:0 0 6px;font:600 11px ui-monospace;letter-spacing:2px;color:#6fb7a4">GUILIN · CITIZEN ID</p>
      <h1 style="margin:0 0 6px;font:800 30px/1.15 system-ui;letter-spacing:-.5px">市民身份卡</h1>
      <p style="margin:0 0 26px;font:400 13px/1.6 system-ui;color:#8fbcae">填姓名和密码就能开卡，不用邮箱。开完卡直接挑角色进游戏。</p>

      <label style="display:block;margin:0 0 14px">
        <span style="display:block;margin-bottom:6px;font:500 12px system-ui;color:#a9cfc3">姓名</span>
        <input data-f="name" maxlength="20" placeholder="例如：唐援朝" autocomplete="username"
          style="width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.16);
          background:rgba(255,255,255,.06);color:#fff;font:400 15px system-ui;outline:none">
      </label>
      <label style="display:block;margin:0 0 8px">
        <span style="display:block;margin-bottom:6px;font:500 12px system-ui;color:#a9cfc3">密码</span>
        <input data-f="password" type="password" maxlength="32" placeholder="至少 4 位" autocomplete="current-password"
          style="width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.16);
          background:rgba(255,255,255,.06);color:#fff;font:400 15px system-ui;outline:none">
      </label>
      <p data-msg style="min-height:20px;margin:6px 2px 18px;font:400 12px/1.5 system-ui;color:#f0a58f"></p>

      <button data-act="register" style="width:100%;padding:14px;margin-bottom:10px;border:0;border-radius:14px;
        background:#2fd6a6;color:#06231c;font:700 15px system-ui;cursor:pointer">开卡并进入</button>
      <button data-act="login" style="width:100%;padding:13px;border-radius:14px;border:1px solid rgba(255,255,255,.2);
        background:transparent;color:#cfe4dc;font:600 14px system-ui;cursor:pointer">已有市民卡，直接登录</button>
    </section>`
  document.body.append(panel)

  const nameInput = panel.querySelector<HTMLInputElement>('[data-f="name"]')!
  const passInput = panel.querySelector<HTMLInputElement>('[data-f="password"]')!
  const msg = panel.querySelector<HTMLElement>('[data-msg]')!
  const close = (user: Civic | null) => {
    panel!.style.display = 'none'
    onDone?.(user)
  }
  const submit = async (mode: 'register' | 'login') => {
    const name = nameInput.value.trim()
    const password = passInput.value
    if (name.length < 2) return void (msg.textContent = '姓名至少 2 个字')
    if (password.length < 4) return void (msg.textContent = '密码至少 4 位')
    msg.style.color = '#a9cfc3'
    msg.textContent = mode === 'register' ? '正在开卡…' : '正在核对…'
    try {
      const res = await fetch(`/api/${mode}`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({name, password}),
      })
      const body = (await res.json().catch(() => ({}))) as {ok?: boolean; user?: Civic; error?: {message?: string}}
      if (res.status === 403) { showBanScreen((body as unknown as {reason?: string}).reason ?? body.error?.message ?? ''); return }
    if (!res.ok || !body.ok || !body.user) {
        msg.style.color = '#f0a58f'
        msg.textContent = body.error?.message ?? `开卡失败（${res.status}）`
        return
      }
      localStorage.setItem(KEY, JSON.stringify({...body.user, registeredAt: Date.now()}))
      // 注册成功 → 物品背包里自动生成「市民二代身份证」
      const created = body.user
      void import('../items').then(module => {
        if (!created) return
        const card = {number: '', name: created.name, uid: created.uid}
        void import('./idcard').then(idcard => {
          const info = idcard.idNumberFor({uid: card.uid, name: card.name, registeredAt: Date.now()})
          module.grantItem('idcard', '市民二代身份证', {number: info.number, date: info.date})
        })
      })
      msg.style.color = '#2fd6a6'
      msg.textContent = `市民卡已就绪：${body.user.name} · UID ${body.user.uid}`
      setTimeout(() => close(body.user!), 550)
    } catch (error) {
      msg.style.color = '#f0a58f'
      msg.textContent = `连不上账号服务（${error instanceof Error ? error.message : 'network'}）`
    }
  }
  panel.querySelector('[data-act="register"]')!.addEventListener('click', () => void submit('register'))
  panel.querySelector('[data-act="login"]')!.addEventListener('click', () => void submit('login'))
  passInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') void submit('login')
  })
  nameInput.focus()
}

/** 把页脚里的 市民UID 填成 GLxxxxx */
export function paintUid() {
  const user = civicUser()
  const uid = user ? `GL${user.uid.slice(0, 5)}` : 'GL------'
  for (const node of Array.from(document.querySelectorAll<HTMLElement>('.civic-uid'))) node.textContent = uid
  // 左上角账号按钮：有市民卡时优先显示名字（压住旧账号系统的 onUser 回调）
  if (user) {
    const entry = document.querySelector<HTMLElement>('.account-entry')
    if (entry) {
      if (entry.textContent !== user.name) entry.textContent = user.name
      entry.removeAttribute('data-guest')
    }
  }
}
paintUid()
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', paintUid)
  setInterval(paintUid, 1500)
}

/** 红屏封禁提示：不可关闭，显示理由 */
export function showBanScreen(reason: string, uid = '') {
  if (document.getElementById('ban-screen')) return
  const el = document.createElement('div')
  el.id = 'ban-screen'
  el.style.cssText =
    'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
    'background:' +
    'radial-gradient(120% 90% at 50% 18%, #6d1512 0%, #3b0b09 42%, #1a0504 100%),' +
    'repeating-linear-gradient(90deg, rgba(255,255,255,.014) 0 1px, transparent 1px 3px);' +
    'overflow:hidden;font-family:system-ui,"PingFang SC","Microsoft YaHei",sans-serif;color:#fdeeea'

  const seal = document.createElement('div')
  seal.textContent = '禁'
  seal.style.cssText =
    'position:absolute;right:-6vw;bottom:-10vh;font:800 46vw/1 "Songti SC","SimSun",serif;' +
    'color:rgba(255,255,255,.028);transform:rotate(-12deg);pointer-events:none;user-select:none'
  el.append(seal)

  const card = document.createElement('div')
  card.style.cssText =
    'position:relative;width:min(90vw,560px);padding:38px 34px 30px;text-align:center;' +
    'border-radius:20px;background:linear-gradient(180deg, rgba(30,6,5,.72), rgba(20,4,3,.86));' +
    'border:1px solid rgba(255,138,112,.24);' +
    'box-shadow:0 30px 90px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.07);' +
    'backdrop-filter:blur(10px)'

  const code = document.createElement('p')
  code.textContent = 'GUILIN · CITIZEN ID SUSPENDED'
  code.style.cssText =
    'margin:0 0 18px;font:600 10.5px/1 ui-monospace,monospace;letter-spacing:.34em;' +
    'text-indent:.34em;color:rgba(255,186,170,.62)'

  const icon = document.createElement('div')
  icon.style.cssText =
    'width:52px;height:52px;margin:0 auto 20px;border-radius:50%;display:flex;align-items:center;' +
    'justify-content:center;border:1.5px solid rgba(255,120,95,.55);background:rgba(255,80,55,.1)'
  icon.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 3l9 16H3L12 3z" stroke="#ff9b85" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 9v5" stroke="#ff9b85" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="16.6" r=".95" fill="#ff9b85"/></svg>'

  const title = document.createElement('h1')
  title.textContent = '市民卡已被封禁'
  title.style.cssText =
    'margin:0 0 8px;font:800 clamp(26px,4.4vw,38px)/1.2 system-ui,"PingFang SC",sans-serif;' +
    'letter-spacing:.04em;color:#fff7f4'

  const sub = document.createElement('p')
  sub.textContent = '你的账号当前无法进入网上桂林'
  sub.style.cssText = 'margin:0 0 26px;font:400 13px/1.6 system-ui;color:rgba(255,206,196,.62)'

  const reasonLabel = document.createElement('p')
  reasonLabel.textContent = '封禁理由'
  reasonLabel.style.cssText =
    'margin:0 0 8px;font:600 10.5px/1 ui-monospace,monospace;letter-spacing:.26em;' +
    'color:rgba(255,180,162,.55)'

  const reasonBox = document.createElement('p')
  reasonBox.textContent = reason || '违反市民守则'
  reasonBox.style.cssText =
    'margin:0 0 24px;padding:15px 18px;border-radius:12px;' +
    'background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);' +
    'font:500 15px/1.7 system-ui,"PingFang SC",sans-serif;color:#ffeae4'

  const meta = document.createElement('p')
  meta.textContent = uid ? `市民 UID · ${uid}` : '如需申诉，请联系管理员复核'
  meta.style.cssText =
    'margin:0;font:500 10.5px/1 ui-monospace,monospace;letter-spacing:.2em;color:rgba(255,190,175,.4)'

  card.append(code, icon, title, sub, reasonLabel, reasonBox, meta)
  el.append(card)
  document.body.append(el)
}

/** 进游戏前查一次封禁状态；被封则弹红屏并返回 true */
export async function checkBan(): Promise<boolean> {
  const user = civicUser()
  if (!user) return false
  try {
    const res = await fetch(`/api/check?uid=${encodeURIComponent(user.uid)}`)
    const body = (await res.json()) as {banned?: boolean; reason?: string}
    if (body.banned) {
      showBanScreen(body.reason || '违反市民守则')
      return true
    }
  } catch {
    /* 网络失败就放行，避免离线时进不去 */
  }
  return false
}
