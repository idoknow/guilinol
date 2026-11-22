#!/usr/bin/env bash
# 发版期间盯可用性：固定节奏轮询几个代表性路径，统计失败次数与版本切换点。
#
#   ./deploy/verify-rolling-update.sh                             # 默认盯 180 秒
#   DURATION=600 EXPECT_SHA=abc1234 ./deploy/verify-rolling-update.sh   # 发版用：要求最终版本是 abc1234
#   DURATION=20 ALLOW_NO_CHANGE=1 ./deploy/verify-rolling-update.sh     # 只做可用性压测，不要求版本变化
#
# 检查面（任一失败都算失败）：/api/health、/version.json、/（静态首页）、/api/auth/social/config
# 退出码：0 = 全程无失败且满足版本要求；1 = 出现过失败 / 版本没变化 / 版本不是期望值。
set -uo pipefail
url=${URL:-https://glol.rcpd.cc}
duration=${DURATION:-180}
interval=${INTERVAL:-0.2}
expect_sha=${EXPECT_SHA:-}
allow_no_change=${ALLOW_NO_CHANGE:-0}
paths=("/api/health" "/version.json" "/" "/api/auth/social/config")

fail=0
total=0
worst_streak=0
streak=0
first_fail=""
last_version=""
first_version=""
switch_at=""
start_ms=$(($(date +%s%N)/1000000))
interval_ms=$(awk -v s="$interval" 'BEGIN{printf "%d", (s+0)*1000}')
(( interval_ms > 0 )) || interval_ms=200
tick=0

# 单个断言：返回 0 表示正常（2xx/3xx）
probe() {
  local path=$1 code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url$path" || echo 000)
  [[ "$code" =~ ^[23] ]]
  return $?
}

while :; do
  now_ms=$(($(date +%s%N)/1000000))
  (( now_ms - start_ms >= duration * 1000 )) && break
  tick=$((tick + 1))
  round_failed=0
  for path in "${paths[@]}"; do
    total=$((total + 1))
    if ! probe "$path"; then
      round_failed=1
      fail=$((fail + 1))
      [[ -z "$first_fail" ]] && first_fail="$(date +%H:%M:%S) $path"
      echo "FAIL $path $(date +%H:%M:%S)"
    fi
  done
  if (( round_failed )); then
    streak=$((streak + 1))
    (( streak > worst_streak )) && worst_streak=$streak
  else
    streak=0
  fi
  # 版本每轮都读，但解析失败不算失败（静态资源抖动不应污染可用性结论）
  version=$(curl -s --max-time 5 "$url/version.json" | sed -n 's/.*"sha":"\([0-9a-f]\{7\}\).*/\1/p')
  if [[ -n "$version" && "$version" != "$last_version" ]]; then
    [[ -z "$first_version" ]] && first_version=$version
    [[ -n "$last_version" ]] && switch_at="$(date +%H:%M:%S) $last_version → $version"
    last_version=$version
  fi
  # 固定节奏：按 tick 计算下一次起点，请求耗时不会把采样频率越拖越低
  next_ms=$(( start_ms + (tick + 1) * interval_ms ))
  sleep_ms=$(( next_ms - $(($(date +%s%N)/1000000)) ))
  (( sleep_ms > 0 )) && sleep "$(awk -v ms="$sleep_ms" 'BEGIN{printf "%.3f", ms/1000}')"
done

echo "-----"
echo "总请求: $total  失败: $fail  最长连续轮次失败: $worst_streak  当前版本: ${last_version:-?}"
[[ -n "$switch_at" ]] && echo "版本切换: $switch_at"
(( fail > 0 )) && echo "首个失败: $first_fail"

status=0
if (( fail > 0 )); then
  echo "结论：发版期间出现过不可用（$fail 次请求失败）"
  status=1
fi
if [[ -n "$expect_sha" ]]; then
  if [[ "$last_version" == "$expect_sha"* ]]; then
    echo "版本校验：命中期望 $expect_sha"
  else
    echo "结论：结束版本 ${last_version:-?} 不是期望的 $expect_sha（发版可能没生效）"
    status=1
  fi
elif (( allow_no_change == 0 )); then
  if [[ -n "$switch_at" ]]; then
    echo "版本校验：观测到切换 $switch_at"
  else
    echo "结论：全程版本未变化（${first_version:-?}），无法证明发生了滚动更新；"
    echo "      确认已发版，或加 EXPECT_SHA=<sha>，或压测时用 ALLOW_NO_CHANGE=1"
    status=1
  fi
else
  echo "版本校验：跳过（ALLOW_NO_CHANGE=1）"
fi
(( status == 0 )) && echo "结论：发版期间零失败，站点始终可用" || true
exit $status
