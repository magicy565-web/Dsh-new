# 小程序原采购会话接线

基线PR41 a5a524a19adf065f804abc1459f1f573cfd8adf4，已含PR38。只消费原两读：GET /api/supply/inquiries、GET /api/conversations/:encodedId/procurement；原两写：POST /api/supply/inquiries/:id/conversation与/reply。关联body仅requestId/expectedRevision/conversationId/confirmed:true；回复body仅requestId/expectedRevision/expectedShareHash/content/confirmed:true。没有新建RFQ/分享协议/买方身份。需求摘要、数量/目的地/备注、原SKU/产品及供货修订、共享范围均来自既有active share。

采购需求按需展开；关联先审阅完整共享范围并明确确认，刷新incremented revision后才可回复。使用同一composer，提交前完整审阅仅本次回复文字和原需求；不会把关联产品/企业资料/输入文件追加到外发body。切换回复保留尚未提交的目标/文件，返回后恢复。无Muse绑定可处理采购数据，新建主会话使用服务端真实createdBy/workspaceId/原幂等创建；不认领历史无归属会话，不普通Pi替代Muse目标。读、关联、回复都不调用模型。

关联与回复均走既有写前journal，未知结果重进后原requestId/body复用，同一采购方通过原MCP取回实际持久reply。官方微信/真实买方/Muse/通知未验证，受拦独立安全审核不执行也不替代，生产关闭且不访问。

供应商后续可复用：composer、仅必要questions的草案卡、版本/hash审阅与独立确认、同body/requestId恢复、真实文件和结果卡。最小稳定契约需服务端提供：原会话supplier服务绑定与capability；持久草案id/revision/hash和明确missingFields/suggestions；产品/市场/MOQ/批发价/零售价/生产及发货期/原图片ID/version/SHA的准确单位/币种/时间定义；目标Shopify真实店铺及权限状态；商品预览的确切字段范围；编辑/拒绝/确认/实际发布的独立幂等操作和回执；实际商品ID/店铺链接；七天sales/traffic数据来源、窗口、刷新时间、缺数/错误状态；通知订阅/权限/送达回执。模型建议和预览不等于发布授权，不自造商品ID、业绩或通知成功。后端未固定前不猜route或请求字段。本任务只先完成采购检查点。
