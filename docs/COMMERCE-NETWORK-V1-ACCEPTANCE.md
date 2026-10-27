# Commerce Network v1.0 候选版：实现与验收记录

更新日期：2026-10-28（Asia/Shanghai）。

交付包：`dsh-commerce-network-1.0.0-rc.1.tgz`。宿主核对版本：官方
`@deepseek-ai/dsh@0.2.1-rc.3`。运行环境：Node.js 24+。

本文件记录当前实现和已实际执行的验收。它是原生插件候选版的交付记录，
不意味着所有外部商业服务均已上线。真实浏览器检查、全仓门禁与安装包验证由
本文末尾的发布表单独记录；包的最终摘要由随包生成的打包回执记录。

## 1. 已实现的产品路径

插件在 DSH 原生会话旁提供 React Flow 无限画布。工厂、海外代理商、第三方
Personal Worker 是各自独立的业务主体或服务；产品上下文、市场、渠道和服务
工单保留各自业务含义。用户通过原生对话生成网络，画布展示实际保存的关系、
任务状态、交付与待决策事项。

已经接通的业务路径：

1. 原生 DSH 工具读取当前工作区及修订。
2. 原生对话工具原子保存项目、主体、产品上下文、渠道计划、销售授权建议和工单建议。
3. Owner 为指定 Personal Worker 发放一次性显示的限定凭据。
4. 独立 Worker 用该凭据完成真实网关握手。
5. Owner 审阅具体任务、可共享资料、截止时间和费用上限，批准精确授权。
6. 原生 DSH dispatch 工具派发已经批准的工单，保存真实 session/tool-call 来源。
7. Worker 领取自己的工单、持有短租约、心跳、读取授权输入并提交实际文本。
8. 服务保存实际内容和 SHA-256；Owner 验收或退回；画布读取实际结果。
9. 下游节点在前序交付验收后运行；共享前序内容仍需明确选择和单独审阅。

SQLite 事务持久化上述业务记录。画布坐标和视口有独立版本。拖线、节点生成或
保存一个计划均不代表已联系买手、已发布渠道或已执行代理任务。

## 2. 实现边界与单一执行宿主

| 模块 | 责任 |
| --- | --- |
| DSH 原生会话与工具 | 会话、模型、工具运行和原生权限；插件只注册业务工具 |
| 无限画布 | 原生 right sidebar；宿主 React；平移、缩放、选择、布局和坐标保存 |
| 纯领域包 | 校验委托动作、状态、主体、租约、期限和事件重放 |
| 原生业务服务 | 项目、主体、授权、工单、交付和预算 |
| SQLite | 业务变更、预算、幂等回执和审计原子提交 |
| Owner HTTP | DSH Connection 认证和 exact-origin 写入；不能直接执行 dispatch |
| Worker Gateway | 单独 Bearer 凭据，只操作被委托给该 Worker 的任务 |
| 原生资料适配 | 读取已有资料库的精确产品版本，不维护第二套库存/产品数据库 |
| 独立 Worker SDK | 传输客户端，不含模型、Agent Loop、付款或渠道发送逻辑 |

`dshTaskRef` 是已发生的原生 session/tool-call 的稳定来源指针，同时保存实际
`nativeDispatch.sessionId` 和 `nativeDispatch.callId`。它不代表创建了原生
Scheduler 定时任务；当前没有自动排程或第二个内部模型执行宿主。

原生 SessionId 是 opaque branded string。官方 Web 默认生成 `session-<UUID>`，
底层 SessionStore 也支持 `session-<counter>`。后端采用有界标识符加当前
`workspaceRegistry` 精确成员关系，不再错误地要求裸 UUID；不通过去掉前缀
或信任用户自报 ID 推测身份。

## 3. 安装自包含 npm 包

目标环境需已有 Node 24+ 和官方 DSH Web。本版本已核对 `0.2.1-rc.3`；其他
宿主版本需要另行验证接口兼容性。插件安装不会自动提供模型凭据、Worker 服务、
WhatsApp、邮箱或商业账号。

