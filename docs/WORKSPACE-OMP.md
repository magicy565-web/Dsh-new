# Workspace 工厂开发入口

开发默认前端选定官方 `@oh-my-pi/pi-coding-agent@18.10.4`，Bun 固定1.3.14。Workspace原HTTP、身份、Session、Store、Runtime、审批、业务任务和Pi Durable阶段继续持有业务执行权威。OMP通过SDK和受控工厂插件调用这些原接口；不另建任务队列或执行同一业务任务的第二引擎。

Issue #71另提供独立 [工厂资料插件](FACTORY-MATERIALS.md)：默认安装不授予私库访问。已认证原Host可在原Library审核策略中明确选择记录/字段/文件版本及接收模型，再用固定 `WORKSPACE_OMP_PROFILE=factory-materials` 选择单独的 `omp:18.10.4:factory-materials-v1` 会话。该资料配置禁用公开搜索/浏览器/公开子代理，每次模型调用前复核原journal全部资料回执。下文的公开材料、公开搜索及私库禁用说明指默认 `public-v1` 配置；不能把两种会话的历史互相迁移。

Issue #72提供单独的 [公开客户研究配置](FACTORY-CUSTOMERS.md)：`WORKSPACE_OMP_PROFILE=factory-customers`，由官方模型工具循环直接选择原搜索／浏览器／公开子代理，插件仅按原工具回执保存模型撰写的待审核文书，不再强制 factory-export 四阶段。它与私库资料配置隔离。真实原生搜索目前拒绝、零来源，不能把合成正向链称为实际海外客户发现。

Issue #73另有 [询盘与待审核草稿配置](FACTORY-INQUIRIES.md)：`WORKSPACE_OMP_PROFILE=factory-inquiries`，官方模型通过既有授权资料工具读取原询盘／产品，自行判断缺项、追问或撰写所需正文。唯一保存工具接收1–5份模型正文与原来源引用，服务重新校验授权、来源版本、原执行意图和幂等；不生成固定三稿、不签发人工审核结论。没有公开搜索、浏览器、公开子代理或发送工具。

这两个精简 profile 通过官方 Skill 加载器及受限 `workspace_skill` → 原生 `skill://` ReadTool 按需读取已选方法，不重复拼接整份 Skill，也不注册旧通用固定业务工具或其 worker RPC。默认 public profile 及其原显式任务接口保留兼容；下文早期固定文书流水线证据属于历史实现。

在维护者控制的原 Host 中沿用已有安全配置，使用下列原入口检查或启动；不要把密钥、Cookie 或完整配置粘贴到聊天：

```sh
WORKSPACE_OMP_PROFILE=factory-inquiries npm run workspace -- --check
WORKSPACE_OMP_PROFILE=factory-inquiries npm run workspace -- --serve
```

公开研究将 profile 改为 `factory-customers`。`--check` 不调用模型，不能证明权限、网络、余额或累计五元额度。启动服务也不会补齐这些授权：真实私库材料仍须原审核策略允许 exact Session／接收模型／字段与文件版本；真实模型须原 Host 的安全配置、计价与原累计 CNY5 已消费／剩余额度可核实。任一证据缺失继续未配置或拒绝，不能用预算标志、合成替身、其他模型或账户代替。

## 启动

本轮固定运行器安装适用于Linux x64；实测Node24.19.0。先在开发检出中安装锁定依赖和必要运行器，安装器使用官方固定npm包并禁生命周期脚本，不安装语音／本地模型组件：

```sh
npm ci --ignore-scripts
node scripts/setup-omp-runtime.mjs
node scripts/workspace-omp-install.mjs
npm run build
npm run workspace
```

`npm run workspace` 一次启动原服务；交互 TTY 自动打开官方 OMP InteractiveMode，普通自然输入走原 HTTP Conversation/Run，终端 UI 不另调用模型。无 TTY 时只保留原服务。`npm start` 等同 `--serve` 网页服务；`npm run agent:dev` 使用同一默认交互入口。也可明确运行 `npm run workspace -- --terminal` 或 `--serve`。已有静态页面仍从原服务交付；本分支没有新建网页。

本机交互入口使用原 loopback local-operator Session。企业终端由已认证的原 Host 调用 `launchWorkspaceOmpWithExistingSession`，复用其现有 Session/CSRF 与可信 ingress 逐请求签名闭包，经私有 fd3 传递白名单请求；Session、CSRF、签名密钥和 Agent Bearer 均不交给企业终端子进程。没有该既有 handoff 时，直接指向企业URL的CLI仍拒绝。每次核对成员、workspace、角色及原服务固定OMP engineScope；旧Pi服务不能成为隐式回退。`/ws-front-status` 显示当前原Run与回复，`/ws-stop` 人工确认后只停前台；后台任务保持单独取消/恢复。终端UI不调用模型、不导入旧终端历史。

