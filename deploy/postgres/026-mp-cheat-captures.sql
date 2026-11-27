-- 联机反外挂自动截图取证（IDOK-458）：保存服务端签名遥测与 S3 截图索引
BEGIN;
CREATE TABLE IF NOT EXISTS mp_cheat_captures (
  id              uuid PRIMARY KEY,
  uid             bigint NOT NULL,
  nickname        text NOT NULL DEFAULT '',
  fp              text NOT NULL DEFAULT '',
  kind            text NOT NULL,
  captured_at     bigint NOT NULL,
  uploaded_at     bigint NOT NULL,
  state_label     text NOT NULL DEFAULT '',
  server_state    text NOT NULL DEFAULT '',
  speed_ms        real NOT NULL DEFAULT 0,
  client_speed_ms real,
  pos_x           real NOT NULL DEFAULT 0,
  pos_y           real NOT NULL DEFAULT 0,
  pos_z           real NOT NULL DEFAULT 0,
  attempt_x       real,
  attempt_y       real,
  attempt_z       real,
  landmark        text NOT NULL DEFAULT '',
  landmark_dist   integer,
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  image_key       text NOT NULL,
  image_bytes     integer NOT NULL,
  width           integer,
  height          integer
);
CREATE INDEX IF NOT EXISTS mp_cheat_captures_at ON mp_cheat_captures (captured_at DESC);
CREATE INDEX IF NOT EXISTS mp_cheat_captures_uid_at ON mp_cheat_captures (uid, captured_at DESC);
COMMIT;
