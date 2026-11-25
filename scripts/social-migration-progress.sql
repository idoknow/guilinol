WITH accounts AS (
  SELECT user_id, MAX(CASE WHEN channel='legacy' THEN 1 ELSE 0 END) AS legacy,
    MAX(CASE WHEN channel='direct' THEN 1 ELSE 0 END) AS direct FROM social_identities GROUP BY user_id
)
SELECT COUNT(CASE WHEN legacy=1 THEN 1 END) AS legacy_accounts,
  COUNT(CASE WHEN legacy=1 AND direct=1 THEN 1 END) AS migrated_to_direct,
  COUNT(CASE WHEN legacy=1 AND direct=0 AND email_placeholder=1 THEN 1 END) AS legacy_only_social
FROM accounts JOIN users ON users.id=accounts.user_id;
