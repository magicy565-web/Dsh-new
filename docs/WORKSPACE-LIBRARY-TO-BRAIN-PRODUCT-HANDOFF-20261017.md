# 企业资料到经营大脑：原项目主链接续说明

## 基线与当前状态

- 仓库：`magicy565-web/workspace-agent`，开发分支 `codex/omp-all-plugins-integration-20261017`。本说明核对的源码基线为 `4a6418922cee9c2754a4f009783a329391ad965c`，不是部署版本声明。
- 该提交保存了 5 个生产文件、4 个测试文件和 1 份待验说明。生产补丁仍为已审 `ba55761ba3951ef52e2454faf28edca19524be82f26ed12164b46a069b691c61`；后续 v3 只修 2 个合成测试文件。源代码写入在此交接点冻结，本提交只增加说明。
- 2026-10-17 首次真实 Node/Bun/OMP SDK 隔离验收：63 项中 61 通过、2 失败，退出码 1。不是完成验收。具体证据见 [transport 验收说明](NATIVE-FACTS-BOUNDED-TRANSPORT-ACCEPTANCE-20261017.md)。
- v3 仅修两测试后的同组验收，已由原唯一服务器操作者于 2026-10-17 21:43:09 至 21:44:28 UTC 完成：63/63 通过，16 个新 SDK 用例全部通过，fail/cancel/skip/todo 均为 0，78832.141384 ms，退出码 0。前、应用后、测试后 1245 文件及依赖锁全核通过；5 个生产文件与 v2 逐 SHA 完全一致。日志 6255 字节，SHA-256 `98f60da3ac30d92f2de69f12d9bbf7f4790f75434b4d05fc808c85068eb3850d`。首跑失败记录保留。
- 已有 Host 合成验收、原生 SDK 替身模型验收、真实 local-files 两轮验收，以及 Medusa 官方 Admin/HTTPS 验收，分别证明各自范围。它们都不能代替“资料上传后由 Agent 提取保存事实，再进入 Brain，并在页面连续使用”的完整交付。

## 要交付的可用结果

用户在原 Workspace 企业资料页上传文件，在原聊天中明确选择资料版本、接收模型、精确事实键、内部记忆读写范围及已有 Goal。第一句话要求读取资料、保存有来源的结构化事实并给建议，Agent 通过原能力完成并保存可查看的 Decision。第二句话在同一会话继续，保留实际 SDK Session ID、原授权范围和来源核验。

现阶段不能把这段用户路径写成已经可用的操作教程。当前测试预先通过可信 Host 种入合成事实，尚未证明模型从新上传资料中自主读取并保存事实。正常启动器也未完成所需可信组合入口。

## 已有页面与接口：复用点

### 1. 上传、版本与会话引用

- `src/library/Company.tsx`：原企业资料页、上传、新版本、固定版本详情和人工审核界面。
- `src/library/common.tsx` 的 `readUpload`：当前上传大小上限 5 MiB；保留原文件类型校验、请求幂等和未知结果处理。
- 先 `POST /api/artifacts` 保存内部文件，再 `POST /api/library/documents` 建立资料记录；新内容走 `POST /api/library/documents/:id/versions`。确切来源包含文档版本与 Artifact 的 ID、版本、SHA-256。
- `src/library/ConversationReferences.tsx` 与 `server/library-http.mjs`：`GET/PATCH /api/conversations/:id/library-references` 保存确切资料或产品引用。现有界面已明确“仅关联，不自动发送给模型”。
- 文档关联、人工审核、接收模型授权是不同条件。不得把引用选中或页面可见当作模型已获读权限。

### 2. 原结构化事实 Host

- `server/index.mjs`：`app.enterpriseContextSessionBinding(identity, options)` 已使用原 access、instance、Library model-read、Artifact、Store、enterpriseMemory 和原 sessionReadonlyClient 创建可信 Host。
- `server/workspace-enterprise-context-host.mjs`：`createEnterpriseContextSessionBinding`；其 `.open(nativeSessionId, {conversationId, runId, requestId})` 返回同 Node closure 中的原 control。
- 可复用操作：`parseUpload`、`structuredMemoryRemember`、`structuredMemoryLookup`、`readOnlyFacts`、`authorizeContext`、`assertDisclosureCurrent`。`readOnlyFacts` 是可信进程内窄能力，没有暴露给模型构造或 RPC 自行创建。
- 初始 selection 必须显式启用、reviewed，固定 customerId、1 至 8 个文档来源及精确资产；`allowMemoryRead`、`allowMemoryWrite` 分别显式授权。现有记忆能力还依赖原 memoryLedger、已审 Docling 连接和来源 authority，不能为方便启动删掉这些前提。
- `structuredMemoryRemember` 调用原 `enterpriseMemory.rememberFromConversationTurn`，保存原 conversation/run、所有选定文档依赖和原 credential-screening proof。不能绕到裸 ledger、另一套数据库或通用记忆 HTTP 写入伪装成 Agent 原会话写入。
- 原 `GET/POST /api/library/memory` 及 history/revoke 管理接口已存在，实现在 `server/library-http.mjs`。管理接口的存在不等于上述同会话工具链已接好。
- Docling 解析仍需原精确源文件和解析转移授权。不要把 metadata 引用当正文，也不启用 Mem0 或向量检索。

