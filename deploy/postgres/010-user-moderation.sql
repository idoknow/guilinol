BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_method TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_by TEXT NOT NULL DEFAULT '';

UPDATE users SET signup_method = COALESCE(
  (SELECT type FROM social_identities s WHERE s.user_id=users.id
     AND abs(s.created_at-users.created_at)<=600 ORDER BY s.created_at,s.type LIMIT 1),
  (SELECT type FROM social_identities s WHERE s.user_id=users.id
     AND users.email_placeholder=1 ORDER BY s.created_at,s.type LIMIT 1),
  'email') WHERE signup_method IS NULL;
ALTER TABLE users ALTER COLUMN signup_method SET DEFAULT 'email';
ALTER TABLE users ALTER COLUMN signup_method SET NOT NULL;
COMMIT;
