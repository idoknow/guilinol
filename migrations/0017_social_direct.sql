CREATE TABLE social_identities_next (
  channel TEXT NOT NULL DEFAULT 'legacy' CHECK(channel IN ('legacy','direct')),
  unionid TEXT,
  type          TEXT NOT NULL CHECK(type IN ('qq','wx','alipay','douyin','google','twitter','feishu')),
  social_uid    TEXT NOT NULL,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname      TEXT NOT NULL DEFAULT '',
  faceimg       TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL,
  PRIMARY KEY(channel,type, social_uid)
 );
INSERT INTO social_identities_next (type, social_uid, user_id, nickname, faceimg, created_at, last_login_at, channel, unionid)
SELECT old.type, old.social_uid, old.user_id, old.nickname, old.faceimg, old.created_at, old.last_login_at,
  (SELECT channel FROM social_identities AS src WHERE src.rowid=old.rowid), (SELECT unionid FROM social_identities AS src WHERE src.rowid=old.rowid)
FROM social_identities AS old CROSS JOIN (SELECT 'legacy' AS channel, NULL AS unionid);
DROP TABLE social_identities;
ALTER TABLE social_identities_next RENAME TO social_identities;

CREATE TABLE social_states_next (
  channel TEXT NOT NULL DEFAULT 'legacy' CHECK(channel IN ('legacy','direct')),
  state   TEXT PRIMARY KEY,
  type    TEXT NOT NULL,
  intent  TEXT NOT NULL DEFAULT 'login' CHECK(intent IN ('login','bind','register','migrate','new')),
  user_id TEXT,
  expires INTEGER NOT NULL,
  used    INTEGER NOT NULL DEFAULT 0,
  ip      TEXT NOT NULL,
  CHECK(intent NOT IN ('bind','migrate') OR user_id IS NOT NULL)
 );
INSERT INTO social_states_next (state, type, intent, user_id, expires, used, ip, channel)
SELECT old.state, old.type, old.intent, old.user_id, old.expires, old.used, old.ip,
  (SELECT channel FROM social_states AS src WHERE src.rowid=old.rowid)
FROM social_states AS old CROSS JOIN (SELECT 'legacy' AS channel);
DROP TABLE social_states;
ALTER TABLE social_states_next RENAME TO social_states;

CREATE TABLE social_pending_next (
  channel TEXT NOT NULL DEFAULT 'legacy' CHECK(channel IN ('legacy','direct')),
  unionid TEXT,
  previous_owner TEXT,
  token      TEXT PRIMARY KEY,
  intent     TEXT NOT NULL CHECK(intent IN ('login','bind','register','migrate','new')),
  type       TEXT NOT NULL,
  social_uid TEXT NOT NULL,
  nickname   TEXT NOT NULL DEFAULT '',
  faceimg    TEXT NOT NULL DEFAULT '',
  user_id    TEXT NOT NULL,
  expires    INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
 );
INSERT INTO social_pending_next (token, intent, type, social_uid, nickname, faceimg, user_id, expires, used, channel, unionid, previous_owner)
SELECT old.token, old.intent, old.type, old.social_uid, old.nickname, old.faceimg, old.user_id, old.expires, old.used,
  (SELECT channel FROM social_pending AS src WHERE src.rowid=old.rowid), (SELECT unionid FROM social_pending AS src WHERE src.rowid=old.rowid), (SELECT previous_owner FROM social_pending AS src WHERE src.rowid=old.rowid)
FROM social_pending AS old CROSS JOIN (SELECT 'legacy' AS channel, NULL AS unionid, NULL AS previous_owner);
DROP TABLE social_pending;
ALTER TABLE social_pending_next RENAME TO social_pending;

CREATE TABLE IF NOT EXISTS social_legacy_sessions (digest TEXT PRIMARY KEY REFERENCES sessions(digest) ON DELETE CASCADE, via_legacy INTEGER NOT NULL DEFAULT 1);
CREATE UNIQUE INDEX IF NOT EXISTS social_owner ON social_identities(user_id,channel,type);
CREATE INDEX IF NOT EXISTS social_user ON social_identities(user_id);
CREATE INDEX IF NOT EXISTS social_states_expires ON social_states(expires);
CREATE INDEX IF NOT EXISTS social_pending_expires ON social_pending(expires);
