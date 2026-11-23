#!/usr/bin/env bash
# CDNFly 刷新 / 预热工具（走官方 /v1/jobs 接口，不是逆向出来的私有接口）
#
# 接口（见 https://www.kancloud.cn/jason22/manual/2547626）：
#   POST /v1/jobs   {"type":"clean_url|clean_dir|pre_cache_url","data":{"url":"..."}}
#   批量提交时 body 直接传数组
#   GET  /v1/jobs?type=clean_url&key1=<域名>&key2=<urlencode(url)>&page=1&limit=10 查询任务
#
# 环境变量：
#   CDNFLY_API     面板地址，默认 https://cdn.cdn.sn
#   CDNFLY_TOKEN   登录后拿到的 access_token（必填；不要写进仓库）
#   SITE           站点域名，默认 glol.rcpd.cc
#
# 用法：
#   ./scripts/cdn-purge.sh dir                     # 刷新整站（clean_dir）
#   ./scripts/cdn-purge.sh url /a.glb /b.js        # 刷新指定 URL
#   ./scripts/cdn-purge.sh urlfile urls.txt        # 从文件批量刷新（一行一个 URL）
#   ./scripts/cdn-purge.sh preheat /a.glb /b.js    # 预热指定 URL
#   ./scripts/cdn-purge.sh list [clean_url|clean_dir|pre_cache_url]   # 查最近任务
set -euo pipefail

API="${CDNFLY_API:-https://cdn.cdn.sn}"
TOKEN="${CDNFLY_TOKEN:?需要 CDNFLY_TOKEN（面板登录后的 access_token）}"
SITE="${SITE:-glol.rcpd.cc}"
BASE="https://$SITE"

cmd="${1:-}"; shift || true

api() { # api METHOD PATH [BODY]
  local method="$1" path="$2" body="${3:-}"
  local sep='?'; case "$path" in *\?*) sep='&';; esac
  local url="$API$path${sep}access_token=$(printf '%s' "$TOKEN" | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read(),safe=""))')"
  if [ -n "$body" ]; then
    curl -fsS -X "$method" -H 'Content-Type: application/json' -d "$body" "$url"
  else
    curl -fsS -X "$method" "$url"
  fi
}

submit() { # submit TYPE URL...
  local type="$1"; shift
  python3 - "$type" "$@" <<'PY' > /tmp/cdnfly_jobs.json
import json,sys
t=sys.argv[1]; urls=sys.argv[2:]
print(json.dumps([{"type":t,"data":{"url":u}} for u in urls], ensure_ascii=False))
PY
  api POST /v1/jobs "$(cat /tmp/cdnfly_jobs.json)" | tee /tmp/cdnfly_jobs_resp.json
  echo
  python3 - <<'PY'
import json
d=json.load(open('/tmp/cdnfly_jobs_resp.json'))
print('提交结果:', d.get('msg'), '任务数:', len(d.get('data') or []))
PY
}

case "$cmd" in
  dir)
    submit clean_dir "$BASE/"
    ;;
  url|preheat)
    [ $# -gt 0 ] || { echo "用法: $0 $cmd <url> [url...]"; exit 2; }
    t=clean_url; [ "$cmd" = preheat ] && t=pre_cache_url
    submit "$t" "$@"
    ;;
  urlfile)
    [ $# -gt 0 ] || { echo "用法: $0 urlfile <file>"; exit 2; }
    submit clean_url $(grep -v '^#' "$1" | grep -v '^$')
    ;;
  list)
    t="${1:-clean_url}"
    api GET "/v1/jobs?type=$t&key1=$SITE&page=1&limit=10" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('总数:', d.get('count'))
for r in (d.get('data') or []):
    print('  ', r.get('create_at2'), r.get('type'), r.get('state'), r.get('key2'))
"
    ;;
  *)
    sed -n '2,22p' "$0"; exit 2
    ;;
esac
