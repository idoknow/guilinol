-- 009-feedback-credit.sql（对齐 migrations/0012_feedback_credit.sql，IDOK-186）
-- feedback.credit：反馈上线后在「关于」页署名用的几个字，由反馈桥在标记 live 时写入。幂等。
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS credit TEXT;
