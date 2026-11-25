-- IDOK-384: 管理面板查询索引优化 + 联机活动记录与玩法耗时汇总表（幂等可重复执行）

-- 1. 管理后台高频查询索引（users/feedback/audit/chat/mp_sessions）
CREATE INDEX IF NOT EXISTS users_created_at ON users (created_at);
CREATE INDEX IF NOT EXISTS feedback_submitted_at ON feedback (submitted_at) WHERE submitted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS feedback_messages_unread ON feedback_messages (feedback_id, id) WHERE author_kind = 'user';
CREATE INDEX IF NOT EXISTS admin_audit_type_id ON admin_audit (target_type, id DESC);
CREATE INDEX IF NOT EXISTS chat_messages_pending ON chat_messages (id DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS chat_messages_uid_id ON chat_messages (uid, id DESC) WHERE sys IS NULL;
CREATE INDEX IF NOT EXISTS mp_sessions_window ON mp_sessions (joined_at, last_seen);
CREATE INDEX IF NOT EXISTS mp_sessions_open ON mp_sessions (instance, id) WHERE left_at IS NULL;

-- 2. 联机账户最近活动流水（每个账户最近在做什么）
CREATE TABLE IF NOT EXISTS mp_activity_log (
  instance bigint NOT NULL,
  seq bigint NOT NULL,
  ts timestamptz NOT NULL,
  session_id text NOT NULL,
  uid bigint NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  activity text,
  detail text,
  duration_sec integer,
  landmark text,
  x real,
  z real,
  PRIMARY KEY (instance, seq)
);
CREATE INDEX IF NOT EXISTS mp_activity_log_ts ON mp_activity_log (ts DESC);
CREATE INDEX IF NOT EXISTS mp_activity_log_uid_ts ON mp_activity_log (uid, ts DESC);
CREATE INDEX IF NOT EXISTS mp_activity_log_activity_ts ON mp_activity_log (activity, ts DESC) WHERE activity IS NOT NULL;
CREATE INDEX IF NOT EXISTS mp_activity_log_end_ts ON mp_activity_log (ts DESC) WHERE kind = 'activity_end' AND activity IS NOT NULL;

-- 3. 联机会话内各玩法累计时长（用于 60s 采样幂等差值，不重算不丢秒）
CREATE TABLE IF NOT EXISTS mp_session_activity (
  instance bigint NOT NULL,
  session_id text NOT NULL,
  uid bigint NOT NULL,
  activity text NOT NULL,
  seconds integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (instance, session_id, activity)
);
CREATE INDEX IF NOT EXISTS mp_session_activity_updated ON mp_session_activity (updated_at DESC);

-- 4. 玩法占用玩家时间按小时汇总（用于 24h/7d/30d/90d 对比分析与趋势）
CREATE TABLE IF NOT EXISTS mp_gameplay_hour (
  hour timestamptz NOT NULL,
  activity text NOT NULL,
  seconds bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (hour, activity)
);

-- 5. 玩法每日每账户占用时长（上海日界，精确统计各玩法独立参与人数与人均时长）
CREATE TABLE IF NOT EXISTS mp_gameplay_player_day (
  day date NOT NULL,
  activity text NOT NULL,
  uid bigint NOT NULL,
  seconds integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, activity, uid)
);
CREATE INDEX IF NOT EXISTS mp_gameplay_player_day_uid ON mp_gameplay_player_day (uid, day DESC);
