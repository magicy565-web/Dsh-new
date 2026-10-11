# TT041 会话式界面开发候选

本候选继续原 V22 源码与固定 PR28 后端，不构建第二运行时。默认进入已保存的最近会话；产品／资料沿原 Library 修订引用，原任务、回执和采购回复留在对应会话。目标、活动与资料入口按需打开，320／390 px 只验证了抽屉的 DOM 行为，尚无本轮视觉浏览器验收。

## 本机源码与边界

- 开发目录：`C:/Users/Administrator/Documents/Codex/2026-10-12/task/workspace-commerce-pr28`，分支 `codex/v22-conversation-integration-20261012`。
- 后端固定基准：PR28 `1a669dc81e6e3dab6fa11d3fbf0afbced08f8c39`，tree `cdb91b1f2c86991fbf055860c63fdf356d4ae2fb`。本候选对该基准没有 `server/` 或 `deploy/` 变更。
- 原 `task/workspace-agent` 在 PR22 `78f1553`，其 `CommerceWorkspace.tsx`、`commerce.css` 和未跟踪的 `HostedSupplyFacts.tsx` 草稿保持原样。另一个任务的 `task-2/integration-worktree` 在固定 PR28，读取时工作树干净，没有争抢后端文件。
- PR30 安全修复源码和历史证据保留；其独立资源／供货页面不再挂载。旧 `/commerce` 入口映射到原 Library。PR30 历史 14/14 不计入本轮测试；对应旧页面 DOM 测试仅为历史源码，本轮会话测试不调用该页面。
- 本机未找到完整可启动的当前原 Harness。现有应用源码、overlay 和审核过的后台材料不等于完整原 Host。已核验的 Downloads 交接 ZIP 是 3,110,485 字节的应用包，不能充当声明为 74,303,280 字节的完整归档。

## 实际接续行为

`App` 继续使用原消息、ConversationLibraryReferences、TaskRunCard、MuseMessageFiles、GoalComposer、目标与活动组件。主导航为会话、目标、资料、活动和搜索；不自动创建新会话或模型任务。原 CloudControl 的真实适配器保留，但在会话内显示对应任务与原命令表单，不以独立三类业务面板作为默认界面。

首次加载最近会话会尊重已打开的设置／资料对话框、草稿和正在保存的操作，避免覆盖用户意图。目标返回自身的原会话。原页面、Muse、CloudControl 和采购操作的 dirty 状态汇总到同一导航保护。

`MuseConversation` 只消费原 `muse-delegations` 合同：准备公开范围只落草稿；范围批准与派发分别确认；刷新沿同一订单；停止等待原执行端确认；只有原 Session 持久收到同一回执哈希后才提供人工验收。GET 不可读／格式不符／viewer 都不开放写操作。普通应用没有已审查的原生绑定时显示不可用，不能借此创建普通模型 Run。订单、尝试、fence 与租约放在展开详情，领取不表述为模型启动。

`ConversationProcurement` 读取服务端授权过滤的需求列表。仅主动共享给当前商家的原需求可由用户确认关联到其原会话，原修订与共享哈希固定在确认时；给原采购方的回复上限对齐服务端 2400 字。共享引用和商家回复是原会话中的惰性记录，不派发 Muse，也不把私有资料转成公开授权。

未知提交结果在按空间／用户／角色／会话限定的浏览器记录中保存原请求与正文。明确点击核对才重试；重新加载不自动派发。批准／派发／验收严格采用后端字段，不附加被合同拒绝的 requestId。浏览器记录不保存凭据或 CSRF，不是另一队列或授权来源。

## 本轮验证

| 本轮实际运行 | 结果 | 证据含义 |
|---|---:|---|
| 当前 TypeScript、Vite production build | 通过 | 59 modules；JS 497.68 kB，gzip 140.83 kB；不表示原 Host 已启动 |
| 会话专项 DOM／原存储与本机 HTTP | 12/12，0 skip | 精确资料修订、对应原任务与文件字节、目标／活动、手机抽屉 DOM、初始设置对话框保护、原 Muse 分步操作、共享采购与回复 |
| 完整原 V22 UI DOM 回归 | 19/19，0 skip | 包含企业 CSRF／失效清理、viewer、资料编辑冲突、丢失响应、诊断重连、原动作审批和一次执行、选定任务输入、目标与有界定时草稿 |
| 未修改的原 Native 磁盘和采购 MCP 回归 | 3/3，0 skip | 原订单／task／attempt／fence、失效租约和迟交拒绝、确切文件版本与 SHA、磁盘重开、私有买方共享／回复／撤销 |

前两组 DOM 使用 production bundle 和临时真实 NTFS Store；普通应用 HTTP/MCP 是原实现。原 Native UI 使用未改的 Native binding、WorkerDesk、Store、artifact 与原 relay 字节，但 Bootstrap／Session transport、已配置 actor、Muse sender 和缺失 Harness error helper 是明确标注的离线夹具。它没有启动完整原 Host，没有真实账号、外部联系、真实模型研究、唤醒或独立业务验收。

原 19 项测试更新的是已确认导航／抽屉的断言及异步写入后等待，原审批、重复提交、权限与持久化断言保留。新测试专门复现了活动对话框被初始导航关闭的问题。初轮失败日志在本机 evidence 中保留；本目录收录最终通过日志，不把初轮或历史结果算作当前通过。

`npm run test:conversation:ui` 先构建并运行 12 项专项；`npm run test:ui` 仍运行原 19 项。后台 runner 排除依赖 production build 的 `.dom.test.mjs`，防止未构建时误跑界面套件；后台实际测试没有删去。本轮未重跑全部后台套件，上游 PR28 的 94 pass／1 Windows symlink skip 是该后端任务的记录。

## 离线交付和剩余条件

使用原 `scripts/package-release.py --application-overlay`，含当前源码、构建产物和原 Host overlay；包的 `launchReady:false`、`nativeSourceArchiveVerified:false` 和外部依赖门槛保留。完整 Harness 和 `--light` 源归档门槛没有绕过。精确本地 commit／tree、包字节／SHA、逐文件复核与解压 HTTP 结果在本机交付 manifest 和交接记录中给出。

华为生产服务器目前由用户主动关机；本轮不排查其可达性，不把关机超时当作 Connector 故障。完成本地交付后由父会话通知用户开机，另行确认部署／验收。

尚需当前完整原 Host 源码与启动验收、用户原 Muse Connector 的实际 claim／heartbeat／文件提交与原 Session 回传、实际账号模型启动／唤醒证据，以及真实结果的人审。两个账号使用双 Worker 还是单 Worker 切换仍待用户决定；原挂载保护、一人一 Worker、v2 绑定审查、Dot epoch39／历史任务21均未改动。任何部署、生产重启、付费、权限、凭据和授权更新仍需新的明确确认。

浏览器工具当前返回 `Transport closed`，没有本轮手机截图。指定参考图未实际落盘，没有像素还原。Library 官方物化失败，保留其身份／版本元数据规则，没有改走猜测 URL、部分字节或去掉元数据的下载。
