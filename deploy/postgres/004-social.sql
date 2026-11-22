-- 004-social.sql
-- hk01 PostgreSQL 聚合登录绑定表（对齐 migrations/0007_social.sql），幂等

BEGIN;

CREATE TABLE IF NOT EXISTS social_identities (
  type          TEXT NOT NULL CHECK(type IN ('qq','wx','alipay','douyin','google','twitter','feishu')),
  social_uid    TEXT NOT NULL,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname      TEXT NOT NULL DEFAULT '',
  faceimg       TEXT NOT NULL DEFAULT '',
  created_at    bigint NOT NULL,
  last_login_at bigint NOT NULL,
  PRIMARY KEY(type, social_uid)
);

CREATE UNIQUE INDEX IF NOT EXISTS social_owner ON social_identities(user_id, type);
CREATE INDEX IF NOT EXISTS social_user ON social_identities(user_id);

CREATE TABLE IF NOT EXISTS social_states (
  state   TEXT PRIMARY KEY,
  type    TEXT NOT NULL,
  intent  TEXT NOT NULL DEFAULT 'login' CHECK(intent IN ('login','bind')),
  user_id TEXT,
  expires bigint NOT NULL,
  used    integer NOT NULL DEFAULT 0,
  ip      TEXT NOT NULL,
  CHECK(intent <> 'bind' OR user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS social_states_expires ON social_states(expires);

COMMIT;
