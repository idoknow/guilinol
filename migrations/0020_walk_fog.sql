-- 0020_walk_fog.sql
-- 地图迷雾（IDOK-588）：每个账号走过哪些 32 m 格子。
-- 严格 ANSI（TEXT / INTEGER），同时兼容 Cloudflare D1（SQLite）与 hk01 PostgreSQL（deploy/postgres/033-walk-fog.sql）。
-- cells 是逗号分隔的格子号文本；count 冗余存一份，方便统计与展示。
CREATE TABLE IF NOT EXISTS walk_fog (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  cells      TEXT NOT NULL DEFAULT '',
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_walk_fog_updated_at
  ON walk_fog(updated_at);
