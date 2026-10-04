# 原生 DeepSeek Harness 与 Worker 接入

## 已实现的边界

`deepseek-api` 是有界文本工作流。`harness` 使用仓库中真正打包的官方 `DeepSeekHarness` SDK，经受支持的 `dsh --profile <DSH_PROFILE>` 启动原生运行时（默认 `sdk`）。SDK 模块没有被替换为模拟实现。

- 同一服务进程内保留一个 SDK 拥有的原生进程，用原生 Session ID 继续会话；续聊只发送当前上下文和最新用户输入，不把整段历史再次当成用户指令
- 每个运行串行执行，事件只来自该 Session 及其真实子 Session；应用只接收事件类型和受限关联 ID，不接收工具参数、结果正文或隐藏推理
- 取消或超时关闭并等待拥有的运行时退出。关停未确认时拒绝新进程；服务退出时必须调用 `provider.close()`
- 可显式启用 Workspace 原生桥接，用 Harness 自身的 JSONL Session 和 `ctx.agents.resume()` 跨进程恢复，不另造一份原生历史
- 原生 Goal、context、MCP、工具、子代理和 profile 内的 Muse Worker 仍由原生 Harness 服务拥有。Workspace 本地 Goal/审批/连接器记录不是原生 Goal 或原生权限的替身

原生运行和远程 Worker 尚未使用真实凭据做端到端验证。“已配置”表示本地配置齐备，不证明凭据、网络或模型可用。

## 来源与实际检查

GitHub 源码版本仅包含 MIT SDK 客户端及安全的来源摘要。下文中的完整源码归档、分卷和逐文件清单属于单独交付的输入，不包含在本仓库内。

轻量 App 包包含官方 SDK 和完整源索引；完整原生源码通过随附五个 ZIP 分卷交付，按 [分卷说明](docs/NATIVE-SOURCE-PARTS.md) 重组为 backend/deepseek-harness-source.tar.gz。完整本地发行归档也可直接包含这个 tar.gz。

完整参考工作树为 `bccf02f2636f7213be321d487aa763eb51396584`，版本 `0.2.0-rc.2`。检查包括当前工作树中的未提交 multi-worker、queue-consumer 和兼容修复，未退回旧 HEAD。完整源归档 `backend/deepseek-harness-source.tar.gz` 和逐文件清单 `backend/SOURCE-MANIFEST.json` 已包含在后端交付包中；归档保留上述工作树，不是 HEAD-only 重建，且不包含依赖、构建产物或凭据。摘要见 `backend/SOURCE-INFO.json`。SDK 许可证见 `vendor/harness-sdk/LICENSE`。

实际源码接口：

- `packages/sdk/client/src/api.ts`：公开 `run(input, { sessionId, onNotification })`
- `packages/sdk/client/src/client.ts`：公开 `client.request()` 和拥有进程的关闭逻辑
- `packages/sdk/protocol/src/types.ts`：上游只有 `initialize`、`session/prompt`、`shutdown`
- `packages/sdk/server/src/server.ts`：未知 Session 用 `agents.create()`，没有磁盘 resume RPC
- `packages/core/agent/src/index.ts`：公开 `agents.create()`、`agents.resume()` 和拥有型 `AgentHandle.dispose()`
- `packages/session/session-persistence/src/index.ts`：公开 `stat()`；原生 JSONL 后端拒绝覆盖已有 Session
- `packages/experimental/muse-worker/src/`：真实 DAG、登记、预算、租约、gateway、取消和队列协议

因此，未启用桥接时，关闭/取消/重启后的已有 Session 会明确报 `NATIVE_RESUME_UNSUPPORTED`，不会悄悄创建空 Session 冒充恢复。

## 基本本机配置

先按完整 Harness 源码 README 构建，确保存在构建后的 `apps/cli/lib/bin.js`。不能给 `DSH_BIN` 填 shell 脚本、未构建的 `bin.ts` 或未经审核的同名包。

