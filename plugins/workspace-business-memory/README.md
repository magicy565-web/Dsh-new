# workspace-business-memory

企业经营记忆：**每个工作空间（企业）一套独立、来源固定、人工审核的业务记忆**。
模型可以召回记忆、提出候选；只有管理员审核通过后，候选才成为经营事实。
增长简报由已确认记忆确定性计算，不编造指标、预测或因果结论。

这是 Harness 后端切片（HTTP + 模型工具 + 记忆区域页面），不是新前端框架，
也不复制产品库、企业资料库或旧 Workspace 的记忆账本。

## 为什么不直接叫“聊天记忆”

聊天记忆记住的是对话；经营记忆记住的是**企业可复用的业务事实**：

| 聊天/笔记记忆 | 本插件的经营记忆 |
| --- | --- |
| 一条自由文本 | 主体（企业/产品/客户/市场/渠道/经营动作）+ 事实键 + 类型 |
| 可能被下一轮覆盖 | 版本链、替代关系、撤回与历史 |
| 说不清来源 | 精确来源引用、核对状态、SHA-256（可核对来源） |
| 模型自己决定 | 模型只能提出候选，管理员审核后生效 |
| 只服务一次回答 | 可被后续所有会话召回，并驱动增长简报 |

## 已实现

1. **每企业一套独立记忆**：`ctx.workspace` 解析工作空间与成员角色，记忆存储按
   workspace 分区（`state.workspaces.<id>.harnessBusinessMemory`）；同一事实键在
   两个企业互不可见。角色来自成员表，不信任请求头自称的 admin。
2. **来源与核对**：
   - `operator`：人工陈述，必须写依据；标记为 `human-attested`。
   - `conversation`：指向精确对话引用；标记为 `conversation-pointer`，仍需人工确认。
   - `product-page`：写入与审核时都向已审核的产品资料库核对**精确页面版本与 SHA-256**；
     版本变化、哈希不符、页面不存在、服务不可达全部 fail closed。
   - `document`：企业资料库来源的接口已预留；未配置时明确返回
     `BUSINESS_MEMORY_SOURCE_UNCONFIGURED`，不降级成本地猜测。
3. **人工审核**：`proposed → active` 必须由管理员执行；批准旧事实的替代版本会把
   当前 active 置为 `superseded`，并保留完整历史与 revision。
4. **召回**：按主体、事实键、类型、状态、自由文本过滤；viewer 只能读取 active，
   operator/admin 可看候选；支持 `requestId` 幂等重放。
5. **增长简报**：覆盖缺口、待审核积压、即将过期、已决策未复盘；
   每条信号引用已有记忆 id，只做计数与结构判断，没有收益预测或因果结论。
6. **审计**：提出/批准/拒绝/撤回写入 `ctx.audit`，只记录元数据（不含事实正文）。
7. **记忆区域页面**：`GET /business-memory`，自包含 HTML（严格 CSP），
   可浏览、搜索、审核、撤回、手工记录；没有外部脚本或构建步骤。

## 不做什么

- 不调用模型；LLM 通过 DSH 工具或组合内工具使用记忆，不在插件里发请求。
- 不做向量检索、Mem0、自动策略学习或 embedding。
- 不创建 Goal、审批、Worker 派单、外部写操作或客户可见披露。
- 不是多租户 SaaS；`workspaceId` 是 Harness 组合内的企业作用域。
- 不把模型叙述直接当事实；没有人工审核就没有 active 记忆。

## 组合行

需要 `storage`、`tools`、`approval`、`workspace`、`audit` 五个 seam：

```yaml
- id: business-memory
  name: workspace-business-memory
  config:
    workspaceId: local
    # 可选：配置后 product-page 来源会向产品资料库核对精确版本与 SHA。
    productLibraryBaseURL: http://127.0.0.1:8790
    # allowLoopbackHTTP: true   # 仅显式审核时用于非 loopback 的明文 HTTP
    # allowConversationSources: false  # 可关闭对话来源
    # timeoutMs: 5000
```

不配置 `productLibraryBaseURL` 时插件仍可挂载：`operator` / `conversation` 来源可用，
`product-page` 明确返回 503，不伪造核对结果。

## HTTP

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/business-memory/status` | 工作空间、计数、来源能力 |
| GET | `/api/business-memory/map` | 按主体类型的覆盖与最近变化 |
| GET | `/api/business-memory/brief` | 增长简报（确定性、可追溯） |
| GET | `/api/business-memory/records?q=&subjectType=&factKey=&kind=&status=&limit=` | 召回 |
| GET | `/api/business-memory/records/:id` | 详情、来源、历史、相关记录 |
| POST | `/api/business-memory/records` | 提出候选（`requestId` 幂等） |
| POST | `/api/business-memory/records/:id/review` | 管理员通过/拒绝 |
| POST | `/api/business-memory/records/:id/revoke` | 管理员撤回 |
| GET | `/business-memory` | 记忆区域页面 |

写操作全部要求 `requestId`；相同 requestId + 相同内容返回原结果，不同内容 409。

## 工具

只读：`business_memory_status`、`business_memory_recall`、`business_memory_read`、
`business_memory_map`、`business_memory_brief`。

需要一次性审批票据（`approval: 'always'`）：`business_memory_propose`、
`business_memory_review`、`business_memory_revoke`。

DSH 侧的适配器只暴露只读工具和“提出候选”；审核与撤回只留给人。

## 数据与失败边界

- 存储损坏、重复 active 事实、超限、跨 workspace 记录一律 fail closed
  （`BUSINESS_MEMORY_INVALID`），不静默重置；
- 单工作空间上限 5000 条记录、10000 条幂等回执、每条 60 条历史；
- 事实正文 ≤2000 字节、详情 ≤8000 字节、标签 ≤12 个；
- 过期事实保留记录但退出 `usable` 与简报统计；
- 未配置的来源、不可达的上游、版本漂移全部阻止写入，不把“没核对”写成“已核对”。

## 验证

在仓库根目录：

```powershell
$node = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node --test plugins/workspace-business-memory/test/domain.test.mjs plugins/workspace-business-memory/test/plugin.test.mjs
```

本地组合冒烟（需要先启动 `node scripts/harness-serve.mjs`）：

```powershell
& $node packages/harness-kernel/bin/wh.mjs doctor --composition harness.local.yml
& $node scripts/business-memory-smoke.mjs --out docs/validation/business-memory-harness-20261022/smoke.json
& $node scripts/business-memory-area-screens.mjs
```

测试全部使用合成数据、本地 HTTP stand-in 和临时存储；没有调用真实模型、
Medusa 或企业资料服务。真实部署仍需要账户、权限与数据验收。
