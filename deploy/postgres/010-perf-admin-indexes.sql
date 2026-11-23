-- 管理后台聚合查询的索引。
--
-- 后台按 device / gpu / build 聚合走的是 kind='window' 的窗口事件；
-- 单独建部分索引，避免和 probe / chunk / resource 那些行抢同一棵树。
--
-- 注：不要给 `grid IS NOT NULL` 建部分索引 —— 实测 74% 的行都有 grid（17.9 万 / 24.2 万），
-- 建完规划器改走 index scan，24 小时那条网格查询从 933ms 变成 2556ms，已经回滚。

CREATE INDEX IF NOT EXISTS perf_event_window_time ON perf_event (received) WHERE kind = 'window';

-- 统计信息更新一次（perf_event 24 万行 / 255MB，规划器拿旧统计容易选错计划）
ANALYZE perf_event;
