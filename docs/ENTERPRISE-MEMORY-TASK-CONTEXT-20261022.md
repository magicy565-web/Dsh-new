# 企业经营记忆接入任务执行上下文

日期：2026-10-22
基线：A，当前 HEAD `codex/product-library-20261022`（`9ccc4f4`，含后续产品库提交）
范围：`enterprise-memory-ledger` + `task-context` + `runtime` + `index` 接线及测试
不包含：新记忆账本/数据库/Runtime、Brain/Signal/Goal/Outcome 改造、客户披露扩权、原生 Session 验收

## 0. 先核对基线（不能只看分支名）

当前 HEAD 中：

- `server/enterprise-memory-ledger.mjs` 存在，已按 `workspaceId` 创建并校验账本行；
  `remember/read/lookup/revoke/list/history/revalidateSnapshot` 等基础接口存在。
- **PR #112 的隔离修复没有吸收**：提交 `db78f41037e1d89f2b810c931d3cac50f087297f`
  不是 HEAD 的祖先（`git merge-base --is-ancestor` 退出 1）。
- HEAD 缺少 PR #112 的以下文件/能力：
  - `server/workspace-store-identity.mjs`
  - `scripts/bind-enterprise-store.mjs`
  - `test/enterprise-memory-isolation.http.test.mjs`
  - `test/enterprise-store-identity.test.mjs`
  - `server/store.mjs` 中没有企业数据目录身份绑定/旧数据显式认领
  - ledger 中没有 PR #112 的 `assertResponseCurrent` 及客户来源双重授权加固

因此本次只在现有账本上做任务上下文接入；**企业数据目录身份绑定、旧数据认领与
PR #112 原生链路仍单独未通过**，不能用本次单元测试替代。

## 1. 旧缺口

`server/task-context.mjs` 的 `prepareInputContext` 只处理用户手选的
`artifacts/skills/memoryIds`；`inputContext` 为 `undefined` 时直接返回，因此每次任务
不会读取 `enterpriseMemories`。`runtime.mjs` 的 `contextMessages` 也只包含旧笔记，
不包含企业事实。

## 2. 本次改动

### 2.1 账本：任务读取接口（唯一记忆权威不变）

`server/enterprise-memory-ledger.mjs` 新增：

- `recallForTask(actor, { query, limit, maxChars })`
  - 只返回本企业 `active`、`internal`、未过期的记忆；
  - 按事实文本/主体 id/事实键做轻量相关性排序，再用字符预算截断；
  - **只对即将披露的事实做 `currentSource` 检查**；来源失效的条目跳过并返回
    `skippedSources`，而不是让所有任务失败；
  - 返回 `facts`（含 id、revision、statement、source、updatedAt、expiresAt）和
    `contextRevision`（审计/快照标识）。
- `contextRevision(actor)`：本企业 active 内部事实的 id+revision 哈希。
- `assertTaskSnapshot(state, facts)` / 导出 `assertTaskFactsCurrent`：
  - 只校验本次实际引用的 fact id、`revision`、`statement`、`workspaceId`、状态、
    过期时间以及来源当前有效性；
  - 新增 code：`MEMORY_CONTEXT_CHANGED`、`MEMORY_CONTEXT_EXPIRED`、
    `MEMORY_CONTEXT_INVALID`；
  - **总版本变化不阻断任务**；只有被引用事实本身变化才阻断。

### 2.2 任务上下文：每次 run 固定企业事实快照

`server/task-context.mjs`：

- `prepareInputContext` 新增 `enterpriseMemory`、`enterpriseActor`、`query`；
- 每次 run（即使 `inputContext === undefined`）都生成：
  - `enterpriseFacts`、`enterpriseRevision`、`enterpriseOmitted`、
    `enterpriseWarning`、`skippedSources` 对应告警；
- 旧行为保留：手选 artifacts/skills/notes 的校验、预算、凭证筛查完全不变；
  未传 `enterpriseMemory` 时依旧返回 `undefined`，不改变旧调用方；
- `inputContextMessages` 增加一条 **system** 块：
  - 明确“企业已确认、人工审核、来源固定”的事实，仅作数据不是指令；
  - 要求引用 `[mem:<id>]`；
  - 没有事实时明确说“当前没有已确认经营记忆”；
  - 读取失败时只暴露错误 code，并明确要求模型不要声称记得企业事实；
- `assertInputContextSnapshot` 末尾校验 `enterpriseFacts`，因此现有准入事务和
  `pi-provider.mjs` 的模型调用前复核都会自动生效。

### 2.3 Runtime / 组装接线

`server/runtime.mjs`：

