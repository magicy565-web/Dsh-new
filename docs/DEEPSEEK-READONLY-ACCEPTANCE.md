# DeepSeek → 原业务只读工具 → 来源回答

基线：PR80 分支 `codex/integrate-factory-capabilities-20261015` 的 `6d1d1175f60802960b411ff751c6dad003d8570f`。本轮独立分支为 `codex/deepseek-readonly-acceptance-20261015`。不修改公共 Host、market-validation、Shopify、main 或部署，不恢复旧 C/D writer。

## 已接线的最小路径

新入口 `scripts/acceptance-deepseek-readonly.mjs` 复用 `createWorkspaceAgentModel`、`createWorkspaceAgentRuntime`、官方 Pi 1.1.0 `AgentSession` 和原 `createWorkspaceClient`。官方 SDK 负责模型传输、工具调用与会话，不增加 AgentLoop。原 Pi/OMP provider 和 Host 继续沿用；本轮没有把 OMP 替换为 Pi，验收明确选择已有 Pi 路径，未改 OMP Session 或公共 Host。

模型只启用原工具 `workspace_business_tasks`，自然语言请求让模型读取最近一项成员任务，再引用返回的 `sources.recordId` 和 `sources.api`。HTTP 边界只允许原 origin 的 GET health、presets、tasks，禁止提交、取消、恢复、批准、私库、其他路径和跳转。任务内容始终是不可信资料。现有服务和访问凭据不可获得额外权限；没有原记录时预检停止，不为验收创建任务。

验收通过表示：官方模型返回、原只读工具成功执行、最终回答引用至少一个实际返回的任务 ID 和 API 路径。它不证明全部事实语义正确、任务商业目标达成、企业私库授权或 OMP 真实模型验收；语义仍需人审。输出经过既有凭据脱敏和明显凭据格式检查的最终回答、所引任务 ID/API、计数、回答哈希与状态，供原成员审阅；不输出原始来源正文、会话文件和错误原文。不要公开分享真实业务验收输出。私有临时 SDK 会话在退出时清理。

## 安全配置的具体步骤

1. 原服务维护者在**已有** secrets/environment 管理入口，将原有获批 `DEEPSEEK_API_KEY` 和原成员 `WS_AGENT_TOKEN` 注入原服务及验收进程。复用已有身份；不要新建/轮换凭据，不把 Key 写进聊天、命令参数、Git、日志或本说明。此执行环境当前没有绑定，模型未读取或复制聊天中的 Key。
2. 在同一安全设置中明确 `PI_PROVIDER=deepseek`、`PI_MODEL` 为原来批准的模型、`WS_AGENT_URL` 为原服务 origin。当前锁定代码白名单是 `deepseek-flash` / `deepseek-v4-pro`；这是代码允许值，不声明实时可用性/价格。`PI_BASE_URL` 可省略，目标固定 `https://api.deepseek.com`。不要因此切换账号、模型或权限。原服务还须已满足其自身启动与访问检查，验收不代为启动或部署。
3. 维护者从原账户/调用账本核对**本次授权范围内全部历史支出**。原累计授权 CNY5 继续有效；未知历史支出不能视为 CNY0。核对 CNY 价格上界、有效期和现有外部硬限额，包含 USD/CNY 换算时使用有来源的保守上界。现有 OMP 的 `WORKSPACE_OMP_PROVIDER_COST_JSON` / `WORKSPACE_OMP_LIVE_BUDGET_VERIFIED` 继续按原 Host 维护；单独设置布尔不能替代对账证据。
4. 将不含凭据的对账声明通过已有受保护文件流程放在仓库外的明确绝对路径，给验收进程设置 `WORKSPACE_DEEPSEEK_BUDGET_EVIDENCE` 指向它。不得指向 `.env`、auth.json、SDK profile 或聊天记录。文件同目录须允许生成单次预留记录。不要提供原始账单中的账号身份或密钥。字段约束见下表；不提供可被误当成实际余额的示例。
5. 运行 `node scripts/acceptance-deepseek-readonly.mjs --check`。该命令不请求网络、模型或账户，不读取任何凭据文件；只检查明确环境绑定，并读取明确选择的非秘密对账声明。配置/对账缺失返回 `waiting`、退出码 2、`modelRequests:0`。`configured_unverified` 表示结构检查通过，不能当作联网成功或独立账单认证。
6. 只有上述安全绑定、账单和剩余预算可核实，才可在同一原授权范围执行 `node scripts/acceptance-deepseek-readonly.mjs --execute-paid-requests`。它先读原 health/presets/tasks，确认存在可引用记录，再做单次预算预留并调用既有 Pi 模型。没有隐式样例或模型回退。当前未满足，本轮未执行此真实付费步骤。

