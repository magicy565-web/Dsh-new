# 统一原生 OMP 的结构化记忆整合（2026-10-16 UTC）

后续独立复核发现本报告的 `9e60b481` 未覆盖过期 memory summary 和旧空查询摘要。两个真实 SDK 反例及模型前修复见[compaction 修复报告](OMP-MEMORY-COMPACTION-FIX-20261016.md)；下文 306/19 是该轮历史结果，不能作为新反例已通过的证明。

## 固定来源与隔离

- 基线：`977b1ad3bcd969784d51bb77ddd4c163c3911e39`，`codex/omp-unified-cloud-build-20261016`。
- 择取来源：PR87 最终 `81339dffdbd90c4b328c20e7b20e660cf78ce7f1`；不是整支合并。
- 新分支：`codex/omp-structured-memory-integration-20261016`，独立 `/workspace/omp-structured-memory-integration` worktree。原 PR87 工作区、分支和未跟踪 `.cache/` 保留。
- Node 24.19.0；复用相同锁定依赖的官方 Bun 1.3.14、OMP 18.10.4。没有改依赖/锁、vendor、原生锁、安全或网络设置。运行依赖通过忽略在提交之外的本地链接复用，不提交 node_modules。
- 只提交源码、测试、说明和授权模型文档。不提交原始日志、会话、Store、合成文件、模型配置或任何凭据。

## 接入的既有边界

从 PR87 择取 memory ledger、disclosure policy、OpenFGA 薄适配，仍由原 `createApp` 创建，使用原 Store/Library singleton 和原路由。没有增加数据库、权限 registry、任务队列、调度器或 Agent Loop。grant 保留全部 await、pending/revision/requestId/fingerprint CAS、迟到 tuple 补删及补删失败的明确错误。

扩展现有 `plugins/workspace-enterprise-context` 和 `enterpriseContext` RPC/Node Host。没有恢复 `packages/`、旧 `enterprise-context-original-authority` 或 PR87 的旧 Host/client 路径。插件不导入 server；Docling OSS transport、PR93 的 parse 签名域及既有证明格式保持不变，ERP 继续归属 free-trade，Mem0 始终禁用。

只有可信 Host 显式允许各方法，且具有原有企业身份、完整选定来源和安全 Docling 绑定，才注册 structured lookup/remember。Node 从真正 Run/Conversation 取得本轮身份和 requestId；模型/RPC 不提供这些权限。写入在原 Store 事务内再次检查原 Run、Session/role/owner、来源和政策，避免排在取消之后的写入继续提交。没有自动把 `workspaceExecution` 改为 true。

新 `kind: memory` 证明以单独的 `workspace-structured-memory-screen-v1` 域绑定完整 query、输入 statement、返回记录/revision/source、scope 和 native Session。持久 memory source 沿用 PR87 的 `enterprise-private-screen-v1` 认证。两者使用已注入 Node 配置闭包，不新建密钥、不传给 worker。PR93 原 `workspace-docling-credential-screen-v1` parse 域不变。

原 toolCall/result 配对、参数、text/details 一致性检查保留。Node 验证每一个旧记忆回执及原 source 签名后，才刷新下一模型看到的当前投影；原 journal 观察不改写，测试直接比较最初工具回执。旧无证明记录不能经刷新自动补签。独立 status proof 不按 `memory` 字段真值解释。

模型出口保留原异步权限检查，然后经现有 fd3 RPC 执行最后同步 Node Store/来源/当前记忆检查。真正 SDK fetch hook 在 Request 构建和完整 body 读取之后再取得许可，筛查完整原 history、实际 context 和 wireBody；最终同步复核 scope、native Session、工具名及当前版本。admission 与实际 dispatch 分开计数；授权拒绝中止 SDK AbortSignal，禁止自动重试。原 local providerTransport、取消/cleanup、worker 退出后的 finalCheck 和完整文件 recipient/purpose/transfer consent、超时检查均保留。

