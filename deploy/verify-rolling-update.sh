#!/usr/bin/env bash
# 发版期间盯可用性：每 INTERVAL 秒打一次 /api/health，统计非 200 次数与版本切换点。
#
#   ./deploy/verify-rolling-update.sh              # 默认盯 180 秒
#   DURATION=600 INTERVAL=0.5 ./deploy/verify-rolling-update.sh
#
# 退出码：0 = 全程无失败；1 = 出现过非 200（打印时间点，便于回查 Ingress/pod 事件）。
set -uo pipefail
url=${URL:-https://glol.rcpd.cc}
duration=${DURATION:-180}
interval=${INTERVAL:-0.2}

fail=0
total=0
worst_streak=0
streak=0
first_fail=""
last_version=""
switch_at=""
start=$(date +%s)

while :; do
  now=$(date +%s)
  (( now - start >= duration )) && break
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url/api/health" || echo 000)
  total=$((total + 1))
  if [[ "$code" != "200" ]]; then
    fail=$((fail + 1))
    streak=$((streak + 1))
    (( streak > worst_streak )) && worst_streak=$streak
    [[ -z "$first_fail" ]] && first_fail="第 $((total)) 次（$(date +%H:%M:%S)）→ $code"
    echo "FAIL[$code] $url/api/health $(date +%H:%M:%S)"
  else
    streak=0
  fi
  # 顺带记录版本切换（发版成功会看到 sha 变化）
  version=$(curl -s --max-time 5 "$url/version.json" | sed -n 's/.*"sha":"\([0-9a-f]\{7\}\).*/\1/p')
  if [[ -n "$version" && "$version" != "$last_version" ]]; then
    [[ -n "$last_version" ]] && switch_at="$(date +%H:%M:%S) $last_version → $version"
    last_version=$version
  fi
  sleep "$interval"
done

echo "-----"
echo "总请求: $total  失败: $fail  最长连续失败: $worst_streak  当前版本: ${last_version:-?}"
[[ -n "$switch_at" ]] && echo "版本切换: $switch_at"
if (( fail > 0 )); then
  echo "首个失败: $first_fail"
  echo "结论：发版期间出现过不可用（$fail 次）"
  exit 1
fi
echo "结论：发版期间零失败，站点始终可用"
