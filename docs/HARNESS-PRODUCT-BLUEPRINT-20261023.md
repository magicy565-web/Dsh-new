# Harness 产品化蓝图

日期：2026-10-23
决策：以后产品开发以本地 Harness 为宿主，应用进程最终退役。
现状：主干 `codex/plugin-library-completion-20261020` @ `1e267158` + 本次 kernel 流式改造。

## 0. 一句话目标

把「聊天优先的单企业工作台」完整地跑在一个本地 Harness 进程里：
一个内核 + 一组接缝（seams）+ 一组领域插件 + 自带页面，应用进程退化成历史客户端。

## 1. 产品能力全景

| 域 | 能力 | 现在在哪 | 目标归属 | 状态 |
| --- | --- | --- | --- | --- |
| A 身份与访问 | 会话、CSRF、角色、企业签名入口 | `server/access*.mjs` | 插件 `workspace-access` + kernel 鉴权钩子 | 未迁 |
| B 工作空间与成员 | 成员表、角色、workspace 解析 | harness workspace seam | 已就位 | ✅ |
| C 会话与运行 | 会话、消息、run 状态机、事件流 | `server/index.mjs`、`server/runtime.mjs` | 插件 `workspace-chat` + kernel 流式 | 未迁（流式本次补齐） |
| D 模型与预算 | provider、token 预算、取消、用量 | `pi-provider.mjs`、`workspace-llm-bridge` | 插件 `workspace-llm-bridge` + 预算插件 | 部分（provider 有，循环没有） |
| E 上下文装配 | 文件、技能、记忆、企业事实 | `server/task-context.mjs` | 插件 `workspace-context` | 记忆已属 harness，其余未迁 |
| F 工具与审批 | 工具注册、审批票据、连接器 | `workspace-bridge.mjs`、`capabilities.mjs`、approval/tools seams | 接缝已就位 + 插件 `workspace-approvals` | 部分 |
| G 产物 | 生成文件、下载、发布 | `run-output.mjs`、artifacts seam | 接缝已就位 + 插件 | 部分 |
| H 业务域 | 资料库、产品库、市场、采购、供应商、Medusa | `plugins/*` | 已在 harness | ✅ 大部分 |
| I 目标与信号 | Goal、Brain、经营信号 | `server/goal-brain*.mjs` | 插件 `workspace-goals` | 未迁 |
| J 自动化 | 计划任务、通知、Worker 派发 | `capabilities.mjs`、`worker-*` | 插件 `workspace-schedule` | 未迁 |
| K 运维 | 诊断、恢复、备份、部署、上线闸门 | 多个 `server/*`、`scripts/*` | 插件 `workspace-ops` | 未迁 |
| L 界面 | 聊天壳、区域页面、管理控制台 | `src/` React | Harness 静态托管 + 每插件页面 | 未迁（`/market`、`/business-memory` 是先例） |

## 2. 归属原则

- **kernel**：只管传输与装载——路由、参数、JSON、错误映射、流式、取消、鉴权钩子。不放业务。
- **seams**：能力接口，可替换、可测试——storage / approval / artifacts / audit / llm / skills / workspace / scope。
- **plugins**：领域数据与领域路由，一个域一个数据分区（`state.workspaces.<id>.<domain>`）。
- **pages**：插件自带的自包含页面（严格 CSP、无外部资源），这是现有 `/business-memory`、`/market` 的模式。

## 3. 先补 kernel 的四个缺口

这四个不补，上面任何一个能力都做不成：

| 缺口 | 为什么阻塞 | 状态 |
| --- | --- | --- |
| 流式响应（SSE） | 聊天必须边生成边推送；缓冲会让用户等到整段结束 | ✅ 本次完成，102/102 |
| 取消传播 | 客户端断开要能停掉 run 和 provider 调用 | 读端已取消源流；运行层取消待做 |
| 鉴权钩子 | 现在只有 `x-harness-*` 自报 actor，不能用于真实用户 | 未做 |
| run 生命周期 | 长任务需要句柄、超时、背压、恢复 | 未做 |

## 4. 构建顺序（每阶段都有验收）

- **P0 内核**（本次完成一半）：流式 ✅、取消、鉴权钩子。
  门槛：kernel 全量测试 + 新增流式/取消测试。
- **P1 会话与运行最小闭环**：`workspace-chat`（会话、消息、run 状态机、SSE）+ `workspace-runner`
  （历史 + 记忆块 → `ctx.llm` → 写回回答）。已完成，模型调用按 `complete()` 一次性返回；
  provider 级流式增量（`run.delta`）待 llm seam 增加 `stream` 能力后接入。
  门槛：一个会话 → 一次 run → 流式事件顺序断言 → 重连可重放（`scripts/chat-smoke.mjs`、`scripts/runner-smoke.mjs`）。
- **P2 上下文装配**：把 `task-context` 的快照语义搬进 `workspace-context`：文件版本、
  技能版本、记忆注入（已有服务）、越权检查。
  门槛：快照过期/版本变化必须阻断；记忆 `verify` 在派发前复核。
- **P3 工具与审批**：工具注册 + 一次性审批票据 + 连接器执行，复用 approval seam。
  门槛：并发重放、过期、篡改、重启后消费失败，全部 fail closed。
- **P4 产物**：生成文件、下载、发布，接 artifacts seam。
- **P5 目标 / 调度 / 通知**：Goal 状态机、计划任务、通知闭环。
- **P6 身份与企业模式**：本地单用户令牌、企业签名入口、会话撤销。
- **P7 界面页化**：聊天壳页、管理页、审批卡片；逐页替换 React。
- **P8 迁移与退役**：会话/运行/审批/产物一次性导入，应用进程下线。

## 5. 关键决策（建议现在拍板）

1. **run 循环抽取而不是重写**：把 `server/runtime.mjs` 抽成 `packages/agent-core`，
   app 与 harness 各挂一次。261 个后端测试是资产，重写等于丢掉。
2. **会话存储沿用单写者 JSON + 事件表**：事件表让 SSE 可重放、可审计；不引入数据库。
3. **身份先做本地单用户令牌**：loopback + `Authorization`，企业模式再上签名入口。
4. **前端复用现有 React**：构建后由 harness 静态托管，逐页替换，不重写 UI。

## 6. 风险

- kernel 改动影响所有插件——用现有 102 个 kernel 测试兜底（本次已验证）。
- 迁移期双运行时：必须禁止双写，先只读镜像再切换。
- 线上部署 `43.128.86.22` 仍在跑应用，迁移不能一步到位。

## 7. 现在能验证什么

| 能力 | 命令 | 结果 |
| --- | --- | --- |
| kernel 流式/取消 | `node --test packages/harness-kernel/test/` | 102/102 |
| 会话与运行 | `node --test plugins/workspace-chat/test/ plugins/workspace-runner/test/` | 20/20 |
| 聊天 SSE 端到端 | `node scripts/chat-smoke.mjs` | 9/9 |
| run 循环端到端 | `node scripts/runner-smoke.mjs` | 7/7 |
| 记忆服务通道 | `node scripts/memory-bridge-smoke.mjs` | 11/11 |
| 记忆全量 | `node --test plugins/workspace-business-memory/test/*.test.mjs test/business-memory-client.test.mjs` | 55/55 |
| 组合完整性 | `node packages/harness-kernel/bin/wh.mjs doctor -c harness.local.yml` | exit 0（13 个插件） |
