# 当前开发交接：DeepSeek Harness

2026-10-26 用户明确选择 DSH 为执行宿主，并要求从仓库删除旧独立 Workspace Harness。
主入口见 [README](README.md)，删除范围见 [迁移记录](docs/DSH-MIGRATION-20261026.md)。

- 在 `/workspace/wsa-dev` 的 `agent/harness-20261023` 继续开发；不要覆盖另一个 checkout。
- 复用 DSH 会话、Agent 执行、权限、工具注册、附件及 profile；不要恢复自建内核／独立运行层。
- 三个原生插件位于 `integrations/dsh/`。通用底座不强制采用获客插件的业务阶段。
- `packages/domain-business-memory` / `packages/domain-product-library` 是保留下来的领域逻辑，
  没有独立 HTTP 服务，也尚未装配为 DSH 插件。
- 原生资料库／Space／Sourcing 的本地测试不等于真实宿主、真实模型、浏览器或生产验收。
- `npm run build` 做静态检查；`npm test` 做原生插件与领域回归；不调用模型或修改 profile。
- 提交使用显式路径；保留其他会话改动。发布分支只允许快进，不能强推。
- 旧应用、OMP 与 Medusa 代码本轮保留；历史限制及旧版未通过门槛仍适用于它们。
  原始交接与验证说明保存在 `docs/archive/`。

下一步继续 DSH 资料选择／版本引用到原生对话的接入，先核实实际宿主接口。
不得把仅存储消息的页面声称为已接通 Agent，也不能把固定流程冒充通用执行能力。
