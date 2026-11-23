#!/usr/bin/env bash
# CDNFly 刷新 / 预热工具（官方 /v1/jobs 接口）
#
# 接口文档：https://www.kancloud.cn/jason22/manual/2547626
#   POST /v1/jobs   {"type":"clean_url|clean_dir|pre_cache_url","data":{"url":"..."}}
#   批量提交时 body 直接传数组
#   GET  /v1/jobs?type=clean_url&key1=<域名>&key2=<urlencode(url)>&page=1&limit=10
#
# 环境变量：
#   CDNFLY_API       面板地址，默认 https://cdn.cdn.sn
#   CDNFLY_TOKEN     登录后的 access_token（必填；走请求头，不出现在进程参数里）
#   SITE             站点域名，默认 glol.rcpd.cc
#   DRY_RUN=1        只打印将要提交的内容
#   CONNECT_TIMEOUT / MAX_TIME   curl 的连接/总超时（默认 10s / 60s）
#
# 用法：
#   ./scripts/cdn-purge.sh dir                     # 刷新整站（clean_dir）
#   ./scripts/cdn-purge.sh url /a.glb /b.js        # 刷新指定 URL（/ 开头会自动补站点域名）
#   ./scripts/cdn-purge.sh urlfile urls.txt        # 从文件批量刷新（一行一个）
#   ./scripts/cdn-purge.sh preheat /a.glb /b.js    # 预热指定 URL
#   ./scripts/cdn-purge.sh list [clean_url|clean_dir|pre_cache_url]
set -euo pipefail

API="${CDNFLY_API:-https://cdn.cdn.sn}"
SITE="${SITE:-glol.rcpd.cc}"
BASE="https://$SITE"
DRY_RUN="${DRY_RUN:-0}"
CONNECT_TIMEOUT="${CONNECT_TIMEOUT:-10}"
MAX_TIME="${MAX_TIME:-60}"

WORK="$(mktemp -d)"          # 每次调用独立目录，并发调用互不干扰
trap 'rm -rf "$WORK"' EXIT

die() { echo "错误: $*" >&2; exit 3; }

need_token() { [ -n "${CDNFLY_TOKEN:-}" ] || die "需要 CDNFLY_TOKEN 环境变量"; }

# /x → https://site/x；相对 → https://site/相对；完整 URL 原样
absolute() {
  case "$1" in
    http://*|https://*) printf '%s' "$1" ;;
    /*)                 printf '%s%s' "$BASE" "$1" ;;
    *)                  printf '%s/%s' "$BASE" "$1" ;;
  esac
}

# token 走 header（接口支持 access-token 头），不进 URL、不进 ps
api() {
  local method="$1" path="$2" body_file="${3:-}"
  local -a args=(-sS --connect-timeout "$CONNECT_TIMEOUT" --max-time "$MAX_TIME"
                 -X "$method" -H "access-token: ${CDNFLY_TOKEN:-}" -H 'User-Agent: cdn-purge/2')
  [ -n "$body_file" ] && args+=(-H 'Content-Type: application/json' --data-binary "@$body_file")
  curl "${args[@]}" "$API$path"
}

# 业务层 code!=0 视为失败（HTTP 200 也可能是错误）
parse_resp() {
  local file="$1" label="$2"
  python3 - "$file" "$label" <<'PY'
import json, sys
path, label = sys.argv[1], sys.argv[2]
try:
    d = json.load(open(path, encoding='utf-8'))
except Exception as e:
    print(f'{label}: 响应不是 JSON ({e})', file=sys.stderr); sys.exit(3)
code = d.get('code')
if code not in (0, '0', None):
    print(f'{label}: 失败 code={code} msg={d.get("msg")}', file=sys.stderr); sys.exit(3)
print(f'{label}: {d.get("msg") or "ok"}，{len(d.get("data") or [])} 个任务')
PY
}

submit() { # submit TYPE URL...
  local type="$1"; shift
  [ $# -gt 0 ] || die "没有要提交的 URL"
  local body="$WORK/body.json" resp="$WORK/resp.json"
  local -a urls=() u
  for u in "$@"; do urls+=("$(absolute "$u")"); done

  python3 - "$type" "$body" "${urls[@]}" <<'PY'
import json, sys
t, out, urls = sys.argv[1], sys.argv[2], sys.argv[3:]
json.dump([{"type": t, "data": {"url": u}} for u in urls], open(out, 'w'), ensure_ascii=False)
print(f'{t}: 准备提交 {len(urls)} 个 URL')
PY

  if [ "$DRY_RUN" = "1" ]; then
    echo "DRY_RUN body 前 400 字节:"; head -c 400 "$body"; echo; return 0
  fi

  need_token
  if ! api POST /v1/jobs "$body" > "$resp"; then
    # 网络层失败不盲目重试：POST 可能已建任务，先查列表确认，避免重复任务
    local first
    first="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))[0]["data"]["url"])' "$body")"
    echo "提交请求失败，检查任务是否已入队: $first" >&2
    if api GET "/v1/jobs?type=$type&key1=$SITE&page=1&limit=20" > "$WORK/check.json" 2>/dev/null \
       && grep -qF "$first" "$WORK/check.json"; then
      echo "任务已在队列中，视为成功（不重试，避免重复任务）" >&2
      return 0
    fi
    die "提交失败且任务列表里没有，请稍后重跑"
  fi
  parse_resp "$resp" "提交 $type"
}

# 逐行读取，避免 unquoted command substitution 的 word splitting / glob 展开
read_urls() {
  local f="$1" line
  [ -f "$f" ] || die "文件不存在: $f"
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in ''|'#'*) continue ;; esac
    printf '%s\n' "$line"
  done < "$f"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  dir)
    submit clean_dir "/"
    ;;
  url|preheat)
    [ $# -gt 0 ] || die "用法: $0 $cmd <url> [url...]"
    t=clean_url; [ "$cmd" = preheat ] && t=pre_cache_url
    submit "$t" "$@"
    ;;
  urlfile)
    [ $# -gt 0 ] || die "用法: $0 urlfile <file>"
    mapfile -t list < <(read_urls "$1")
    [ "${#list[@]}" -gt 0 ] || die "文件里没有 URL: $1"
    submit clean_url "${list[@]}"
    ;;
  list)
    need_token
    t="${1:-clean_url}"
    api GET "/v1/jobs?type=$t&key1=$SITE&page=1&limit=10" > "$WORK/list.json"
    python3 - "$WORK/list.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
if d.get('code') not in (0, '0', None):
    print('查询失败:', d.get('code'), d.get('msg'), file=sys.stderr); sys.exit(3)
print('总数:', d.get('count'))
for r in (d.get('data') or []):
    print(' ', r.get('create_at2'), r.get('type'), r.get('state'), r.get('key2'))
PY
    ;;
  *)
    sed -n '2,22p' "$0"; exit 2 ;;
esac
