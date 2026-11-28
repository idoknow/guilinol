-- 0021_walk_fog_version.sql
-- 地图迷雾（IDOK-590）：格子口径从 32 m 收到 8 m、点亮半径从 60 m 收到 10 m。
-- 旧记录的格子号在新网格上会落到完全不同的位置，所以行里存一份口径号（lib/fog.ts 的 FOG_VERSION），
-- 对不上的记录一律按「没开过图」处理。默认值 1 正好是旧口径，无需回填。
ALTER TABLE walk_fog ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
