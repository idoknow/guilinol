BEGIN;
CREATE TABLE IF NOT EXISTS web_ip_bans(ip inet PRIMARY KEY, reason text NOT NULL, expires timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS web_guard_events(ip inet NOT NULL, kind text NOT NULL, subject text, at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS web_guard_window ON web_guard_events(ip,kind,at);
CREATE INDEX IF NOT EXISTS web_guard_retention ON web_guard_events(at);
CREATE TABLE IF NOT EXISTS web_guard_windows(ip inet PRIMARY KEY, times timestamptz[] NOT NULL, touched timestamptz NOT NULL);
CREATE OR REPLACE FUNCTION web_guard_admit(address inet) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE moment timestamptz:=clock_timestamp(); recent timestamptz[];
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(host(address),4682));
 SELECT ARRAY(SELECT stamp FROM unnest(times) stamp WHERE stamp>moment-interval '60 seconds') INTO recent FROM web_guard_windows WHERE ip=address;
 IF cardinality(recent)>=120 THEN RETURN false; END IF;
 INSERT INTO web_guard_windows VALUES(address,array_append(coalesce(recent,ARRAY[]::timestamptz[]),moment),moment)
 ON CONFLICT(ip) DO UPDATE SET times=excluded.times,touched=excluded.touched;
 RETURN true;
END $$;
CREATE TABLE IF NOT EXISTS web_guard_counts(bucket timestamptz NOT NULL, kind text NOT NULL, hits bigint NOT NULL, PRIMARY KEY(bucket,kind));
CREATE OR REPLACE FUNCTION web_guard_hit(category text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO web_guard_counts VALUES(date_trunc('minute',now()),category,1)
 ON CONFLICT(bucket,kind) DO UPDATE SET hits=web_guard_counts.hits+1
$$;
CREATE OR REPLACE FUNCTION web_guard_event(address inet, category text, identity_hash text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE duration interval;
BEGIN
 IF address IS NULL THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(host(address),4682));
 IF EXISTS(SELECT FROM web_ip_bans WHERE ip=address AND expires>now()) THEN RETURN true; END IF;
 INSERT INTO web_guard_events(ip,kind,subject) VALUES(address,category,identity_hash);
 IF category IN ('honeypot','scanner') THEN duration:=interval '24 hours';
 ELSIF category='login-failed' AND (SELECT count(*) FROM web_guard_events WHERE ip=address AND kind=category AND at>now()-interval '24 hours')>=20 THEN duration:=interval '24 hours';
 ELSIF category='login-attempt' AND (SELECT count(DISTINCT subject) FROM web_guard_events WHERE ip=address AND kind=category AND at>now()-interval '30 minutes')>=15 THEN duration:=interval '2 hours';
 ELSIF category IN ('waf','rate') AND (SELECT count(*) FROM web_guard_events WHERE ip=address AND kind IN ('waf','rate') AND at>now()-interval '10 minutes')>=20 THEN duration:=interval '1 hour';
 END IF;
 IF duration IS NULL THEN RETURN false; END IF;
 INSERT INTO web_ip_bans VALUES(address,category,now()+duration) ON CONFLICT(ip) DO UPDATE SET reason=excluded.reason,expires=excluded.expires;
 INSERT INTO admin_audit(actor_id,action,target_type,target_id,detail) VALUES('web-guard','web.ip.ban','ip',host(address),jsonb_build_object('reason',category,'expires',now()+duration));
 PERFORM web_guard_hit(CASE WHEN category IN ('waf','rate') THEN 'auto-ban' WHEN category IN ('scanner','honeypot') THEN 'edge-ban' ELSE category END);
 RETURN true;
END $$;
COMMIT;
