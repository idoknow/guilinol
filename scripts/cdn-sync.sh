#!/usr/bin/env bash
# 只刷新「变过的区块」：按内容 sha256 与上一次清单比对；改动过的 clean_url + 预热，删除的只刷新
#
# 用法：
#   CDNFLY_TOKEN=xxx ./scripts/cdn-sync.sh            # 自动找 dist / web/dist
#   DIST=web/dist STATE=.cdn-hashes.json ./scripts/cdn-sync.sh
#   DRY_RUN=1 ./scripts/cdn-sync.sh                  # 只看要刷哪些
#
# CI：把 .cdn-hashes.json 缓存住（见 PR 说明），否则每次都当全量变更。
# 依赖：python3 ≥3.8、CDNFLY_TOKEN
set -euo pipefail

API="${CDNFLY_API:-https://cdn.cdn.sn}"
HOST="${HOST:-https://glol.rcpd.cc}"
STATE="${STATE:-.cdn-hashes.json}"
DIRS="${DIRS:-assets landmarks world textures avatar brand icons contributors home basis}"
DRY_RUN="${DRY_RUN:-0}"
PREHEAT_ONLY="${PREHEAT_ONLY:-0}"   # 1 = 只预热，不 clean（避免把线上缓存全清）
INIT_BASELINE="${INIT_BASELINE:-0}"  # 1 = 忽略旧状态、把当前文件当基线并预热全部（首次运行用）
BATCH="${BATCH:-300}"
MAX_TIME="${MAX_TIME:-60}"

# 构建产物目录：显式给定优先，否则依次尝试 dist、web/dist
if [ -z "${DIST:-}" ]; then
  for d in dist web/dist; do
    [ -d "$d" ] && DIST="$d" && break
  done
fi
[ -n "${DIST:-}" ] && [ -d "$DIST" ] || {
  echo "找不到构建产物（试过 dist、web/dist）；请用 DIST=<dir> 指定" >&2; exit 2; }

# 明文 http 只允许真正的回环主机名（精确匹配，前缀匹配会被 127.0.0.1.evil.com 绕过）
python3 - "$API" <<'PY' || exit 3
import sys, urllib.parse
u = urllib.parse.urlsplit(sys.argv[1])
host = (u.hostname or '').lower()
if u.scheme not in ('http', 'https') or not host:
    print(f'错误: CDNFLY_API 不是合法 URL {sys.argv[1]}', file=sys.stderr); sys.exit(1)
if u.scheme == 'http' and host not in ('127.0.0.1', '::1', 'localhost'):
    print(f'错误: CDNFLY_API 用明文 http 会把 token 发到 {host}，请改 https', file=sys.stderr)
    sys.exit(1)
PY

export API HOST DIST STATE DIRS DRY_RUN PREHEAT_ONLY INIT_BASELINE BATCH MAX_TIME

exec python3 - <<'PY'
import hashlib, json, os, sys, time, urllib.request, urllib.error

API   = os.environ['API'].rstrip('/')
HOST  = os.environ['HOST'].rstrip('/')
DIST  = os.environ['DIST']
STATE = os.environ['STATE']
DIRS  = os.environ['DIRS'].split()
DRY   = os.environ['DRY_RUN'] == '1'
STATE_ONLY = os.environ.get('STATE_ONLY') == '1'
PREHEAT_ONLY = os.environ.get('PREHEAT_ONLY') == '1'
INIT_BASELINE = os.environ.get('INIT_BASELINE') == '1'
NO_CLEAN = PREHEAT_ONLY or INIT_BASELINE
BATCH = int(os.environ['BATCH'])
MAX_T = int(os.environ['MAX_TIME'])
TOKEN = os.environ.get('CDNFLY_TOKEN', '')
API_KEY = os.environ.get('CDNFLY_API_KEY', '')
API_SECRET = os.environ.get('CDNFLY_API_SECRET', '')

def die(msg):
    print(f'错误: {msg}', file=sys.stderr); sys.exit(3)

def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()

now = {}
for d in DIRS:
    base = os.path.join(DIST, d)
    if not os.path.isdir(base):
        continue
    for root, _, files in os.walk(base):
        for name in files:
            full = os.path.join(root, name)
            now['/' + os.path.relpath(full, DIST).replace(os.sep, '/')] = sha(full)

old = {}
if os.path.islink(STATE):
    die(f'{STATE} 是符号链接，拒绝读写（可能被投毒）')
if os.path.exists(STATE):
    try:
        old = json.load(open(STATE, encoding='utf-8'))
    except Exception as e:
        print(f'警告: 状态文件解析失败，按全量处理 ({e})', file=sys.stderr)
        old = {}

if INIT_BASELINE:
    old = {}          # 首次运行：不信任旧状态，全部当新文件（只预热，不 clean）

