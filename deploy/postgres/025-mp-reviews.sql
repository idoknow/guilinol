BEGIN;
ALTER TABLE mp_bans ADD COLUMN IF NOT EXISTS record_id text;
UPDATE mp_bans SET record_id='legacy-' || id WHERE record_id IS NULL;
CREATE TABLE IF NOT EXISTS mp_reviews (
  id uuid PRIMARY KEY, uid bigint NOT NULL, evidence jsonb NOT NULL,
  opened_ms bigint NOT NULL, resolved_ms bigint, ban_id text
);
CREATE UNIQUE INDEX IF NOT EXISTS mp_reviews_pending ON mp_reviews(uid) WHERE resolved_ms IS NULL;
COMMIT;