### 3. 原 Brain 与 native Session

- `server/goal-brain-host.mjs`：原 `createGoalBrainHost().bind(...)`、`sourceCatalog`、`readSource` 及同步 current/commit 门已支持明确的 `memory-fact` 来源。事实不是 metric，也不是 document metadata artifact。
- `server/pi-business-agent.mjs`：可信 binding 的 `brainMemoryFactKeys`，以及 `bindBrainForNativeSession`，已在真实 SDK ID 握手之后打开原 control，获取 `readOnlyFacts`，再绑定 Brain；首次模型请求前完成绑定与原 saveSession。
- `server/workspace-omp-session.mjs`、`server/workspace-omp-bridge.mjs`、`server/workspace-omp-worker.mjs`：原 native 生命周期、最终实际 receiver/body 检查、取消和交付门继续使用；Node 持有权柄，worker 不获得企业 Host 权柄或任意 profile。
- 原 Context/Decision 保存由 Agent Run 与原 Goal 约束，结果是内部未审批草稿。不得新建 Goal 外执行、自动发送或代替人工审批。
- 新 Session 的初始键和 scope 一经确定，不允许旧 Session 后加事实键、自动刷新旧 catalog 或迁移旧 receipt。当前 observed proof 若因正常更新失效，应明确拒绝旧绑定；需要新 control/reader/binding 的场景必须显式处理，不能清空旧 proof 使其假通过。

### 4. 原聊天与 Brain 页面读取

- 继续使用 `POST /api/conversations` 和 `POST /api/conversations/:id/messages`；第二轮是同会话下一条消息，不另造 CLI/Loop/Queue。
- `server/goal-brain-http.mjs` 已有 `/api/conversations/:id/brain/sources`、`context`、`diagnosis`、`brief`、`decisions/:id` 等读取投影。POST 仅开放已有人工 review/feedback；Context/Decision authoring 仍由 Agent Run 完成。
- 但当前 HTTP 投影调用 `host.bind({identity, conversationId, canSubmit:false, ...})` 时没有传入 `memoryFacts`。因此不能假定页面已能读取带 `memory-fact` 依赖的 Decision。必须在原页面读取路径复用同一可信、当前有效的窄读取授权并实际验收，不能暴露可由浏览器伪造的 reader/handle，也不能为页面绕过依赖校验。

## 尚缺的一个产品接入：可信组合入口

它不是增加一个开关即可完成，至少包含以下相互关联的接线点：

1. **原启动与初始选择。** `server/index.mjs::startWorkspaceServer` 调用 `server/workspace-omp-host.mjs::createWorkspaceOmpBusinessOptions`，当前正常启动只组合模型/client 等既有配置，没有把资料 model-read policy、`goalBrainOptions`、`enterpriseContextHost`、`brainMemoryFactKeys` 和已审 bounded paid selector 一起注入原聊天。原 `createApp` 仅在 `goalBrainOptions !== null` 时创建 Brain。需要在既有页面/HTTP 边界收集显式选择，经过原服务端授权后形成绑定，不能信任模型输入直接生成权柄。
2. **同 Session 的读取、保存与建议。** 原 business 已接只读事实，但没有接入原企业 `parseUpload` / `structuredMemoryRemember` 工具。应仅复用选定原方法与当前 Run control；不能把互斥的 business 和 enterprise profile 同时设为 true，也不默认启用所有插件。`plugins/workspace-enterprise-context/src/extension.js::enterpriseContextExtension({client, authorize, enabledMethods})` 已有方法白名单入口，可供设计复用，但注册工具本身还不足以完成安全接线。
3. **原工具 receipt 与可查看结果。** 需解决下节确切兼容缺口，并把同范围结果接到原聊天/Brain 页面。保持原 UI 架构，不建设第二套前端、记忆库或授权系统。

原 business binding 还需要既有配置的认证 client；正常配置缺失时应明确显示未配置，不读取或新建凭据来让测试通过。

## 必须先解决的正常 receipt 兼容缺口

`plugins/workspace-enterprise-context/src/extension.js` 产生 `plugin: workspace-enterprise-context-oss` 的真实原工具 receipt。