### 安装实际交付包

将 tarball 放在目标机器可以读取的位置，然后通过原生插件管理器安装：

```sh
dsh plugin --profile web add /absolute/path/dsh-commerce-network-1.0.0-rc.1.tgz
```

如果这个 profile 此前安装的是同名 `link:` 开发包，请先停止该 profile，执行
`dsh plugin --profile web remove dsh-commerce-network`，再安装 tarball 并重启。
本次验收发现直接替换 specifier 可能保留旧 link resolution；安装后应确认加载
路径来自 profile 的 `node_modules/dsh-commerce-network`。卸载插件不删除上述
业务数据库。正常安装只运行一个拥有此数据目录的 DSH profile 进程。

也可以在对应 profile 的原生 Plugins 页面使用本地 tarball 完整路径。官方
管理器安装新 bundle 默认选中启用；已选中不等于加载成功，需查看实际加载状态。
未启用 HMR 时，按管理器给出的 `restart-required` 提示重启 profile，再刷新页面。

至少检查：

- `dsh-commerce-network` 没有加载错误。
- 原生会话中出现打开画布的入口，右侧画布打开后主会话保留。
- 当前会话/工作区可以读取画布服务，无认证请求被拒绝。
- 四个 `commerce_network_*` 工具已经注册。
- 初次运行是真实空状态，没有示范客户、订单或收入。

自包含包由 [打包脚本](../scripts/package-commerce-network.mjs) 生成：在临时
staging 目录放入同一份领域源码、重定位导入、移除未发布 workspace 依赖，再
执行 `npm pack --ignore-scripts`。它不复制宿主或另建服务器。

开发者构建命令：

```sh
npm ci --ignore-scripts
npm run build:commerce-client
node scripts/package-commerce-network.mjs /absolute/output-directory
```

最终字节数、文件清单和 SHA-256 以实际打包后生成的
`commerce-package-receipt.json` 为准。版本名不代表已发布到公共 npm registry。

### 数据和卸载

默认数据库：`$DSH_HOME/commerce-network/commerce.sqlite`。显式 `config.dataDir`
覆盖该目录。数据库、原生会话、凭据和真实资料不进入 Git。卸载释放工具和 HTTP
注册并关闭连接，不替用户删除持久业务文件。

有已领取工单时，先请求停止并查看实际回执。停用内部插件不等于物理终止
独立第三方进程；不能把卸载显示成外部工作已经停止。

## 4. 第三方 Personal Worker 接入

Provider 是独立业务主体，Agent service 是其提供的执行服务。Owner 为指定
服务发放的凭据绑定一个 workspace、project 和 agent。secret 只显示一次，
数据库和幂等记录只保留 hash；丢失首次响应需要显式轮换。

`connect` 只证明持有该凭据，不证明工商身份、专业资质、服务能力或外部渠道
权限。正式远程连接使用 HTTPS；只有显式本机开发可使用 localhost HTTP。
SDK 不把 secret 放入 URL、不接受 redirect、不自动重试未知结果。

在独立 Worker 项目安装同一个 tarball 后使用：

```js
import { createWorkerClient } from 'dsh-commerce-network/worker-client';

const worker = createWorkerClient({
  baseUrl: process.env.COMMERCE_ORIGIN,
  token: process.env.COMMERCE_WORKER_TOKEN,
});

await worker.connect({}, { requestId: 'connect-installation-001' });
const claimed = await worker.claim({}, { requestId: 'claim-job-001' });

if (claimed.order) {
  const lease = {
    orderId: claimed.order.id,
    leaseId: claimed.order.leaseId,
  };
  const started = await worker.heartbeat(lease, {
    requestId: 'start-job-001',
  });
  const input = await worker.resources(lease, {
    requestId: 'read-job-input-001',
  });
  // 将 brief、allowedActions 和 input.resources 交给已有 Personal Agent。
  // 执行期间由其真实运行环境继续 heartbeat，并检查 stopRequested。
}
```