普通自然输入默认 `workspaceExecution:false`，只允许问答和已准入的只读工具；即使模型尝试 `workspace_factory_task`，原宿主也拒绝创建任务。明确执行使用 `/ws-execute 公开文字`，官方终端显示本次原文并要求人工确认后才传 `workspaceExecution:true`；Escape不会创建Run或任务，后续原审批仍保留。真实官方TTY、原HTTP和有限无密钥模型替身的7项回归见 [执行意图证据](validation/omp-terminal-fixes-20261015/intent.json)。

终端控制由原Host校验Session与既有Agent绑定同一成员、workspace、角色、实例和接收方，再调用原API；`/ws-resume`、`/ws-continue` 执行准入仍需原Host的价格和预算审查，缺配置明确拒绝。`/ws-approve` 只记录原proposal决定，`/ws-continue` 另行确认后才继续；`/ws-cancel` 控制原Pi任务。OMP前台不是Pi Durable checkpoint，不能重放；其后台业务恢复用 `/ws-business-resume TASK_ID STABLE_REQUEST_ID`，沿用当前原会话的任务引用、原stage和预算。直接 `/ws-task` 仍不派发新通用任务，工厂提交使用已确认的 `/ws-execute`。UI子进程不继承模型密钥或公网代理，原Host的路由未改变。

企业Host集成入口位于 `server/workspace-omp-terminal-host.mjs`。调用方必须已拥有原认证Session和原可信请求闭包；这里不提供登录、取浏览器cookie或创建凭据的命令：

```js
await launchWorkspaceOmpWithExistingSession({
  origin: existingPublicOrigin,
  session: existingAuthenticatedSession,
  conversationId: originalConversationId,
  request: existingNativeSessionRequest, // ({method,path,body,signal}) -> {status,body}
  environment: process.env, // 内部仅挑选终端设置和无密钥模型元数据
});
```

每Run资料副本在正常结束、取消和初始化失败时清理；宿主在worker实际退出后另按该原Run的精确目录前缀兜底，覆盖强制结束，保留原件和其他Run副本。回归证据见 [生命周期清理](validation/omp-terminal-fixes-20261015/snapshot-cleanup.json)。

没有现有模型、成员绑定、已审价格或可确认剩余预算时，服务可以启动保存工作，模型执行明确返回未配置；不会生成凭据、选免费模型或默认启用合成替身。

```sh
npm run workspace -- --check
node scripts/workspace-omp-install.mjs --check
```

配置检查不调用模型；配置存在仍不等于在线模型已验证。运行器检查核对Bun版本／SHA和OMP固定版本。依赖缺失则给准确安装缺口。

沿用原 `PI_PROVIDER`／`PI_MODEL`／`PI_BASE_URL` 与该provider现有安全密钥配置，以及原已授权 `WS_AGENT_URL`／`WS_AGENT_TOKEN`。不接受租约Worker凭据代替成员绑定、不创建principals。额外的 `WORKSPACE_OMP_PROVIDER_COST_JSON` 必须有每百万token美元计价的input/output/cacheRead/cacheWrite；剩余预算未由可信Host确认时保留 `WORKSPACE_OMP_LIVE_BUDGET_VERIFIED=0`。这两个配置不是余额查询或货币支出硬上限。本轮未读取或填入真实密钥，未启用该标志。

原Pi1.1.0保留显式 `npm run agent:pi` 回退，需要它原有的服务绑定和配置。默认入口不会启动回退。旧Pi／私库会话不得自动迁入OMP；历史读取和原已受理后台任务保持原授权边界。

## 工厂能力与审核

普通独立包 `@workspace-agent/pi-factory` 的兼容目录是 `packages/workspace-procurement`。普通模式公开五个工厂／历史读取工具；受控Workspace宿主另明确启用 `workspace_factory_task`，仅提交原 `factory-export` 文书预设。用户是供货工厂，旧买方采购链只是兼容回归。

公开产品资料、客户来源材料和RFQ进入原任务四阶段，生成产品材料、客户匹配证据及待审核开发信。保留稳定requestId、原taskId、原阶段Run、原文书字节／SHA；重载不自动恢复或再提交。来源未独立核验、供货缺项和部分失败保持可见。文书完成不是获客、供货承诺、发送或销售证明。

