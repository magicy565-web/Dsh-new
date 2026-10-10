# Workspace Agent 0.5.0-rc.2 · 上线候选版

一个面向单企业的云端 AI 专家团队 Workspace：先选择、配置专家岗位，编组团长与成员，再按预算和权限委托已审核的外部云 Worker。保留原有会话及增长服务作为次要协作和业务执行入口。
本项目不是 Muse 官方产品，不宣称未公开功能完全等价。

当前是可检查的候选版本，尚未达到正式上线门槛。已推进网页功能闭环、
访问与会话保护、恢复/审计运维，以及真实 Harness 的中转适配；真实模型、
实际托管环境、浏览器视觉验收和完整独立安全复核仍分别设门槛。

## ChatGPT dot「xy」外部 Worker（仅受审核插件方式）

已经加入受控的 Dot Pull Bridge：企业先批准公开研究任务，WorkerDesk 持久排队，个人 dot 通过专用 Workspace 插件领取任务、租约续期、上传真实文件与工具回执，最后由企业管理员验收。首页会显示 dot「xy」的登记/握手和排队状态，不会把尚未接单显示为执行中。

**Workspace — xy 插件已安装**，但目前身份与收件箱工具调用仍返回内部错误，不能宣称 dot 已在线执行。PR #12 代码审查确认：项目原先自定义 Bearer 校验不能作为 ChatGPT MCP 的 OAuth 2.1 用户认证；接通真正合规的 IdP、授权和部署前，不能靠重新安装插件解决。详情见 [真实连接与 OAuth 阻塞](docs/DOT-MCP-CONNECTION.md)。没有真实可审核的凭据、供应商可强制的预算限制与 TLS 部署时必须保持默认关闭。

**现已补上真正的 MCP Streamable HTTP 服务端 `/mcp`**，兼容 2026-07-28 及 2025-11-25 任务调用；此前 `/api/dot-worker/v1` 是 REST 接口，不能直接充当 ChatGPT 插件服务器。新 MCP Endpoint 不会远程唤醒个人 dot，必须由 dot 的插件主动连接并领取任务。

详见 [真正的 Dot MCP 连接指南](docs/DOT-MCP-CONNECTION.md)、[Dot 实际接入与验收说明](docs/DOT-XY-INTEGRATION.md)、[原始插件 11 项动作 OpenAPI](docs/dot-worker-openapi.json)。

## Muse Personal Agent 接入（源码待验收）

当前开发分支新增独立 `/api/muse-worker/v1` REST 网关，供个人 Muse 的 **Custom API Connector** 主动领取公开任务、续租、上传真实文件与提交审核结果。通过独立凭据、`museTasks` 队列和 Worker 身份检查与 ChatGPT Dot 隔离；不重建 DAG/WorkerDesk。

**这不是远程唤醒个人 Muse 的 API。** Muse 侧当前仅有本地 Skill/CLI scaffold，尚无已核验的 HTTPS 主机、已完成的 Vault 注册、真实 Muse 任务或第三方可强制消费上限。默认 `WORKSPACE_MUSE_ENABLED=0`；禁用时可用独立授权凭据检查只读身份和空收件箱，不能领取或完成付费任务。工具回执无法取得时支持明确的 `evidenceNote`，绝不伪造回执或认定来源已独立核验。

接口、所有 11 项路径、费用/权限上线门槛及联调步骤：[Muse Personal Worker REST 技术说明](docs/MUSE-PERSONAL-WORKER-REST.md)。

## 云端专家中心（主入口）

当前专家市场包含 8 种独立 SVG 岗位图标（不使用字母头像或远程占位图），每位专家从统一后端目录返回完整作业规范：企业必需资料、研究方法、可编辑交付物、验收条件以及数据边界。配置界面读取当前 Workspace 已登记的 Skill 与 Connector 状态，并能打开现有权限管理页。参考 [真实图标总览](docs/expert-icons-sheet.svg) 和 [云端专家团队说明](docs/CLOUD-WORKER-EXPERT-TEAMS.md)。

专家委托携带经审核的岗位作业步骤和交付要求，而非空泛的角色提示。配置完成且有经过审核云执行器的专家团，还可以在受控总预算内生成真实的多张待审批 Worker 任务单。任务不会自动派发、收费或对外联系；原生 Harness 并行 DAG 仍需单独接通和验收。