有了真实结果后，在同一运行环境中交付：

```js
const delivery = await worker.deliver({
  orderId: lease.orderId,
  leaseId: lease.leaseId,
  title: actualResult.title,
  content: actualResult.text,
  sourceUrls: actualResult.sourceUrls,
  actualMinor: actualResult.serviceCostMinor,
}, { requestId: persistedDeliveryRequestId });
```

第二段是集成调用片段，`lease`、`actualResult` 和持久 requestId 必须来自实际
任务上下文。没有内置或伪造的研究/获客服务。收到 stopRequested 后应停止自身
工作，再调用 `stopped(lease, {requestId})`，不能继续交付。

租约最长 120 秒，且不超过任务截止时间。长任务由原 Personal Agent 的运行
环境及时续约；SDK 不自行启动轮询、模型或后台任务。未知 transport 结果保留
`outcomeUnknown` 和原 requestId；核查任务状态后只能用相同 ID 和相同内容重试
可能已提交的变更，不能换 ID 盲目重复执行外部动作。

## 5. 人工决策、关系授权与数据流

### 审阅与模型权限

模型可以读网络、创建计划、提出工单和派发已批准工单。它不能自批任务、取得
Worker secret、提高预算、批准销售授权或验收自己的交付。

审批先读取 `/commerce-network-api/review`。预览包含任务、允许动作、实际共享
资料全文、费用上限、币种、截止时间、networkRevision 和 reviewDigest。Owner
提交相同 digest 和 revision；服务重新检查资料，内容或状态变化时拒绝审批。

结构化字段白名单不等于自由文本语义 DLP。资料描述可能自己含敏感文字，因此
真实文本审阅仍是披露授权的一部分。外部交付和来源文字按参考数据处理，不能
作为修改权限的指令。

### 销售授权关系

Factory → distributor mandate 明确双方、市场、产品上下文和业务范围，状态
proposed → active → revoked。Owner 激活时保存 approval receipt 和 approvedAt。
`legalSignature` 保持 false；不声称有双方法律签名、独家经销合同、佣金付款或
已经连接的销售账号。

### 依赖和实际输出传递

`dependsOn` 提供同项目 DAG 顺序约束，缺失对象、自依赖和循环整体拒绝。所有
前序真实交付必须 accepted 才能派发下游。

共享前序输出必须显式列出 `accepted_deliverable:<predecessorWorkOrderId>`。
前序真实文本、来源和摘要进入下游审批预览，批准后才能交给下一个 Worker。
读取时复核同项目、已验收状态及完整字节摘要。依赖边本身从不授予内容权限。

### 原生资料

精确 sourceRef 指向原生 workspaceLibrary 产品 ID/revision。适配器共享名称、
描述、分类和限定 SKU 技术参数，剔除专用价格表、供应条件、company、附件和
其他文档内容。原生库仍为 profile 级，不是多租户产品目录；对外共享必须有
具体 workspace/project mapping 和独立 Owner 批准。

每次资料读取检查 mapping、原生服务可用性、精确 revision、归档状态和摘要。
文档还需原版本、字节 SHA、来源审核与独立披露批准；当前没有文档披露审批
入口，`approved_document` 保持阻断。

## 6. 预算、停止、重试和恢复

项目默认上限为零，支持被批准的免费任务。Owner 可以提高上限。批准任务时
原子保留完整 maximumMinor，实际报告费用必须为非负整数且不超限。金额使用
币种最小单位；accepted 后才记录 accruedMinor。这是费用授权与验收账，不是
钱包、支付、结算或税务发票。

Worker 失联后可能仍在外部执行。租约过期且 stopUnconfirmed 为 true 时，
failed 工单仍保留 riskHeldMinor 和预留。释放风险预算需要真实停止回执，再由
Owner 提交明确处理理由，防止相同额度被新任务重复占用。

