BEGIN;
CREATE TABLE IF NOT EXISTS admin_audit (
  id bigserial PRIMARY KEY, actor_id text NOT NULL, action text NOT NULL,
  target_type text NOT NULL, target_id text NOT NULL, detail jsonb NOT NULL,
  created_at bigint NOT NULL DEFAULT unixepoch()
);
CREATE INDEX IF NOT EXISTS admin_audit_target ON admin_audit(target_type,target_id,id DESC);
CREATE INDEX IF NOT EXISTS perf_event_kind_time ON perf_event(kind,received);
ALTER TABLE perf_event ADD COLUMN IF NOT EXISTS batch_position smallint NOT NULL DEFAULT 0;
-- Persist the two counters once per minute, including historical samples.
CREATE OR REPLACE FUNCTION perf_route_count(data jsonb, min_status integer)
RETURNS bigint LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(sum((route->>'count')::bigint),0)::bigint
  FROM jsonb_array_elements(data->'routes') route WHERE (route->>'status')::int >= min_status
$$;
ALTER TABLE perf_server ADD COLUMN IF NOT EXISTS requests bigint GENERATED ALWAYS AS (perf_route_count(sample,0)) STORED;
ALTER TABLE perf_server ADD COLUMN IF NOT EXISTS errors5xx bigint GENERATED ALWAYS AS (perf_route_count(sample,500)) STORED;
-- Completed UTC days. The marker and both summaries are committed together.
CREATE TABLE IF NOT EXISTS perf_summary_day (day timestamptz PRIMARY KEY);
CREATE TABLE IF NOT EXISTS perf_session_day (
  day timestamptz NOT NULL, session uuid NOT NULL, vid text, device text, region text,
  seen timestamptz NOT NULL, is_new boolean, is_returning boolean, failed boolean,
  lost double precision, duration double precision, has_chunk boolean, has_fps boolean, has_playable boolean
);
CREATE INDEX IF NOT EXISTS perf_session_day_time ON perf_session_day(day);
CREATE TABLE IF NOT EXISTS perf_value_day (
  day timestamptz NOT NULL, metric text NOT NULL, device text, region text,
  value double precision NOT NULL, n bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS perf_value_day_key ON perf_value_day(metric,day);
COMMIT;
