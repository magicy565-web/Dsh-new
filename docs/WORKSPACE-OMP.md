# Workspace 工厂开发入口

开发默认前端选定官方 `@oh-my-pi/pi-coding-agent@18.10.4`，Bun 固定1.3.14。Workspace原HTTP、身份、Session、Store、Runtime、审批、业务任务和Pi Durable阶段继续持有业务执行权威。OMP通过SDK和受控工厂插件调用这些原接口；不另建任务队列或执行同一业务任务的第二引擎。

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

交互终端目前使用原 loopback local-operator Session。它先核对原服务的固定 OMP engineScope；旧 Pi 服务不能成为隐式回退。企业身份仍走原网页/nativeSession/CSRF，不把 Agent Bearer 标记为 Session。`/ws-front-status` 显示当前原 Run 与回复，`/ws-stop` 由原人工确认停止当前前台回答；已受理业务任务保持单独取消/恢复。终端 UI 不持模型密钥、不执行自己的模型流，也不导入旧终端历史。

UI-only终端不能证明后台模型现金余额，因此不从通用 `/ws-task`、`/ws-resume`、`/ws-continue`、`/ws-business-resume` 命令派发执行；它们准确返回未配置。自然输入统一经过原OMP宿主准入，后台恢复/分别继续仍用原已审核网页/API。原状态、确认取消和仅记录决定的审批保持原权限；批准决定不等于已执行。UI子进程不继承模型密钥或公网代理，原宿主的公网/模型路由未改变。

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

资料工具 `workspace_public_document` 仅在宿主明确设置独立公开目录 `WORKSPACE_OMP_PUBLIC_DOCUMENT_ROOT` 和 `WORKSPACE_OMP_PUBLIC_FILES_JSON` 后注册。JSON 是最多八项 `{id,path,sha256}`，每文件至多64 KiB，支持md/txt/csv及PDF。工具只接受 documentId；目录、符号链接、字节变更、凭据样文本与任意路径均拒绝，原宿主路径不进入工具正文。PDF另校验文件头，复用官方ReadTool内置原生文字提取，不安装解析依赖、不上传、不把二进制或图片给模型。纯文字提取成功为 `document_read`，扫描页返回 `partial_ocr_required` 与 `pagesNeedingOcr`，损坏PDF为 `unavailable`；OCR尚未执行。重载前按当前 ID/SHA复查缓存；撤销选择或更换同ID字节时，旧正文不能再次进入模型。

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

本轮九项交付状态（所有模型流程验收均为明确有限、无密钥合成模型）：

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
| 回归、固定版本与中文交付 | 完成 | 最新31/31，原Pi／Library53/53，原业务17/17，typecheck通过；不冒称生产上线 |

剩余阻塞是未审查的真实模型配置与剩余预算、不可用的真实公开搜索，以及未批准的未来通知机制。企业终端目前未接入企业Session；企业用户继续用原认证网页/API。同伴分支的结果／恢复UI未在本分支验收。

公开工具的逐次原授权、指定文件/来源→原任务三文书、搜索失败与缓存撤销检查见 [受控公开工具](validation/omp-public-tools-20261014/README.md)。默认受控宿主已显式接入上述有限工具；支持但不可达或未配置时保持准确状态。完整Pi私库guard未迁到OMP，也没有为迁移开放私库或任意文件工具。原Pi终端仅显式回退。

前端协作接口沿用原路由：公开 `POST /api/conversations/:id/messages` 需稳定requestId、空inputContext；文书执行意图明确给 `workspaceExecution:true`。用 `GET /api/conversations/:id/business-results` 读取原任务／阶段／文书状态，人工恢复用 `POST /api/conversations/:id/business-tasks/:taskId/resume` 的稳定requestId与 `confirmed:true`。终端只补同鉴权的 `GET /api/conversations/runtime` 公开引擎标识与 `GET /api/conversations/:id/terminal-status?runId=…` 窄回执，严格核对会话/Run/成员归属，避免读取整个bootstrap。没有新Store或任务注册表。本分支未加入或验收同伴分支的结果／恢复UI。`server/index.mjs` 仅最小启动接线，未修改供应商traffic loader、readiness或原PiProvider业务引擎。
