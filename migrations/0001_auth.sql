CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL,
  salt TEXT NOT NULL, digest TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sessions (
  digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE email_codes (
  email TEXT NOT NULL, purpose TEXT NOT NULL, digest TEXT NOT NULL, expires INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(email,purpose)
);
CREATE TABLE mail_events (ip TEXT NOT NULL, email TEXT NOT NULL, sent INTEGER NOT NULL);
CREATE INDEX mail_ip ON mail_events(ip,sent);
CREATE INDEX mail_email ON mail_events(email,sent);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, until INTEGER NOT NULL, hits INTEGER NOT NULL);
