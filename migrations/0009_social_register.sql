-- 第三方注册：允许 social_pending.intent='register'
-- SQLite 不能改 CHECK，只能重建表（表里是 5 分钟内的一次性数据，重建无损）
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
