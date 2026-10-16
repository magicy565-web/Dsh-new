# 给 Dot（xy）的开发交接与分工

前半部分保留 PR86 独立包的历史验收。当前原 Host 接线、正式包路径与真实 TED 拒绝结果见文末“2026-10-16 原 Host 接线续增量”，不要将旧待办或旧 Node22 结果当成本次状态。

本轮由当前会话开发免费外贸垂直插件，协作入口为 Issue #85：
https://github.com/magicy565-web/workspace-agent/issues/85

## 基线与本轮交付

固定基线 `b8866e95f2c655603c7b55529b579f91c9626fa1`，来自原分支 `codex/final-native-context-integration-20261015`。只新增独立包 `packages/workspace-free-trade/**`、`test/free-trade.test.mjs` 和本交接/验证文件。不替换原工厂卖方询盘准备包。

已写代码：官方 TED/SAM 单页采购公告检索；ERPNext 四类商业单据的指定记录/字段只读查询；未保存、未审核的报价数据准备；四个 Pi 工具、Skill、隔离测试与包说明。没有安装第三方 ERP 服务、创建账户或调用付费模型。不是六类业务方案全量上线。

本包拥有的代码范围：`packages/workspace-free-trade/**`、`test/free-trade*.test.mjs`、`docs/FREE-TRADE-*.md`、`docs/validation/free-trade-20261016/**`。请复用这些适配器，不平行再写 TED/SAM/ERPNext 客户端。

## 请原 Dot/整合工作继续持有的范围

以下是建议协作边界，不是对 Dot 当前运行状态的断言：Pi/OMP 会话与恢复、原 Host 统一接线、Library/产品/询盘权限与版本、Shopify、Muse/Dot Bridge、WorkerDesk/Marketplace、移动端 UI。当前增量没有修改这些文件，也没有修改根依赖锁、main、部署或原审批/预算/调度逻辑。

## 最小接线契约

从包入口导入 `freeTradeExtension`，从 `./adapters` 导入 `createTenderClient` 与 `createErpNextClient`，由原可信 Host 传入既有安全凭据和授权函数。企业模式必须 `enterprise:true`，不得加载无权限检查的普通 public-only 入口处理企业私有上下文。

`authorize({tool,input},signal,receiver)`：检查原成员、Session/workspace、精确当前模型接收方、过期/撤权与公开查询的外传授权。必须显式返回 true；调用前后均检查。

`authorizeRecord({doctype,name,fields,origin},signal,receiver)`：检查原企业与 ERP 实例、原记录、字段和接收方的精确授权。ERPNext 自己的账户权限也必须保持最小。插件不创建独立授权数据库。

原 Host 仍负责每次模型调用前对已缓存私有回执重验、会话恢复/切换/分叉边界、取消和原 Artifact 保存。包没有实现此生产接线。后续集成不得另起 Agent Loop、队列、审批、调度或资料库；源码里没有新 HTTP API 需要部署。

报价准备仅返回 `persisted:false` 的 Quotation payload，不执行 POST/submit/send/order。价格规则、税、交货/付款条件、报价修订留在已有 ERPNext；加入真实写入必须走原人工授权与验收，不能把模型提供的 approved 当批准。

## 验证及未完成项

当前临时环境 Node 22.16.0；77 项增量测试通过，0 失败/跳过/取消，含本机真实 Node HTTP，外部服务数据、模型身份与权限为明确合成测试。不是原 Host 或原 Pi/OMP SDK 集成测试，不代表真实 TED/SAM/ERPNext 已通。完整命令、包验证和哈希在相邻 validation 目录。

仍需在既有 Node24/Pi/OMP 环境验收安装/移除与工具 Schema、原 Host 权限/Artifact/缓存重验接线，以及真实 TED 只读查询、合法 SAM key、已部署 ERPNext 的只读授权。当前容器外网 DNS 失败，未用虚构成功替代联调。未触发 GitHub Actions，也不将其启动失败当测试结果。

Comtrade/GLEIF/CSL、CRM 导入、Mayan/Akeneo、WooCommerce 和 ERPNext 写入不在本轮实现；没有提前安装或复制一套系统。

## 通知状态

Issue #85 是已写入仓库的共享分工记录，不能等同 Dot 已读。Workspace—xy 身份检查曾返回 429 `Token refresh already in progress`；已提供的插件仅有 Worker 领取/回执接口，没有任意跨会话发消息动作。没有领取旧任务、伪造 task/event/receipt 或将本会话成果冒充 Dot 原生执行。请接手者在 Issue #85 确认接收及接线范围。

