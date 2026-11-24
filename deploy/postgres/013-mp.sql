BEGIN;
CREATE TABLE IF NOT EXISTS mp_online_minute (
  ts timestamptz PRIMARY KEY, online integer NOT NULL, connections integer NOT NULL,
  rtt_p50_ms real, out_bytes bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS mp_online_hour (
  ts timestamptz PRIMARY KEY, online real NOT NULL, peak integer NOT NULL, peak_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS mp_sessions (
  instance bigint NOT NULL, id text NOT NULL, uid bigint NOT NULL, name text NOT NULL,
  joined_at timestamptz NOT NULL, left_at timestamptz, last_seen timestamptz NOT NULL,
  reason text, close_code integer, region jsonb, PRIMARY KEY(instance,id)
);
CREATE INDEX IF NOT EXISTS mp_sessions_recent ON mp_sessions(joined_at DESC);
CREATE INDEX IF NOT EXISTS mp_sessions_user ON mp_sessions(uid,joined_at DESC);
COMMIT;
