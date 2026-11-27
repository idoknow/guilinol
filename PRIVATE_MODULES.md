# 私有模块

以下实现不再随本仓库分发，由部署仓库 `idoknow/guilinol-ops`（私有）在构建时叠加：

- `rt/`：联机服务与反作弊（含距离额度判定、封禁、协议校验、测试）
- `server/trace-*.mjs`、`server/cheat-captures.mjs`：会话标记编解码、上传接口与取证截图服务
- `web/src/session-mark*.ts`、`web/src/cheat-capture.ts`、`web/src/capture-page.ts`、`web/src/fingerprint.ts`
- `deploy/postgres/024-mp-anti-cheat.sql`、`025-mp-reviews.sql`、`026-mp-cheat-captures.sql`
- `scripts/cheat-capture-test.mjs`、`scripts/test-session-mark.mjs`、`scripts/test-trace-*.mjs`、`scripts/verify-trace-browser.mjs`、`scripts/bench-trace.mjs`

本仓库单独 clone 无法完整构建/运行，属于预期行为。
