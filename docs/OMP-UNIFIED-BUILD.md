# OMP 单入口云构建验收

## 固定来源与范围

- 唯一源码基线：PR93 HEAD bacd9e9b1f07817b573783e7fbb9e36b43405075
- 开发分支：codex/omp-unified-cloud-build-20261016
- 在当前 dot 云电脑的独立目录获取、安装、构建；没有访问旧 Workspace 服务器或后台
- Git 直连/代理没有可用无交互认证，使用现有 GitHub 连接器按固定 SHA 取得 205 份必要文件，全部核对 Git blob SHA；另外补取两份原有纯配置/价格约束模块
- 这是有范围的源码快照，不是完整 git clone。未下载历史 deliverables、运行证据、巨型 zip、旧前端/微信/部署产物、无关旧 Host 测试与服务。完整仓库的其余文件由以原提交为父的开发提交保留，不删除
- 没有 cherry-pick 其他候选分支或新增业务能力，没有新 AgentLoop、队列、数据库、Artifact 保存流程或模型服务

## 入口变更

npm start / npm run workspace / npm run dev / npm run agent:dev，以及 START.command、START.bat、start.sh 统一到 scripts/workspace-omp.mjs。

默认路径直接运行固定官方 OMP CLI。项目 manifest 先发现/校验，只把已启用的声明扩展传入官方 --trusted-extension；关闭环境/项目扩展自动发现。原 local CLI 通过同一入口的显式资料参数复用，原私有 Session 和模型预算约束保持。

旧 HTTP 启动器保存在 scripts/workspace-omp-legacy.mjs，仅 legacy:workspace 显式调用。默认入口拒绝 --serve，绝不静默落回旧服务。

原 local Session 对旧 public/HTTP profile 的导入改为按选定 profile 延迟加载，避免本地原生路径仅因加载 Session 模块而要求旧 Pi 前端依赖。选定旧 profile 时仍使用原代码和权限检查。

## 真实验证

2026-10-16，Node 24.19.0 / npm 11.9.0，Linux x64：

1. 固定官方 Bun 1.3.14 安装成功，二进制 SHA256 匹配仓库 runtime-audit.json。
2. OMP 18.10.4 的固定依赖 npm ci 成功；ignore-scripts / omit optional，无可选本地模型组件。
3. npm run build:omp 成功：11 包源码/资源/依赖/pack 闭包、11 包 Bun 编译、官方 OMP 对每个包的独立发现和 factory 注册。
4. 官方发现器验证显式启用可加载、关闭优先、不启用的已卸载插件不阻塞；未执行任何注册的业务工具。
5. npm run test:omp：4 项通过，覆盖统一入口/快捷启动、11 包状态、关闭/卸载/缺失包 fail closed、预览输入和 shell 门控。
6. npm run workspace -- --check：OMP/Bun integrity verified；11 包可发现；仅 workspace-local-materials 启用；其他绑定能力明确 unconfigured；不连接 8787 或任何 WS binding。
7. npm start 在真实 PTY 进入官方 v18.10.4 TUI，显示 no-model 与离线状态，并实际加载本地插件。它是原生终端前端；没有用旧 Workspace 网页替代。

以上均为零真实模型调用、零付费、零外部业务执行。编译/注册成功只证明代码装载，不证明外部企业/商店服务成功。

## 当前环境阻塞，未冒充通过

原生持久 Session 的三项既有回归仍失败/受阻：
- workspace-omp-local-entry 中实际持久会话续聊
- workspace-omp-plugin-uninstall 的物理卸载后持久恢复
- workspace-omp-plugins 的跨回合原生文件会话

其中明确的底层错误为 OMP native file lock 的 Operation not permitted (os error 1)。云执行环境拒绝其临时合成 Session 的原生锁；受支持的提权执行入口也在初始化阶段因只读文件系统失败。没有修改 vendor、关闭/绕开文件锁或把持久模式改成内存后宣称通过。恢复/持久写入应在允许该原生锁的受支持环境重跑原命令。

```sh
node --test test/workspace-omp-local-entry.test.mjs test/workspace-omp-plugin-uninstall.test.mjs test/workspace-omp-plugins.test.mjs
```

## 插件覆盖

基线已有 11 个规范包，此次全部保留并逐个原生加载：
workspace-procurement、workspace-factory-materials、workspace-factory-customers、workspace-factory-inquiries、workspace-factory-ingestion、workspace-market-validation、workspace-shopify-product、workspace-local-materials、workspace-plugin-info、workspace-free-trade、workspace-enterprise-context。

默认 local-materials 在普通 TUI 仅注册公开草稿工具，没有 selected-file Host，因此不开放文件读取、owner references 或企业资料。完整本地资料能力继续需要显式选定输入/输出和原 Session 边界。其他业务插件没有客户端、成员授权、外部配置或新的批准；发现/独立注册通过，业务能力仍禁用/unconfigured。免费贸易/ERP、企业资料/Docling 均未真实调用，Mem0 保持关闭。

Muse Bridge/Marketplace 等基线其他模块未被包装成虚假的新插件。Brain/Medusa 候选未通过全部审查，本轮不将它们接入共享 Host/Artifact，也不把候选功能计入这 11 包。

## 使用与界面边界

TUI 启动使用官方 CLI + --no-session --no-tools --no-extensions --no-skills --no-rules --no-lsp 和明确扩展 allowlist。隔离空 HOME/agent 目录在退出时清理，fetch 被预加载门控禁止；输入门控返回 handled，模型前门控再次拒绝。没有真实 keys、模型配置、登录、权限扩张、部署、main 修改/合并或强推。

本轮仅提供 no-model 界面，不承诺已具备真实企业运行或持久恢复。不会因屏幕出现插件名称或工具数而声称相关外部服务已配置。
