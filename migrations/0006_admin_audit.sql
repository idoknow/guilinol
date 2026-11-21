CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY, actor_id text NOT NULL, action text NOT NULL,
  target_type text NOT NULL, target_id text NOT NULL, detail text NOT NULL,
  created_at bigint NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS admin_audit_target ON admin_audit(target_type,target_id,id DESC);
