# 给执行 agent 的固定规则

## 运行结束前必须清理自己启动的进程（Rock 2026-11-19）
多个 agent 共用同一台 sg 机器，残留的预览服务器和浏览器会把机器拖垮。

- 每一轮**结束前**，把自己这一轮启动的进程全部关掉：`vite`/`npm run preview`/`npm run dev`、`http.server`、Playwright/Chromium（含 `chrome-headless-shell`、`--type=gpu-process` 子进程）、`node scripts/*.mjs`、`uv run` 长任务、`gltfpack` 等。
- 做法：
  - 启动后台服务时记下 PID（`cmd & echo $! > .pids`），结束时按 PID 关（`kill $(cat .pids)`）。
  - 验证脚本用 `timeout` 包一层，并在脚本里 `try/finally` 调用 `browser.close()` 和 `server.close()`。
  - 结束前用 `ps -eo pid,etimes,args | grep -E "vite|chrom|playwright|scripts/"` 自查，只关自己工作目录下启动的进程（可以用 `readlink /proc/<pid>/cwd` 确认）。
- **不要**用 `pkill -f <模式>` 或按进程名批量杀：会误杀别人正在跑的进程、Multica daemon，或者杀掉自己的 shell。
- 交付评论最后加一行：“已清理本轮进程”。
