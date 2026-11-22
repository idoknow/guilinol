CREATE TABLE IF NOT EXISTS social_identities (
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
CREATE UNIQUE INDEX IF NOT EXISTS social_owner ON social_identities(user_id, type);
CREATE INDEX IF NOT EXISTS social_user ON social_identities(user_id);

-- 聚合登录状态：发起时写一行，回调时一次性消费。
-- intent='bind' 的行必须带 user_id，回调时核对当前会话用户，防止 code 被串到别人账号。
CREATE TABLE IF NOT EXISTS social_states (
  state   TEXT PRIMARY KEY,
  type    TEXT NOT NULL,
  intent  TEXT NOT NULL DEFAULT 'login' CHECK(intent IN ('login','bind')),
  user_id TEXT,
  expires INTEGER NOT NULL,
  used    INTEGER NOT NULL DEFAULT 0,
  ip      TEXT NOT NULL,
  CHECK(intent <> 'bind' OR user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS social_states_expires ON social_states(expires);
