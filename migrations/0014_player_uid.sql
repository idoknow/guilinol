ALTER TABLE users ADD COLUMN uid INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(uid)='integer' AND (uid=0 OR uid BETWEEN 100000 AND 9007199254740991));
WITH numbered AS MATERIALIZED (
  SELECT id, 99999 + row_number() OVER (ORDER BY created_at,id COLLATE BINARY) AS number FROM users
)
UPDATE users SET uid=numbered.number FROM numbered WHERE users.id=numbered.id;
CREATE UNIQUE INDEX users_uid_unique ON users(uid);
CREATE TABLE player_uid_sequence (singleton INTEGER PRIMARY KEY CHECK(singleton=1), last_uid INTEGER NOT NULL);
INSERT INTO player_uid_sequence SELECT 1,coalesce(max(uid),99999) FROM users;
CREATE TRIGGER users_allocate_uid AFTER INSERT ON users WHEN NEW.uid=0 BEGIN
  UPDATE player_uid_sequence SET last_uid=last_uid+1 WHERE singleton=1;
  UPDATE users SET uid=(SELECT last_uid FROM player_uid_sequence WHERE singleton=1) WHERE rowid=NEW.rowid;
END;
CREATE TRIGGER users_uid_immutable BEFORE UPDATE OF uid ON users WHEN OLD.uid<>0 AND NEW.uid<>OLD.uid BEGIN
  SELECT raise(ABORT,'uid cannot change');
END;