原网页的人工批准、取消和符合条件的恢复继续走原接口；模型没有批准、恢复、付款或发送工具。受控OMP不暴露任意本机read/bash/eval/task，不授予私库访问，也不读取旧Pi缓存给新引擎。选定公开工厂Skill通过官方加载器加载，包含简短社区写作方法改编和来源记录。

宿主默认注册 `workspace_public_search`：只用固定的官方无密钥 DuckDuckGo provider，每原 Run 最多两次；可由可信宿主明确选择 `WORKSPACE_OMP_PUBLIC_SEARCH_PROVIDER=startpage` 或 `disabled`。拒绝、挑战、超时和空结果保留零来源，不能宣称已连接或发现客户。本轮两 provider 的真实公开查询都不可用；合成来源与 403 回执、原 Run 持久化和文书输入传递已实测。

有已存在的 `/usr/bin/chromium` 时，注册 `workspace_public_browser`；否则准确报告缺少现有浏览器，不自动安装。`WORKSPACE_OMP_BROWSER_BIN=disabled` 可关闭。它只检查公开 HTTPS 页，解析须为公开 IPv4，固定 hostname/IP、独立 profile、禁用页面脚本，确认真实 HTTP 成功才返回页面；不附着用户浏览器、不开放表单/任意代码/下载参数、不忽略证书。已有 Chromium 的脚本禁用、HTTP回执及关闭已在自有合成页验证；未宣称真实客户页面导航成功。

资料工具 `workspace_public_document` 仅在宿主明确设置独立公开目录 `WORKSPACE_OMP_PUBLIC_DOCUMENT_ROOT` 和 `WORKSPACE_OMP_PUBLIC_FILES_JSON` 后注册。JSON 是最多八项 `{id,path,sha256}`，每文件至多64 KiB，支持md/txt/csv及PDF。工具只接受 documentId；目录、符号链接、字节变更、凭据样文本与任意路径均拒绝，原宿主路径不进入工具正文。PDF另校验文件头，复用官方ReadTool内置原生文字提取，不安装解析依赖、不上传、不把二进制或图片给模型。文字提取成功为 `document_read`；原生报告扫描页时返回 `partial_ocr_required` 与 `pagesNeedingOcr`；损坏PDF为 `unavailable`。原生OCR页提示是启发式，`native_hint_only` 和模型可见说明均明确：空提示不证明每页可读或已完整审阅。正文被原ReadTool截断时优先返回 `partial_truncated`、`textTruncated:true`、`pagesNeedingOcr:null` 和 `ocrStatus:unknown_after_truncation`，向模型说明剩余正文与OCR要求未知。OCR尚未执行。重载前按当前 ID/SHA复查缓存；撤销选择或更换同ID字节时，旧正文不能再次进入模型。

`workspace_factory_public_review` 用官方 TaskTool 执行最多两项明确提供的公开文字审阅。固定与父 Run 相同的模型/provider；child工具为空、不递归、不发现私库/项目插件，父子共享原四次模型请求及1600输出 token 额度。原 TaskTool 返回的结果仍属于该原 Run，不产生第二业务任务。外部模型真实价格与余额未验证时，原宿主仍不执行任何自然输入模型调用。

## 实测与缺口

| 范围 | 实际证据／限制 |
| --- | --- |
| 原Conversation→原Run→OMP→工厂原任务 | [核心检查](validation/workspace-omp-core-20261014/README.md)：合成模型，真实HTTP／SDK，单原任务、四阶段、三文书精确SHA |
| 默认入口、独立manifest加载、续聊、取消、恢复和审批 | [初版11项验收](validation/workspace-omp-core-20261014/default-acceptance.json)：真实子进程退出、原预算／stage ID／文书SHA保留；批准与继续分别执行；后续完整组合见受控公开工具检查 |
| 原文书重载、租户／成员／只读拒绝、部分失败 | [工厂文书检查](validation/factory-export-20261014/README.md)，未发送或接单 |
| 内置搜索／read／eval浏览器／取消 | [内置工具检查](validation/omp-builtins-factory-20261014/README.md)；真实DDG连接失败、零来源 |
| 原生OMP子代理分工／取消／回传 | [Task检查](validation/omp-builtin-task-20261014/README.md)：两真实child AgentSession、最大并发2、合成模型、原abort回执 |
| 可选社区插件 | [固定候选检查](validation/pi-community-20261014/README.md)：Pi1.1.0兼容验收不冒充OMP兼容；默认文档转换缺依赖，独立fallback／OCR事实另列 |
| 普通独立工厂包 | [包契约](PI-PROCUREMENT-PACKAGE.md)，普通模式保留宿主其他工具／命令，但不激活受控私库授权 |

