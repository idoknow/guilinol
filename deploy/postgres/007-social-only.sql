-- 第三方登录/注册不再强制绑定邮箱：占位邮箱账号打标记
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_placeholder smallint NOT NULL DEFAULT 0;
