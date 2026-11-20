#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
dir=${1:?pass the absolute local export directory}
[[ ${CONFIRM_REPLACE_HK_GLOL:-} == yes ]] || { echo 'Refusing to replace the hk01 glol rehearsal database; see docs/deploy-hk.md' >&2; exit 1; }
python3 deploy/postgres/import-snapshot.py "$dir/d1-glol.sql" | ssh -T rock@cn-hk-fxy-01.rockchin.top kubectl -n idoknow exec -i deploy/glol-postgres -- psql -Xq -v ON_ERROR_STOP=1 -v VERBOSITY=terse -U postgres -d glol
