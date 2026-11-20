#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
temp=$(mktemp -d)
trap '[[ -z ${container:-} ]] || docker rm -f "$container" >/dev/null; rm -rf "$temp"' EXIT
cp deploy/nginx.conf "$temp/default.conf"
echo 'server { listen 127.0.0.1:3000; location / { return 200 "$http_cf_connecting_ip"; } }' >> "$temp/default.conf"
container=$(docker run -d --network none -v "$temp/default.conf:/etc/nginx/conf.d/default.conf:ro" "${1:?web image}")
check() {
  local result
  result=$(docker exec "$container" wget -qO- --header="X-Real-IP: $1" --header="CF-Connecting-IP: $2" http://127.0.0.1:8080/api/test)
  [[ $result == "$3" ]] || { echo "expected $3, got $result" >&2; exit 1; }
}
for attempt in {1..20}; do docker exec "$container" wget -qO /dev/null http://127.0.0.1:8080/ && break; sleep .2; done
check 173.245.48.8 192.0.2.42 192.0.2.42
check 2606:4700::1 2001:db8::8 2001:db8::8
check 192.0.2.9 192.0.2.42 192.0.2.9
check 173.245.48.8 '' 173.245.48.8
