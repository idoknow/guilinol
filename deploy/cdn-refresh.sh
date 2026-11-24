#!/usr/bin/env bash
# 发版后刷新 CDN（在发版机 sg 上跑，IDOK-192）。
# 以前由 GitHub Actions 的 cdn-purge.yml 做，但 GitHub runner 连 cdn.cdn.sn 一直超时（HTTP 000），
# 每次发版都失败、CDN 旧文件刷不掉。现在改在发版机本地跑，逻辑不变：
#   1. 入口页（no-store 的 HTML / version.json / manifest）直接 clean_url
#   2. 从 glol-web:<sha> 镜像取出实际在跑的静态文件，和上次的哈希基线比，只刷新+预热变了的文件
# 密钥：~/.config/glol-cdn/env（CDNFLY_API_KEY / CDNFLY_API_SECRET，0600，不进仓库）。
# 基线：~/.local/state/glol-cdn/hashes.json；没有基线时只记基线不刷新。
# 用法：deploy/cdn-refresh.sh <sha>    失败只返回非 0，由调用方决定是否影响发版。
set -euo pipefail
sha=${1:?用法: cdn-refresh.sh <sha>}
[[ $sha =~ ^[0-9a-f]{7,40}$ ]] || { echo "bad sha: $sha" >&2; exit 2; }
env_file=$HOME/.config/glol-cdn/env
[[ -r $env_file ]] || { echo "缺少 $env_file，跳过 CDN 刷新" >&2; exit 1; }
set -a; . "$env_file"; set +a
cd "$(dirname "$0")/.."

bash scripts/cdn-purge.sh url / /index.html /version.json /id.html /backpack.html /admin/ /manifest.webmanifest

state_dir=$HOME/.local/state/glol-cdn; mkdir -p "$state_dir"
work=$(mktemp -d); trap 'rm -rf "$work"; [[ -n ${cid:-} ]] && docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT
image=ghcr.io/idoknow/glol-web:$sha
docker pull -q "$image" >/dev/null
cid=$(docker create "$image")
docker cp "$cid:/usr/share/nginx/html" "$work/dist-live"
if [[ ! -s $state_dir/hashes.json ]]; then
  echo "没有哈希基线：只记录基线，本次只刷了入口页"
  DIST=$work/dist-live STATE=$state_dir/hashes.json STATE_ONLY=1 bash scripts/cdn-sync.sh
else
  DIST=$work/dist-live STATE=$state_dir/hashes.json bash scripts/cdn-sync.sh
fi
echo "CDN 刷新完成 ${sha:0:7}"
