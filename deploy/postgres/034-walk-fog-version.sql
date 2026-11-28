-- 034-walk-fog-version.sql
-- 地图迷雾（IDOK-605）到 hk01 k3s PostgreSQL 的镜像，与 migrations/0021_walk_fog_version.sql 等价。
-- 口径号对不上的旧记录按「没开过图」处理，默认值 1 正好是旧口径。
ALTER TABLE walk_fog ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
