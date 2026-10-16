# Session 恢复及原件传输验收（开发分支）

基线 PR91 `f7353fead48da4ce4cddcf91230a28d3caf6e7b7`，独立分支 `codex/enterprise-context-session-transfer-20261016`，单 writer。先完成恢复门禁，后处理原件传输授权；未覆盖其他支线。

## Checkpoint 1：压缩恢复凭据门禁

可复跑命令 `node test/fixtures/enterprise-context-legacy-repro.mjs`（显式运行旧缺陷；非默认测试，只有合成key/本机HTTP/有限模型，临时源码副本运行后清理）。该脚本通过已取得的历史 Git 对象恢复完整旧源码，共用当前锁定依赖，不继承 provider/service 凭据环境、不改工作树。当前负例命令 `node --test --test-name-pattern="legacy unscreened credential|screened parse restores" test/enterprise-context-host.test.mjs`。

实际旧版复现来自 `ba4f3789174b36ba7497eed707efe6ac513b1f14` 的完整源码临时 checkout（插件0.2.0），Node24.19.0、Bun1.3.14/OMP18.10.4，原 Host/签名 Session/Library/Artifact、本机 HTTP Docling 替身、有限模型。HTTP200 返回非通用 secret 格式的随机合成 key。旧版实际 parse 接受该值；SDK SessionManager.appendCompaction 把正文带入合成摘要并移除上下文中的 toolResult；恢复成功且摘要触发1次有限模型请求、0次真实模型请求。测试不输出 key/正文，临时 journal 不提交。

PR91 基线对应回归也失败：预期恢复模型请求0，实为1。新实现先由 Node 对完整响应/接受正文执行既有已知凭据筛查，再给 parse proof 增加 HMAC-SHA256 筛查凭证。MAC 使用当前 Node 内连接 key，绑定来源/正文 hash/scope/native Session 全部字段和固定用途域；key 不随 proof 或 RPC 发送。不靠版本号、标记或来源可读性认定已筛查。恢复沿既有 snapshot 的 control.check 首先核验证据，缺失/伪造/正文或 Session 换绑均拒绝；压缩摘要不会先进入模型。当前连接 key 改变也拒绝旧证据，故障关闭。未引入持久密钥、配置、迁移权限或第二套存储。

旧会话不自动迁移，拒绝后原 journal 完整保留；不调用模型清洗。安全新会话通过实际 SDK 压缩后续接同一 native Session，验证缓存不再请求 Docling。旧 status 的完整多来源要求仍独立存在。

最终命令、结果与第二阶段在后续 checkpoint 补齐。真实 Docling/模型/ERP 未验收，Mem0关闭，原 Artifact 保存仍 `SESSION_READONLY_EXECUTION_REFUSED`。无TED重试、网络变更、main修改合并、强推、部署或真实凭据读取/创建。

第一阶段完成：`node --test test/enterprise-context-host.test.mjs` 49/49；`node --test test/enterprise-context-oss.test.mjs test/enterprise-context-extension.test.mjs` 14/14；`npm run build`（含十一包 `plugins:pack-check`）通过，仅已有 bundle大小提示。命令及本地日志hash见 `checkpoint-1-checks.json`，未提交运行日志/会话。

## Checkpoint 2：现有 Host 内的完整原件传输许可

固定复用源为 PR87 `b7bd2410a623a9d7ec654a0a826ac3778cae64c3` 的 `server/enterprise-context-original-authority.mjs`，该文件 SHA256 `c1bddb38f504511a98c515614c8593f84d5cf789eeaa4eb18f5dc16d6c23d1fa`。选择性采用其 `checkParserGrant`/`verify` 的“明确原件许可 + 异步许可后再次检查现态”语义，放入已有 PR91 `workspace-enterprise-context-host.mjs`；未导入旧 authority 实例/模块、旧 Host 或 PR86 冲突分支。原 bridge 持续校验真正活动 Run，原 Library/Session 边界继续检查现态。

模型字段读取许可不再隐含完整原件传输许可。可信 Node binding 须注入现有 `authorizeParserTransfer(request)` 实时检查器，精确接收 file/artifact ID、文件 version/SHA、document ID/revision/version、Session/member/workspace、模型、native Session、固定 Docling `origin/v1/convert/file` 接收方，固定 `purpose:document-extraction` 和 `transfer:complete-file`。缺函数、非严格true、异常、超时、中止均拒绝；没有创建生产许可、配置凭据、权限记录或审批。测试检查器仅内存合成，不能视为实际企业授权。

