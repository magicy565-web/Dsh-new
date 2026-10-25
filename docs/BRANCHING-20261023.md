# 开发与发布分支

更新：2026-10-26。后续执行宿主为 DeepSeek Harness；独立工作台已删除。

- 云端工作区 `/workspace/wsa-dev`：`agent/harness-20261023`，本次清理与后续 DSH 开发。
- 原 checkout `/workspace/workspace-agent`：保留会话开始时的检出状态，避免覆盖别的工作。
- 功能提交使用显式路径，勿带入其他会话未提交文件。
- 合入 `release/harness-20261023` 仍只允许快进；遇到分叉先检查，不强推。
- 当前检查为 `npm run build` + `npm test`；旧工作台的 release-check / doctor 已随运行层删除。
- 本地测试不能替代真实 DSH 挂载和浏览器验收；不得沿用旧工作台的上线结论。
