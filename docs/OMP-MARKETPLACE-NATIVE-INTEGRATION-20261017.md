# Marketplace 原生业务 Session 最小闭环

从 `cba32b2458e60dc7b75d9a4ea8b03a3803b1651e` 继续，同一开发分支及 Draft PR99。整合源码提交 `628fed31763d51d38ea5272a3267b0029efd8dcd`；原 requestId 规范化回执跟进提交 `99e64bb1004f94131cdfb140d582c1e7a18544f9`。复用 PR83 原 Marketplace 插件、原 mount/服务、原 WorkerDesk 和原 Store。本轮范围是 **同一当前快照下的公开发现、内部未确认草稿、原买方拥有订单/任务的状态字段**；不扩展私有交付正文或商业执行。

## 接入与权威

`mountMarketplace(app, options)` 仍在原 enterprise Host listen 前挂载。新增可选的同步 `readReviewedScope(context)` 将已有 Host 的审核结论接入模型投影；缺失/撤回返回 null，工具明确 unconfigured。其返回值契约见 [插件说明](../plugins/workspace-marketplace/README.md)。没有创建权限数据库、grant API、新角色、预算系统、队列或 AgentLoop；没有生产配置文件或真实凭据创建。

回调不能根据模型布尔值、原订单所有权或公开发现权限自行产生私有权限。它必须读取已有审核来源，绑定原 workspace、subject、conversation、recipient、固定用途、scope revision/expiry，并分别决定 discovery、内部草稿和 owner order status。测试中的审核回调与业务身份为明确合成替身，未宣称真实企业审核服务已接通。

原 business Agent 接收这个 Host 的客户端，沿现有私有 fd3 交给原 OMP loader/Session。client/guard 指针必须匹配原 Host；旧 raw marketplace/readActor 注入方式不会配置原生扩展。business 清单现在有六类能力，默认入口仍仅 local-materials；清单加载不等于授权，缺少各自配置继续 failclosed。

原签名 Session、当前原 Run/会话所有权、接收者和服务实例绑定维持既有检查。私有来源仍由原 Marketplace `getOrder` 校验买方所有权，原 WorkerDesk/contract 校验相同 orderId 与 createdBy/buyerSubject，不允许同企业另一买方或外企业继承。

## 模型披露与草稿

- 订单只允许审核字段 `orderId/status/serviceId/workerId/updatedAt/termsHash`，至少选 orderId/status。原输入、objective、交付/evidence 正文、错误详情、付款信息和账户引用不进入回执。
- 回执保留原 Session/会话、recipient hash、用途、审核字段、scope fingerprint/revision/expiry，以及原订单/contract 精确快照 SHA 和原 updatedAt。它不是 bearer 权限令牌；每次校验均重新查询原 Host 当前权限及真实来源，模型回执不能创建权限。
- 公开发现只读取原已发布、审核过的服务/报价及当前 verified binding 可用性。它不能授权私有订单读取。模型工具仍仅四个，没有确认、付款、批准、派单、远程 refresh/poll、验收或 provider 写入工具。
- 草稿调用原 createOrder/WorkerDesk.create，actor 固定 human=false。原报价/预算规则和原买方身份保持不变；原 Store admission 内同步重验当前 scope、原 Run/Session 和取消状态。没有第二订单 ID 或执行行，workspaceExecution:true 不改变这些权限。
- 写入后应答丢失明确 unknown / retryWithNewRequest=false；同原 requestId 精确重试确认既有一条持久化草稿。取消 Run 停止答案交付，保留已经提交的 draft，不伪造回滚。

回执采用严格快照：订单、报价、scope、字段或当前授权变化均拒绝旧历史，需重新建立当前审核上下文；本轮不自动替换旧来源证明，不实现运行中状态流式刷新。读取状态也不联系远端 Worker。

## 安全边界与实际验证

原 Session guard 在首次向模型披露 Marketplace 结果前、恢复后的首次模型请求、onModelRequest 后和官方 transport 的实际 Request.text 后复核全部原 journal 依赖；原 Node 在 worker 退出后的最终交付边界再次读取原 journal 并复核。插件禁用后不能恢复依赖它的历史。

模型只允许单一文本回执且 details 一致；多余图片、伪造字段/正文和跨插件回执均拒绝。可选包只在选中该能力或验证其历史时加载：隔离测试在没有 Marketplace 包的目录中导入真实核心源码，默认核心不因包物理卸载而崩溃；原 loader 的 disable/uninstall 生命周期另由 build:omp 验证。

| 场景 | 原服务 / SDK 与替身边界 |
| --- | --- |
| 两轮同会话发现/草稿/状态 | 原签名 HTTP、原磁盘 Store、WorkerDesk、原 fd3、官方 OMP；恢复相同 native Session，精确重试只留一条 draft/contract，无 consent，无 Worker submit/checkout/transfer/refund |
| 授权/用途/字段/过期/来源/报价变化与禁用 | 原 Host 恢复拒绝，新增模型 request event=0；跨买方及外企业身份拒绝 |
| 缺配置与公开权限 | unconfigured；仅 discovery 不能读原私有订单或创建草稿，即使输入 execution=true |
| 提交点撤权、未知结果与取消 | 原 Store 同步 admission 拒绝后零草稿；真实提交后注入应答丢失再精确重试；取消不派单且不撤销已落盘草稿 |
| 最终 Node 交付 | 官方 worker 正常退出后撤回审核 scope，原 Node 最终校验拒绝答案 |
| 实际 provider 发送 | 两轮生产 fd3 后，在原真实活动 Run 中恢复官方 SDK；仅此序列化探针用只读 loopback RPC 转接同一个原客户端。SSE 是有限替身，身份/审核/Provider/报价与业务数据均合成 |
| 正常与未选字段 | 浏览器原权限可读合成私有订单正文，但实际 SDK 请求体没有该正文，只有审核状态；正常控制 fetch=1 |
| 两个异步窗口 | onModelRequest 与实际 Request.text 后分别撤回 scope、改变来源/字段、撤销 Session；另测出站时取消。全部 fetch=0 |
| 伪造/接收者/禁用 | 篡改私有状态回执、追加未审核图片、换 receiver、禁用插件均 fetch=0 |