同一 Worker 最多一份活跃租约。超时不自动重新派发。重启保留任务、租约、
授权、交付、预算与幂等记录，恢复记录不自动恢复外部执行。

撤销立即阻断新的资料和交付；未过期旧凭据只能在自己已有租约范围查停止状态
或确认停止。凭据过期继续拒绝。服务不声称能够强制杀死外部 Agent 进程。

请求限制为每凭据每分钟 60 次（进程内窗口）。状态/资源查询及空队列轮询不
增加业务修订。这是运行保护，不是完整公共 SaaS 防滥用体系。

## 7. 已完成的自动化验收

### Commerce 回归：64/64，零跳过

```sh
node --test integrations/dsh/dsh-commerce-network/test/*.test.mjs \
  packages/domain-commerce-network/test/*.test.mjs
```

| 测试组 | 数量 | 实际范围 |
| --- | ---: | --- |
| Native bridge / 图投影 | 11 | 同会话发送、真实回执关联、无假数据、坐标、依赖、授权与初始视口 |
| HTTP | 1 | 实际 localhost HTTP；Owner 认证、origin、dispatch 隔离、Worker 入口 |
| 原生资料库适配 | 7 | 真实 LibraryStore；字段限制、版本、归档、撤销、摘要 |
| 独立安全回归 | 16 | workspace/agent 隔离、预算、撤销、数据流、风险预留、限流 |
| 业务服务 | 9 | SQLite 恢复、实际字节、身份、幂等、CAS、回滚、官方 session ID |
| Worker SDK | 3 | secret、redirect、请求 ID、未知结果和 JSON 验证 |
| 纯领域 | 17 | 状态迁移、角色/服务/租约、重放、期限和权限引用 |
| **合计** | **64** | **全部通过** |

最终执行 `npm run check`：构建通过，**321 项测试通过、0 失败、0 跳过**。
`npm run test:client` 的全部原生客户端检查通过；Commerce 工厂合同另验证
8 项检查，包括真实打包 React Flow 的非空节点和关系边渲染。这个检查已能阻止
错误边界吞掉渲染异常后误报通过。

### 官方 ToolRuntime + 独立 Worker 进程

```sh
DSH_RUNTIME_DIR=/absolute/path/to/installed-dsh-runtime \
node integrations/dsh/dsh-commerce-network/dev/native-smoke.mjs
```

实际结果：

```json
{
  "ok": true,
  "officialToolRuntime": true,
  "nativePluginLoaded": true,
  "independentProcessGateway": true,
  "actualStoredBytes": true,
  "ownerAcceptance": true,
  "modelCalls": 0
}
```

这里使用真实官方 Cordis/ToolRuntime、插件加载、SQLite、HTTP、独立子进程、
实际交付字节和验收。session/registry 与业务记录是明确的隔离夹具，不是商业
海外 Provider 或买手数据。

已修复真实合同问题：工具 presentation metadata 必须为 lossless JSON，不能
返回 undefined；真实 Web SessionId 带 session- 前缀，不能误按裸 UUID 拦截。

## 8. 未宣称完成的能力

- 真实模型端到端：本次没有配置/调用真实模型 Key，ToolRuntime 调用不等于
  LLM 已理解并完成商业任务。
- 多租户 SaaS 登录：当前为一个 DSH Owner；业务主体节点不是 SSO、企业账号或成员系统。
- 生产第三方 Provider：协议和独立进程通过，不证明指定商业 Agent 已持续联网运营。
- 公共外联：没有发送邮件/WhatsApp/买手消息、投放广告、开店或托管发布渠道。
- 付款和法律签名：没有实际资金流、佣金结算、合同签署或法定代理权验证。
- 持续排程：没有创建自动计划任务或第二个 Agent Loop。
- 商业结果：没有虚构买手池、询盘、样品单、成交额或转化数据。
- 任意 A2A Endpoint：当前实现 scoped Pull Gateway，不自动抓取注册 URL。

