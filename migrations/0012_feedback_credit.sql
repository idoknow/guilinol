-- 反馈上线后在「关于」页署名（IDOK-186）：credit = 几个字的贡献说明，由反馈桥在标记「已上线」时写入。
ALTER TABLE feedback ADD COLUMN credit TEXT;
