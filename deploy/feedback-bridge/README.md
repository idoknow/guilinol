## sg 主机上安装（仅由验收人执行）

使用专用的私有工作目录 `~/guilinol`，或修改 service 的 WorkingDirectory。需要 Linux util-linux `flock`、Node 22、已登录相应 workspace 的 Multica daemon CLI、对私库有只读访问权的 `gh`。确保 user service 的 PATH 可找到它们（必要时在 env 写入完整 PATH）。不要使用短期任务 checkout。

```sh
install -d -m 700 ~/.config/glol-feedback-bridge ~/.config/systemd/user
install -m 600 deploy/feedback-bridge/env.example ~/.config/glol-feedback-bridge/env
install -m 644 deploy/feedback-bridge/glol-feedback-bridge.{service,timer} ~/.config/systemd/user/
```

在私有 env 中填入 Pages 同一 token、汇总父 issue UUID、mac local codex 的 agent UUID，以及 daemon 提供的绝对 CLI 路径。核对 project 后设置 `BRIDGE_ENABLED=1`。仅单机、单份状态目录运行，不要并行部署第二台主机。确保用户退出后 systemd user manager 仍运行（由管理员按需启用 linger）。

```sh
systemctl --user daemon-reload
systemctl --user enable --now glol-feedback-bridge.timer
systemctl --user list-timers glol-feedback-bridge.timer
journalctl --user -u glol-feedback-bridge.service
```

开关改回 0 后下次直接退出；卸载用 `systemctl --user disable --now glol-feedback-bridge.timer`。`--dry-run` 只读取远端数据，将含用户私有信息的描述打印到本地，请勿分享真实输出。状态保存在 `~/.local/state/glol-feedback-bridge`；不要清空。两次 Multica 失败后暂停该反馈并在关联任务（尚未建单则在汇总父 issue）提醒 sg claude。人工核对任务、照片和时间线后，停 timer 并等 service 退出，只清该反馈 JSON 的 `failures` 和 `alerted` 字段，再启动 timer。未建单时反馈保持 submitted，不伪报已开始建模。409 不重试。用户原照片始终从受鉴权的接口读取；仅明确标记可公开的成果 PNG 进入 `public/comparisons/`。
