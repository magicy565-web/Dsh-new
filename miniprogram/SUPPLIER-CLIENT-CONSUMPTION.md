# 供应商小程序接线状态

原采购检查点已完成并推送：PR42 `1666719fa68e0b76d8ebaed31ede45e3fa694ff1`，源码包检查点 `68328e1`，3 项真实本地 HTTP/MCP 与 35 项客户端回归通过。供应商独立分支 `codex/wechat-supplier-20261012`、Draft PR43 保留该检查点，并整合后端固定提交 `0f12d2ac11eae48d490cdb639bbf3fe60dc3d4b7`，客户端不改 server 或共享构建/锁。

已按该提交的稳定文档消费三种写入：原会话 supplier-services 初始/追问（requestId/content/expectedRevision）、准确 facts 保存，以及 expectedRevision/confirmed/publicFields 预览。请求经现有写前 journal，失败未知时保留原 UUID/body，不另造身份、模型调度或发布流程。商品预览和公开字段审阅组件沿用原卡片/抽屉样式；字段选择默认空，原事实或修订变化重置。服务端生成的零售单位、包装件数、消费者售价、处理/运输时间与图片来源原样显示，MOQ/批发价/建议价/生产期不能代填；图片未观察仍未知，preview 不能当作 Shopify 商品或渠道发布回执。

普通组件/显示测试使用实际后端 profile/preview 核心输出以及编译后的 native Component 回调，五项通过；这是产品开发测试，不是微信运行或独立安全审核。这里尚未接通未实现的 service 会话路由，不声称 UI→HTTP→Pi 闭环已完成。

后端尚需明确的集中缺口：

1. GET collection/detail 的准确 service DTO：id/conversationId/revision/phase/profile、必要 missingFields/questions、suggestions、runId、错误、持久 preview/contentHash 以及待核对状态；实际状态机与能力标识。
2. 服务编辑后的旧预览失效规则、拒绝/取消如何映射原 run/服务；确认预览所依据的准确修订和 hash，以及图片实际可用性/文件权限检查证据。
3. Shopify 未配置/未授权/可写权限与准确店铺身份状态；独立预览审阅、创建、渠道发布的请求与回执，准确 product/variant/channel IDs 和未发布/已发布/未知/失败状态。客户端不创建凭据，不要求扩权。
4. 七天监测的配置/读取路由、原 publication 时间来源与窗口、数据源/采样时间/覆盖区间/缺数状态、可空 sales/traffic 指标和订阅通知权限/送达状态；配置记录不能当成调度已开启或通知成功。
5. 用户选择图片时，以原上传 artifactId/version/SHA 和明确 sourceNote 保存为内部图片事实；图片/PDF不解析。如何完成经审阅的外部传输由业务服务决定，不由客户端直接连接 Shopify。

Cnsubscribe Agent Service 是权限、预算、任务记录、审批和验收的业务控制点。客户端只使用这一个业务 API；执行内核复用 Pi SDK，Durable 恢复待主任务验证。原 Muse/Dot 协议和身份/订单/租约/回执保留为适配边界；包不加载 DSH/Cordis/fullHarness，也不新造 Loop/DAG/Worker 调度器。真实账号、Shopify 授权、通知、生产与独立审核均无新增动作。
