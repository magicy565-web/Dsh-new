# 供应商服务小程序导入

解压 ZIP，在微信开发者工具导入含 project.config.json 的目录。touristappid、空 baseUrl、urlCheck:true 为开发默认；未配置企业入口/微信 broker 时明确阻挡，不产生假登录。本环境没有运行官方微信工具或真机；官方 miniprogram-api-typings@5.2.3 编译通过不等于微信验收。request.redirect 要求基础库 3.2.2 或更新。

这是原 Muse 素材和主会话客户端的延续，已保留采购 PR42/供应商组件 PR43，整合后端固定 b210576。登录后“商品服务”复用同一输入框：Pi 整理明确引述的商品事实→必要缺项→单独审阅原图片 ID/version/SHA 来源→准确字段预览→原产品库回执→已有 Shopify 商品观察→七天配置/采样/原总结/停止。MOQ、批发/建议价、生产期不代填零售包装/消费者售价/发货运输期。图片/PDF不解析，不假提取；关联资料不是外发授权。未知写入复用原 UUID/body，重进核对原服务与持久记录。

Shopify 创建/发布目前没有授权，原服务返回 blocked。ACTIVE 不等于已发布，预览没有真实 Shopify 商品 ID。七天配置只是保存原 goal/schedule，disabled_requires_original_schedule_approval 不表示启用；销量/流量缺数为 null 并附状态与覆盖/来源，原会话总结更正复用同一消息，外部通知未配置。受拦独立安全审核没有重复执行或被这些业务测试替代。

固定后端 b210576 有一个实测待修复的契约缺口：首次保存产品后，修改事实再次保存同一原产品返回 409 SUPPLIER_SAVE_PENDING。客户端显示真实阻挡，未另建产品绕过；完整证据在 SUPPLIER-ACCEPTANCE.md。修复需由主后端处理旧保存回执并更新原产品。本包不是该后端修复。

最少账号操作：使用既有已审查企业身份/成员映射、HTTPS 私有入口及原微信 code→Session broker；客户端只填公开 baseUrl、真实 AppID、合法域名和隐私说明。AppSecret/签名/证书/角色/预算仅在服务端。跑微信开发者工具和 iOS/Android 真机后，由有权限账号提审。真实 Shopify 只读授权/准确商品身份需由既有授权流程配置；创建/发布仍需业务服务额外明确审批，不能由本包开启。七天 Schedule 需通过既有原审批设施单独启用，微信订阅通知需真实权限和服务契约。目前不声称真实登录、店铺发布、七天实测数据或外部通知通过。

客户端只有原业务 API 与本地模块，不加载 DSH/Cordis/fullHarness 或云端 Pi SDK，不另造 Loop/DAG/Worker。Cnsubscribe Agent Service 管权限、预算、任务、审批、验收；Pi SDK 是云端执行内核，Durable 恢复组件由主任务验证。无账号秘密进入 ZIP，没有生产/付费调用、凭据创建、扩权、主分支修改或部署；关闭的华为生产未访问。没有用户可访问的云端预览 URL。
