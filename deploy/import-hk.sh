#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${CLOUDFLARE_API_TOKEN:?provide glol-scoped D1 export access}" "${CLOUDFLARE_ACCOUNT_ID:?}"
[[ ${CONFIRM_REPLACE_HK_GLOL:-} == yes ]] || { echo 'Refusing to replace the hk01 glol rehearsal database; see docs/deploy-hk.md' >&2; exit 1; }
umask 077
mkdir -p .wrangler/hk-rehearsal
dir=$(mktemp -d .wrangler/hk-rehearsal/run.XXXXXXXX)
trap 'rm -f "$dir/source.sql"; rmdir "$dir"' EXIT
npx --no-install wrangler d1 export glol --remote --output "$dir/source.sql"
python3 deploy/postgres/import-snapshot.py "$dir/source.sql" | ssh -T rock@cn-hk-fxy-01.rockchin.top kubectl -n idoknow exec -i deploy/glol-postgres -- psql -Xq -v ON_ERROR_STOP=1 -v VERBOSITY=terse -U postgres -d glol
