BEGIN;
ALTER TABLE chat_words ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE chat_words DROP CONSTRAINT IF EXISTS chat_words_action_check;
ALTER TABLE chat_words ADD CONSTRAINT chat_words_action_check CHECK(action IN ('block','review','allow'));
CREATE TABLE IF NOT EXISTS chat_seed_seen(source text NOT NULL,word text NOT NULL,PRIMARY KEY(source,word));
COMMIT;
