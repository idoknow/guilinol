BEGIN;
CREATE TABLE IF NOT EXISTS chat_settings (id boolean PRIMARY KEY CHECK(id), config jsonb NOT NULL);
INSERT INTO chat_settings VALUES(true,'{"unmoderated_policy":"pending","radius":60,"max_length":100,"near_ms":1500,"world_ms":10000,"window_hours":24,"threshold":3,"steps_minutes":[60,1440,10080]}') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS chat_messages (
 id bigserial PRIMARY KEY, ch text NOT NULL CHECK(ch IN ('world','near')), uid bigint NOT NULL, peer text NOT NULL, name text NOT NULL,
 cid text NOT NULL, text text NOT NULL, x float8 NOT NULL,z float8 NOT NULL, sys text,
 status text NOT NULL CHECK(status IN ('normal','blocked','pending','deleted')), provider text NOT NULL,label text NOT NULL,summary jsonb,
 created_at bigint NOT NULL, processed_by text, processed_at bigint, UNIQUE(uid,cid));
CREATE INDEX IF NOT EXISTS chat_history ON chat_messages(ch,id DESC) WHERE status='normal';
CREATE INDEX IF NOT EXISTS chat_sender_channel ON chat_messages(uid,ch,id DESC);
CREATE INDEX IF NOT EXISTS chat_violations ON chat_messages(uid,created_at) WHERE status='blocked';
CREATE TABLE IF NOT EXISTS chat_mutes(id bigserial PRIMARY KEY, uid bigint NOT NULL, until_ms bigint NOT NULL,reason text NOT NULL,source text NOT NULL,actor text NOT NULL,created_at bigint NOT NULL);
CREATE INDEX IF NOT EXISTS chat_mute_uid ON chat_mutes(uid,id DESC);
CREATE TABLE IF NOT EXISTS chat_words(id bigserial PRIMARY KEY, word text UNIQUE NOT NULL,category text NOT NULL,action text NOT NULL CHECK(action IN ('block','review')),enabled boolean NOT NULL,actor text NOT NULL,updated_at bigint NOT NULL);
COMMIT;
