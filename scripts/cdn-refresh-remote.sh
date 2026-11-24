#!/usr/bin/env bash
# 发版后的 CDN 刷新 + 预热（目录级），供 GitHub Actions 调用。
#
# 只提交「目录」任务，不逐文件提交：
#   - 入口页是单文件 → clean_url（清掉旧 HTML）
#   - 静态目录 → pre_cache_url（服务端自己展开目录内文件，一次发版十几条任务）
# 不做 clean_dir：擦掉缓存但预热没跟上时首访会更慢（上次发版 2.5-5s/文件就是这么来的）。
#
# 失败不阻断流程：任何一步失败只打印告警并以 0 退出，由 workflow 侧当作提示。
set -uo pipefail

API="${CDNFLY_API:-https://cdn.cdn.sn}"
HOST="${SITE_HOST:-https://glol.rcpd.cc}"
ENTRY="${ENTRY_PAGES:-/ /index.html /version.json /id.html /backpack.html /admin/ /manifest.webmanifest}"
DIRS="${SITE_DIRS:-assets world landmarks textures models avatar brand icons contributors home basis}"

if [[ -z "${CDNFLY_API_KEY:-}" || -z "${CDNFLY_API_SECRET:-}" ]]; then
  echo "::warning::没有 CDNFLY_API_KEY / CDNFLY_API_SECRET，跳过 CDN 刷新"
  exit 0
fi

post() {
  local body=$1 label=$2
  local resp code
  resp=$(curl -sS -m 60 -o /tmp/cdn-resp.json -w '%{http_code}' \
      -H "api-key: $CDNFLY_API_KEY" -H "api-secret: $CDNFLY_API_SECRET" \
      -H 'Content-Type: application/json' --data-binary "$body" "$API/v1/jobs" 2>&1) || code=000
  code=${code:-$resp}
  if [[ "$code" != "200" ]]; then
    echo "::warning::$label 提交失败（HTTP $code）"
    return 0
  fi
  if ! grep -q '"code":0' /tmp/cdn-resp.json; then
    echo "::warning::$label 被拒绝: $(head -c 200 /tmp/cdn-resp.json)"
    return 0
  fi
  echo "$label 已提交: $(head -c 120 /tmp/cdn-resp.json)"
}

entry_jobs=""
for p in $ENTRY; do
  entry_jobs+="{\"type\":\"clean_url\",\"data\":{\"url\":\"$HOST$p\"}},"
done
post "[${entry_jobs%,}]" "入口页刷新"

dir_jobs=""
for d in $DIRS; do
  dir_jobs+="{\"type\":\"pre_cache_url\",\"data\":{\"url\":\"$HOST/$d/\"}},"
done
post "[${dir_jobs%,}]" "目录预热"

echo "完成：入口页 $(echo $ENTRY | wc -w) 个、目录 $(echo $DIRS | wc -w) 个"