审核 profile 的工具、文件范围、联网、进程执行、MCP、原生交互策略和成本。目录分离不是操作系统沙箱。本项目不提供默认全权限补丁，也不会从网页修改 native profile 的授权。

```text
WORKSPACE_RUNTIME=harness
DEEPSEEK_API_KEY=仅在本机安全配置
DSH_BIN=/绝对路径/deepseek-harness/apps/cli/lib/bin.js
DSH_REVIEWED_PATCH=/绝对路径/已审核的-profile.patch.yml
DSH_MODEL=deepseek-v4-flash
```

只有用户实际启动请求时才创建原生进程。进程使用隔离的 `.data/harness` 和 `.data/agent-workspace`，只继承 PATH、HOME、LANG、DSH_HOME 和当前路由唯一允许的凭据变量；官方路由为 DEEPSEEK_API_KEY，中转路由为 FASTAITOKEN_API_KEY。不读取任意 DSH_API_KEY_ENV 指向的环境变量，不继承其他 token、NODE_OPTIONS 或整个 shell 环境。

`maxTokens` 属于 SDK 初始化的进程级设置。同一进程中必须保持一致；修改后需要重启并在原生桥接模式恢复。它不是每轮可随意修改的原生参数。

## FastAIToken 原生路由（显式审核后启用）

这条路径仍使用真正的 Harness SDK、AgentLoop、原生工具、Session 和 llm-pi-ai。`workspace-fastaitoken` 是独立原生 provider，不重定向 `deepseek-official`，也不替换为 Workspace 文本适配器。选定模型为 `gpt-6-sol`；本次只做无真实凭据的夹具验证，没有创建实际部署配置或调用中转。

官方材料（核对日期 2026-10-04）只用于确定协议和地址，不能证明当前账户、该模型、工具调用或流式输出可用：

