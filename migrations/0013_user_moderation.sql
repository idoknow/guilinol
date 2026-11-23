ALTER TABLE users ADD COLUMN signup_method TEXT NOT NULL DEFAULT 'email';
ALTER TABLE users ADD COLUMN banned_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN ban_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN banned_by TEXT NOT NULL DEFAULT '';

UPDATE users SET signup_method = COALESCE(
  (SELECT type FROM social_identities s WHERE s.user_id=users.id
     AND abs(s.created_at-users.created_at)<=600 ORDER BY s.created_at,s.type LIMIT 1),
  (SELECT type FROM social_identities s WHERE s.user_id=users.id
     AND users.email_placeholder=1 ORDER BY s.created_at,s.type LIMIT 1),
  'email');
