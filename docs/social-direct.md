## First-party social login

Apply `deploy/postgres/018-social-direct.sql` (self-hosted) or `migrations/0017_social_direct.sql` (D1) **before** serving this version. Existing rows become `legacy`; the same provider ID in `direct` is a separate identity. Never correlate accounts via nickname, unionid, or the text of a legacy ID.

`QQ_APPID` / `QQ_APPKEY` and `WX_APPID` / `WX_SECRET` independently enable providers. Optional `QQ_REDIRECT` and `WX_REDIRECT` override `https://<host>/api/auth/oauth/{qq,wx}/callback`. Register the exact callback with the provider. Keep credentials server-side.

`SOCIAL_LEGACY_CUTOFF` and `SOCIAL_LEGACY_SUNSET` are inclusive Shanghai calendar dates (`YYYY-MM-DD`); an unset date has no effect. With no new configuration, `/api/auth/social/config` retains its old `{enabled}` response. During migration, a verified real email **or** any direct binding exempts the account, including on subsequent legacy logins. `scripts/social-migration-progress.sql` counts accounts, not identities.

## Client contract

- Start with `POST /api/auth/oauth/start` and `{type, intent}`; navigate to `url` in the same browser. `bind` and `migrate` require the initiating session at callback. On `login`, refresh `/api/me`.
- `new`: no account was created. POST `/api/auth/social/confirm` with `choice: "register"` for social-only signup, or use `/api/auth/social/register` for the existing email/password verification flow. With `choice: "legacy"`, the pending authorization is discarded and the client starts a separate legacy login.
- `takeover`: confirm with `takeover: true` using the initiating account. Eligibility and session ownership are rechecked at transfer; a moved identity leaves the previous account intact and creates an audit entry. `already_bound` is a conflict, not permission to overwrite.
- For a blocking migration, offer `/api/me.migration.options`. Email uses `POST /api/auth/email/bind` with `migrate: true`, email and password on both calls, plus the verification code on the second. Refresh `/api/me` after success.