`server/workspace-omp-business-journal.mjs::revalidateBusinessJournal` 当前对成功业务 receipt 仅分派原 factory/market/monitor/product/Medusa/Brain 等验证器，没有 enterprise-context 的成功 receipt 分支；未知 receipt 会抛 `NATIVE_BUSINESS_RECEIPT_INVALID`。因此“只将 remember 工具加到 business profile”会在原交付或连续上下文链上失败，不能宣称完整链已接通。

后续方案须复用原 control 的真实 proof/current 验证，并覆盖最终发送、交付和下一轮当前依赖检查。不得删除 journal 检查、把 receipt 改名伪装成 Brain/metric、清空 transcript，或对未知 receipt 放行。还须检查原 `readBusinessContext` 与 catalog 精确匹配，不能仅修最后一处报错。

**范围边界：** 新建、显式授权 Session 的普通工具调用及其同会话正常续轮，可以作为新的能力验收。此前未完成、且不在本轮允许范围的旧 receipt 恢复/迁移安全复审，不得重跑或换路径变体重试。若上述接线必须改变该旧恢复语义才能工作，应停止该部分，明确报告函数、失败条件和所需范围确认；不能借产品接入降低旧门禁。

## 分步完成标准：按用户可用成果验收

### 第一步：现有 transport 隔离验收已收口

- v3 同组 63 项已实际通过；保留首轮 61/63、精确拒绝码、两次日志哈希与全源码/锁校验，见配套验收说明。
- 当前两个修正只涉及合成用例：第二轮读取同一 Context 后更新 Decision；资料变更的再次发送精确要求 HTTP 409 `FACTORY_DOCUMENT_REVISION_CHANGED` 且无新 Run/发送。没有降低生产版本门。
- 本次全通过只确认原 SDK 加有限替身模型的这条链，不证明真实模型业务或页面已可用。

### 第二步：在原聊天入口完成一条新资料主链

使用合成文件和原依赖，在初始显式授权的新 Session：

1. 通过原上传接口保存文件与资料，记录精确版本/SHA；原会话关联保留。
2. 通过原授权入口固定 receiver、资料范围、可写事实键和已有 Goal；未选择或未授权时保持原默认行为。
3. Agent 通过原解析/读取能力取得来源，再通过原 `structuredMemoryRemember` 保存事实。测试不得预先插入事实来代替该步骤。
4. Brain 从原精确键 reader 得到事实，保存带真实来源的 Context/Decision，并关联原 Goal。所有实际模型接收、最终 body、取消、current 与 commit 检查保留。
5. 第二句话仍用同一 native Session 和初始 scope，读取原上下文并更新建议。无必要时不提高 Context revision；若 Context 确实更新，必须正确处理旧 Decision 依赖，不能绕过版本门。

完成标准是上传后的用户操作链成功，而非仅工具注册成功。撤权、源版本变化或 receiver 改变时，原模型发送和保存应拒绝；拒绝结果要在原页面可理解。

### 第三步：用户可查看并继续使用

- 原企业资料页可看到文件版本，原聊天可看到明确接收范围和来源；原 Brain 页面能读取该 Decision 的全部合法依赖。
- 第一轮建议和第二轮续稿均可回看；事实来源可定位到原文档版本/SHA，内部草稿未审批状态明确。
- 显式新绑定的正常路径与旧 scope 拒绝分别验收，不自动迁移旧会话。
- 真实模型验证另需明确本次模型、可发送资料、预算和历史费用依据。现有 bounded adapter 是两 Run 临时验收组合，不是新的产品预算引擎；新 adapter 实例不能自动证明历史余额。未确认 usage 仍按原上界预留。此说明不授权付费或部署。

## 交接核对与操作边界

- 从上述精确开发分支提交恢复源码，先核远端 HEAD；保留正常非强推与单一代码写入者。当前服务器为旧基线加选择性补丁，不能 pull 整支或用远端 HEAD 冒充运行版本。
- v3 测试补丁 SHA-256：`7c5b6aed02cef98988ee30af7c84740a8fd1baee942d469c87453f782707f71f`；测试增量包 SHA-256：`a310b35798b10c9dbfaeebaa0840b6cf1d4cac5055583f06bfac33458f53cb62`，73030 字节。它应用于 v2 后的 1245 文件隔离副本，不重复应用 v2。
- 使用仓库原锁和实际 SDK；不以 stub 包、静态检查、旧 Host 测试数替代新入口验收。
- 先交准确最小 diff 与离线/隔离结果，再审核真实模型或服务变更。只提交项目源码、测试和脱敏说明；不要提交原运行日志、上传资料、截图、私有配置或凭据。
