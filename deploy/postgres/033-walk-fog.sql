-- 033-walk-fog.sql
-- 地图迷雾（IDOK-588）到 hk01 k3s PostgreSQL 的镜像，与 migrations/0020_walk_fog.sql 等价。
-- 格子口径见 lib/fog.ts（IDOK-605 起每格 8 m，行里另存 version，见 034-walk-fog-version.sql）。
CREATE TABLE IF NOT EXISTS walk_fog (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  cells      TEXT NOT NULL DEFAULT '',
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_walk_fog_updated_at
  ON walk_fog(updated_at);
