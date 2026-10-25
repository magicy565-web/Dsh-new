# dsh-workspace-memory

原生经营记忆插件：候选、人工审核、版本替换、撤销、有效期和可追溯召回。
复用 `packages/domain-business-memory`，没有旧 HTTP 桥接、独立运行服务或 Agent Loop。

## 安装

这是本仓库内的本地 bundle，保留完整 checkout。在仓库根目录先运行
`npm ci --ignore-scripts`，由 npm workspaces 连接领域包并安装锁定的 zod；
再在 DSH 执行 `plugin_manager install_bundle target=<checkout>/integrations/dsh/dsh-workspace-memory`。
当前领域依赖尚未发布到 registry，不将单独打出的插件 tarball 声称为可独立分发的发行包。

侧栏入口为「经营记忆」，Host 行为 `include:workspace-memory`。
必需服务：`tools`、`storageDomain`、`workspaceRegistry`；Web 面复用 `connection` / `webServer`。
文档来源可选复用资料库提供的 `workspaceLibrary`；未装资料库时仍可提出人工／对话候选。

## 使用与边界

1. 在 DSH 建立原生工作区，在记忆面板中选择它。工作区 id 来自原生 registry。
2. 人工或 Agent 提出候选，注明对象、事实键、信息性质、来源和可选有效期。
3. 用户在面板中查看原文、来源、SHA 和历史，选择通过或驳回。审核要求当前全局修订。
4. 同一对象／事实键的新候选获批后替换旧记录；旧历史保留。
5. `business_memory_recall` 只返回已人工确认、未过期且来源仍可用的记忆。

记忆不自动注入系统提示。Agent 自主选择工具；业务阶段不成为宿主的强制执行流程。
模型调用的实际工具结果由 DSH 会话记录；这里的操作幂等凭据和审核历史不是模型执行证明。

| 工具 | 能力 |
| --- | --- |
| `business_memory_propose` | 仅提出候选；作用域从当前 Agent 的原生会话归属解析，不能传入工作区／角色／审核标志 |
| `business_memory_recall` | 当前工作区内的有界召回；最多检查 50 条，默认 20 条，记录 JSON 总计最多 24 KB，返回未返回数量与排除原因 |

召回的 `q` 是字面子串；可省略以读取当前工作区的有界结果。
`searchScope` 为 `approved-active-only`，`population` 返回各生命周期的数量，不返回待审核内容。
空 `items` 表示没有可用匹配，不表示工作区没有候选。

没有审核、批准、撤销的模型工具。HTTP 面只面向已认证的 DSH Web 管理员。
当前 DSH profile 视为单一管理员：他可以在面板中选择 registry 中的各工作区；
工作区分区是数据组织和 Agent 作用域，不是成员／企业租户隔离承诺。

## 来源

- **文档**：`doc_` id + 确切版本 + SHA-256，经资料库原生附件读取器验证。
  提候选、通过、召回时重新核验原字节，发现归档、缺失、篡改、不可读取或插件失效即拦截。
  新版不替换旧 pin。当前只支持资料库读取器支持的有界 UTF-8 TXT / Markdown / CSV / JSON。
  文档属于当前 profile 的企业资料库；各工作区中的记忆独立。
- **原生对话**：Agent 未指定文档时，服务根据真实执行上下文写入当前 session / tool call 指针。
  模型不能自填指针。它不表示逐句内容已被独立核验；面板可跳转原生来源对话。
- **人工陈述**：仅从管理员界面创建，必须填写陈述依据。人工批准也不等于独立证明。

事实、观察、假设、偏好、决策和结果保持各自性质，不能因为审批而相互替换。

## 存储与 HTTP

原生 `ctx.storageDomain` 单元 `workspace_business_memory`，使用宿主路由的存储后端。
其 global 中按 `workspaces[原生 id].harnessBusinessMemory` 保存原有领域数据键。
更新在原生持久提交后才发布；写失败保留旧快照，损坏状态加载失败，不清空重建。
插件卸载会取消并排空待处理操作，然后关闭原生 domain。不会自动迁移旧工作台文件。

同源认证接口前缀 `/workspace-memory-api`，请求体最多 64 KiB：

- `GET /workspaces`：真实原生工作区。
- `GET /workspaces/:id/state`：状态／筛选记录，默认最多 20 条；可用搜索缩小匹配范围。
- `GET /workspaces/:id/sources`：资料库可读的版本元数据，不返回原文。
- `GET /workspaces/:id/memories/:memoryId`：记录、来源可用性和历史。
- `POST /workspaces/:id/proposals`：不接受 `activate`、身份或权限字段。
- `POST /workspaces/:id/memories/:memoryId/review`：`decision`、`note`、`requestId`、`expectedRevision`。
- `POST /workspaces/:id/memories/:memoryId/revoke`：`reason`、`requestId`、`expectedRevision`。

所有写操作使用稳定的 UUID `requestId`；相同命令重试复用凭据，变更内容必须换新 UUID。
审核版本冲突返回 409，不覆盖他人的决定。写请求检查 Origin，未认证请求返回 401。

## 验证

仓库根目录：

```sh
npm ci --ignore-scripts
npm run check
npm run test:client
DSH_RUNTIME_DIR=/workspace/dsh-runtime node integrations/dsh/dsh-workspace-memory/dev/native-smoke.mjs
```

核心测试覆盖权限边界、原生作用域、来源失效、取消、并发撤销、持久提交失败和幂等重试。
Client 冒烟使用真实 React / jsdom 与本地 HTTP、合成 storage / registry。
可选 native smoke 使用官方 Cordis、Tools、StorageDomain / JSON，Agent identity 是测试夹具；
它验证审批、召回和重启恢复，不验证真实模型任务。
指定场景的真实模型验收与离线证据检查见 [LIVE-ACCEPTANCE.md](../../../docs/LIVE-ACCEPTANCE.md)。