默认 CLI 文件选择不构成企业身份。无可信 Host 时记忆仍 unconfigured；默认插件配置没有扩大，未启动旧 Workspace 常驻服务器或恢复前端。测试中的原 createApp HTTP 仅为短生命周期的本机合成验收。

## 实际组件与替身

| 验收 | 实际组件 | 明确替身/边界 |
| --- | --- | --- |
| 两原件、四 Run、记忆 revision 1/2 | 原 signed Host、Store、Library/Artifact、Bun worker、官方原生 SDK/JSONL | 合成身份/原件、本机 Docling HTTP、有限模型选择和文本 |
| 逐工具回执与持久化 | `isError=false`、无 `pi.tool.failed`、content/details、返回时 workspace.json 实际行 | 不用 Run 总结代替工具成功 |
| 重开 | 四个新 worker 恢复同一 native Session；另外 createApp 关闭 Store 后重新打开读取相同记忆 | 不是 SIGKILL/掉电恢复承诺 |
| 全新进程恢复证明 | 专项依次启动不同 PID 的 Bun，重新打开真实 Store 和原生 journal，重新构造原 Node Host 模块并验证原证明 | 只有显式相同的合成身份、Host instance、来源和合成安全配置通过；不是无配置恢复或真实企业身份连续性的证明 |
| SDK 出口竞态 | 原 Node Host、真实 openStore、官方 SDK、实际 Request/SSE 解析 | 此专用 fixture 的身份、Library 授权服务、字节和 fetch/SSE 是显式进程内替身；零真实网络模型请求 |
| FGA 并行 grant/revoke | 原 policy/client、真实 openStore、实际磁盘 | 本机回环 HTTP/barrier tuple 服务，不是真实 OpenFGA |
| 原 PR93 安全/compaction | 原 Host、官方 SDK、已有 63 项测试 | 有限模型和本机 Docling；包括合法 screened compaction 恢复与旧无证明拒绝 |

SDK 出口正常对照只有 1 次 mock fetch；HTTP 500 也只 dispatch 1 次。异步 model hook、授权等待及实际 body 读取窗口中的撤源、撤政策、改 memory、撤 Session 均要求零 fetch，并断言变更窗口确实到达。旧凭据明文/Base64/Hex、伪造 query/native Session/scope/revision/source/statement 证明均在请求前拒绝。

FGA 补删被故意拒绝的负向测试保留本地 revoked、check/read 拒绝，并返回 `DISCLOSURE_CLEANUP_FAILED`；不能宣称外部清理完成。多阶段授权失败不自动回滚先前已提交的阶段，没有新增后台重试或核销队列。

跨进程专项独立于同进程 Store reopen 和四个 Bun worker 的 Run 恢复。新进程在相同显式合成绑定下恢复同一 native Session，只产生一次进程内 mock SDK fetch；配置缺失、合成筛查值轮换、Host instance 改变均在模型请求前拒绝，逐项断言原 journal 字节前缀与全部旧证明未变；仅允许官方 SDK 附加一个 `session_exit` 退出记录，禁止新模型/证明记录。没有 process-local 随机 proof key 被偷偷替换或自动补签，也没有为恢复创建真实凭据。强化验收曾因要求整个文件字节不变而失败；独立诊断定位为原 SDK 只追加 `session_exit`（18 → 19 条，原条目无修改），因此最终断言明确区分原证明保留与官方退出元数据，不把拒绝恢复说成成功恢复。保留 PR93 的 instance-bound scope，因此**不宣称整个生产 Host 重启、更换实例后会自动采用旧私有 journal**；Store 中已保存记忆的读取和旧 journal 的披露权限是不同边界。PR96/97/98 均未移入或合并。

## 可复现命令

在新 worktree 根目录使用 Node24。npm 构建使用本轮创建的两个独立空配置文件隔离用户/全局 npm 配置；它们位于忽略的 `.cache/integration-npm/`，不含服务凭据。

