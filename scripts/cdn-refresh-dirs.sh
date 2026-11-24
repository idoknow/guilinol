#!/usr/bin/env bash
# 目录级 CDN 刷新：每个顶层目录算一个内容摘要，只有变了的目录才提交
#   clean_dir（擦掉该目录旧缓存）+ pre_cache_url（整目录预热，服务端自己展开文件列表）
# 入口页是单文件，仍然逐个 clean_url。
#
# 为什么不再逐文件提交：一次发版几百个文件就是几百条任务，CDN 的预热队列会大量卡在 pending，
# 结果是「旧缓存被擦了、新文件没预热」，首访反而最慢。目录级一次发版只要十几条任务。
#
# 用法：
#   CDNFLY_API_KEY=... CDNFLY_API_SECRET=... scripts/cdn-refresh-dirs.sh <dist目录>
#   可选：DRY_RUN=1 只打印要刷哪些；STATE=<json> 指定基线文件
set -euo pipefail

DIST=${1:?用法: cdn-refresh-dirs.sh <dist目录>}
[ -d "$DIST" ] || { echo "找不到构建产物目录: $DIST" >&2; exit 2; }

export DIST
export API="${CDNFLY_API:-https://cdn.cdn.sn}"
export HOST="${HOST:-https://glol.rcpd.cc}"
export STATE="${STATE:-$HOME/.local/state/glol-cdn/dirs.json}"
export DRY_RUN="${DRY_RUN:-0}"
export CDNFLY_API_KEY="${CDNFLY_API_KEY:-}"
export CDNFLY_API_SECRET="${CDNFLY_API_SECRET:-}"
export ENTRY_PAGES="${ENTRY_PAGES:-/ /index.html /version.json /id.html /backpack.html /admin/ /manifest.webmanifest}"
mkdir -p "$(dirname "$STATE")"

exec python3 - <<'PY'
import hashlib, json, os, sys, urllib.request, urllib.error

DIST = os.environ['DIST'].rstrip('/')
API = os.environ['API'].rstrip('/')
HOST = os.environ['HOST'].rstrip('/')
STATE = os.environ['STATE']
DRY = os.environ['DRY_RUN'] == '1'
KEY = os.environ['CDNFLY_API_KEY']
SECRET = os.environ['CDNFLY_API_SECRET']
ENTRY = os.environ['ENTRY_PAGES'].split()

if not (KEY and SECRET):
    print('错误: 需要 CDNFLY_API_KEY + CDNFLY_API_SECRET', file=sys.stderr)
    sys.exit(3)


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


# 按顶层目录聚合：目录摘要 = 该目录下所有「相对路径 + 文件哈希」排序后的 sha256
groups = {}
for root, _dirs, files in os.walk(DIST):
    for name in files:
        full = os.path.join(root, name)
        rel = os.path.relpath(full, DIST).replace(os.sep, '/')
        top = rel.split('/', 1)[0] if '/' in rel else '.'   # '.' = 根目录下的单文件
        groups.setdefault(top, []).append(f'{rel}:{sha(full)}')

digests = {}
for top, items in groups.items():
    items.sort()
    digests[top] = hashlib.sha256('\n'.join(items).encode()).hexdigest()

old = {}
if os.path.exists(STATE):
    try:
        old = json.load(open(STATE))
    except Exception:
        old = {}

changed = sorted([d for d, h in digests.items() if old.get(d) != h])

print(f'目录数 {len(digests)}，变化 {len(changed)}: {", ".join(changed) if changed else "无"}')

if not old:
    print('没有基线：本次只记录基线，不刷新（下次发版开始按目录差异刷新）')
    if not DRY:
        json.dump(digests, open(STATE, 'w'), indent=1, sort_keys=True)
    sys.exit(0)

if not changed:
    print('没有目录变化，跳过')
    sys.exit(0)

if DRY:
    for d in changed:
        print(f'  会刷新 {d}/')
    sys.exit(0)


def post(jobs):
    body = json.dumps(jobs).encode()
    req = urllib.request.Request(API + '/v1/jobs', data=body, method='POST')
    req.add_header('api-key', KEY)
    req.add_header('api-secret', SECRET)
    req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode())
    if str(data.get('code')) != '0':
        raise RuntimeError(f"提交失败: {data.get('code')} {data.get('msg')}")
    return data.get('data') or []


# 1) 入口页：单文件，擦缓存就够（内容本身就是最新的）
if ENTRY:
    ids = post([{'type': 'clean_url', 'data': {'url': f'{HOST}{p}'}} for p in ENTRY])
    print(f'入口页刷新 {len(ENTRY)} 个: {ids}')

# 2) 变了的目录：一次请求里 clean_dir + pre_cache_url 成对提交
jobs = []
for d in changed:
    if d == '.':
        continue                     # 根目录下的单文件由入口页那步处理
    url = f'{HOST}/{d}/'
    jobs.append({'type': 'clean_dir', 'data': {'url': url}})
    jobs.append({'type': 'pre_cache_url', 'data': {'url': url}})
if jobs:
    ids = post(jobs)
    print(f'目录刷新 {len(changed) - (1 if "." in changed else 0)} 个目录，提交 {len(jobs)} 条任务: {ids}')

json.dump(digests, open(STATE, 'w'), indent=1, sort_keys=True)
print('基线已更新')
PY
