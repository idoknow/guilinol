BEGIN;
LOCK TABLE social_identities, social_states, social_pending IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='social_identities' AND column_name='channel') THEN
    IF EXISTS (SELECT 1 FROM social_identities WHERE channel='direct') THEN
      RAISE EXCEPTION 'Direct social identities exist; review before rollback';
    END IF;
    DELETE FROM social_identities WHERE channel='direct';
    DELETE FROM social_states WHERE channel='direct' OR intent IN ('migrate','new');
    DELETE FROM social_pending WHERE channel='direct' OR intent IN ('migrate','new');
    ALTER TABLE social_identities DROP CONSTRAINT IF EXISTS social_identities_pkey;
    DROP INDEX IF EXISTS social_owner;
    ALTER TABLE social_identities ADD PRIMARY KEY(type,social_uid);
    CREATE UNIQUE INDEX social_owner ON social_identities(user_id,type);
    ALTER TABLE social_states DROP CONSTRAINT IF EXISTS social_states_intent_check, DROP CONSTRAINT IF EXISTS social_states_check;
    ALTER TABLE social_states ADD CHECK(intent IN ('login','bind','register')), ADD CHECK(intent <> 'bind' OR user_id IS NOT NULL);
    ALTER TABLE social_pending DROP CONSTRAINT IF EXISTS social_pending_intent_check;
    ALTER TABLE social_pending ADD CHECK(intent IN ('login','bind','register'));
    ALTER TABLE social_identities DROP COLUMN IF EXISTS channel, DROP COLUMN IF EXISTS unionid;
    ALTER TABLE social_states DROP COLUMN IF EXISTS channel;
    ALTER TABLE social_pending DROP COLUMN IF EXISTS channel, DROP COLUMN IF EXISTS unionid, DROP COLUMN IF EXISTS previous_owner;
  END IF;
END $$;
DROP TABLE IF EXISTS social_legacy_sessions;
COMMIT;
