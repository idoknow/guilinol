-- 005-social-pending.sql
-- hk01 PostgreSQL 聚合登录待确认表（对齐 migrations/0008_social_pending.sql），幂等

BEGIN;

CREATE TABLE IF NOT EXISTS social_pending (
  token      TEXT PRIMARY KEY,
  intent     TEXT NOT NULL CHECK(intent IN ('login','bind')),
  type       TEXT NOT NULL,
  social_uid TEXT NOT NULL,
  nickname   TEXT NOT NULL DEFAULT '',
  faceimg    TEXT NOT NULL DEFAULT '',
  user_id    TEXT NOT NULL,
  expires    bigint NOT NULL,
  used       integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS social_pending_expires ON social_pending(expires);

COMMIT;
