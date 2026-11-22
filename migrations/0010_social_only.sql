-- 第三方登录/注册不再强制绑定邮箱（2026-11-22）：
-- 没有真实邮箱的账号用占位地址（*@social.invalid），并用 email_placeholder=1 标记，
-- 这样既能保留 users.email 的 UNIQUE NOT NULL，也能在界面上显示「未绑定邮箱」。
ALTER TABLE users ADD COLUMN email_placeholder INTEGER NOT NULL DEFAULT 0;
