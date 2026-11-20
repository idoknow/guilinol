ALTER TABLE users ADD COLUMN notify_email INTEGER NOT NULL DEFAULT 1;
ALTER TABLE feedback ADD COLUMN admin_read_id INTEGER NOT NULL DEFAULT 0;
CREATE TABLE feedback_messages(id INTEGER PRIMARY KEY,feedback_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,author_kind TEXT NOT NULL CHECK(author_kind IN ('user','admin','agent')),author_name TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL DEFAULT(unixepoch()),relayed_at INTEGER,source TEXT,UNIQUE(feedback_id,source));
CREATE INDEX feedback_chat ON feedback_messages(feedback_id,created_at,id);
CREATE TABLE feedback_mail(feedback_id TEXT PRIMARY KEY REFERENCES feedback(id) ON DELETE CASCADE, summary TEXT NOT NULL DEFAULT '', next_at INTEGER NOT NULL DEFAULT 0);
CREATE TRIGGER notify_feedback_event AFTER INSERT ON feedback_events BEGIN
 INSERT INTO feedback_mail(feedback_id,summary) VALUES(NEW.feedback_id,substr(NEW.message,1,200)) ON CONFLICT(feedback_id) DO UPDATE SET summary=substr(trim(summary||char(10)||excluded.summary),-200); END;
CREATE TRIGGER notify_feedback_message AFTER INSERT ON feedback_messages WHEN NEW.author_kind!='user' BEGIN
 INSERT INTO feedback_mail(feedback_id,summary) VALUES(NEW.feedback_id,substr(NEW.body,1,200)) ON CONFLICT(feedback_id) DO UPDATE SET summary=substr(trim(summary||char(10)||excluded.summary),-200); END;
