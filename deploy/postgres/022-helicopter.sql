BEGIN;
CREATE TABLE IF NOT EXISTS helicopter_queue (
  ticket bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  passenger text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('low','high','dynamic')),
  offered_at bigint,
  t0 bigint,
  last_seen bigint NOT NULL,
  route_version text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS helicopter_single_aircraft ON helicopter_queue ((true)) WHERE offered_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS helicopter_notice (
  passenger text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code text NOT NULL
);
COMMIT;
