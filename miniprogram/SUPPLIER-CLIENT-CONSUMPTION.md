# 供应商小程序稳定契约消费

当前独立集成分支 codex/wechat-supplier-integrated-20261012，Draft PR46，最终源码 b7f97f3；已保留采购 PR42 与组件 PR43，从 b210576438f72ee7683e736aa17452a3097a33cf 继续整合固定后端 faaf124d077812b4b86a5d584c1111d3dbdf93fe。具体交付、48项测试、真实本地HTTP与源码截图/包见 [最终验收](SUPPLIER-FINAL-ACCEPTANCE.md)。不修改 server、根构建/锁或网页。

消费原 owner-scoped supplier-services collection/detail；Pi initial/messages；profile 精确事实；preview 的 expectedRevision/confirmed/publicFields；原鉴权 images 字节与 SHA；save-product 原资料库回执；shopify-draft 的准确预览 hash 和明确 blocked 结果；shopify-observation 原商品/渠道；monitors 配置/读取、monitor-check、monitor-summary、monitor-stop。CID编码一次，写入复用原 UUID/body 和既有 journal。确认具体 service revision/profileHash 或 monitor scopeHash；字段选择默认空，更新后重新审阅。图片/PDF不解析，引用不是外发许可。

一个业务控制点：Cnsubscribe Agent Service 管权限、预算、任务记录、审批、验收。客户端只用该业务 API；云端执行内核 Pi SDK，Durable恢复待主任务验证；原 Muse/Dot 协议/身份/订单/租约/回执保留为适配边界。客户端不加载 DSH/Cordis/fullHarness，不新建 Loop/DAG/Worker 或另一个后台。

原产品二次保存前后版本：b210576实测409 SUPPLIER_SAVE_PENDING；faaf124主后端已用按请求回执修复。本客户端重跑相同业务，确认同一原产品ID/修订2、丢回执冷恢复、唯一产品，不能把旧失败自动认定已修。准确前后记录见最终验收。新增消费 cancel/reject，绑定 revision/profileHash 并明确确认；停止后旧范围不可编辑或恢复，新商品需明确选择。没有自行改后端，也不使用PR44旧整合覆盖。

真实 Shopify 创建/发布仍 blocked；ACTIVE不等于发布；七天配置 disabled_requires_original_schedule_approval 不等于启用，缺数为 null、带来源/窗口/状态；原会话总结更正同一消息，外部通知 not_configured。真实账号、Shopify授权/七天数据、微信官方工具/真机/审核/订阅及独立安全验收不在已通过范围。受拦独立审核不执行也不替代。最少操作见 [导入](SUPPLIER-IMPORT.md)。没有访问生产/付费服务、创建真实凭据或扩大权限。
