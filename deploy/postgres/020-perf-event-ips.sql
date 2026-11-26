-- 为遥测与联机会话保留真实客户端 IP（client_ip）与 CDN 节点 IP（node_ip），幂等可重复执行。
BEGIN;
ALTER TABLE perf_event ADD COLUMN IF NOT EXISTS client_ip text;
ALTER TABLE perf_event ADD COLUMN IF NOT EXISTS node_ip text;
ALTER TABLE mp_sessions ADD COLUMN IF NOT EXISTS client_ip text;
ALTER TABLE mp_sessions ADD COLUMN IF NOT EXISTS node_ip text;
COMMIT;
