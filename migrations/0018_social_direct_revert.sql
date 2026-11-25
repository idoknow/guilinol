DELETE FROM social_identities WHERE rowid IN (
  SELECT old.rowid FROM social_identities AS old CROSS JOIN (SELECT 'legacy' AS channel) AS fallback
  WHERE (SELECT channel FROM social_identities AS src WHERE src.rowid=old.rowid)='direct'
);
DELETE FROM social_states WHERE rowid IN (
  SELECT old.rowid FROM social_states AS old CROSS JOIN (SELECT 'legacy' AS channel) AS fallback
  WHERE (SELECT channel FROM social_states AS src WHERE src.rowid=old.rowid)='direct'
) OR intent IN ('migrate','new');
DELETE FROM social_pending WHERE rowid IN (
  SELECT old.rowid FROM social_pending AS old CROSS JOIN (SELECT 'legacy' AS channel) AS fallback
  WHERE (SELECT channel FROM social_pending AS src WHERE src.rowid=old.rowid)='direct'
) OR intent IN ('migrate','new');

CREATE TABLE social_identities_next (
  type          TEXT NOT NULL CHECK(type IN ('qq','wx','alipay','douyin','google','twitter','feishu')),
  social_uid    TEXT NOT NULL,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname      TEXT NOT NULL DEFAULT '',
  faceimg       TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL,
  PRIMARY KEY(type, social_uid)
);


INSERT INTO social_identities_next(type,social_uid,user_id,nickname,faceimg,created_at,last_login_at)
  SELECT type,social_uid,user_id,nickname,faceimg,created_at,last_login_at FROM social_identities;
DROP TABLE social_identities;
ALTER TABLE social_identities_next RENAME TO social_identities;
CREATE UNIQUE INDEX IF NOT EXISTS social_owner ON social_identities(user_id, type);
CREATE INDEX IF NOT EXISTS social_user ON social_identities(user_id);

CREATE TABLE social_states_next (
  state   TEXT PRIMARY KEY,
  type    TEXT NOT NULL,
  intent  TEXT NOT NULL DEFAULT 'login' CHECK(intent IN ('login','bind','register')),
  user_id TEXT,
  expires INTEGER NOT NULL,
  used    INTEGER NOT NULL DEFAULT 0,
  ip      TEXT NOT NULL,
  CHECK(intent <> 'bind' OR user_id IS NOT NULL)
);

INSERT INTO social_states_next(state,type,intent,user_id,expires,used,ip)
  SELECT state,type,intent,user_id,expires,used,ip FROM social_states;

DROP TABLE social_states;
ALTER TABLE social_states_next RENAME TO social_states;
CREATE INDEX IF NOT EXISTS social_states_expires ON social_states(expires);

CREATE TABLE social_pending_next (
  token      TEXT PRIMARY KEY,
  intent     TEXT NOT NULL CHECK(intent IN ('login','bind','register')),
  type       TEXT NOT NULL,
  social_uid TEXT NOT NULL,
  nickname   TEXT NOT NULL DEFAULT '',
  faceimg    TEXT NOT NULL DEFAULT '',
  user_id    TEXT NOT NULL,
  expires    INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);

INSERT INTO social_pending_next(token,intent,type,social_uid,nickname,faceimg,user_id,expires,used)
  SELECT token,intent,type,social_uid,nickname,faceimg,user_id,expires,used FROM social_pending;

DROP TABLE social_pending;
ALTER TABLE social_pending_next RENAME TO social_pending;
CREATE INDEX IF NOT EXISTS social_pending_expires ON social_pending(expires);

DROP TABLE IF EXISTS social_legacy_sessions;