### 功能入口与运维边界

默认首页 `/workers` 提供 8 个专家岗位、3 套专家团配置模板，支持选择与配置岗位、只读技能范围、审核过的云执行器绑定、项目预算、团队成员和分工计划。`/services` 保留原来的增长服务任务单和企业商机池。配置专家不等于外部执行，团队 DAG 仍是下一阶段；已绑定专家可以创建待单独审批的真实 Worker 任务单。详见 [云端专家团队技术说明](docs/CLOUD-WORKER-EXPERT-TEAMS.md)。

## AI Worker 服务中心

业务执行入口 `/services` 提供标准增长服务、预算任务单、插件可用性、进度和成果验收；人工验收的经销商名单可逐项转入企业商机池并进行人工资格判断。服务 API 使用单企业持久数据；未登记且核验第三方适配器时仅能保存待执行草稿，**不会真正委托，也不会生成模拟业绩**。涉及历史询盘等企业私有资料的服务尚不开放跨企业传送。参考 [AI Worker V1 开发说明](docs/AI-WORKER-V1.md)、[外部 A2A Worker 接入](docs/AI-WORKER-A2A-INTEGRATION.md) 和 [业务商机池](docs/AI-WORKER-OPPORTUNITY-PIPELINE.md)。

这是开发候选功能，不代表生产集成、真实合作伙伴或收费执行已上线。

## 从 GitHub 源码运行

本仓库是源码项目，未包含构建产物。首次运行需要 Node.js 24+：

```sh
npm ci
npm run build
npm start
```

打开 http://127.0.0.1:8787。完整本地/企业部署步骤见
[GitHub 部署指南](docs/GITHUB-DEPLOYMENT.md)。下面提到的 App ZIP 是单独交付的构建包，
不同于 GitHub 的源码 ZIP。

## 继续开发交接

请先阅读 [Work 开发交接](00_READ_FIRST_WORK_HANDOFF.md) 与
[业务闭环审计](docs/BUSINESS-FLOW-AUDIT.md)。最新开发补齐了实际会话执行链：
选择确切文件版本、技能修订和记忆，查看可见计划，审批精确连接器动作，
在同一运行中带执行收据继续，并保存真正的文件产物。
内置本地资料库适配器可执行实际文本文件读写，仍须显式配置与审批。
本地脚本模型测试不代表真实模型、浏览器或生产上线验收。

## 本版新增

- 网页管理：技能、连接器、精确审批、定时草稿、运行记录、文件版本与下载、
  记忆启停/作用域；包含取消、重复点击、错误恢复和导航中断处理
- 企业访问：管理员/操作员/只读角色、短期签名入口、浏览器会话、CSRF、
  过期/撤销、重启失效和有据可查的操作审计
- 运维：停止服务后的校验备份/安全恢复、审计分段归档、生产模式拒绝本地
  无登录访问、部署与事故处理说明
- FastAIToken：明确选择的 gpt-6-sol；独立文本接口和真正原生 Harness 接入
  分开验证，不把文本接口当成原生工具
- 运行诊断：只读配置、夹具证据、模型观察与调度/存储/连接器状态；明确断线、
  过期快照、重连和重启，不会因刷新产生模型费用或执行外部动作
- 可复现交付：锁定依赖、源码/构建哈希、干净解压启动检查与上线证据检查

审批、定时和连接器仍默认关闭；配置存在不代表在线验证通过。
没有启动真实定时任务、进行收费模型调用、使用历史聊天中的 Key 或公开部署。

## 本地启动

需要 Node.js 24 或更新版本。主应用 ZIP 已含前端构建和纯 Node 后端，
本地启动不需要 npm install。

```sh
node --env-file-if-exists=.env server/index.mjs
```

打开 http://127.0.0.1:8787 。也可以使用 start.sh、START.command 或 START.bat。
不要直接打开 dist/index.html；不要把默认本地模式反向代理到公网。

复制 .env.example 到最终主机的私有配置位置，按实际需要配置。
默认 CLI 选择 FastAIToken；缺少新授权 Key 或明确模型配置时保持 setup_required，
不会使用别的模型/供应商兜底。凭据只通过最终主机的安全设置录入，
不放入聊天、前端、代码、命令参数或交付包。

