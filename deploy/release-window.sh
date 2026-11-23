#!/usr/bin/env bash
# 定时发版（IDOK-155，Rock 2026-11-22）：线上每 4 小时最多更新一次，不再每合并一个 PR 就发。
# 由 sg 上的 systemd user timer glol-release-window.timer 调用，工作目录是专用克隆 ~/glol-release/guilinol
# （不要用 ~/guilinol，那是反馈桥的目录）。
# 逻辑：取 main 上最新一个「镜像已构建成功」的提交；和线上 /version.json 相同就跳过，不同就检出后跑 deploy-hk.sh。
# 整个脚本包在 main() 里，bash 先读完再执行，后面 git checkout 改掉本文件也不影响这次运行。
set -euo pipefail
main() {
  cd "$(dirname "$0")/.."
  local repo=idoknow/guilinol live target
  git fetch --quiet origin main
  target=$(gh run list -R "$repo" --workflow glol-images.yml --branch main --event push --status success \
    --limit 1 --json headSha --jq '.[0].headSha')
  [[ $target =~ ^[0-9a-f]{40}$ ]] || { echo "找不到构建成功的 main 镜像" >&2; exit 1; }
  git merge-base --is-ancestor "$target" origin/main || { echo "$target 不在 main 上" >&2; exit 1; }
  live=$(curl -fsS --max-time 20 https://glol.rcpd.cc/version.json | sed -n 's/.*"sha" *: *"\([0-9a-f]*\)".*/\1/p')
  if [[ $live == "$target" ]]; then
    echo "线上已是 ${target:0:7}，本窗口无更新"
    exit 0
  fi
  echo "发版窗口：${live:0:7} → ${target:0:7}"
  git log --oneline "${live:-$target~1}..$target" 2>/dev/null || true
  [[ ${DRY_RUN:-} == 1 ]] && { echo "DRY_RUN=1，不部署"; exit 0; }
  git checkout --quiet --detach "$target"
  bash deploy/deploy-hk.sh
  for attempt in {1..12}; do
    live=$(curl -fsS --max-time 20 "https://glol.rcpd.cc/version.json?t=$(date +%s)" | sed -n 's/.*"sha" *: *"\([0-9a-f]*\)".*/\1/p' || true)
    if [[ $live == "$target" ]]; then
      echo "已上线 ${target:0:7}"
      # CDNFly 没有刷新/预热 API：上线后用 GET 把大文件拉进 CDN（失败不影响发版）。
      # 2026-11-23 起暂停：CDNFly 节点出现 456（CC/自动封禁），DNS 已回滚到 CF。恢复后在 service 里设 CDN_WARM=1 再启用。
      if [[ ${CDN_WARM:-0} == 1 ]]; then
        bash scripts/cdn-warm.sh || echo "CDN 预热失败（不影响发版）" >&2
      fi
      exit 0
    fi
    sleep 10
  done
  echo "部署脚本成功但 /version.json 仍是 ${live:0:7}" >&2
  exit 1
}
main "$@"
