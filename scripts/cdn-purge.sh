#!/usr/bin/env bash
# CDNFly 刷新 / 预热工具（官方 /v1/jobs 接口）
#
# 接口文档：https://www.kancloud.cn/jason22/manual/2547626
#   POST /v1/jobs   {"type":"clean_url|clean_dir|pre_cache_url","data":{"url":"..."}}
#   GET  /v1/jobs?type=clean_url&key1=<域名>&page=N&limit=50
#
# 安全约定：
#   * token 通过 curl 配置文件（0600）传入，不出现在命令行/进程列表
#   * CDNFLY_API 必须是 https；只有 127.0.0.1 / localhost 允许 http
#
# 环境变量：
#   CDNFLY_API       面板地址，默认 https://cdn.cdn.sn
#   CDNFLY_TOKEN     登录后的 access_token（必填）
#   SITE             站点域名，默认 glol.rcpd.cc
#   DRY_RUN=1        只打印要提交的内容
#   CONNECT_TIMEOUT / MAX_TIME  默认 10s / 60s
#
# 用法：
#   ./scripts/cdn-purge.sh dir
#   ./scripts/cdn-purge.sh url /a.glb https://host/b.js
#   ./scripts/cdn-purge.sh urlfile urls.txt
#   ./scripts/cdn-purge.sh preheat /a.glb
#   ./scripts/cdn-purge.sh list [clean_url|clean_dir|pre_cache_url]
set -euo pipefail

API="${CDNFLY_API:-https://cdn.cdn.sn}"
SITE="${SITE:-glol.rcpd.cc}"
BASE="https://$SITE"
DRY_RUN="${DRY_RUN:-0}"
CONNECT_TIMEOUT="${CONNECT_TIMEOUT:-10}"
MAX_TIME="${MAX_TIME:-60}"

WORK="$(mktemp -d)"
umask 077
RC="$WORK/curlrc"
printf 'header = "access-token: %s"\nheader = "User-Agent: cdn-purge/3"\nconnect-timeout = %s\nmax-time = %s\n' \
  "${CDNFLY_TOKEN:-}" "$CONNECT_TIMEOUT" "$MAX_TIME" > "$RC"
trap 'rm -rf "$WORK"' EXIT

die() { echo "错误: $*" >&2; exit 3; }

need_token() { [ -n "${CDNFLY_TOKEN:-}" ] || die "需要 CDNFLY_TOKEN 环境变量"; }

# 明文 http 会把 token 发到网上，只允许本机回环
check_api_scheme() {
  case "$API" in
    https://*) return 0 ;;
    http://127.0.0.1*|http://localhost*) return 0 ;;
    http://*) die "CDNFLY_API 是明文 http，会泄露 token：$API" ;;
    *) die "CDNFLY_API 不是合法 URL：$API" ;;
  esac
}

absolute() {
  case "$1" in
    http://*|https://*) printf '%s' "$1" ;;
    /*)                 printf '%s%s' "$BASE" "$1" ;;
    *)                  printf '%s/%s' "$BASE" "$1" ;;
  esac
}

# api METHOD PATH [BODY_FILE]：HTTP 非 2xx 直接失败（不再把错误页当成功）
api() {
  local method="$1" path="$2" body_file="${3:-}" code
  local -a args=(-sS -K "$RC" -o "$WORK/body.out" -w '%{http_code}' -X "$method")
  [ -n "$body_file" ] && args+=(-H 'Content-Type: application/json' --data-binary "@$body_file")
  code="$(curl "${args[@]}" "$API$path" 2>/dev/null || echo 000)"
  case "$code" in
    2*) cat "$WORK/body.out" ;;
    000) die "请求失败（连接或超时）: $method $path" ;;
    *)   echo "HTTP $code: $(head -c 200 "$WORK/body.out" 2>/dev/null)" >&2
         die "接口返回 HTTP $code: $method $path" ;;
  esac
}

# 业务层：必须带 code 字段且为 0
parse_resp() {
  local file="$1" label="$2"
  python3 - "$file" "$label" <<'PY'
import json, sys
path, label = sys.argv[1], sys.argv[2]
try:
    d = json.load(open(path, encoding='utf-8'))
except Exception as e:
    print(f'{label}: 响应不是 JSON ({e})', file=sys.stderr); sys.exit(3)
if not isinstance(d, dict) or 'code' not in d:
    print(f'{label}: 响应缺少 code 字段，无法判断成败', file=sys.stderr); sys.exit(3)
if d['code'] not in (0, '0'):
    print(f'{label}: 失败 code={d["code"]} msg={d.get("msg")}', file=sys.stderr); sys.exit(3)
print(f'{label}: {d.get("msg") or "ok"}，{len(d.get("data") or [])} 个任务')
PY
}

# URL 是否已入队：翻 3 页找，避免只匹配第一页的误判
job_exists() {
  local type="$1" url="$2" page
  for page in 1 2 3; do
    api GET "/v1/jobs?type=$type&key1=$SITE&page=$page&limit=50" > "$WORK/jobs.json" || return 1
    grep -qF "$url" "$WORK/jobs.json" && return 0
  done
  return 1
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

  need_token; check_api_scheme
  if ! api POST /v1/jobs "$body" > "$resp"; then
    # 网络层失败不盲重试：先确认是否已入队，避免重复任务
    local first
    first="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))[0]["data"]["url"])' "$body")"
    echo "提交失败，检查是否已入队: $first" >&2
    if job_exists "$type" "$first"; then
      echo "任务已在队列中，视为成功（不重试）" >&2; return 0
    fi
    die "提交失败且任务列表里没有，请稍后重跑"
  fi
  parse_resp "$resp" "提交 $type"
}

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
  dir)     submit clean_dir "/" ;;
  url|preheat)
    [ $# -gt 0 ] || die "用法: $0 $cmd <url> [url...]"
    t=clean_url; [ "$cmd" = preheat ] && t=pre_cache_url
    submit "$t" "$@" ;;
  urlfile)
    [ $# -gt 0 ] || die "用法: $0 urlfile <file>"
    mapfile -t list < <(read_urls "$1")
    [ "${#list[@]}" -gt 0 ] || die "文件里没有 URL: $1"
    submit clean_url "${list[@]}" ;;
  list)
    need_token; check_api_scheme
    t="${1:-clean_url}"
    api GET "/v1/jobs?type=$t&key1=$SITE&page=1&limit=50" > "$WORK/list.json"
    python3 - "$WORK/list.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
if d.get('code') not in (0, '0'):
    print('查询失败:', d.get('code'), d.get('msg'), file=sys.stderr); sys.exit(3)
print('总数:', d.get('count'))
for r in (d.get('data') or []):
    print(' ', r.get('create_at2'), r.get('type'), r.get('state'), r.get('key2'))
PY
    ;;
  *) sed -n '2,22p' "$0"; exit 2 ;;
esac
