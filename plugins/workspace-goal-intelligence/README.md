# 企业经营上下文大脑 / Goal Intelligence 0.4.0

独立 Pi/OMP 插件：`@workspace-agent/pi-goal-intelligence`。
每家企业保留自己的经营上下文、来源、经营决策和复盘；不是另一个 Agent Runtime。

**交付状态：可运行的独立模块与离线功能/边界测试；生产 Host 和真实模型接线尚未验收。**
普通安装默认 unconfigured。不是已经上线的多租户经营平台。

## 已实现

1. 企业隔离的经营上下文：服务端固定 `workspaceId`；模型不能指定/更换企业。
   现有目标/预算来自原 Host，产品/公司/询盘等来自明确授权的来源投影。
2. 决策记忆：事实观察、假设、偏好主张分开；竞争性解释、支持/反对/缺失证据、
   两个以上方案、核验指标和停止条件。所有模型叙述保留未审核标记。
3. 经济性辅助：整数最小货币单位、区间计算、预算/币种/能力门禁；未知值不补零，
   不把概率/分类置信度当成交率。不生成承诺收益。
4. 原 Artifact 持久化适配器：create/read/update、原事务 admission.check、版本冲突、
   稳定 requestId；不新建业务数据库、审批/调度/订单系统。
5. 首页最多三条真实决策投影；没有可用决策时为空。相同问题去重、暂停/关闭目标和
   失效资料阻挡，支持原人类 UI 忽略/稍后。复盘不自动变成经营成功。
6. 资料/身份/接收模型撤权重验、取消、缓存防篡改；恢复和压缩后的私有上下文必须由
   原 Host 挂接硬门禁。本包不以扩展事件抛错代替真正的 provider 前阻断。

## 不重复开发的部分

复用原 Pi/OMP、Library/Products、Goal、Artifact、Store、审批和 WorkerDesk。
不复制 ERPNext、Medusa、Docling 适配器。Mem0 和向量检索保持关闭。
不引入 BDI/LangGraph/Mastra/Temporal 框架，不训练新模型，不直接调用 Jev。
BDI 仅体现在“有来源的认知、原经营目标、待授权行动”的数据结构中。
本包没有运行时 npm 依赖、网络客户端、计时器、Shell 工具或模型调用。

## 独立运行验证

在仓库根目录（或本次增量源码包解压根目录）运行：

```sh
node --test test/goal-brain*.test.mjs
node scripts/goal-brain-offline-proof.mjs
```

不需要启动 Workspace 服务，不读取模型配置，不需要企业服务器。
测试使用 Node 的 SQLite **测试夹具**保存合成 Artifact，验证重开后持久性。
它不是原 Workspace Store，也不是本产品新建的企业数据库或真实模型。
当前验收环境 Node 22.16.0；原项目目标仍是 Node 24+，真实 SDK/全仓验收另列。

## 原 Host 接线接口

```js
import { createArtifactBrainRepository } from './src/artifact-repository.mjs';
import { createBusinessBrain } from './src/brain.mjs';
import { businessBrainExtension } from './src/extension.mjs';

// 所有 existing*/reviewed* 值均由原可信 Host 提供；不能来自模型输入。
const repository = createArtifactBrainRepository({
  store: existingStore,
  artifacts: existingArtifactService,
  workspaceId: existingSession.workspaceId,
  authorizeRecord: reviewedOriginalArtifactAccess,
});
const brain = createBusinessBrain({
  binding: {
    workspaceId: existingSession.workspaceId,
    subject: existingSession.subject,
    sessionId: existingSession.id,
    conversationId: existingConversation.id,
    scopeVersion: originalGrantRevision,
    receiver: { provider: existingModel.provider, id: existingModel.id },
  },
  repository,
  authorize: reviewedLiveSessionAndReceiverAccess,
  readSource: reviewedOriginalSourceProjection,
  readGoal: reviewedOriginalGoalProjection,
  assertCurrent: reviewedLiveSourceAndGoalCheck,
  assertCommit: reviewedSynchronousStoreAdmission,
  authorizeHumanFeedback: reviewedOriginalHumanAction,
});
const extension = businessBrainExtension({
  brain,
  registerContextGuard: registerIntoOriginalPrivateContextGuard,
});
// 交给现有原生 extension loader，不启动另一条模型循环。
```

上述 reviewed*/register* 是 **需要原 Host 真正实现和注入的接口**，不是仓库中已自动
存在的函数；不能写 `() => true` 当生产权限。包内 fixture 的允许函数仅供合成测试。
八个工具在缺少 brain 或硬上下文门禁注册器时都返回 unconfigured。

### V0.4 实时经营脉搏

`workspace_brain_brief` 每次读取都会重新计算最多三条业务动作卡：企业上下文缺口、待定/未知经营结果、缺少可比基线、描述性变化和未复盘决策。它不是固定 Prompt，也不是预测模型；页面刷新即可得到当前授权事实下的新结果。没有受支持的指标时，卡片会明确提示补数据，而不是编造 KPI。

