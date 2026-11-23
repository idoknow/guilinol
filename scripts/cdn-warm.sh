#!/usr/bin/env bash
# CDN 预热（IDOK-53）：CDNFly 没有刷新/预热 API，发版后用普通 GET 把大文件拉进 CDN 缓存。
# 由 deploy/release-window.sh 在确认上线后调用；失败不影响发版。
# 只预热 CDN 规则会缓存的后缀（glb|ktx2|bin|js|css|字体|图片），其余请求回源也只是白跑。
# 注意：从一台机器预热只能填满它解析到的那个 L1 节点和共享的 L2，其他 L1 首次访问仍会 L2 命中。
#   HOST=https://glol.rcpd.cc JOBS=2 DELAY=0.3 ROUNDS=2 scripts/cdn-warm.sh
set -euo pipefail
HOST=${HOST:-https://glol.rcpd.cc}
JOBS=${JOBS:-2}
# CDNFly CC 自动封禁：60 秒 20 次 → 封 600 秒；每个请求前停 DELAY 秒，默认 2 并发 × 0.3 秒，别把出口 IP 打进黑名单
DELAY=${DELAY:-0.3}
ROUNDS=${ROUNDS:-2}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

curl -fsS --max-time 30 "$HOST/world/manifest.json?t=$(date +%s)" -o "$work/manifest.json"
curl -fsS --max-time 30 "$HOST/" -o "$work/index.html"

python3 - "$work/manifest.json" "$work/index.html" >"$work/urls" <<'PY'
import json, re, sys
manifest = json.load(open(sys.argv[1]))
html = open(sys.argv[2], encoding='utf-8', errors='ignore').read()
paths = set()
def add(path):
    if path:
        paths.add('/' + path.lstrip('/'))
for key in ('peaks', 'atlas', 'vehicles', 'distantBuildings'):
    entry = manifest.get(key)
    if isinstance(entry, dict):
        add('world/' + entry.get('file', ''))
overview = manifest.get('overview') or {}
for key in ('heights', 'underlay', 'texture'):
    if isinstance(overview.get(key), dict):
        add('world/' + overview[key].get('file', ''))
for landmark in manifest.get('landmarks') or []:
    add(landmark.get('file', ''))
for match in re.findall(r'''(?:src|href)=["']\.?/?((?:assets|brand|home|icons|textures)/[^"'?#]+)''', html):
    add(match)
cacheable = re.compile(r'\.(?:glb|ktx2|bin|js|css|woff2?|ttf|otf|webp|png|jpe?g|gif|svg|ico)$', re.I)
for path in sorted(p for p in paths if cacheable.search(p)):
    print(path)
PY

total=$(wc -l <"$work/urls")
echo "预热 $total 个 URL（$HOST，并发 $JOBS，$ROUNDS 轮）"
for round in $(seq 1 "$ROUNDS"); do
  HOST=$HOST DELAY=$DELAY xargs -P "$JOBS" -I{} sh -c 'sleep "$DELAY"; curl -sS -o /dev/null --max-time 120 -w "%{http_code} %{size_download} %header{x-cache-status} {}\n" "$HOST{}"' <"$work/urls" >"$work/round$round" 2>>"$work/errors" || true
  ok=$(awk '$1==200||$1==304' "$work/round$round" | wc -l)
  l1=$(grep -c 'HIT from L1' "$work/round$round" || true)
  any=$(grep -c 'HIT from' "$work/round$round" || true)
  mb=$(awk '{s+=$2} END {printf "%.1f", s/1048576}' "$work/round$round")
  echo "第 $round 轮：成功 $ok/$total，CDN 命中 $any/$total（其中本节点 L1 $l1，其余为共享 L2），下载 ${mb} MB"
done
bad=$(awk '$1!=200&&$1!=304' "$work/round$ROUNDS")
if [[ -n $bad ]]; then
  echo "异常 URL："
  echo "$bad"
fi
[[ -s $work/errors ]] && { echo "curl 错误："; sort -u "$work/errors" | head -20; }
exit 0