原 Run 的模型预留/计数维持既有语义；零 fetch 不被当作新增预算退款承诺。真实外部模型和业务调用为零，Mem0 向量关闭。没有部署、main 合并、强推、真实凭据读取/创建或运行资料入库。

## 测试判据修正与完整补验

独立审查发现，旧 SSE 替身在正文断言之后才增加 fetch 计数；伪造正文即使进入替身，也可能抛错后被误记为零发送。这是测试口径缺口，不代表已确认生产越权。旧 SDK 零发送结果已被下面的新结果替代。

本次仅修改两份测试文件：fetch 入口第一步计数；正文断言即使被 SDK 捕获也会显式传回测试；父测试只将指定的预期拒绝视为正常负例，其他断言均传播；forged 场景精确断言原 Host 返回 `MARKETPLACE_SOURCE_CHANGED`。生产源码未改动。

局部敏感性变异只让测试 fixture 的 `revalidateReceipt` RPC 返回 true，故意绕过该证明检查。正常 forged 用例通过且零 fetch；变异用例实际进入一次替身 fetch，以 `1 !== 0` 失败，进程退出码 1。变异已恢复，fixture 与父测试哈希对应下述源码提交；没有用替身抛错充当成功拦截，也没有修改生产 guard。该变异是预期失败证据，不计作验收通过项。

正常与变异使用相同聚焦命令：`node --test --test-name-pattern='Marketplace original active Run/SDK egress forged$' test/workspace-omp-marketplace-wire.test.mjs`，同样清空业务环境。变异仅临时在 fixture 的 `rpc(method,value,model)` 开头加入 `if(method==='revalidateReceipt')return true;`，执行后恢复。日志 `marketplace-counter-fixed-forged.tap` 与 `marketplace-guard-bypass-mutation.tap` 的哈希及恢复校验见验证摘要。

完整矩阵和 pack/build 均在同一源码 HEAD `4901f19bca6fc26944149e5e393ba2034a867b3f` 重新执行，包含 requestId 规范化及本次测试判据修正。先前 `dda1b217` 的测试补验被停止，未计为通过。此后只保存说明与脱敏证据，不改运行时、插件、测试或构建源码。

## 命令和证据

固定 Node 24.19.0、Bun 1.3.14、OMP 18.10.4。以下命令均使用 `env -i PATH="$PATH" HOME=/tmp NO_COLOR=1`：

```sh
node --test test/workspace-omp-marketplace.test.mjs test/marketplace-plugin.test.mjs test/workspace-omp-marketplace-optional.test.mjs
node --test test/workspace-omp-marketplace-wire.test.mjs
node --test test/workspace-omp-business-integration.test.mjs test/workspace-omp-business-wire.test.mjs test/workspace-omp-brain-decision.test.mjs test/marketplace.test.mjs test/marketplace-http.test.mjs test/marketplace-stripe.test.mjs acceptance/marketplace-original-host.mjs test/workspace-omp-unified.test.mjs
npm run plugins:pack-check
npm run build:omp
```

| 执行组 | 结果 | 本地忽略日志 |
| --- | --- | --- |
| 原 Host/契约/可选包、两轮闭环及隔离负例 | 20 passed，0 failed，0 skipped | marketplace-4901f19-native.tap |
| 实际 SDK 发送/恢复/接收者/篡改矩阵 | 14 passed，0 failed，0 skipped | marketplace-4901f19-sdk.tap |
| 原 Marketplace/签名 Host 冷启动、业务组合/Brain/统一入口回归 | 110 passed，0 failed，0 skipped | marketplace-4901f19-regression.tap |
| pack 闭包及原生 compile/discover/load | 14 插件通过 | marketplace-4901f19-pack.log / marketplace-4901f19-build-omp.log |

20/14/110 及 pack/build 本次全部在 `4901f19` 重新通过，均为零 failed/cancelled/skipped。带空白 requestId 的两轮精确重试包含在 20 项矩阵中，不额外累加。14 项 SDK 矩阵正常控制 fetch=1，13 个拒绝场景均为 fetch=0；forged 的原 Host 拒绝码精确为 `MARKETPLACE_SOURCE_CHANGED`。各组有交集，不作为独立总数相加。

最终日志计数、SHA256 与确切源码提交见 [验证摘要](validation/omp-marketplace-native-20261017-summary.json)。各组存在交集，不累加为独立总数；日志保留在忽略的 evidence，临时 Store/会话/正文不入源码。

## 保留缺口

未接真实 Provider/支付/Worker/企业审核服务，未验收私有交付正文/Artifact 的模型披露、付款或执行，也未完成 Marketplace UI 导航及完整浏览器体验。严格快照变化后的同会话自动刷新/迁移未实现；其余隔离 profile 尚未全部组合。既有 Medusa/真实服务等缺口不变。远程 Actions 的既有 startup_failure 报告未被本地通过覆盖，本轮未独立重查或重触发远程 CI。