## 2026-10-16 原 Host 接线续增量（本次）

已从 PR86 固定 `92b23961bbbb26e9118f849a2ade062dd19686f0` 选择性接收上述适配器，接到 `be0c3c1deb175e0076c14d312bc3157f87ff07d0`，独立分支 `codex/free-trade-host-integration-20261016`。唯一正式包迁至 `plugins/workspace-free-trade` 0.1.1，原适配器客户端未重写。前文 `packages/` 和 Node22 验收为历史记录。未接收 PR87，不接管其他会话的 ERPNext/Docling/Mem0/Medusa 开发。

新增原 OMP 原生插件包装与原 Node24↔Bun worker fd3 接线。实际原 Host 持有签名 Session、成员和 instance 身份、安全 ERP 连接及当前记录授权；子进程不拿 ERP 密钥。精确记录/字段/origin/模型接收方、撤权、原生缓存回执、来源变化、模型发送前/完成后及最终交付均受原 Host 检查。信任原 Host 的当前授权回调，不将固定许可数组、测试回调或本机 UID 当生产客户授权。没有新账号、授权库、ERP、RAG 或 Agent Loop。

公开会话显式用 `--public-only --plugin-config config.free-trade.json`，禁止同时带本地私有输入/archive；相同会话不能从私有输入切换成公开模式。默认配置保持不开启此插件。准确命令、限额及私有接线契约见插件 README。

真实匿名 TED 查询只执行一页/limit1，一次请求收到 HTTP403，阶段为网络/API拒绝，未自动重试，不宣称已连通或获得采购机会。SAM/真实 ERPNext/付费模型本轮未测；原 SDK 和原 Host 验收使用明确合成数据与有限模型。原 Artifact 业务保存尚未接线，原生 Session 持久化不能冒充已保存报价；报价仍 `persisted:false`。验证结果和下一步在 `docs/validation/free-trade-host-integration-20261016/`。未合并 main、部署或触发外部业务写入。


## PR89 收尾：容量预留与 TED 诊断（0.1.2）

继续同一 writer、同一 `codex/free-trade-host-integration-20261016` 分支，从 `a3d6328a7311fc330ad7051901ee297063c3ae20` 修复两项问题。真实原 Host/OMP SDK 加有限模型复现三份私有投影需要 18 次读取而上限 16，原实现直到 Node 最终交付才失败。现在在工具网络读取前预留所有后续重验，第三份投影提前返回 `FREE_TRADE_PRIVATE_READ_CAPACITY`；前两份首轮 12 次、同会话续轮 16 次完成。下一模型轮若不能为完成/最终交付留足容量，在请求记账前拒绝。16 总额及准备、发送、完成、worker 最终、Node 最终的独立来源/撤权检查均保留，没有复用旧重验结果。

TED 客户端增加可选可信进程内诊断观察器：正文最多 2048 bytes/250ms，只输出固定信号及脱敏头白名单，诊断最多 1024 bytes；不输出正文、任意头、cookie、授权、URL、异常文本，不附在模型工具参数或 SAM 凭据请求上。兼容错误码 `REMOTE_AUTHORIZATION_REFUSED` 不等同缺 key。官方发布公告 Search API 无需 key；旧 403 没有响应头/正文，不能事后断言来源。

当前任务容器只读策略 `/etc/codex/network-policy.json` 为 restricted、151条 HTTP egress 规则，无匹配 `api.ted.europa.eu`，有 `api.deepseek.com`。父会话策略不可见，不能互相代用；旧响应及代理拒绝日志不可得，不能把当前配置当历史 403 的确定归因。未改变网络/代理/权限，未再请求 TED，未付费。

本轮结果、日志/源码哈希和当前白名单脱敏证据在 `docs/validation/free-trade-capacity-diagnostics-20261016/`。下一步仍是原环境明确允许精确 TED API 域名后，另行授权一次诊断联调；真实 SAM/ERP/模型与原 Artifact 保存尚未完成。PR87 的 `13cccff0df703e6471329cd0e1815aee3f6179a9` 仅记作后续接收线索，本轮未拉入或接线。后续若另获安排，只能选择性接到更新后的 PR89 底座，不能覆盖旧 Host、启用 Mem0 或再写一套 ERP 客户端。