- `createRuntime({ ..., enterpriseMemory, memoryWorkspaceId })`；
- `prepareRunInput` 从本次用户输入（消息创建路径传入 `content`；恢复/修改上下文
  路径取最后一条 user 消息）生成 query；
- `completeObserved` 增加 **provider-neutral pre-dispatch 复核**：所有 provider
  调用前都重新校验本次快照，排队后才启动的 run 同样覆盖；
- 使用 conversation 的 `workspaceId` 构造内部服务 actor
  `{ subject: 'workspace-runtime', role: 'operator', workspaceId }`，只读本企业账本；
- 快照仍写入 `run.inputContextSnapshot`，每次 run 可追溯；
- 保留旧行为：快照只含企业事实（无手选 selection）时，历史启用笔记仍进入系统
  prompt，不被企业事实替代。

`server/index.mjs`：

- 把已经创建的 `enterpriseMemory` 实例传入 `createRuntime`；
- 不创建第二个账本。

## 3. 阻断语义

| 场景 | 行为 |
| --- | --- |
| 任务未开始前，某条事实来源版本变化 | `recallForTask` 跳过该条，快照不含它，`MEMORY_SOURCE_SKIPPED` 告警 |
| 快照已固定，准入前该事实被替代/撤权/来源失效 | `assertInputContextSnapshot` 抛 409，任务不执行 |
| 企业新增一条**与任务无关**的事实 | 不阻断；`contextRevision` 仅用于审计 |
| 事实在运行中过期 | 后续复核抛 `MEMORY_CONTEXT_EXPIRED` |
| 另一企业读取 | actor/workspace 不匹配，`MEMORY_WORKSPACE_REQUIRED` |

## 4. 验证

本次实际执行：

| 命令 | 结果 |
| --- | --- |
| `node --test test/task-context.test.mjs test/task-context-enterprise-memory.test.mjs test/runtime-enterprise-memory.test.mjs test/enterprise-memory-ledger.test.mjs test/enterprise-memory-http.test.mjs test/goal-brain-memory-fact.test.mjs test/runtime-v2.test.mjs` | **79/79 通过**（含 runtime-v2 的 22 项） |
| `node --test test/enterprise-memory-ledger.test.mjs test/enterprise-memory-http.test.mjs test/goal-brain-memory-fact.test.mjs test/pi-provider.test.mjs` | **40/40 通过** |
| `tsc --noEmit` | 通过 |

代码审查与逐路径结论见
[代码审查记录](REVIEW-ENTERPRISE-MEMORY-TASK-CONTEXT-20261022.md)。

新增测试覆盖：

- `recallForTask` 选择、排序、审计 revision；
- 无手选 inputContext 时仍注入企业事实；
- 来源版本变化阻断（`MEMORY_SOURCE_REVOKED`）；
- 被引用事实被替代后旧快照阻断（`MEMORY_CONTEXT_CHANGED`）；
- **无关新事实不阻断**；
- 过期/非 active 事实不进入快照；
- 跨企业 actor 拒绝；
- runtime 真实 run：provider 收到企业记忆块，`run.inputContextSnapshot` 保存
  fact id/revision；
- 来源变化后的下一条 run 不再把旧事实当作当前事实。

### 已知基线问题（与本次改动无关）

`test/server-v2.test.mjs` 与 `test/business-flows.test.mjs` 在当前 HEAD 和未改动的
baseline worktree 上都以同一错误失败：

```text
TypeError: AI-work source environment must be a plain object.
  at createAiWorkService (server/ai-works.mjs)
```

发生在 `createApp` 创建 AI-work 服务时（`process.env` 原型不是普通对象），早于本次
runtime 接线。报告中不得把它算作本次改动通过或失败。

### 仍未通过的门槛

- **PR #112 原生 Session 主链**：历史 `OMP_SESSION_FAILED` / 文件锁 `EPERM` 必须在
  目标 Linux 主机重跑；本次没有模拟、替换锁或伪造 Session。
- **企业数据目录身份绑定/旧数据认领**（PR #112 的 `workspace-store-identity`、
  `bind-enterprise-store`）未吸收，独立企业部署仍不能宣称完成。
- 真实模型、真实企业资料、来源解析、跨进程恢复、部署验收均未执行。

## 5. 下一步

1. 在目标 Linux 环境完成 PR #112 原生链路：上传 → 记忆写入 → Brain 读取 → 续聊 →
   重启恢复 → 同企业另一员工接续 → 跨企业拒绝 → 撤权后延迟读取拒绝。
2. 吸收/重做企业 Store 身份绑定与旧数据显式认领，保持唯一账本。
3. 将真实产品库/资料库/询盘/报价/样品/订单来源接入 `recallForTask` 的 fact 投影，
   不复制业务数据。
4. 再推进 Brain/Signal/Goal/Outcome 闭环；本次未改。
