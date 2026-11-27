BEGIN;
ALTER TABLE mp_sessions ADD COLUMN IF NOT EXISTS fp text;
CREATE INDEX IF NOT EXISTS mp_sessions_client_ip ON mp_sessions(client_ip);
CREATE INDEX IF NOT EXISTS mp_sessions_ip_recent ON mp_sessions(client_ip, joined_at DESC);
CREATE INDEX IF NOT EXISTS mp_sessions_subnet ON mp_sessions USING gist ((client_ip::inet) inet_ops);
CREATE INDEX IF NOT EXISTS mp_devices_ip24 ON mp_devices(ip24);
CREATE INDEX IF NOT EXISTS mp_devices_fp ON mp_devices(fp);
-- mp_bans already has a unique index on (kind,value) for both uid and fp.
COMMIT;
