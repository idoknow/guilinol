CREATE TABLE IF NOT EXISTS fishing_catches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  zone_id text NOT NULL, species_id text NOT NULL, grade text NOT NULL,
  weight double precision NOT NULL CHECK (weight > 0), method text NOT NULL,
  caught_at timestamptz NOT NULL DEFAULT clock_timestamp(), client_catch_id uuid NOT NULL,
  UNIQUE(user_id,client_catch_id)
);
CREATE INDEX IF NOT EXISTS fishing_user_time ON fishing_catches(user_id,caught_at DESC);
CREATE INDEX IF NOT EXISTS fishing_zone_player ON fishing_catches(zone_id,user_id,grade);