原 Host 可通过 `goalBrainOptions.sourceAdapter` 接入已有业务系统的结构化经营指标。该 adapter 只是一条受信读取接口，不保存第二份业务数据：
- `list({identity,binding,receiver})` 可以异步返回经过 Host 审核的 source references。
- `read({identity,binding,reference,receiver,signal})` 返回一个严格的 `{workspaceId,reference,observedAt,validUntil,values}` 投影。
- `current({identity,binding,reference,expected,receiver})` 必须同步返回当前同一投影，用于原 Store 写事务的 commit-time 复核；不能在锁内等待网络请求。
这使现有 Inquiry、Shopify/commerce cohort、市场验证等服务以后可以各自提供真实指标，而 Brain 不需要再建数据库或复制它们的数据。

### 必须保持的服务端契约

- `authorize({action,binding,receiver,signal,...})`：实时验证原 Session、企业、成员、
  会话、原 Run 意图、具体记录/字段和精确模型接收方。明确返回 true；否则阻挡。
  provider/id 比较只是插件的第一层；baseUrl/API/实例等完整接收者边界由原 Host 验证。
- `readSource(...)` 返回 `{workspaceId,reference,observedAt,validUntil,values}`。
  `reference` 为工具指定的 kind/id/revision/sha256/fields，必须与原服务实际一致；
  values 顶层键必须恰好是 fields。原读器验证源字节/投影与哈希、客户级别及字段许可，
  不能仅把模型传来的 reference 原样贴到任意文本上。日期必须含时区，validUntil 可 null。
- `readGoal(...)` 返回且只返回 `{workspaceId,id,revision,objective,status,currency,
  budgetRemainingMinor,perTaskCapMinor,capabilities,deadline}`。revision 为字符串，
  状态 active/paused/closed；预算未测量时为 null；deadline 为含时区时间或 null。
  这些必须来自原已确认 Goal/预算权威，不允许模型给自己写预算。
- `assertCurrent(...)`：输出前重验本次所有来源和目标，包括撤权、版本和可见投影；
  只读成员不因没有写权限而被拒绝读取。
- `assertCommit({state,operation,recordKey,requestId,binding,sourceRefs,goalIds,sources,
  goals,receiver,signal})`：在 **原 Store 写事务内同步**检查原 Session、操作权限、
  原执行意图、来源版本/字段/期限、目标状态及预算快照；feedback.save 还需原人类操作
  权威。只能返回 true，Promise 不被当作通过。外部源必须有原服务可核对的版本快照；
  无法同步核对时阻挡，不能在锁内发网络请求。
- `registerContextGuard({plugin,validateReceipt})`：把验证器注册到原 Host 的硬门禁后
  才返回 true。在每次 provider 请求前、恢复/压缩后和最终交付前校验仍影响上下文的
  所有私有依赖。压缩不能丢掉依赖索引；仅验证当前可见 tool 文本是不够的。
- `authorizeRecord`：原 Artifact 的成员/租户 ACL；不仅依靠 namespace 标签。
  原普通 Artifact HTTP/导出路径也必须维持同样的私库隔离，保护 businessBrain 元数据
  不被无权工具伪造。本包没有替整个旧应用完成多租户改造。

生产首接建议仍为 **每企业一个原 Workspace Store + 各自原生 Session**。即便未来共库，
本模块仍检查企业 namespace；测试共库通过不能推导其它旧 API 已有租户隔离。
同企业的受权新会话可重读旧经营上下文；不可把另一会话的旧 tool receipt 直接搬入模型。

## 调用与状态

| 工具 | 方法 | 写入/限制 |
|---|---|---|
| workspace_brain_sources | sourceCatalog | 只读；返回原 Host 已授权的公司、产品精确字段版本与原 Goal ID，不返回未授权目录 |
| workspace_brain_context | contextRead | 只读；冷启动 empty |
| workspace_brain_diagnose | diagnose | 只读；仅分析已授权且类型明确的询盘漏斗指标，保留 pending/unknown、可比性和因果不确定性 |
| workspace_brain_context_save | contextSave | 原 Artifact 未审核上下文 |
| workspace_brain_decision | decisionRead | 只读；校验 contextRevision |
| workspace_brain_decision_save | decisionSave | 原 Artifact 未审核决策 |
| workspace_brain_review_save | reviewSave | 原 Artifact 观测复盘，非因果证明 |
| workspace_brain_brief | brief | 只读投影，最多3条，不触发模型 |

`feedbackSave` 只供原人类 UI，不注册成工具；只影响首页，无审批/派单权限。
所有工具参数的闭合 JSON Schema 在 `src/contracts.mjs`；同处运行时检查拒绝额外字段。
`contextSave`/`decisionSave`/`reviewSave` 必须提供 requestId 和 expectedRevision；
初建为0。重复完全相同请求返回当前原记录，不新增版本；改正文却复用 requestId 拒绝。
旧版本不能覆盖新版本。上下文修订后旧决策需要显式复核/修订，不能原样继续推荐。

