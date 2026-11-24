BEGIN;
ALTER TABLE chat_words ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE chat_words DROP CONSTRAINT IF EXISTS chat_words_action_check;
ALTER TABLE chat_words ADD CONSTRAINT chat_words_action_check CHECK(action IN ('block','review','allow'));
CREATE TABLE IF NOT EXISTS chat_seed_seen(source text NOT NULL,word text NOT NULL,PRIMARY KEY(source,word));
WITH first_run AS (
  INSERT INTO chat_seed_seen VALUES ('migration','016-local-default') ON CONFLICT DO NOTHING RETURNING 1
), changed AS (
  UPDATE chat_settings SET config=config||'{"unmoderated_policy":"local_only"}'::jsonb
  WHERE id AND config->>'unmoderated_policy'='pending' AND EXISTS(SELECT 1 FROM first_run)
    AND NOT EXISTS(SELECT 1 FROM admin_audit WHERE action='chat.settings') RETURNING 1
)
INSERT INTO admin_audit(actor_id,action,target_type,target_id,detail)
SELECT 'migration','chat.settings','chat','config','{"reason":"016: adopt local lexicon default","unmoderated_policy":"local_only"}'::jsonb FROM changed;
COMMIT;
