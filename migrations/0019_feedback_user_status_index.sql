CREATE INDEX IF NOT EXISTS feedback_user_status ON feedback(user_id, status, updated_at);