```sh
env -i PATH="$PATH" HOME=/tmp NO_COLOR=1 \
  NPM_CONFIG_USERCONFIG="$PWD/.cache/integration-npm/user.npmrc" \
  NPM_CONFIG_GLOBALCONFIG="$PWD/.cache/integration-npm/global.npmrc" npm run build:omp
env -i PATH="$PATH" HOME=/tmp NO_COLOR=1 \
  NPM_CONFIG_USERCONFIG="$PWD/.cache/integration-npm/user.npmrc" \
  NPM_CONFIG_GLOBALCONFIG="$PWD/.cache/integration-npm/global.npmrc" npm run plugins:pack-check

env -i PATH="$PATH" HOME=/tmp NO_COLOR=1 node --test --test-concurrency=1 \
  test/workspace-omp-cloud-acceptance.test.mjs \
  test/workspace-omp-local-environment.test.mjs test/workspace-omp-local-entry.test.mjs \
  test/workspace-omp-local.test.mjs test/workspace-omp-plugin-uninstall.test.mjs \
  test/workspace-omp-plugins.test.mjs test/workspace-local-references.test.mjs \
  test/workspace-omp-unified.test.mjs test/workspace-omp-local-budget.test.mjs \
  test/workspace-omp-local-wire.test.mjs test/enterprise-context-host.test.mjs \
  test/enterprise-context-extension.test.mjs test/enterprise-context-oss.test.mjs \
  test/enterprise-context-unified-egress.test.mjs test/workspace-omp-structured-memory.test.mjs \
  test/enterprise-persistence-real-store.test.mjs test/enterprise-disclosure-revoke-race.test.mjs \
  test/enterprise-memory-ledger.test.mjs test/enterprise-memory-http.test.mjs \
  test/enterprise-disclosure-policy.test.mjs test/enterprise-disclosure-http.test.mjs \
  test/enterprise-openfga.test.mjs test/library-api.test.mjs test/library-containment.test.mjs \
  test/library-recovery.test.mjs test/pi-library-read.test.mjs \
  test/workspace-omp-factory-materials.test.mjs test/workspace-omp-factory-customers.test.mjs \
  test/workspace-omp-factory-inquiries.test.mjs test/store.test.mjs \
  test/store-durability.test.mjs test/store-migration.test.mjs
```

最终生产源码的主回归 **306/306 通过，0 失败、0 跳过**，日志 `evidence/integration-final.tap`。随后新增并收紧跨进程专项，最终完整出口文件 **19/19 通过**（含跨进程专项 1 项），日志 `evidence/integration-egress-final.tap`；两组有重叠，不相加。上列命令按最终测试文件列出，后续重跑会包含后来新增的跨进程用例，不能把历史 306 原样套用为新总数。

Node24 `build:omp` 与独立 `plugins:pack-check` 均通过：11 包静态闭包、编译、官方发现/加载/注册、禁用、物理卸载；构建阶段模型请求和业务工具执行均为 0。构建日志：`evidence/integration-build-final.log`、`evidence/integration-pack-final.log`。原始 TAP 均在忽略的 `evidence/`。历史 60 和 163 不相加作本轮结果。

最终完整出口专项的实际命令：

```sh
env -i PATH="$PATH" HOME=/tmp NO_COLOR=1 node --test --test-concurrency=1 \
  test/enterprise-context-unified-egress.test.mjs
```

跨进程专项可独立执行：

```sh
env -i PATH="$PATH" HOME=/tmp NO_COLOR=1 node --test \
  --test-name-pattern='fresh Bun processes' test/enterprise-context-unified-egress.test.mjs
```

## 未测与外部前提

真实模型、真实凭据/企业资料、真实 TED/SAM/ERPNext/Docling/Mem0/MCP/Muse/Shopify/OpenFGA、付费和部署均为零。没有配置或读取真实密钥。旧 DeepSeek 5 元历史预算仍缺请求标识/最终状态（含 UNKNOWN/中断）、实际 usage/费用、账户累计账单、核销截止时点和余额对账，不能授权新调用。本轮不解决此前浏览器 sandbox helper 阻塞，也不声称真实付费取消核销、生产业务质量、跨进程争用或崩溃恢复已验收。Brain/Medusa 未合入。