changed = sorted(p for p, h in now.items() if old.get(p) != h)
removed = sorted(p for p in old if p not in now)
print(f'当前文件 {len(now)}；变更 {len(changed)}；删除 {len(removed)}')
for p in changed[:15]:
    print('   +', p)
if len(changed) > 15:
    print('   ...')
for p in removed[:10]:
    print('   -', p)

if not changed and not removed:
    print('没有变更，不需要刷新')
    sys.exit(0)

if DRY:
    print(f'DRY_RUN：将刷新 {len(changed)} 个、删除 {len(removed)} 个（删除的只刷新不预热）')
    sys.exit(0)

if STATE_ONLY:
    # 只写基线、不提交任何任务（CI 首次运行 / 刚做过整站刷新时用）
    def _save(paths):
        tmp = STATE + '.tmp'
        if os.path.islink(tmp):
            os.unlink(tmp)
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as f:
            json.dump(paths, f, indent=0, sort_keys=True)
        os.replace(tmp, STATE)
    _save(now)
    print(f'STATE_ONLY：只写基线 {len(now)} 条到 {STATE}，不提交任务')
    sys.exit(0)

if not TOKEN and not (API_KEY and API_SECRET):
    die('需要 CDNFLY_API_KEY+CDNFLY_API_SECRET 或 CDNFLY_TOKEN')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    """不跟随重定向：urllib 默认会把自定义请求头（含 access-token）带到重定向目标"""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

OPENER = urllib.request.build_opener(NoRedirect)

def api(path, body=None):
    data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method='POST' if data else 'GET')
    if API_KEY and API_SECRET:                  # 面板 API 密钥（长期有效），只在请求头
        req.add_header('api-key', API_KEY); req.add_header('api-secret', API_SECRET)
    else:
        req.add_header('access-token', TOKEN)   # token 只在请求头，不进进程列表
    req.add_header('Content-Type', 'application/json')
    req.add_header('User-Agent', 'cdn-sync/4')
    try:
        with OPENER.open(req, timeout=MAX_T) as r:
            payload = json.loads(r.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        die(f'HTTP {e.code}: {e.read()[:200]!r}')
    except Exception as e:
        die(f'请求失败: {e}')
    if not isinstance(payload, dict) or 'code' not in payload:
        die(f'响应缺少 code：{str(payload)[:160]}')
    if payload['code'] not in (0, '0'):
        die(f'业务失败 code={payload["code"]} msg={payload.get("msg")}')
    return payload

def save_state(paths):
    """原子写，且不跟随符号链接"""
    tmp = STATE + '.tmp'
    if os.path.islink(tmp):
        os.unlink(tmp)
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(paths, f, indent=0, sort_keys=True)
    os.replace(tmp, STATE)

state = dict(old)

def submit(kind, paths):
    body = [{'type': kind, 'data': {'url': HOST + p}} for p in paths]
    return api('/v1/jobs', body)

if not NO_CLEAN:
    for i in range(0, len(changed), BATCH):
        chunk = changed[i:i + BATCH]
        res = submit('clean_url', chunk)
        print(f'clean_url 第 {i // BATCH + 1} 批：{res.get("msg")}，{len(res.get("data") or [])} 个任务')
        for p in chunk:
            state[p] = now[p]
        save_state(state)      # 每批成功就落盘，中途失败重跑不会重复提交

if not NO_CLEAN:
    for i in range(0, len(removed), BATCH):
        chunk = removed[i:i + BATCH]
        res = submit('clean_url', chunk)
        print(f'clean_url(已删除) 第 {i // BATCH + 1} 批：{res.get("msg")}，{len(res.get("data") or [])} 个任务')
        for p in chunk:
            state.pop(p, None)
        save_state(state)

for i in range(0, len(changed), BATCH):
    chunk = changed[i:i + BATCH]
    res = submit('pre_cache_url', chunk)
    print(f'pre_cache_url 第 {i // BATCH + 1} 批：{res.get("msg")}，{len(res.get("data") or [])} 个任务')

# 回查任务终态：失败的从状态里剔除，下次会重试
time.sleep(5)
failed = set()
try:
    domain = HOST.split('//')[-1]
    for page in (1, 2, 3):
        d = api(f'/v1/jobs?type=clean_url&key1={domain}&page={page}&limit=50')
        for r in (d.get('data') or []):
            st = (r.get('state') or '').lower()
            if st in ('error', 'fail', 'failed'):
                u = r.get('key2') or ''
                failed.add(u[len(HOST):] if u.startswith(HOST) else u)
except SystemExit:
    raise
except Exception as e:
    print(f'回查任务状态失败（不影响本次结果）: {e}', file=sys.stderr)

if failed:
    for p in failed:
        state.pop(p, None)
    save_state(state)
    print(f'有 {len(failed)} 个任务失败，已从状态剔除，下次会重试')

print(f'完成：变更 {len(changed)}、删除 {len(removed)}；状态写入 {STATE}')
PY
