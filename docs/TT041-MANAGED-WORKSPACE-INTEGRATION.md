# TT041 托管运营入口：原源码集成候选

本候选将 V22 商品、Shopify 只读证据和活动视图，与原 Workspace 插件的
Muse 会话派单、原 Store 及 PR25 主控读取接在同一源码树中。产品主线是企业
给商品、供货条件、目标和预算，由平台托管运营，Dot 规划及汇报、原 Muse
执行；已局部接入原 Supply V1 的供给服务、Shopify 商品观察及私有只读 MCP。
供应商 SKU 与店铺商品映射尚未实现；这里没有完成真实 Muse 执行、Shopify
发布、公开买家 Connector/询盘写入或商业计费验收。

## 固定源码与工作所有权

- PR26 `b117b808673410d69cd65bc676379f42af38a93f`：原会话委派、Windows
  NTFS 持久化与受信成果所有权；原独立分支保留。
- PR22 `78f155367524b48381d79b2edebe0e5e2925e85d`：273 个原 Git blob
  与已存在的只读本机副本逐字节匹配。
- PR25 当前 `f662ac28caa93e992c153e4826e5eba04a97932e`：原主控与 Host
  适配器，并保留最新运营边界审计和测试。接线原稿来自父提交 `bac9e8c8`。
- 实际三方比较基线 `b9546e1d7e6d7ac1381f84327a4f15cbfc60598f`。
  集成提交保留 PR26、PR25 两个父提交，不重写原历史。
- 独立分支 `codex/tt041-managed-workspace-integration-20261012`。
  未编辑其他任务的工作树、index 或未提交 UI，也未更新 main。

## 已集成的具体文件和行为

`server/index.mjs` 保留 PR26 的单个 Muse Host 创建、路由、启动及关闭，
加入原 V22 `business-library.mjs`、`commerce.mjs`、`shopify.mjs` 初始化与
现有认证路由。Shopify 保持原只读接口；合入源码本身不产生发布授权。

`server/store.mjs` 保留已验证的 NTFS sync、单 writer、锁、文件身份及
提交失败传播，接合 V22 v3 结构校验及原 v1/v2 迁移。`scripts/recovery.mjs`
使用同一 Store 校验并保留原安全文件打开/flush。WorkerDesk 保留原 attach
事务钩子，默认身份校验兼容 V22 的可信主体；Dot bridge 保留严格租约判断。

原 `server/muse-worker-native.mjs`、其 overlay 副本及
`deploy/muse-native-overlay/server/workspace-plugin-service.mjs` 已应用
PR25 的 `bindControl` 接线。该方法只从当前原认证 owner、固定 Worker、
配置 scope 和插件 epoch 获取原 Store/Session 的读取能力。原 owner、关闭
Host、过期 epoch 校验仍生效。它不会派单、核对恢复、续租、触发模型或写状态。
三处原接线目标在 PR26 `9e92fe31` 与 `b117b808` 字节一致，因此原补丁兼容。
历史 `docs/patches/dot-control-host-wiring.patch` 仅作为来源证据保存，已应用的
集成树不应再次运行该补丁。

三方合并的 11 个冲突逐项处理：`.env.example`、Muse 部署说明、只读连接
检查、recovery、Dot bridge、index、store、WorkerDesk、opportunities、Muse
HTTP/probe 测试。保留原 Muse owner/fencing、事务 attach、同订单恢复及
Windows 持久化；加入原 V22 v3/Commerce，而非整包覆盖。

V22 前端来自上述固定原 Git 源，不重新设计本任务无所有权的 UI。独立集成
只改共享后端冲突、三处 Host 接线以及一项时间戳断言：原 blocked run 会先
记录 finishedAt 再记录 createdAt，主控必须显示最新已保存的时间。

## 最小前端/微信小程序契约

完整请求与响应见 [MUSE-CONVERSATION-API.md](MUSE-CONVERSATION-API.md)。
沿用原认证入口、签名/CSRF 和 admin 门禁，不在客户端保存业务真相或身份。

1. 原会话 `POST /api/conversations/:nativeAgentId/messages` 显式
   `provider:"muse"`、原 `requestId`、原内容及已批准公开范围的 order 输入，
   只准备原 WorkerDesk 草稿；普通消息继续走原 Dot。
