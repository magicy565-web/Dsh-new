# 原供应商字段与必要预览检查

本轮客户端检查沿用原服务DTO，不新增后台/表单或猜API。

| 用户目标 | 原字段 | 原界面位置与含义 |
|---|---|---|
| 产品与描述 | name、description、skuCode | 原内部资料、必要缺项、Listing标题/描述/SKU |
| 目标市场 | targetMarket、currency | 原事实和预览审阅显示国家/币种，Listing显示销售国家/消费币种 |
| 生产MOQ | supplierMoq、supplierUnit | 原内部资料/供货摘要，不作为零售包装数量 |
| 报价 | wholesaleUnitPrice、wholesaleCurrency | 原内部供货报价，不作为消费者售价 |
| 零售价 | consumerPrice、currency | 明确消费者实际售价；recommendedRetailPrice只为未确认建议/内部字段 |
| 生产交期 | productionDays | 原内部资料/供货摘要；不作为消费者处理/运输天数 |
| 发货/交付期 | handlingDays、shippingDays | 逐项审阅；Listing单列处理及发货/运输，不依赖描述段落 |
| 图片 | images的原artifact/version/SHA或public_url/sourceNote | 内部关联、预览准确来源和可用性、核对SHA打开原图片；外发另行审批 |
| 可销售单元 | retailUnit、unitsPerPack | 原明确零售单元和每包数量，不从MOQ推断 |
| 七天单品监测通知 | 原monitor/check/source/summary和各phase通知 | 原商品/变体/时间窗口/销售口径、v2浏览事件与sessionsnull、独立通知审批/执行和未知结果 |

实际修正：原 `presentSupplierPreview` 已计算fulfillment，但原WXML未显式渲染；在现有组件补一行同款muted文本。新的原编译Component/WXML测试确认产品、描述、市场、售价、单元、SKU、处理及发货/运输均可见，即使描述段落不包含交付信息；空值仍“尚未提供”，不是0或生产天数。日志为`miniprogram/evidence/shop-readiness/field-completeness-ui.txt`，是本地原DTO输入/原组件浏览器验证，不是实际商店、模型或微信验收。

图片/PDF解析能力沿用诚实提示，资料关联不代表外发授权。readiness固定契约未收到时，不把原配置、网页登录或token存在作为店铺授权通过。所有就绪接入将依实际固定后端契约完成，原SKU、供货事实、预览和监测流程保持。
