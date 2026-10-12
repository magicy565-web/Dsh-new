# 原采购会话小程序导入

解压 ZIP，微信开发者工具导入含 project.config.json 的目录。本包保留原 Muse 精灵、同一会话和 composer，只增加按需展开的原采购需求及明确审阅后的关联/回复。默认 touristappid、空 baseUrl、urlCheck:true；没有真实账号或已运行的微信平台验收。官方 API 类型为 miniprogram-api-typings@5.2.3，request.redirect 需要基础库 3.2.2 或更新。

连接 PR41 a5a524a 的原 Workspace 业务服务，客户端仅用采购两读两写，不创建买方身份、RFQ、分享协议、模型任务或订单。只有采购方已经明确共享的 active inquiry 才显示；关联要确认原范围，回复要完整审阅本次文字。关联资料/附件不追加到外发 body。断网或未知结果通过原写前 journal 复用 requestId/body，重进取回原会话及实际回复。目标/Muse 流程仍用既有草案与独立审批/派发协议。

客户端和包不加载 DSH、Cordis、旧 fullHarness 或另一个调度器。Cnsubscribe Agent Service 掌握权限、预算、任务记录、审批和验收，执行内核由主任务复用 Pi SDK；Durable 恢复能力由主任务验证。既有 Muse/Dot 协议只作为业务服务适配边界。

3 项真实本地 HTTP/MCP/Store 客户端业务测试及原客户端 35 项回归通过。截图为原 Page/WXML/WXSS 的有限 Chromium 模拟，非微信引擎/开发者工具/真机；模型调用、任务和订单均为零。本任务没有重新运行或替代受拦独立安全审核，没有访问关闭的华为生产、真实 Shopify、真实买方或付费模型。

最少上线操作：使用既有审核账号、成员映射和 HTTPS 私有入口配置原登录 broker；客户端只配置公开 baseUrl、真实 AppID、合法域名与隐私说明。AppSecret、签名、证书、角色和预算决策留在服务端。然后在微信开发者工具及 iOS/Android 真机验证登录、恢复、确认和文件，再由授权账号提审。Shopify 授权、微信订阅通知及独立安全验收尚未完成；供应商 Listing/7天指标须等待后端稳定契约，不以本采购包声称已实现。没有用户可访问的云端预览 URL。
