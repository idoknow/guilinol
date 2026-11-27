-- 按提交人索引反馈状态与更新时间（用于管理员/专职 Agent 定向检索与按提交人筛选）
CREATE INDEX IF NOT EXISTS feedback_user_status ON feedback (user_id, status, updated_at);