## 9. 真实浏览器与安装包验收

下列结果来自本次隔离验收环境，业务名称和内容明确标注为合成测试资料。
没有把模型接口接收、连接握手或画布节点当作外部商业执行成功。

| 门禁 | 结果 | 实际证据 |
| --- | --- | --- |
| 官方 DSH Web 真实 profile 加载 | 通过 | 官方 CLI 安装、真实 workspace/session、同源认证 GET 200 |
| 原生会话 + 右侧无限画布 | 通过 | 原生会话保留；真实页面呈现 8 个节点、8 条关系；无浏览器脚本异常 |
| 桌面与较窄桌面交互 | 通过 | 1600×1000 和 1280×900；筛选、搜索高亮、缩略图、节点拖动、详情、成员面板 |
| 布局与项目隔离 | 通过 | 拖动后 CAS 保存，刷新恢复同一坐标与视口；切换项目不显示另一项目工单 |
| 首次视图 | 通过 | 未保存的新项目以 0.9 缩放打开；远端节点不将全部卡片压缩；已有视口保留 |
| 凭据与实际资料审批 | 通过 | 真实 UI 生成限定 token，关闭后页面不含该 token；逐项展示待分享内容和 digest |
| Worker 交付与人工验收 | 通过 | 独立 Node 进程连接真实 Host，领取、心跳、读取唯一授权产品、提交文本及 SHA-256；UI 查看并验收 |
| 前序输出传递 | 通过 | 两项委托分别验收；后项仅获取明确批准的 accepted_deliverable 内容，没有继承产品访问权 |
| 销售协作授权 | 通过 | 点击真实关系、核对范围并批准；保存状态 active，仍明确没有法律签名 |
| 全仓与原生客户端门禁 | 通过 | `npm run check` 321/321；`npm run test:client` 全部通过；官方 ToolRuntime 冒烟通过 |
| 自包含 tarball | 通过 | 原生 CLI 实际安装；解除开发 link；包内相对 domain 导入；重启后两份已验收交付完整保留 |
| 源码交付位置 | 独立开发分支 | `codex/commerce-network-product-v1-20261028`；最终 commit/PR 见交付消息 |

浏览器验收中的 dispatch 由官方 ToolRuntime 验证程序使用实际隔离 profile
会话归属执行。**模型调用次数为 0**；没有可用模型凭据，因此不能将这些检查
描述为真实模型从自然语言自动完成全链路。外部 Worker 是独立进程中的协议
验收客户端，不代表真实第三方商业 Provider 的能力已获验证。

安装包内含 runtime、宿主加载客户端、Worker SDK、领域源码、许可和本文件，
不含测试工作区、SQLite、Worker secret、模型凭据或开发依赖。最终打包回执
提供字节数、13 个文件的清单与 SHA-256，不在归档内硬编码归档自身的摘要。

## 10. 实现依据

- [插件 README](../integrations/dsh/dsh-commerce-network/README.md)
- [领域规则](../packages/domain-commerce-network/README.md)
- [原生入口](../integrations/dsh/dsh-commerce-network/index.js)
- [业务服务](../integrations/dsh/dsh-commerce-network/service.js)
- [原生资料适配](../integrations/dsh/dsh-commerce-network/resources.js)
- [Worker SDK](../integrations/dsh/dsh-commerce-network/worker-client.mjs)
- [官方 runtime 冒烟](../integrations/dsh/dsh-commerce-network/dev/native-smoke.mjs)
- [打包脚本](../scripts/package-commerce-network.mjs)
- 官方安装包 `@deepseek-ai/dsh-plugin-manager/README.md`：tarball、默认启用、
  restart-required 和已选中/已加载的区别。
- 官方安装包 `dsh-api-session-controller/lib/types/agent.js`、`commands.js` 和
  `dsh-session/lib/types/types.js`：真实会话 ID 合同。
