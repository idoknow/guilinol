-- 003-player-saves.sql
-- hk01 PostgreSQL 玩家商圈云端存档与幂等账本迁移（对齐 migrations/0006_player_saves.sql）
-- 依赖 001-schema.sql（users.id TEXT PRIMARY KEY）

BEGIN;

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

COMMIT;
