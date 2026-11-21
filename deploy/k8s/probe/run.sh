#!/bin/sh
set -eu
base=${PROBE_ORIGIN:-https://glol.rcpd.cc}
sid=$PROBE_SESSION
rows=
measure() {
  timing=$(curl -sS --connect-timeout 5 --max-time 15 -o /dev/null -w '%{time_namelookup} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total} %{http_code}' "$base$2") || :
  event=$(printf '%s\n' "$timing" | awk -v target="$1" 'function ms(s){return s>0?s*1000:0}
    NF==6{printf "{\"kind\":\"probe\",\"target\":\"%s\",\"dns\":%.3f,\"tcp\":%.3f,\"tls\":%.3f,\"ttfb\":%.3f,\"total\":%.3f,\"status\":%d}",target,ms($1),ms($2-$1),ms($3-$2),ms($4),ms($5),$6}')
  test -n "$event"
  rows="${rows}${rows:+,}$event"
}
measure home /
measure manifest /world/manifest.json
for n in 1 2 3 4 5; do measure "chunk$n" "/world/0_$n.glc"; done
measure health /api/health
curl -fsS --connect-timeout 5 --max-time 15 -H 'Content-Type: application/json' \
  --data "{\"sid\":\"$sid\",\"context\":{\"source\":\"probe\",\"node\":\"$PROBE_NODE\"},\"rows\":[$rows]}" "$base/api/t"
