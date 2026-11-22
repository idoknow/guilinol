-- 聚合登录：回调换到用户信息后先落一条 pending，等用户确认才真正登录/绑定。
-- 上游回调不带 state，无法证明 code 属于本次流程，这一步是防登录/绑定 CSRF 的关键。
CREATE TABLE IF NOT EXISTS social_pending (
  token      TEXT PRIMARY KEY,          -- sha256(浏览器 cookie 里的随机值)
  intent     TEXT NOT NULL CHECK(intent IN ('login','bind')),
  type       TEXT NOT NULL,
  social_uid TEXT NOT NULL,
  nickname   TEXT NOT NULL DEFAULT '',
  faceimg    TEXT NOT NULL DEFAULT '',
  user_id    TEXT NOT NULL,             -- login: 已绑定账号；bind: 发起绑定的会话用户
  expires    INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS social_pending_expires ON social_pending(expires);