下载前、下载后发送原始字节前、返回后均重新调用检查，异步许可返回后再查原 Session/来源。parse proof 复用/模型披露/最终交付也检查实时许可。绑定创建时复制并固定传输配置，接收方和用途计入原 scope。检查器等待沿原 Run 取消，并以既有 timeoutMs 限制；不合作/迟到许可不会发送文件，检查器异常文本丢弃为静态错误码。没有新 AgentLoop/数据库/队列/权限服务。

首轮新增13项实际 Host/SDK 与本机 HTTP 测试通过；另对缺许可不下载、不合作取消、迟到许可超时、私有异常隔离4项通过（其中3项重跑，新增异常用例1项）。完整 Host 组63/63、适配器/扩展14/14、原ERP/插件/Library/预算兼容组113/113均通过，0失败/跳过/取消。最后增强摘要确含旧正文及静态拒绝码断言后，受影响压缩正/负例2/2重跑通过；可复跑旧版脚本1/1，真实模型请求0。`npm run build`（含十一包打包闭包）通过。

## 最终验证与边界

```sh
node test/fixtures/enterprise-context-legacy-repro.mjs
node scripts/enterprise-context-preflight.mjs
node --test test/enterprise-context-host.test.mjs
node --test --test-name-pattern='legacy unscreened credential|screened parse restores' test/enterprise-context-host.test.mjs
node --test test/enterprise-context-oss.test.mjs test/enterprise-context-extension.test.mjs
node --test test/free-trade-host.test.mjs test/free-trade-native.test.mjs test/free-trade.test.mjs test/workspace-omp-plugins.test.mjs test/workspace-omp-plugin-uninstall.test.mjs test/workspace-omp-local-budget.test.mjs test/factory-materials-read.test.mjs
npm run build
```

实际组件：Node24.19.0原Host、签名Session/member、Conversation/Run/取消、Library/Artifact/Store、Node↔Bun RPC、Bun1.3.14/OMP18.10.4原生loader/tool/Session/compaction、loopback HTTP。独立仓库外十一包发现、禁用/卸载、同会话恢复、既有来源/授权和readonly门禁均有实际SDK回归。Docling multipart字节真实经过本机HTTP，但parser/OCR响应、所有身份/资料/许可及模型决策均合成；没有真实Docling/模型/ERP验收。190个最终组的不同顶层工程用例是测试覆盖，绝不是上线结论；首轮、复现及定向重跑不重复累加。

仍有阻塞：生产完整原件传输许可必须由现有可信Host另行提供，当前没有创建或扩大任何许可；真实Docling/模型/ERP版本、权限和业务质量未验；Artifact保存仍在原admission被`SESSION_READONLY_EXECUTION_REFUSED`拒绝。Library继续事实权威，Mem0固定禁用。未引入PR90共享Artifact、旧PR86 Host、AgentLoop/数据库/队列/审批、workspaceExecution旁路，未重试TED/改变网络/读取聊天密钥/创建实际配置凭据/付费/部署/修改或合并main/强推。只推开发分支源码、测试及验收材料；运行journal、上传原件、解析正文、凭据和日志均不入Git。

## 提交与源码包 checkpoint

- 第一项提交 `b86faf9240852eb42632d82748cad4e4c5376fba`，已push独立开发分支。
- 第二项源码提交 `e0c4e7bb19daae23b492f4f2a016bd256a4f5347`，已push同一分支；后续仅补验收元数据。最终源码/锁文件hash见 `source.json`，各命令与本地日志hash见 `checks.json`，无日志内容入库。
- `python3 scripts/package-pi-source.py --ref e0c4e7bb19daae23b492f4f2a016bd256a4f5347 --output /tmp/enterprise-context-session-transfer-source.zip` 实际构建提交源码包，2192个源码文件逐个通过ZIP manifest SHA256校验。归档SHA256 `982a80543dad19d69479c87877cf00161ddb49c4df2fe8a85d7c817445abaccd`；源码包是本地验收产物，未推Git，详细元数据见 `package.json`。源码包明确 `launchReady:false`，不包含依赖安装目录或原运行资料。插件单包闭包由build前置 `plugins:pack-check` 检查。
- 远端复核：PR91父分支仍为指定 `f7353fea…`；本轮未修改该父分支或main，仅新分支前进。Draft PR以该父分支为base，便于单独审查本轮增量。