当前没有真实付费模型、真实海外候选或完整商业链路验收。五元总额的可控剩余预算没有验证，付费调用为零；价格／预算配置标志不能当本轮实际消费证明。七天未来通知的持续同意和持久收件人权限机制仍待另行批准，未开发或激活。未部署、未合并main、未发送、未创建账户或扩展Worker权限。

2026-10-14初版九项交付状态（所有模型流程验收均为明确有限、无密钥合成模型）：

| 项目 | 状态 | 可交付结果与剩余限制 |
| --- | --- | --- |
| 固定OMP默认统一入口 | 完成 | 官方交互终端与原服务统一启动；固定版本、准确缺配置拒绝 |
| 独立工厂插件加载 | 完成 | 官方manifest实际加载；普通五工具和受控第六提交工具分开 |
| 内置公开搜索／浏览器 | 部分完成 | 原工具接入及拒绝、页面策略已验；真实无密钥搜索失败，零真实候选 |
| 选定公开资料读取 | 完成 | 精确文本／PDF与SHA、撤销与缓存校验；扫描页部分完成，OCR未执行 |
| 原生OMP子代理 | 完成 | 两原生child会话、受限公开文字、共享额度、取消及回传已验 |
| 原任务／审批／取消／恢复／结果 | 完成 | 原HTTP与账本、原ID和预算、准确人工决定／继续及重载均已验 |
| 社区Skill辅助文书 | 部分完成 | 选定简短MIT改编实际加载，覆盖产品／客户／RFQ／报价和跟进草稿原则；上游不可变commit未核验，未接发送序列 |
| 公开资料→候选来源→开发信→人工审核 | 部分完成 | 合成来源及文本／PDF完整链路通过；真实客户来源与真人文书验收未完成 |
| 回归、固定版本与中文交付 | 完成 | 最新33/33，原Pi／Library53/53，原业务17/17，typecheck通过；不冒称生产上线 |

剩余阻塞是未审查的真实模型配置与剩余预算、不可用的真实公开搜索，以及未批准的未来通知机制。企业终端已有原Host内存handoff接线；真实部署的既有Session接入和真实模型仍须分别验证。同伴分支的结果／恢复UI未在本分支验收。

公开工具的逐次原授权、指定文件/来源→原任务三文书、搜索失败与缓存撤销检查见 [受控公开工具](validation/omp-public-tools-20261014/README.md)。默认受控宿主已显式接入上述有限工具；支持但不可达或未配置时保持准确状态。完整Pi私库guard未迁到OMP，也没有为迁移开放私库或任意文件工具。原Pi终端仅显式回退。

PDF回执标记 `extractionPolicy:native-text-hints-v2`。继续会话时除了当前文件ID/SHA，还校验该标记；旧提取策略回执不能带着不准确的完整读取声明再次进入模型。拒绝不会自动重写历史或重跑任务，需要新建公开会话；原历史查看与已受理后台任务的人工控制不变。

前端协作接口沿用原路由：公开 `POST /api/conversations/:id/messages` 需稳定requestId、空inputContext，默认只读；文书执行意图明确给 `workspaceExecution:true`。用 `GET /api/conversations/:id/business-results` 读取原任务／阶段／文书状态，人工恢复用 `POST /api/conversations/:id/business-tasks/:taskId/resume` 的稳定requestId与 `confirmed:true`。终端补同鉴权的 `GET /api/conversations/runtime`、`GET /api/conversations/:id/terminal-status?runId=…` 及 `POST /api/conversations/:id/terminal-controls`；后者固定原状态／取消／批准／继续／恢复操作与精确ID，不能提交任意新任务，写操作保留人工确认及原权限。没有新Store或任务注册表。`server/index.mjs` 仅最小启动接线，未修改供应商traffic loader、readiness或原PiProvider业务引擎。

2026-10-15真实公开网络复测：DDG HTTP403，IANA公开页读取超时，均未取得可用来源；未解挑战或改道。GitHub Actions仍为创建jobs前的 `BuildFailed/startup_failure`，见 [既有Issue16](https://github.com/magicy565-web/workspace-agent/issues/16) 与 [本次CI事实](validation/omp-terminal-fixes-20261015/ci.json)。本地通过不是CI成功，不据此盲改应用。