2. 展示准确 reviewHash 后，原 worker-orders approve/dispatch 路由处理原单。
   登录与重连只读取；同 requestId 不重下单。不把自然语言当预算或发布批准。
3. 原 order 详情提供 conversationDelegation 的 phase、attempt、fence、lease、
   receiptHash、returnedHash 和 acceptedAt。成果文件依准确 ID/version/SHA 下载。
4. 原 Session 持久返回与企业验收分开。主控只读投影展示状态和授权引用；不
   输出完整审查内容、成果、文件或预算，授权下钻再读取原订单详情。
5. 当前接入点是原插件 `service.muse.bindControl(actor)`；尚未注册新增主控
   HTTP/SSE/MCP 或通知 outbox 消费接口。PR25 reducer 的序列化测试不是原
   writer 已注册持续通知的证明；后续应复用原 writer/调度，不新造任务队列。

主控 claimed/active 是有效原领取租约，不证明 model turn。原 delegation
仍返回 `wake.supported:false`、`wake.observed:false`、`executionStartedAt:null`。
排队、唤醒、领取、执行、成果返回、企业验收必须继续分别展示。

## Supply V1 原始文件核验与局部接入

已知 FullSource `libfile_b8308f0853bc81918723e76abc53a87e`，3,110,485 B，
SHA256 `f3dbc6df232531b450a98d05d06ba70f968da700c03e543c574713bdd6392386`；
Overlay `libfile_800f071b280481918363342e6f114aa6`，71,522 B，
SHA256 `c1e97a354056b3188d9282f97dbbc85c09bbc3d6321ecd2224e8a27e2dcfa75d`。
Library manifest `libfile_08d7d3517a3481918eac23d47af29c9b` version 1
已通过正常只读接口核对。已知包存在，不因 Git 没有这些模块而判定它不存在。

此前一次官方 Library materialization 在 Windows 的 `os.setxattr` 身份落盘
处失败，canonical 目录仍空；未接受或查看失败临时 ZIP，未改 helper 或绕过
元数据。随后父任务明确授权使用 Downloads 中已存在的用户原始 ZIP，不再下载。
独立核验其 3,110,485 B/SHA、283 个文件 CRC、清单 16 项的大小/SHA，并逐字节
比对任务1的只读解包。相对 PR22 为 266 未变、7 修改、10 新增、0 删除。

已复用原 `supply-network.mjs`、`sourcing-mcp.mjs` 和 `readCatalogPage`，
将原 index 路由和 optional supplyNetwork 校验逐项接入当前原 Host/Store。
没有把包里的旧 fsync 或 Muse handler 覆盖回来。原 7 项 Supply HTTP 测试在
集成树上全通过，使用原持久化 Store、临时本机服务和明确 Shopify 夹具。
`SOURCE-CHANGES.json` 是原包来源清单，不能当作当前合并后的 index/store SHA；
当前差异及源文件散列见本候选 validation 清单。

新增源码组件 SupplyNetworkPanel/CSS 保留原始字节供任务1复用，尚未挂载到
CommerceWorkspace。任务1仍持有其三个未提交前端文件；需先修复编辑 revision
固定、原 dirty 生命周期、不确定提交重试及 revision conflict 展示。当前发布
后 listing 编辑遵循原包 operator 更新即公开的版本化声明契约，不擅自改变它。

单企业试点仍不是多租户平台。原 listing 只有 supplierId 和文本 SKU，没有企业
Product/SKU/Commerce/Shopify variant 所有权映射。私有 MCP 只有 search/profile/
changes 三项读取，默认关闭，独立 bearer，不是公开 OAuth Connector；询盘仅
内部 draft，sentAt:null。公开数据不等于真实供应库存或报价。原完整 Harness、
官方 Connector+计划任务的账户唤醒能力、准确外部发布授权及经营结果仍须验收。

## 本机验证范围

`docs/validation/managed-workspace-integration/` 保存本次实际日志和源头清单。
原 Store/Artifact/HTTP 与适配器执行真实代码，Shopify 返回、native Session、
Muse sender/model 均使用明确夹具。原 Harness 部分缺失，未冒充真实 Muse。
Windows ACL 私密性及 POSIX overlay mode 仍保留已有差异，不删安全断言或
降低验收标准。前端通过复用已安装依赖构建；这不替代任务1的 UI 生命周期
修复。真实插件打包、Linux 全套与生产均未在本轮验收。
