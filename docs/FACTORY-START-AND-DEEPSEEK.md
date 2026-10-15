# 最小启动与既有 DeepSeek 配置

本说明对应 PR #80 的原 Host 接线。命令只选择原有能力，不创建账号、密钥、权限或部署；本轮不调用付费模型。用户已批准的累计 CNY5 测试授权继续有效，不需要再次批准同一笔预算。

## 最小启动

在完整仓库根目录、现有依赖和固定运行器已经就绪、现有安全配置已绑定的情况下：

```sh
npm run build
WORKSPACE_OMP_PROFILE=factory-ingestion npm run workspace -- --check
WORKSPACE_OMP_PROFILE=factory-ingestion npm run workspace -- --serve
```

`--check` 不调用模型；先看 `modelKeyPresent`、`costReviewed`、`remainingBudgetReviewed` 及原 backend 绑定状态。它们并不证明密钥有效、金额充足或资料已授权。`--serve` 启动原服务；浏览器访问该服务配置的原地址，本地默认 `http://127.0.0.1:8787`。`npm run build` 仅生成网页，若只用已构建的原界面或 API 可省略。要使用计划能力，将上述 profile 改为 `market-validation`；保存计划不会启动七天监测。

首次取得完整源码、尚未装依赖时，先按锁定版本准备（现有安装无需重做）：

```sh
npm ci --ignore-scripts --no-audit --no-fund
node scripts/setup-omp-runtime.mjs
node scripts/workspace-omp-install.mjs
```

当前审计固定环境为 Linux/x64、Node 24.19.0、OMP 18.10.4、Bun 1.3.14；其他平台需要对应的既有运行器审计。这些安装命令下载依赖，不调用付费模型。附件为审查增量包，须应用到其标明的完整仓库基准，不能当作一个包含全部依赖的独立运行包。

## 真实 DeepSeek 验收所需的原配置

下面列的是 `server/pi-provider-config.mjs`、`server/workspace-omp-host.mjs` 实际读取的变量，不是新建的配置系统。当前执行环境未注入这些既有绑定；这不代表用户从未提供 API。

| 名称 | 要求与含义 |
| --- | --- |
| `PI_PROVIDER` | 明确选择 `deepseek`；未设置时原代码默认其他 provider，不能据此代替用户批准的 DeepSeek。 |
| `PI_MODEL` | 原 Host 中已经批准的明确模型。此锁定代码的允许值为 `deepseek-flash`、`deepseek-v4-pro`；这是代码白名单，不是当前云端可用性或价格声明。不得任意换模型。 |
| `DEEPSEEK_API_KEY` | 将用户原有、已授权的 DeepSeek 密钥通过现有安全设置绑定给服务进程；不在聊天、Git、命令参数或验收输出中提供值。 |
| `WORKSPACE_OMP_PROVIDER_COST_JSON` | 原 Host 核对后的实际模型价格 JSON，必须同时含数值 `input`、`output`、`cacheRead`、`cacheWrite`；当前 SDK 配置单位为 USD/百万 token。此处不填写猜测价格或用零伪装免费。 |
| `WORKSPACE_OMP_LIVE_BUDGET_VERIFIED` | 仅在原累计 CNY5 已消费、剩余额度及所需货币换算已核实后，由原 Host 配置为 `1`。这个布尔值本身不是账单、余额或硬限额证明。 |
| `WS_AGENT_TOKEN` | 既有原 Workspace 成员/实例绑定的 Agent 凭据，供 Host 验证同一成员和实例；它不赋予 Library 披露或写权限。复用原有绑定，不创建新 token。 |
| `WS_AGENT_URL` | 原服务的 HTTP(S) origin；可省略并使用原本地默认地址。连接已有服务时填写其原地址，不在 URL 中放凭据或 query。 |
| `PI_BASE_URL` | 可省略。DeepSeek 原目标固定为 `https://api.deepseek.com`；此锁定代码拒绝其他目的地。 |
| `WORKSPACE_OMP_PROFILE` | 选择 `factory-ingestion` 或 `market-validation`。它只选择能力，不授予文件/字段权限。 |

私有建档还依赖**现有**企业 Session/受审身份入口，以及原 `createApp({ libraryModelReadPolicy })` 内的精确上传、字段、版本、接收方和期限选择。它不是可以由模型传入的环境变量或 JSON 授权文件；仅设置 provider 变量或 Agent token 不足以启用私库。应由原 Host 维护者复用已经审核的配置入口，不能通过本说明增加权限。

## 安全绑定方式与金额证据

由原服务维护者在**现有**托管环境的 secrets/environment 设置或现有受保护的服务环境文件中绑定上述原值，并保持原访问控制。服务进程只读取得它们。不要把密钥贴入聊天，不把含真实值的环境文件/截图打包或提交，不在 shell 参数里写密钥，不创建、轮换或扩大凭据。这里没有要求重新申请同一预算，也没有执行任何凭据修改。

若原服务已使用仓库根目录的受保护 `.env`，`npm run workspace` 会按原 Node 启动方式读取它；应继续用原有权限与 secret 管理流程维护，而不是让模型生成一个带密钥的新文件。本审查包不包含该文件。检查输出只使用存在性和状态，禁止 `printenv`、回显 JSON 全配置或密钥值。

还缺原账户/调用账本中可核实的累计已消费金额、截止时间和 CNY 剩余额度；价格为 USD 时还须有原换算口径。应只提供脱敏金额证据或其安全位置，不提供密钥。当前这一路新增 DeepSeek 请求为 0、费用为 CNY0；原累计已消费和剩余额度未知，不能推算为还剩 CNY5。

`WORKSPACE_ACCEPTANCE_*` 是其他既有验收 runner 的单独声明；把它们设成“已批准/总额5”不会使本 Host 获得密钥、余额证据或 Library 权限，不应把这些标志当作解决办法。

本轮只交付启动与配置说明。既有绑定和金额证据可核实后，原授权允许在同一总预算内做最小真实模型建档测试，输入应明确标注为合成、非敏感材料；那也只能证明真实模型处理合成输入，不能冒充真实企业资料验收。

## 监测开始与验证完成

有效原获客批准/执行回执和原人审控制是观测的边界。baseline 可省略；省略时保持 `unavailable`/null，允许授权观测开始，但不能虚构投放前为零或计算提升。传入无效 baseline 仍拒绝。七天 `window_ended` 只表示时间结束：必要指标缺失时是 `insufficient_evidence`，实测齐全也仅是 `observed_not_adjudicated`，始终 `goalVerified:false`。`provisional:false` 仅表示必要指标没有缺口，不表示市场或目标已验证。
