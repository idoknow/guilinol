BEGIN;
CREATE TABLE IF NOT EXISTS perf_network (
  prefix cidr PRIMARY KEY, country text, region text, city text, isp text
);
CREATE INDEX IF NOT EXISTS perf_network_prefix ON perf_network USING gist(prefix inet_ops);
CREATE TABLE IF NOT EXISTS perf_event (
  received timestamptz NOT NULL DEFAULT now(), batch uuid NOT NULL, session uuid NOT NULL,
  build text, world text, device text, gpu text, country text, region text, city text, isp text,
  kind text NOT NULL, mode text, grid text, context jsonb NOT NULL, fields jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS perf_event_time ON perf_event(received);
CREATE INDEX IF NOT EXISTS perf_event_world ON perf_event(world,received);
CREATE TABLE IF NOT EXISTS perf_daily (
  day date NOT NULL, world text NOT NULL, device text NOT NULL, kind text NOT NULL,
  samples bigint NOT NULL, p50 double precision, p75 double precision, p95 double precision,
  PRIMARY KEY(day,world,device,kind)
);
CREATE TABLE IF NOT EXISTS perf_server (minute timestamptz NOT NULL, sample jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS perf_server_minute ON perf_server(minute);
COMMIT;