`recordRef` 同时给出原 Artifact ID/revision/version/sha256 和业务 recordRevision。
源事实不复制进第二资料库；上下文保存来源引用和模型草稿，每次读取重新投影授权事实。
现有 Artifact 每文件的100版本上限、配额和删除规则继续生效。本版未做跨100版本归档；
达到上限应报告原错误并人工处理，不自动开第二份上下文绕过限额。

若提交期间取消或原服务回执丢失，操作可能已经写入。不要宣称回滚、换 requestId 或
重复派发；先用原读方法核对确切记录，再在原许可下恢复。

## 还未完成

真实原 Host/provider 硬门禁和原 Session/成员接线；原 createArtifactService 全量运行
与 Node24/固定 Pi1.1.0/OMP18.10.4 SDK 验收；真实企业资料和模型质量评测；移动端
卡片挂接；事件/定时重新分析；真实第三方 Worker 派发、收费和商业验收。
Jev、Mem0、自动经营策略学习均未启用，也不作为安装依赖。

本包所做的是经营记忆与受控决策支持，不是对经营收益的保证。


## V0.2: source-backed diagnosis and original Artifact boundary

- New `workspace_brain_diagnose` read-only tool analyzes **only** trusted `metric` projections labelled `inquiry-funnel-v1` and explicitly segmented by product, market and channel. It preserves pending/unknown outcomes and reports only a descriptive conversion rate delta for complete, nonoverlapping cohorts. It does **not** infer a lost-order cause, generate a forecast, approve a recommendation or create any job.
- The original `server/brain-artifact-policy.mjs`, `server/artifacts.mjs` and `server/index.mjs` now reserve the private Brain metadata namespace and exclude protected Brain records from generic Artifact HTTP list/read/mutation. Original trusted creation/update requires `brainProtectedWrite` and synchronous transaction `check`; model or HTTP request bodies cannot supply it.
- Local Node22 tests: 100/100 pass (original 85 + ten diagnostic + five protected namespace). The original Host's Node24 HTTP + full existing suite, official Pi/OMP agent loop and live enterprise data **remain untested**. Do not deploy or merge without this acceptance and the existing Host private-context guard integration.

See `docs/GOAL-BRAIN-V02-INTEGRATION.md` for the exact metric contract and next acceptance checklist.

## V0.3 原 Workspace Host 集成：已提交、默认关闭、仍需官方 AgentSession 联调

已在原 Host 增加 `server/goal-brain-host.mjs`，直接使用原 `LibraryModelRead.businessBrainForSession` 的真实 Session/企业成员、模型接收方、公司与产品精确字段及 revision；使用原有 Artifact/Store 的事务准入检查持久化。只有原生 **running Run + allowBusinessSubmit** 才可写上下文或决策，不能靠模型提供 `canSubmit` 标志获得权限。原 Goal 来源需有同一企业/成员拥有的 conversation，并有原管理方的明确 reviewed revision；没有原预算账本就保留 `null`，不自动派发 Worker。

仅当可信服务器代码向 `createApp` 注入原管理方的 `goalBrainOptions:{ originalReceiver, reviewedGoals }` 且原 `libraryModelReadPolicy` 已明确审核时，原 Session GET 可读取：
- `/api/conversations/:id/brain/sources`：可用原资料引用及 Goal ID；
- `/api/conversations/:id/brain/context`：现有持久经营上下文；
- `/api/conversations/:id/brain/brief`：已有最多三条可执行前核查的经营建议。

这些接口不启动模型、不创建 Run 或 Worker 订单，且只读；服务器生产默认 `goalBrainOptions=null`，因而返回 unconfigured。内部 `bind({identity,conversationId,runId,canSubmit,signal})` 的资料保存由原 Session + 原运行中 Run 双重门禁审核，不可从 HTTP 构造绑定。**注意：本轮尚未将 Brain 八个工具挂进官方 OMP 18.10.4 的 provider 前、恢复后、压缩后硬上下文门禁，因此默认插件仍 fail-closed，不能宣称真实模型决策已跑通。**

本地使用合成原 Store 接口及 SQLite test-only Artifact facade 的 Node 22.16.0 回归，**117/117** 测试通过（包含独立额外的七条 Host 边界测试）。正式 Node 24 全仓 build/原 Host HTTP、原模型调用、真实企业资料联调仍未完成。详见 `docs/GOAL-BRAIN-V03-ORIGINAL-HOST.md`。


## V0.4 — Realtime Business Pulse

`workspace_brain_brief` now recomputes up to three action cards from the current authorized context, evidence gaps, measured inquiry observations and unfinished decision reviews. It is a deterministic read-only projection: no probability, causal inference, spending approval or external execution is created. The same Brain is now loadable inside the original Pi AgentSession, with transcript receipts revalidated before provider calls.
