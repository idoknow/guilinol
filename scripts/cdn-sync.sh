#!/usr/bin/env bash
# 只刷新「变过的区块」：按内容 sha256 对比上一次的清单，改动过的才 clean_url + 预热
#
# 用法：
#   CDNFLY_TOKEN=xxx ./scripts/cdn-sync.sh                 # 用 web/dist 和 .cdn-hashes.json
#   DIST=web/dist ./scripts/cdn-sync.sh
#   DRY_RUN=1 ./scripts/cdn-sync.sh                        # 只看要刷哪些，不真的提交
#
# CI 里要把 .cdn-hashes.json 缓存住（actions/cache），否则每次都当成全量变更：
#
#   - uses: actions/cache@v4
#     with:
#       path: .cdn-hashes.json
#       key: cdn-hashes-${{ github.ref_name }}
#       restore-keys: cdn-hashes-
#
# 依赖：python3、curl；CDNFLY_TOKEN
set -euo pipefail

API="${CDNFLY_API:-https://cdn.cdn.sn}"
HOST="${HOST:-https://glol.rcpd.cc}"
DIST="${DIST:-web/dist}"
STATE="${STATE:-.cdn-hashes.json}"
# 需要托管的静态目录（与 nginx 的 location 对应）
DIRS="${DIRS:-assets landmarks world textures avatar brand icons contributors home basis}"
DRY_RUN="${DRY_RUN:-0}"

[ -d "$DIST" ] || { echo "找不到构建产物: $DIST" >&2; exit 2; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

# 1) 计算当前构建的哈希表
python3 - "$DIST" "$STATE" "$tmp/now.json" "$tmp/changed.txt" "$DIRS" <<'PY'
import hashlib, json, os, sys
dist, state_path, now_path, changed_path, dirs = sys.argv[1:6]
dirs = dirs.split()

def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()

now = {}
for d in dirs:
    base = os.path.join(dist, d)
    if not os.path.isdir(base):
        continue
    for root, _, files in os.walk(base):
        for name in files:
            full = os.path.join(root, name)
            rel = '/' + os.path.relpath(full, dist).replace(os.sep, '/')
            now[rel] = sha(full)

try:
    old = json.load(open(state_path))
except Exception:
    old = {}

changed = sorted(p for p, h in now.items() if old.get(p) != h)
removed = sorted(p for p in old if p not in now)

json.dump(now, open(now_path, 'w'), indent=0, sort_keys=True)
open(changed_path, 'w').write('\n'.join(changed + removed))
print(f'当前文件 {len(now)} 个；变更 {len(changed)} 个；删除 {len(removed)} 个')
if changed:
    print('  变更（最多列 15 个）:')
    for p in changed[:15]:
        print('   +', p)
PY

mapfile -t urls < "$tmp/changed.txt"
if [ "${#urls[@]}" -eq 0 ]; then
  echo "没有变更，不需要刷新"
  exit 0
fi

# 2) 提交刷新 + 预热（分批，避免单请求过大）
batch=300
if [ "$DRY_RUN" = "1" ]; then
  echo "== DRY_RUN，将刷新 ${#urls[@]} 个 URL："
  printf '  %s\n' "${urls[@]:0:20}"
  [ "${#urls[@]}" -gt 20 ] && echo "  ..."
  exit 0
fi

[ -n "${CDNFLY_TOKEN:-}" ] || { echo "需要 CDNFLY_TOKEN" >&2; exit 2; }

python3 - "$tmp/changed.txt" "$HOST" "$tmp/batches" "$batch" <<'PY'
import json, sys, os
src, host, outdir, batch = sys.argv[1], sys.argv[2].rstrip('/'), sys.argv[3], int(sys.argv[4])
paths = [l for l in open(src).read().splitlines() if l.strip()]
os.makedirs(outdir, exist_ok=True)
for i in range(0, len(paths), batch):
    chunk = paths[i:i+batch]
    body = [{"type": "clean_url", "data": {"url": host + p}} for p in chunk]
    json.dump(body, open(f'{outdir}/clean_{i//batch}.json', 'w'), ensure_ascii=False)
    body = [{"type": "pre_cache_url", "data": {"url": host + p}} for p in chunk]
    json.dump(body, open(f'{outdir}/warm_{i//batch}.json', 'w'), ensure_ascii=False)
PY

post_jobs() { # post_jobs <file> <label>
  local f="$1" label="$2"
  echo -n "$label $(basename "$f"): "
  # token 走 header，不进 URL/ps；带超时；业务 code!=0 视为失败
  curl -sS --connect-timeout "${CONNECT_TIMEOUT:-10}" --max-time "${MAX_TIME:-60}" \
       -X POST -H "access-token: $CDNFLY_TOKEN" -H 'Content-Type: application/json' \
       --data-binary @"$f" "$API/v1/jobs" > "$tmp/resp.json"
  python3 - "$tmp/resp.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
code = d.get('code')
if code not in (0, '0', None):
    print('失败', code, d.get('msg'), file=sys.stderr); sys.exit(3)
print(d.get('msg'), len(d.get('data') or []), '个任务')
PY
}

for f in "$tmp"/batches/clean_*.json; do post_jobs "$f" "刷新"; done
for f in "$tmp"/batches/warm_*.json;  do post_jobs "$f" "预热"; done

# 3) 只有提交成功才更新状态文件
cp "$tmp/now.json" "$STATE"
echo "状态已更新: $STATE"
