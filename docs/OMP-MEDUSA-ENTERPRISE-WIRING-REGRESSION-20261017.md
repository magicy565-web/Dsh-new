# Medusa 与企业资料插件 OMP 接线回归

验收源码基线：`77f5ab5e9d189aa2a3477fa4fc47704dddf141f9`。本轮仅修复实际复现的测试入口过期，并保存开发验收说明；插件、Host、授权、默认入口和交互输入脚本源码均未修改。使用 Node 24.19.0、固定 Bun 1.3.14 与原生 OMP 18.10.4。没有调用真实模型、Docling、Medusa 或其他外部业务服务，没有读取真实凭据。

`test/workspace-omp-session-startup.test.mjs` 原先运行 `npm start` 等待 HTTP，复现为 `NATIVE_OMP_TTY_REQUIRED`，登录与撤权断言未执行。默认入口现为原生 OMP TTY；测试改用现有 `npm run legacy:workspace` 并核对该脚本的启动输出。修正后原始签名登录、CSRF、原生 SDK 工具读取、无绑定拒绝、退出撤权及 Session 轮换拒绝全部执行通过。默认入口的独立回归仍确认不隐式启动 HTTP。

| 对象 | 实际源码/加载结果 | Host 接线与权限证据 | 外部服务边界 |
| --- | --- | --- | --- |
| workspace-medusa-catalog 0.1.0 | pack 闭包、原 SDK 发现/加载通过；注册 status、preview、reconcile 三工具；显式 disabled 与 no-plugins 后不被发现 | business-v1 原签名 Host / fd3 / Session；读取当前授权产品 revision/sourceHash；来源变更与伪造 receipt 在恢复前被拒绝 | 测试使用注入 fetch 替身，原 Workspace API 是实际本机 HTTP；没有真实 Medusa 登录/请求。无配置的 preview 明确 configured=false |
| workspace-enterprise-context 0.2.3 | pack 闭包、原 SDK 发现/加载通过；普通安装注册七工具但不获得 Host 能力；disabled/no-plugins 不发现 | enterprise-context-v1 原签名 Host / Artifact / Library；精确 document revision/version、artifactId/version/SHA、接收方和 purpose；现有 live authorizeParserTransfer 负责完整文件传输授权 | Docling 为实际本机 HTTP 替身；缺安全连接或来源选择时 unconfigured 且 Docling 请求数 0。Mem0 保持 disabled |
| 企业资料生命周期 | 原生 Session 续用、禁用、物理卸载、独立安装及 compaction 回归通过 | 旧私有历史在禁用/卸载、来源撤销或 proof 缺失后拒绝；新无工具 Session 可工作；worker 退出后的 Node 最终门继续重验所有来源 | 模型决策均为有限合成响应；不是付费模型或真实服务连通证据 |
| 来源及取消 | 下载前后、响应返回、模型披露、最终交付、恢复阶段的版本/SHA/权限变化测试通过 | 原 Session 注销、Run 取消、在途 Docling HTTP 与等待中的传输授权均沿原 Host 取消；超时后不晚发文件 | 仅临时合成文件、临时原 Store/Artifact 与本机接口；日志、Session 和运行数据均不入 Git |
| Medusa 编辑边界 | collection/sales_channels 无损编辑及部分 variant 关联保留的现有五项测试通过 | Library 草稿投影和 Medusa 原生产品保持各自数据权威；OMP 只有只读预览/回读工具 | 未宣称真实产品创建、编辑、发布、库存或销售验收完成 |

当前 Medusa business-v1 与 enterprise-context-v1 是独立且互斥的既有 Host profile；两插件可由同一原 SDK 独立加载，本轮未验证同一 Session 同时可信绑定。默认本地入口仍只启用 local-materials，显式 business manifest 本身不提供签名 Host 或来源授权。企业资料普通 Host 暴露五个既有状态/解析/禁用 Mem0 工具，两个 structured-memory 方法仅在原 Host 明确绑定时加入，和 Mem0 向量服务无关。

运行时完整性：`verifyWorkspaceOmpRuntime` 实测 Bun binary SHA256 等于已审计值 `a8f9ebd1770ddc8e55dab7a68d4ec1ec1eebf374bb97cc65cf2c3cb373fc6791`，版本 1.3.14；OMP package manifest 为 18.10.4，固定 lock integrity 为 `sha512-JZqUebDzrBNIdtW5ztWQAre67QnCV6xVZ9/R2ZdOX5zGFUO7d73Nd5TYqTRRQZrjKD+bUnXLkqk3IE1cu4aDZQ==`。这不是重新验证发布者 provenance。交互输入脚本 SHA256 仍为 `301cd56b4d0b51e6f05b6bd9b17ab9f1dc4cd763870324e3948c49db012b2e81`。

实跑合计 **151 passed、0 failed/cancelled/skipped**；另有构建/pack 检查及两插件逐项 native loader enable/disable/no-plugins 检查通过，不重复计入测试数。所有命令从仓库根目录执行，使用清空的进程环境：

```sh
env -i PATH="$PATH" HOME=/tmp node scripts/build-omp.mjs
```

该构建包含 `check-plugins.mjs --pack`，全部 14 个既有插件的包闭包、Bun 编译及原 OMP 发现加载通过；构建未执行业务工具或模型请求。

```sh
# 48 passed
env -i PATH="$PATH" HOME=/tmp node --test test/workspace-omp-unified.test.mjs test/workspace-omp-plugins.test.mjs test/enterprise-context-extension.test.mjs test/medusa-catalog.test.mjs test/medusa-catalog-edit.test.mjs test/enterprise-context-oss.test.mjs test/enterprise-disclosure-policy.test.mjs test/enterprise-disclosure-revoke-race.test.mjs
# 97 passed
env -i PATH="$PATH" HOME=/tmp node --test test/enterprise-context-host.test.mjs test/enterprise-context-unified-egress.test.mjs
# 2 passed
env -i PATH="$PATH" HOME=/tmp node --test --test-name-pattern='Medusa|medusa' test/workspace-omp-business-integration.test.mjs
# 4 passed，包含本轮修正后的原 Host 启动回归
env -i PATH="$PATH" HOME=/tmp node --test test/medusa-catalog-http.test.mjs test/enterprise-disclosure-http.test.mjs test/workspace-omp-session-startup.test.mjs
```

后续真实服务开机验收仍需另行执行：

- 在实际受信任 Host 内核对固定源码和运行时、签名 Session、模型接收方与当前 Library 选择；缺绑定/配置仍为 unconfigured。
- 用明确选定的合成资料验证真实 Docling 完整文件授权、精确 artifact/version/SHA、返回后的复核、撤权和取消；本机 HTTP 替身不计作真实 Docling 连通。
- 在 Medusa 真实服务上先做只读状态与精确来源回读；合成 draft 创建/无损编辑及重启持久化只在另行授权的现场验收内执行，未知写结果先人工核查，不自动重试。
- 真实模型、两 profile 同一 Session 同时接线以及交互输入补丁的现场安装均未由本轮验证。无部署、网络、账号或服务配置变更。