## 供应商与原生执行

- FastAIToken 文本接口：固定官方文档地址，非流式 Chat Completions；
  不执行浏览器、终端、原生工具或远程连接器
- 原生 Harness：真正官方 SDK 与真实 native runtime；支持经审核的
  workspace-fastaitoken profile、明确协议/地址/模型、凭据变量引用，
  可选持久 bridge 用于原生会话恢复。见 [NATIVE-HARNESS.md](NATIVE-HARNESS.md)
- DeepSeek 官方文本接口仍作为独立可选模式，需单独明确配置

原生中转测试已经使用真实 Harness/SDK/llm-pi-ai/JSONL，但模型网络是明确
拦截的本地夹具。它不能证明实际中转账户支持 gpt-6-sol 的流式、工具、
结构化输出或成本限制。不同协议的验证深度见原生文档。

真实测试需要单独明确的累计费用授权，覆盖所有重试和原生内部调用。
真实调用还需要安全配置的新 Key、核验后的模型价格与可执行的账户侧硬额度。
外层 Token 预留不是账单保证。检查工具见
[docs/PROVIDER-ACCEPTANCE.md](docs/PROVIDER-ACCEPTANCE.md)。

## 企业部署

仅支持一个企业共享空间、一个后端写进程。成员共享空间内的数据，不提供
多租户或各成员私密聊天隔离。生产模式必须使用经过审核的 TLS/员工登录入口，
由入口签发请求绑定的短期身份断言；普通反向代理或 X-User 头不够。

[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) 说明准确边界、角色、会话、签名协议、
服务模板及目标环境验收。填写环境变量不会自动创建登录入口或托管服务。

当前云开发电脑没有经过验证的长期生产托管保证；Sites/Workers 也不能原样
运行此项目需要的原生子进程和持久磁盘。正式发布仍需支持这些能力的授权主机。

## 数据、备份和恢复

数据默认在 .data/。单写锁、私有文件、原子落盘和文件哈希保护已有数据；
恢复不会自动重发付费请求。普通离线工具支持 workspace v2、文件产物和当前
安全审计；原生模式另支持文档定义的 JSONL/附件/溢出文件/工作目录完整校验。
恢复中断待执行记录、停用定时/技能/连接器、撤销未消费审批，并收紧原生权限。

完整原生工具部署还需要按经过审核的 profile 确认原生 sessions、附件、
插件存储和工具工作目录的备份范围。遇到未知原生文件树时工具明确拒绝，
不悄悄输出不完整备份。见 [docs/RECOVERY.md](docs/RECOVERY.md) 和
[原生恢复流程](docs/NATIVE-RECOVERY.md)。

## 开发和验证

```sh
npm ci
npm run test:offline-evidence
npm run test:recovery
node scripts/check-launch-gates.mjs
```

最后一条是证据门槛检查；必要证据缺失时非零退出是正确结果。
只读诊断与证据等级见 [docs/OPERATIONS-DIAGNOSTICS.md](docs/OPERATIONS-DIAGNOSTICS.md)。
当前结果与限制见 [VALIDATION.md](VALIDATION.md)；全部接口见
[server/API.md](server/API.md)；版本计划见 [docs/RELEASE-PLAN.md](docs/RELEASE-PLAN.md)。

单独交付的主 ZIP 小于 8 MB；本 GitHub 仓库不包含发行 ZIP。可选完整原生源码沿用已有五个分卷，重组说明见
[docs/NATIVE-SOURCE-PARTS.md](docs/NATIVE-SOURCE-PARTS.md)；不会把本地数据或凭据
混入发行包。旧版发布包保留。

### Native recovery and upgrades

The release includes native JSONL/checkpoint backup and no-replay restore for the
reviewed local storage layout, plus crash-safe app-store migrations and startup
diagnostics. See [native recovery](docs/NATIVE-RECOVERY.md),
[store migration](docs/STORE-MIGRATION.md), and [validation](VALIDATION.md).
Actual production profile, provider, browser and deployment acceptance remain
separate launch gates. A generated overlay or passing fixture is not live acceptance.
