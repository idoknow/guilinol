CREATE TABLE feedback (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
 title TEXT NOT NULL, body TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL,
 heading REAL, landmark_id TEXT, status TEXT NOT NULL DEFAULT 'draft',
 multica_issue TEXT, pr_url TEXT, submitted_at INTEGER,
 created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX feedback_quota ON feedback(user_id,submitted_at);
CREATE INDEX feedback_pending ON feedback(status,updated_at);
CREATE TABLE feedback_photos (
 feedback_id TEXT NOT NULL REFERENCES feedback(id), n INTEGER NOT NULL CHECK(n BETWEEN 1 AND 20),
 r2_key TEXT NOT NULL, bytes INTEGER NOT NULL, mime TEXT NOT NULL, view_label TEXT,
 exif_lat REAL, exif_lon REAL, exif_dir REAL, exif_time TEXT, ready INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(feedback_id,n)
);
CREATE TABLE feedback_events (
 id INTEGER PRIMARY KEY, feedback_id TEXT NOT NULL REFERENCES feedback(id), status TEXT NOT NULL,
 message TEXT NOT NULL, screenshot_url TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX feedback_timeline ON feedback_events(feedback_id,id);
