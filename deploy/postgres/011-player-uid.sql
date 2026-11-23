BEGIN;
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_attribute WHERE attrelid='users'::regclass AND attname='uid' AND NOT attisdropped) THEN
    ALTER TABLE users ADD COLUMN uid bigint;
    WITH numbered AS (
      SELECT id, 99999 + row_number() OVER (ORDER BY created_at,id COLLATE "C") AS number FROM users
    )
    UPDATE users SET uid=numbered.number FROM numbered WHERE users.id=numbered.id;
    ALTER TABLE users ALTER COLUMN uid SET NOT NULL,
      ADD CONSTRAINT users_uid_unique UNIQUE(uid), ADD CHECK(uid BETWEEN 100000 AND 9007199254740991);
    ALTER TABLE users ALTER COLUMN uid ADD GENERATED ALWAYS AS IDENTITY (START WITH 100000);
    EXECUTE format('ALTER TABLE users ALTER COLUMN uid RESTART WITH %s', (SELECT coalesce(max(uid),99999)+1 FROM users));
  END IF;
END $migration$;
COMMIT;