- [快速开始](https://docs.fastaitoken.com/docs/getting-started)：Chat Completions 示例为 `https://www.fastaitoken.com/v1/chat/completions`，原生 `openai-completions` 的 base URL 固定为 `https://www.fastaitoken.com/v1`
- [Codex 指南](https://docs.fastaitoken.com/docs/使用场景/OpenAI%20Codex)：声明 Responses 支持，配置为 `https://fastaitoken.com/v1`；原生协议名为 `openai-responses`
- [Claude Code 指南](https://docs.fastaitoken.com/docs/使用场景/Claude%20Code)：声明 Messages 支持，base URL 为 `https://fastaitoken.com/`；原生协议名为 `anthropic-messages`。其中部分模型需要 ClaudeCode 令牌分组；这不是 gpt-6-sol 支持 Messages 的证据

当前严格允许以上三个“协议 + 精确 URL”配对，不自动跳转域名、切换协议、替换模型或回退供应商。后两种协议仅完成真实 native 注册/初始化夹具，未完成其响应线格式夹具，更未真实调用。Chat Completions 已用真实 llm-pi-ai 和原生 AgentLoop 的拦截 SSE 夹具验证文本、工具参数流、工具结果回传及 JSONL 重启恢复。任何夹具都不能取代指定账户的真实兼容性验收。

### 生成无密钥的原生注册补丁

先核实该账户中精确模型 ID、协议、上下文窗口、最大输出和价格。以下容量变量必须由审核者提供；不从模型名猜测容量，不把测试中的合成容量当作真实规格：

```sh
node scripts/generate-native-bridge.mjs --relay \
  openai-completions https://www.fastaitoken.com/v1 gpt-6-sol \
  "$REVIEWED_CONTEXT_WINDOW" "$REVIEWED_MAX_TOKENS" \
  /绝对路径/新的-workspace-relay.patch.yml
```

命令只创建新文件（0600，已有文件拒绝覆盖），不读凭据、启动进程、访问网络或调用模型。输出为 JSON 语法的合法 YAML，对已有 `llm-pi-ai` 配置项增加一个独立 provider。其内容只有协议、精确地址、`FASTAITOKEN_API_KEY` 环境引用、单个模型及明确容量，且 provider 重试数为 0；不包含密钥、headers、额外模型、任意 JS 或权限设置。部署 profile 必须保留 `llm-pi-ai` 配置项。注册补丁必须单独保存，不能把安全策略或其他配置混入这个文件。

审核后配置模板（本文不是已应用的配置）：

```text
WORKSPACE_RUNTIME=harness
DSH_PROVIDER=workspace-fastaitoken
DSH_PROFILE=sdk
DSH_MODEL=gpt-6-sol
DSH_PROTOCOL=openai-completions
DSH_BASE_URL=https://www.fastaitoken.com/v1
DSH_API_KEY_ENV=FASTAITOKEN_API_KEY
DSH_RELAY_PATCH=/绝对路径/已审核的-workspace-relay.patch.yml
DSH_BIN=/绝对路径/deepseek-harness/apps/cli/lib/bin.js
DSH_REVIEWED_PATCH=/绝对路径/已审核的权限-profile.patch.yml
```

凭据只能在获准的安全通道中配置到 FASTAITOKEN_API_KEY；不得复用已贴在聊天中的旧密钥。模板不包含密钥。对于中转，模型、协议、地址和凭据引用无默认值；缺失或不匹配即失败。SDK 初始化收到精确的 provider/model/profile；注册补丁列出的模型必须匹配，并限制每次请求的 maxTokens 不超过审核上限。原生输出若包含当前凭据原文会被拒绝，事件仅保留安全的类型字段。

### 花费和上线门槛

真实测试需单独批准累计预算，而不是只批准每个请求的限额。本仓库发布没有配置或使用模型密钥，也不授权付费调用。原生一次运行可能进行多次模型请求及工具往返；外层 maxTokens 和运行超时不是费用硬上限。开始前必须验证 gpt-6-sol 的实际计费及币种、账户/令牌的可执行累计硬额度，覆盖本轮全部请求、工具往返和任何重试；不能证明额度可执行时不进行真实测试。当前生成器禁用 provider 自动重试，没有协议/模型自动回退。

原生安装需完成同一审核版本的 CLI、SDK server、llm-pi-ai 及其依赖构建。部署者还必须审核原生工具、网络出站、交互失败关闭、子代理和 Worker 范围；防止 native settings、profile 间接引用和凭据存储覆盖被审核路由；保持配置只读或由部署流程管理。Workspace 文件指纹不能证明动态 settings、间接依赖或实际中转价格未改变。真实账户认证、指定模型流式/工具兼容性、累计费用硬上限、取消和完整原生恢复演练均是上线阻塞项。

## 可选：真正恢复持久化原生 Session

桥接是本应用显式部署的 Cordis 插件，不是宣称上游 SDK 本来就有的接口。

1. 构建同一安装中的原生 SDK server、protocol、LLM 和 CLI 包
2. 生成一个新的覆盖文件；此命令只检查公开模块导出并写文件，不启动 runtime、模型、网络或 Worker

```sh
node scripts/generate-native-bridge.mjs \
  /绝对路径/deepseek-harness/packages/sdk/server/package.json \
  /绝对路径/workspace-bridge.patch.yml
```

3. 审核生成内容。它只停用原来的 `sdk-jsonrpc-server` 展示层，加载 `server/native-bridge.mjs`，不添加工具权限；原有安全 profile 保留
4. 在本机设置：

```text
DSH_WORKSPACE_BRIDGE=1
DSH_WORKSPACE_BRIDGE_PATCH=/绝对路径/workspace-bridge.patch.yml
```

也可以将生成内容明确合入已审核的 `DSH_REVIEWED_PATCH`，此时不单独设置 bridge patch。

桥接使用公开 SDK 请求入口协商版本 1 的部署扩展 `workspace/session/open`，明确区分 `create` 和 `resume`。适配器校验返回的版本、ID 和恢复标记。桥接只接受本应用格式的 Session ID，恢复前检查原生持久化记录的工作目录和根 Session 身份；缺失、损坏、已被其他进程拥有或位于其他工作目录的记录均失败，不回退到新建。

真正打开和恢复调用原生 `agents.create/resume`，收到的消息用原生 `createUserMessage/followup` 写入原生 Inbox；模型上下文、日志、原生 Goal/MCP 仍由原生服务重建。启动 Workspace 本身不会恢复会话或调用模型，只有显式启动该请求才恢复。原生恢复可能继续该 Session 已持久化的待处理 Inbox/Goal，应按原生语义审核，不代表外部动作恰好执行一次。

桥接当前只接受文本输入。它没有任意 RPC、工具执行、Goal 修改、权限修改、审批回复或附件上传入口。SDK 不具备原生审批回复协议；`onApproval` 被明确拒绝，不会将网页审批按钮伪装成 native approval。需要审批的原生 profile 必须自行采用经审核、失败关闭的交互策略。

构建产物不足时生成器失败；没有隐式 source-loader、旧版本或替代可执行文件回退。在本次检查树中 CLI/SDK server 的最终 `lib` 发布入口尚未全部存在，部署前仍需完成原生构建。

## 权限配置指纹

`provider.permissionFingerprint` 是审核配置的 SHA-256，包括 runtime 模式、原生 provider、模型、protocol、endpoint、profile 名、凭据变量引用、工作目录、home、可执行文件身份与内容、明确的 profile/relay/bridge patch 内容、适配器实现和启用的桥接实现。它不返回路径、补丁正文或凭据。排队/计划运行可绑定此值；改变 runtime 或这些文件后，旧授权不能自动转为新权限运行。

每次执行前再次计算，变更时报 `NATIVE_POLICY_CHANGED` 并关闭旧进程。需要重启并重新审核待执行任务。补丁间接引用的其他文件、远程 MCP 的行为和完整 native 安装依赖仍需部署方独立固定和审核；这个指纹不是整个依赖树的供应链证明。

## 可选：复用原生 multi-worker 控制面

`server/worker-provider.mjs` 默认禁用，不创建网络监听器、外部执行器、凭据、cron、付款或部署。

显式服务端配置需要同一审核版本的 worker `package.json`、固定 public-only workflow catalog、独立私有 `statePath`、operator enrollment、租约/字节限制，以及部署方提供的 `verifyIdentity(request)`。它通过同一安装的公开 `multi-engine`、`multi-gateway` 导出复用真正的 `MultiWorkerEngine`，不复制或重写它的 DAG、预算或租约逻辑。

- `submit({ taskKey, jobId, idempotencyKey, deadlineAt })` 只从审核 catalog 取得 query/acceptance；拒绝模型或 HTTP 请求额外传入 prompt、凭据或权限
- `get(jobId)`、`result(jobId)`、`cancel(jobId)` 使用固定服务端 operator 身份；成功结果标明 `independentlyVerified: false`
- 原生 gateway 每次验证 worker 身份和所有权；本应用不发明“相信请求头中的 workerId”的鉴权方案
- 取消运行中的 Worker 只表示 `cancel_requested`，直到真实 Worker 确認停止；超时不能伪装为停止成功
- 原生状态具有单写者锁、预算预留和重放保护。不要为了启动新进程而删除仍存活 writer 的锁

`createNativeWorkerConnectorAdapter({ workerProvider })` 可注入现有连接器审批注册表，支持 `submit/status/result/cancel`。它使用调用方持久化运行 ID 作为提交幂等键，绑定审批中的 task/job resource，不将 connector credentials 或私有上下文转发给 Worker。

这个可选服务是独立本地控制面，不是 SDK profile 内 `ctx.museWorker` 的远程管理口。必须使用独立状态文件，不能与原生 profile 争用同一个 store。若要让原生 Goal 使用 Worker，请在审核后的原生 profile 中启用已有的 `worker_submit/status/result/cancel`；其原生等待/恢复逻辑已有源码实现。stock SDK 和当前 session 桥接均不公开该 profile 内的 gateway。真实个人 Muse 执行器、托管鉴权、外部网络部署和 read-only 隔离仍需要部署方另行配置和验证。

## 验证方式和范围

```sh
node --test test/harness-provider.test.mjs test/native-relay.test.mjs test/worker-provider.test.mjs
```

全部模型、身份、远程结果和问题文本均明确标为 fixture。

- 通过真正打包的官方 SDK 和本地 JSON-RPC 进程夹具，测试同 Session 续聊、输出归属、取消和关闭
- 通过实际 Harness 源码的 Context、AgentLoop、Session、JSONL 和 SDK server，配合无网络的脚本模型，测试磁盘重启后恢复原生历史；未调用真实模型
- 通过实际构建后的原生 worker 公开导出，测试本地状态重启、任务审批、身份拒绝、单次计费、租约、取消确认和不可信结果标记
- 用真实 llm-pi-ai + SDK server + AgentLoop 的无联网 SSE 夹具核对 gpt-6-sol 路由、分片工具参数、一次本地纯 fixture 工具调用及结果回传、JSONL 恢复，检查日志/通知/持久文件不含合成密钥；其他两个协议只做注册/初始化检查
- 测试错误/异步事件回调隔离、跨 Session/迟到事件拒绝、原生审批/未授权 RPC 拒绝、权限文件变化、失败关闭和安全错误输出

真实源码测试默认寻找相邻 `muse-development/deepseek-harness-enterprise`，也可设置 `DSH_TEST_SOURCE_ROOT`。源码/构建依赖缺失时对应 integration 测试会明确 skip；单元 fixture 通过不等于原生集成或真实部署通过。没有运行真实 DeepSeek 模型、MCP 外部服务、个人 Muse、Redis/Upstash、远程队列、支付或账号操作。

## 原生数据恢复的额外限制

Workspace 普通数据备份不等于完整原生备份。默认 native profile 将日志放在 DSH_HOME/sessions/<project>/<encoded-session-id>/ 下；当前源码格式为 session.v4.jsonl 或 session.v4.jsonl.zstd，历史规范代际文件必须保留。相关子 Session 也必须完整保留。POSIX 的 session.lock 是持久锁文件，锁持有状态在内核中；不能把文件存在当成进程运行，也不能删除仍可能有 writer 持有的锁。

仅在 `provider.close()` 成功且整个原生进程确认退出后，才能制作一致的离线日志副本。恢复要求相同审核版本及 compression、原目录所有权、私有权限和精确原 absolute workspace cwd；桥接拒绝 cwd 不匹配的历史。只接纳经过审核的普通文件，拒绝符号链接和未知目录；原生会话/引用附件拒绝可执行位，工作目录文件按普通私有字节恢复，不保留可执行权限。恢复不能回退格式或重新创建空历史替代损坏历史。

日志之外，默认 native profile 还可能需要 DSH_HOME/attachments/v1、DSH_HOME/storages 和 agent-workspace 的工具输出；具体 profile 可产生更多外部状态。DSH_HOME 还可能包含 .credentials.yaml、可执行配置和其他秘密，禁止整目录盲目归档。当前已实现下文支持范围内的原生清单和恢复流程；若真实部署仍有未纳入的额外插件状态，应保持明确拒绝，并把该 profile 的完整恢复演练留作上线阻塞项。

## Native data recovery implementation

Use [docs/NATIVE-RECOVERY.md](docs/NATIVE-RECOVERY.md) for the implemented native-aware
backup/restore path. It preserves actual JSONL generations, semantic checkpoints,
native IDs, attachments and workspace bytes; native stores are quarantined and
restored sessions get read-only/deny-approval policies without replaying work.
The optional DSH_RECOVERY_PATCH pins durable storage (including otherwise-temporary
spills) inside the application data root and participates in execution fingerprints.
Native activation requires the original absolute data path. Unsupported native
state/storage fails closed. This is a tested local recovery capability, not proof
that a chosen production profile, Windows host or off-host recovery drill passed.
