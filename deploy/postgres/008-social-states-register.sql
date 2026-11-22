-- 008-social-states-register.sql
-- 006 只放开了 social_pending.intent='register'，漏了 social_states：
-- 带 intent=register 的 /api/auth/social/start 一律撞 CHECK 返回 500（面板对注册意图的预取也在撞）。幂等。
BEGIN;
ALTER TABLE social_states DROP CONSTRAINT IF EXISTS social_states_intent_check;
ALTER TABLE social_states ADD CONSTRAINT social_states_intent_check
  CHECK (intent IN ('login','bind','register'));
COMMIT;
