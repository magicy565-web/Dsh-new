# 老应用退休评估（2026-10-23）

老应用指仓库根目录的 `server/`（单体 `server/index.mjs`，默认 `127.0.0.1:8787`）加
`src/`（React 前端）。本文回答三个问题：**它现在还有什么用、哪些能力已被新
Harness 覆盖、还差什么才能下线。**

## 入口对比

| | 老应用 | 新 Harness |
| --- | --- | --- |
| 端口 | 8787 | 8790（`harness.local.yml`） |
| 入口 | `/`（React SPA） | `/home`（工作台首页），`/` 是市场页 |
| 身份 | 自建 `access.mjs` + 签名入口 | `workspace-access`（会话 + CSRF + Ed25519 签名入口） |
| 数据 | 自有存储文件 | `.harness-data`（storage seam） |

## 能力映射

| 能力 | 老应用 | 新实现 | 证据 |
| --- | --- | --- | --- |
| 对话 / 流式 | `server/index.mjs` 路由 | `workspace-chat`（SSE、审批卡片、附件） | `scripts/chat-smoke.mjs` 16/16 |
| 上下文装配 | 内嵌 | `workspace-runner`（记忆/技能/文件固定） | `scripts/runner-smoke.mjs` 13/13 |
| 工具审批 | 内嵌 | approval seam + 聊天内人工批准 | `scripts/guarded-smoke.mjs` 10/10 |
| 产物 | `server/artifacts.mjs` | `workspace-artifacts`（文本 + 二进制、可下载） | artifacts 10/10、`chat-smoke` 字节往返 |
| 目标 | `goal-brain*.mjs` | `workspace-goals` + `/goals` 页面 | goals 6/6 |
| 计划任务 | `worker-*` | `workspace-schedules` + `/schedules` 页面 | `scripts/schedules-smoke.mjs` 8/8 |
| 通知 | 无统一入口 | `workspace-inbox`（计划/审批汇聚） | guarded/schedules 冒烟 |
| 身份 | `access.mjs`、`auth-ingress.mjs` | `workspace-access`（会话、CSRF、签名入口） | `scripts/access-smoke.mjs` 22/22 |
| 运维 / 备份 | 多个 `scripts/*` | `workspace-ops` + `/ops` 页面 | `scripts/ops-smoke.mjs` 7/7 |
| 首页 | React SPA | `workspace-home`（`/home`） | home 2/2 |

## 尚未覆盖（下线的阻塞项）

1. **未挂载的业务插件**：`plugins/` 里还有 Medusa、ERPNext、Shopify、采购、询盘等包，
   但 `harness.local.yml` 没有挂载它们，也没有对应的冒烟。老应用里这些页面仍可能是唯一入口。
2. **React 前端的专有页面**：报价单、采购单等手工交互页面没有迁移到新页面体系。
3. **数据迁移**：老应用的数据文件与 `.harness-data` 是两套结构，没有迁移脚本。
4. **二进制历史文件**：老应用存储里的附件没有导入。

## 过渡期建议

- 新入口固定为 `http://127.0.0.1:8790/home`；老应用保持只读、只在内网可达。
- 每次改动后跑：`node --test <插件测试列表>`、`node scripts/{chat,runner,guarded,schedules,access,ops}-smoke.mjs`、`wh doctor -c harness.local.yml`（当前 22 个插件、全绿）。
- 退休顺序：冻结旧写路径 → 导出旧数据 → 逐个迁移阻塞项并补冒烟 → 切换入口 → 下线 8787。
- 判定标准：上表每一行都有**真实进程的冒烟**，且 §尚未覆盖 的四项清零。

## 结论

核心工作流（对话→上下文→工具审批→产物→目标→计划→通知→身份→运维）已经在新
Harness 上闭环并有证据；老应用仍不能被删除，因为业务插件挂载、专有页面和数据迁移
三项未完成。**结论：保留，但不再是主入口。**
