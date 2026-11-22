-- 第三方注册：social_states.intent 也要允许 'register'（0009 只改了 social_pending）
-- SQLite 不能改 CHECK，只能重建表（state 是 10 分钟内的一次性数据，重建无损）
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
