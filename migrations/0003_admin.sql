ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin'));
ALTER TABLE users ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
UPDATE users SET created_at=unixepoch();
CREATE TRIGGER users_registration_time AFTER INSERT ON users WHEN NEW.created_at=0 BEGIN
  UPDATE users SET created_at=unixepoch() WHERE id=NEW.id;
END;
