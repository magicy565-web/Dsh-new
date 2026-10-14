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

`npm run workspace` 一次启动原网页服务。`npm start` 和 `npm run agent:dev` 使用同一默认入口。已有静态页面从原服务交付；本分支没有新增前端。打开服务打印的本机地址，新公开会话走OMP前端。

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

原网页的人工批准、取消和符合条件的恢复继续走原接口；模型没有批准、恢复、付款或发送工具。受控OMP默认不暴露任意本机read/bash/eval/task，不授予私库访问，也不读取旧Pi缓存给新引擎。选定公开工厂Skill通过官方加载器加载，包含简短社区写作方法改编和来源记录。

## 实测与缺口

| 范围 | 实际证据／限制 |
| --- | --- |
| 原Conversation→原Run→OMP→工厂原任务 | [核心检查](validation/workspace-omp-core-20261014/README.md)：合成模型，真实HTTP／SDK，单原任务、四阶段、三文书精确SHA |
| 默认入口、独立manifest加载、续聊、取消、恢复和审批 | [最新11项验收](validation/workspace-omp-core-20261014/default-acceptance.json)：真实子进程退出、原预算／stage ID／文书SHA保留；批准与继续分别执行 |
| 原文书重载、租户／成员／只读拒绝、部分失败 | [工厂文书检查](validation/factory-export-20261014/README.md)，未发送或接单 |
| 内置搜索／read／eval浏览器／取消 | [内置工具检查](validation/omp-builtins-factory-20261014/README.md)；真实DDG连接失败、零来源 |
| 原生OMP子代理分工／取消／回传 | [Task检查](validation/omp-builtin-task-20261014/README.md)：两真实child AgentSession、最大并发2、合成模型、原abort回执 |
| 可选社区插件 | [固定候选检查](validation/pi-community-20261014/README.md)：Pi1.1.0兼容验收不冒充OMP兼容；默认文档转换缺依赖，独立fallback／OCR事实另列 |
| 普通独立工厂包 | [包契约](PI-PROCUREMENT-PACKAGE.md)，普通模式保留宿主其他工具／命令，但不激活受控私库授权 |

当前没有真实付费模型、真实海外候选或完整商业链路验收。五元总额的可控剩余预算没有验证，付费调用为零；价格／预算配置标志不能当本轮实际消费证明。七天未来通知的持续同意和持久收件人权限机制仍待另行批准，未开发或激活。未部署、未合并main、未发送、未创建账户或扩展Worker权限。

OMP内置搜索、浏览器和子代理的隔离诊断已执行，默认受控网页尚未开放这三类工具；真实公网搜索仍受阻。完整Pi私库guard没有迁到OMP，也没有为迁移开放私库或任意文件工具。OMP交互TUI与原Run账本没有完成衔接，未作为默认入口交付；原Pi终端仅显式回退。

前端协作接口沿用原路由：公开 `POST /api/conversations/:id/messages` 需稳定requestId、空inputContext；文书执行意图明确给 `workspaceExecution:true`。用 `GET /api/conversations/:id/business-results` 读取原任务／阶段／文书状态，人工恢复用 `POST /api/conversations/:id/business-tasks/:taskId/resume` 的稳定requestId与 `confirmed:true`。本分支实测这些HTTP接口；没有加入或验收同伴分支的结果／恢复UI。`server/index.mjs` 仅最小补OMP启动选项和未配置受信adapter接线，未修改供应商traffic loader、readiness或原PiProvider业务引擎。
