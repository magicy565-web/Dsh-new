# Brain decision 原生业务 Session 增量验收

本轮从 `8b30224802a47f007fa420bd3a958b6bf0214b3e` 的 WIP 继续，同分支 `codex/omp-all-plugins-integration-20261017`、同 Draft PR99。此前完整限定验收基线为 `69e4ead`；该 WIP 当时只运行既有 93 项测试，本轮补齐下面的专门验收。源码提交：`e0d70e431bc126ab42f01e9e86788b0473b1dc6b`。这里只接受 **同一原签名身份/会话绑定、同一精确 context Artifact 版本** 下的 decision 连续修改。

## 行为和权限

- decision 的继承信息与正文写入原 Artifact 的同一次 admission 事务；包含原 bindingHash、前一 Artifact 精确 ref 和 context 精确 ref。原 Store、Artifact、Run 和 OMP 18.10.4 仍分别拥有持久化、授权和模型循环，没有新增队列、AgentLoop 或数据库。
- 校验历史回执时沿至多 32 步原版本链读取真实不可变字节，验证版本递增、SHA、同绑定以及 context。将历史正文重建的受限视图与已有回执比较；不改写旧 journal/proof，不补签旧回执。
- 历史 decision 中的来源即使已从新 decision 移除，仍必须当前有效、已授权；原 Goal、接收者、Session 和取消信号继续生效。不同企业或绑定不能继承旧回执。
- 原 WIP 存在一个已复现的竞态：历史捕获后、最后读取当前 decision 时发生的“已移除历史来源”变化可能漏检。本轮在最后读取和 gate 后再次检查历史依赖；专门负例在修复前失败、修复后通过。
- context 变化继续使旧 decision 失效。未实现跨 context 自动迁移或让旧 decision 依赖新的 Goal/来源；这类历史恢复仍拒绝。超过继承链上限也拒绝。
- 同 requestId、同正文的精确重试确认原持久化版本，不产生第三版本。已持久化后响应丢失明确返回 `writeOutcome: unknown`、`retryWithNewRequest: false`；之后精确重试可读回 `persisted: true`。取消原 Run 不会撤销已经提交的 Artifact，也不会交付被取消的最终答案。
- decision 仍为模型撰写、未人审、不可执行的记忆，不产生付款、预算批准、第三方派单或业务执行权限。

## 验收范围

| 检查 | 实际执行及边界 |
| --- | --- |
| 连续保存和精确重试 | 原签名 HTTP Host、原磁盘 Store/Artifact、原 fd3、Bun/OMP Session；跨三个原 Run 恢复同 native Session，两次保存和一次精确重试只有同一 Artifact 的两个版本 |
| 未知写入状态 | 在原 Artifact update 实际提交后注入一次应答丢失；确认磁盘 v2、未知回执、精确重试 v2，不模拟“假成功持久化” |
| 来源/Goal/撤权/禁用 | 原 Host 和原来源修改；恢复拒绝且无新增模型 request；撤销签名 Session 后原 HTTP 入口拒绝 |
| 取消和最终交付 | 保存 v2 后取消原 Run；worker 已退出后修改原产品来源，Node 最终交付重新核验并拒绝 |
| 实际模型发送 | 独立 Bun 进程恢复原 Host journal；Node 持有真实 Store/Access/Library/Brain，测试只读 loopback RPC 转接。原生产 fd3 写入路径由上一行覆盖；测试 RPC 不是新增生产入口 |
| 异步发送窗口 | `onModelRequest` 及官方 transport 的实际 `Request.text()` 后分别发生来源变化、Goal 变化、签名 Session 撤销、取消：八种情况均零模型 fetch |
| 正常和篡改控制 | 正常一次有限 SSE 替身，实际请求体包含原 decision 与修改后的正文；禁用 Brain 或篡改历史 decision 正文均零发送 |
| 身份隔离 | 原签名 Host 拒绝另一成员读原会话；原 Access/Host 拒绝外企业身份绑定，均在 Artifact 字节读取前。两个企业独立 Artifact 及绑定替换另由明确 SQLite facade 单元测试覆盖，不宣称多租户部署验收 |

所有业务输入、身份、模型和外部传输为明确合成数据或有限替身；OMP SDK、原 Host、原 Store/Artifact/Access 在相应测试真实执行。真实模型和业务服务没有连接或调用，Mem0 向量关闭。

## 命令与本地结果

固定 Node 24.19.0、Bun 1.3.14、OMP 18.10.4。命令使用 `env -i PATH="$PATH" HOME=/tmp NO_COLOR=1` 清空业务环境。

```sh
node --test test/goal-brain*.test.mjs test/business-brain*.test.mjs test/business-signals.test.mjs test/decision-planner.test.mjs
node --test test/workspace-omp-brain-decision.test.mjs
node --test test/workspace-omp-brain-decision.test.mjs test/workspace-omp-brain-decision-wire.test.mjs
node --test test/workspace-omp-business-integration.test.mjs test/workspace-omp-business-wire.test.mjs test/enterprise-disclosure-revoke-race.test.mjs test/enterprise-memory-concurrency-real-store.test.mjs
npm run plugins:pack-check
npm run build:omp
```

| 最终执行组 | 结果 | 本地忽略日志 |
| --- | --- | --- |
| Brain 源码/权限/来源/决策，含 12 项 decision 继承单元负例 | 180 passed，0 failed，0 skipped | brain-decision-source-regression-round2.tap |
| 原 Host + 官方 SDK 组合：8 项 Host、11 项实际发送/恢复 | 19 passed，0 failed，0 skipped | brain-decision-sdk-host-round2-final.tap |
| 新增身份隔离后的原 Host 全套复验 | 9 passed，0 failed，0 skipped | brain-decision-original-host-round2-final.tap |
| 第一轮业务 Host/SDK/撤权/记忆竞争定向复验 | 33 passed，0 failed，0 skipped | brain-decision-baseline-safety-round2.tap |
| 插件 pack 和固定版本 OMP native build/load | 14 插件通过 | brain-decision-pack-round2.log / brain-decision-omp-build-round2.log |

日志计数、SHA256、检查点与确切来源提交见 [本轮验证摘要](validation/omp-brain-decision-20261017-summary.json)。日志保留在忽略的 `evidence/`，不提交会话正文、临时 Store、凭据或运行资料。各组有交集，不累加为独立测试总数。

既有 GitHub Actions 38999750909、38999747216 的 `startup_failure` 为父任务报告；本轮没有将本地测试结果改写成远程 CI 成功，也未独立重查或重新触发。

## 本轮未完成

Marketplace 私有模型桥没有接入，仍不在 business profile 中。现有原 Marketplace 插件直接返回 `getOrder` 的输入、交付正文和错误信息；原买方身份/订单所有权检查不能单独证明这些正文可转发给模型。后续需要将可信客户端绑定、精确订单/原交付 Artifact 来源投影、接收者、恢复/撤权及发送边界复核接入既有授权链；保留原 WorkerDesk/预算/人工确认，不能直接把四个插件工具全开或转发原订单对象。

其余第一轮列出的实例、迁移、完整浏览器、真实外部服务、全部隔离 profile 组合和 PR94 最新验收基础设施缺口仍然存在。此报告不扩展其完成状态。
