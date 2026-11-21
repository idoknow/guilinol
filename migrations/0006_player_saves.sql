-- 0006_player_saves.sql
-- 玩家商圈玩法云端存档与幂等账本迁移草案（Stage 1A / IDOK-122）
-- 严格使用 ANSI 标准数据类型（TEXT / INTEGER），无 AUTOINCREMENT 或数据库专有类型，
-- 同时兼容 Cloudflare D1 (SQLite) 与 hk01 k3s (PostgreSQL, deploy/postgres/001-schema.sql)。
-- 不修改既有 0001_auth.sql ~ 0005_feedback_chat.sql 任何表结构。

CREATE TABLE IF NOT EXISTS player_saves (
  user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  schema_version    INTEGER NOT NULL DEFAULT 2,
  revision          INTEGER NOT NULL DEFAULT 1,
  payload_json      TEXT NOT NULL,
  client_updated_at INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_player_saves_updated_at
  ON player_saves(updated_at);

CREATE TABLE IF NOT EXISTS player_ledger_txns (
  tx_id           TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  kind            TEXT NOT NULL,
  delta           INTEGER NOT NULL,
  balance_after   INTEGER NOT NULL,
  ref_id          TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  UNIQUE(user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_player_ledger_user_time
  ON player_ledger_txns(user_id, created_at DESC);