| 对账声明字段 | 必须满足 |
| --- | --- |
| `schema` | `workspace.deepseek-readonly-budget.v1` |
| `provider` / `model` | `workspace-deepseek` / 与获批 `PI_MODEL` 精确一致 |
| `receiptId` | 维护者对账记录的唯一安全标识；不可复用旧声明 |
| `billingEvidenceRef` / `priceEvidenceRef` / `hardCapEvidenceRef` | 维护者实际核查证据的脱敏标识；不是 URL、Key 或声明自身的循环引用 |
| `hardCapVerified` | 现有外部上限实际核查后为 true；本工具不创建或修改账户限额 |
| `currency` / `approvedCapCny` | `CNY` / 原累计上限 5 |
| `spentCny` / `remainingCny` | 已核实的累计支出和剩余金额，总和精确为 5；余额必须为正 |
| `inputUpperCnyPerMillion` / `outputUpperCnyPerMillion` | 非零、有限的 CNY/百万 token 保守上界；输入必须覆盖普通/缓存读写最贵情况及换算风险 |
| `verifiedAt` / `expiresAt` | 核对时间距运行不超过 15 分钟，未过期，有效期不超过核对后 1 小时 |

上述声明是维护者的对账证明入口，程序只验证其结构和一致性，**不能独立验证账户余额、价格或硬限额真实性**。不清楚任一项时保持等待，不伪造字段以解锁。不要求重新批准原 CNY5 授权。

## 请求和费用边界

最多 3 次模型请求，每次输出最多 1600 tokens、无自动重试，非思考模式，官方 HTTPS 接收方固定。模型入站守卫复核 receiver、128000 context 元数据和 120000 UTF-8 字节的上下文保守界限，超限即拒绝。按每次最多整个 128000 context 输入和 1600 输出预留：`ceil(3 × (128000 × inputUpper + 1600 × outputUpper)) / 1000000 CNY`。这是保守预留上界，不是实际账单；当前代码白名单及上下文定义须与所选模型和核实的价格范围一致。

首次执行在对账文件旁以独占创建方式写入 `.reservation`，并发/重复执行同一路径不能再次调用；成功、失败、超时均不自动退还预留。未知结果保留全额预留。**不要删除或另存旧证据绕过预留**。下一次必须由维护者核对账户实际支出及所有并发预留，出具新的对账声明；其他工作线的支出也要计入原 CNY5，不能给各线分别视为 CNY5。外部现有硬限额和统一对账是累计费用权威，本脚本的本地标志不能代替它。

## 证据类别与离线复现

```sh
node --test --test-concurrency=2 test/deepseek-acceptance-policy.test.mjs test/deepseek-readonly-wire.test.mjs test/pi-provider-config.test.mjs test/pi-workspace-agent.test.mjs test/pi-workspace-agent-startup.test.mjs test/pi-library-read.test.mjs
npm run build
node scripts/acceptance-deepseek-readonly.mjs --check
```

- **真实 SDK**：锁定官方 Pi 1.1.0 的 ModelRuntime、OpenAI wire 编解码、AgentSession、工具分派；原 Workspace HTTP、Store 和成员约束实际运行。
- **替身**：离线测试 DeepSeek SSE、token usage、业务建档阶段模型和测试任务文本均为明确合成；不会连接真实模型或把测试 token 计为账单。HTTP 仍读取实际原 Store 的隔离测试记录。OMP 的此前验证不计入本轮实际 SDK 运行。
- **真实模型**：仅安全配置和真实账单条件满足后，执行入口可以触发的实际 DeepSeek 调用。本轮为 0；缺 Key、原成员绑定和累计余额证据，不能宣称完成真实模型验收。
