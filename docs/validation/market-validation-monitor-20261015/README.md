# B 路监测与原 Host 集成验收 — 2026-10-15

基线 PR #68：`d82d35fd7213012ff6b0e5f2f24d765aba021a9e`。
环境：云端 `/workspace/workspace-agent`，Node.js `v24.19.0`。
后续授权已解决初版 a8a73b1 的 dispatcher/合法 Goal 关联缺口；本说明替代初版仅模块测试结论。
未合并 A 路 PR77，仅只读核对其 Artifact/指标契约；未改 C 路 worker/bridge/session、既有工厂插件或 main。

## 最终实际运行

```sh
npm run build
# tsc --noEmit + vite build，exit 0；有包体大小提示，不是错误

node --test test/market-validation-monitor.test.mjs test/market-validation-monitor.http.test.mjs test/supplier-monitoring.test.mjs test/capabilities.test.mjs test/store.test.mjs test/product-traffic-ga4.test.mjs test/runtime-v2.test.mjs test/agent-owner-policy.test.mjs test/access.test.mjs test/pi-business-conversation.native.test.mjs test/pi-task.http.test.mjs
# 159 tests, 159 pass, 0 fail, 0 skipped, exit 0; 5652.893188 ms

git diff --check
# exit 0
```

范围包括新增模块21项、HTTP9项，以及原审批/Store/GA4/监测/Runtime/隐私/企业访问回归。
原 Pi native business/task HTTP 的16项也在159内；不能把这些子集与159相加。

扩大回归首次遇到未构建 dist 的两项静态页面404；构建后已通过。复用默认流量时发现
原 supplier 仍允许旧 v1，现只将实际 v2 分享给新监测，保留旧 v1 的既有兼容语义，
修复后原 supplier 回归通过。初版依赖安装的默认 cache 不可写问题已用临时 npm cache
解决，锁文件不变。没有把失败或跳过记作通过。

## 当前源码 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| server/market-validation-monitor.mjs | 9ea662bfcb5a59fa94c52fe08158172dfc216989f13c9586c10a1a2e79d1445d |
| server/market-validation-launch-reader.mjs | 3f03301f34608402e4af66516b5689c72458398da5050ace84edd2e36b423884 |
| server/market-validation-monitor-http.mjs | b1e5d858e8cce366faed8e2015afe594d27da2cb0caf4bc9bbf0d17d97132d6c |
| server/runtime.mjs | a90668b7faa8e59cb648df6068b4046ef4740c48688ba77c7a95e85f66d7163c |
| server/index.mjs | 57bcf0eb395acca7fa5f1b7824047e03be7a18791c86ee7fdd4f38b6a5aa2ec4 |
| server/agent/privacy.mjs | eb8f9bffd7122963cc841d660324428b89acb7e9ee5fad360bdc21eff75acc28 |
| test/market-validation-monitor.test.mjs | d08c6bb361d72f88852943a71e5eeff4c02ff84963eb8a390015997a94a61239 |
| test/market-validation-monitor.http.test.mjs | c112b0c41635a5232e8fd5f5f112cf0d7c89db3aa90f4f8b5b3111d649fe2c13 |

## 已实际接通的原路径

- 企业签名 ingress → 原 Session/CSRF/当前角色 → 源 owner → 原 Artifact 版本/字节hash/计划hash → Host 原获客回执读取 → 原会话/Goal 创建 → disabled Schedule。
- 显式确认后使用同一真实成员的 createdBy/workspaceId 创建服务任务上下文，只有源引用，不复制聊天/私库或模型 Session。原 businessAgentOwner 的通用 Goal 拒绝不变；新任务也拒绝 sendMessage 和通用模型启动。
- 原企业 HTTP 创建/列表/读取/observe/control、原 Schedule 审批和 index dispatcher 已接线。真实 App listen 的唯一原 timer 自动分派，跨重启后仍读同一 Goal/Schedule，无新 scheduler。
- 原 Goal PATCH pause/cancel 立即禁用原 Schedule，重复暂停不增加其修订；服务 resume 只解除暂停，仍需新审批。取消不可恢复，原 Goal 状态和监测投影一致；七天总结进入 review_required。
- 原隐私过滤保护源/服务上下文及其 Goal/Schedule/结果，跨成员404；未签名、CSRF错误、viewer写入和 Session 在异步回执读取期间过期均拒绝。
- 原计划被修改版本、错hash/错获客条目或解析期间元数据变化均拒绝。无原真实回执、未批准计划标志或仅Shopify发布均不能创建任务。
- 同一回执跨并发/重启只生成一个原任务和计划；中断冻结区间、重复读、取消中写回、日程推进和漏跑缺口有测试。
- 原计划 visits/add_to_cart/checkouts/refunds 等必要指标逐项展示，浏览事件/退款单位不冒充这些指标。缺项为 insufficient_evidence；数据具备也只是 observed_not_adjudicated，goalVerified始终false，交原模型结合批准目标评审。
- 原服务可核实的投放前基线支持真实来源、证据引用和精确区间；无来源仍明确 unavailable，错渠道/晚于启动的基线拒绝。

## 证据分层与剩余验收

- 新增测试使用真实原 App/HTTP、Store事务、Runtime、审批、Schedule与自动timer，实际关闭和重开私有临时目录。
- Shopify/GA4使用真实仓库客户端源码，外部HTTP/授权为合成替身；未访问真实商店/GA4。没有复制连接器。
- 新增HTTP测试的OMP engineAdapter是禁止模型调用的替身，不是实际OMP SDK模型回合。另有原Pi AgentSession/SDK的keyless有限模型脚本16项回归通过；不证明真实模型判断或写作质量。
- 临时签名key仅供进程内离线测试，未保存或创建生产凭据。计划Artifact、回执、基线和数据都是合成测试材料，没有企业运行数据提交。
- 回执写evidenceKind:real只为测试真实分支，不能当作实际投放证据。真实获客服务未接入，默认createApp不配置解析器则准确阻塞；不从未审核计划伪造开始时间。
- 业务时钟推进和七次/跨八天触发都是模拟，实际七天观测为零。真实模型、店铺/GA4/广告、生产发布、付费调用、部署均为零。
- C路统一OMP工具注册、实际获客服务回执和真实转化/基线读源仍需后续集成；本轮已接原企业HTTP/任务，不声称模型可直接调用未注册工具。
- 更长期周期需用户明确并沿原Host审批；七天结束不自动延长或订阅外部通知。CI和真实生产验收没有由本地结果证明。

接口与启动见 [监测适配说明](../../MARKET-VALIDATION-MONITOR.md)。
