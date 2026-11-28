-- 封禁申诉结构化字段与自动初审摘要（IDOK-503 P6）
BEGIN;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS ban_record_id text;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS appeal_triage jsonb;
CREATE INDEX IF NOT EXISTS feedback_ban_record_idx ON feedback (ban_record_id) WHERE ban_record_id IS NOT NULL;
COMMIT;
