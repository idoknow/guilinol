-- 按小时汇总：滚动 24 小时的后台总览无法用「整日」汇总表（窗口跨不到整日边界，
-- partitions() 只能退回扫原始 perf_event，单次 12-20 秒并撞 15s 查询超时）。
-- 小时粒度可覆盖任意窗口：最大裸扫段 ≤ 1 小时。
CREATE TABLE IF NOT EXISTS perf_summary_hour (hour timestamptz PRIMARY KEY);
CREATE TABLE IF NOT EXISTS perf_session_hour (
  hour timestamptz NOT NULL,
  session uuid NOT NULL,
  vid text,
  device text,
  region text,
  seen timestamptz,
  is_new boolean,
  is_returning boolean,
  failed boolean,
  lost double precision,
  duration double precision,
  has_chunk boolean,
  has_fps boolean,
  has_playable boolean
);
CREATE INDEX IF NOT EXISTS perf_session_hour_hour ON perf_session_hour (hour);
CREATE TABLE IF NOT EXISTS perf_value_hour (
  hour timestamptz NOT NULL,
  metric text NOT NULL,
  device text,
  region text,
  value double precision NOT NULL,
  n bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS perf_value_hour_key ON perf_value_hour (hour, metric);
