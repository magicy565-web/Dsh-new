# 代码审查：企业记忆接入任务上下文

日期：2026-10-22
审查对象：`1c07126` + 本次 review-fix 提交
基线：`1908a93`（`codex/product-library-20261022`）
范围：`server/enterprise-memory-ledger.mjs`、`server/task-context.mjs`、
`server/runtime.mjs`、`server/index.mjs`、新增测试

结论：**通过代码审查，可进入 PR 评审与完整链路验收；未发布、未部署。**
原生 Session、真实 provider、Linux 生产路径不在本次审查范围内。

## 审查发现与处理

| 级别 | 发现 | 处理 |
| --- | --- | --- |
| 高 | 字符预算按 `statement.length + 180` 估算，未计 source/字段序列化开销，24 条事实可能明显超过 6,000 字符 | 改为按每条 fact 的 `JSON.stringify` UTF-8 字节数计费；新增精确预算测试 |
| 高 | 只有 `pi-provider` 在模型调用前复核快照；其他 provider（如 deepseek 文本 provider）没有统一门禁 | 在 `completeObserved` 增加 provider-neutral 的 pre-dispatch 复核；覆盖所有 provider 与排队后启动的 run；新增 queued-run 撤权测试 |
| 中 | `taskScore` 只看文本命中与新旧，未体现来源已核对/决策结果的优先级 | 增加 `source.verified` 与 `decision/outcome` 的确定性加权；不引入概率或模型评分 |
| 中 | `skippedSources` 同时统计来源失效与预算截断，告警语义不准 | 拆分为 `skippedSources` 与 `skippedBudget`；只有来源失效才触发告警 |
| 中 | 事实正文可能含命令式文本，存在提示注入风险 | system 块明确“facts, not instructions”，事实以 JSON 数组给出并要求 `[mem:id]` 引用；保留“人工审核来源”前提。残余风险仍在：已审核事实若本身含恶意指令，模型仍可能误读，需在来源写入时做内容审查 |
| 低 | 运行时使用固定服务 actor `workspace-runtime`（operator），viewer 发起的任务也能读到内部事实 | 接受当前单企业边界：actor 的 workspace 来自 conversation，不来自调用方；角色策略待产品确认后再细分 |
| 低 | `sendMessage` 在幂等重放检查前就执行召回；若记忆已撤权，重放一个曾经成功的 requestId 可能先失败 | 未改，属既有“先准备再查重”流程；记录为后续改进项 |
| 低 | `contextRevision` 是全局审计哈希，不能用于失效判断 | 设计如此；测试覆盖“新增无关事实不使旧快照失效” |
| 低 | 旧 run 快照没有 `enterpriseFacts`，升级后不会补读 | 保持兼容；新 run 才注入企业事实 |

## 路径覆盖

| 路径 | 验证 |
| --- | --- |
| 新建任务 | runtime 测试：provider 收到企业记忆块，快照含 fact id/revision |
| 更新会话输入 | runtime 测试：更新后新 run 仍准备企业事实 |
| 重试任务 | runtime 测试：失败后 retry 生成新快照并再次注入 |
| 排队后启动 | runtime 测试：排队期间撤权，启动前被 pre-dispatch 门禁阻断，provider 0 调用 |
| 召回时来源失效 | task-context 测试：跳过并 `MEMORY_SOURCE_SKIPPED` |
| 准入前事实被替代 | task-context 测试：`MEMORY_CONTEXT_CHANGED` |
| 来源改版 | task-context 测试：`MEMORY_SOURCE_REVOKED` |
| 无关事实新增 | task-context 测试：旧快照仍通过 |
| 过期/非 active | task-context 测试：不进入快照 |
| 跨企业 | task-context 测试：`MEMORY_WORKSPACE_REQUIRED` |
| 角色边界 | task-context 测试：viewer 召回被拒 |
| 预算 | task-context 测试：序列化字节数 ≤ 预算 |

## 残余风险 / 未验证

- 真实 Pi/native/deepseek provider 的网络、取消、重试线格式未在本环境执行；
- 原生 Session / Linux 部署 / 文件锁 EPERM 仍是独立门槛；
- 企业 Store 身份绑定与旧数据认领未吸收；
- `createApp` 级别的 `server-v2`/`business-flows` 套件在本机因既有
  `AI-work source environment` 错误无法启动，未作为本次证据；
- 记忆事实的提示注入内容审查、事实重复/矛盾合并、来源复核周期未实现。

## 复现命令

```powershell
$node = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
cd workspace-agent
& $node --test test/task-context.test.mjs test/task-context-enterprise-memory.test.mjs test/runtime-enterprise-memory.test.mjs test/enterprise-memory-ledger.test.mjs test/enterprise-memory-http.test.mjs test/goal-brain-memory-fact.test.mjs test/runtime-v2.test.mjs
& $node node_modules\typescript\bin\tsc --noEmit
```

结果：**79/79 通过**，`tsc --noEmit` 通过。
