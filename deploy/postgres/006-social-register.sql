-- 006-social-register.sql
-- 允许 social_pending.intent='register'（第三方注册：验证邮箱+设置密码后才建号），幂等
BEGIN;

ALTER TABLE social_pending DROP CONSTRAINT IF EXISTS social_pending_intent_check;
ALTER TABLE social_pending ADD CONSTRAINT social_pending_intent_check
  CHECK (intent IN ('login','bind','register'));

COMMIT;
