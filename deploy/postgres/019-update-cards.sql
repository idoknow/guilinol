BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_game_entry timestamptz;
UPDATE users SET first_game_entry=to_timestamp(created_at) WHERE first_game_entry IS NULL
  AND EXISTS (SELECT 1 FROM player_saves WHERE user_id=users.id);
CREATE TABLE IF NOT EXISTS update_cards (
  id uuid PRIMARY KEY, slug text NOT NULL UNIQUE, kind text NOT NULL CHECK(kind IN ('gameplay','modeling')),
  title varchar(20) NOT NULL, summary varchar(80) NOT NULL, how_to varchar(60) NOT NULL,
  images jsonb NOT NULL CHECK(jsonb_typeof(images)='array' AND jsonb_array_length(images) BETWEEN 1 AND 3),
  release_sha text NOT NULL, published_at timestamptz NOT NULL DEFAULT clock_timestamp(), active boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS update_cards_feed ON update_cards(published_at,id) WHERE active;
CREATE TABLE IF NOT EXISTS update_card_views (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, card_id uuid NOT NULL REFERENCES update_cards(id) ON DELETE CASCADE,
  action text NOT NULL CHECK(action IN ('viewed','skipped')), at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(user_id,card_id)
);
COMMIT;
