当前增量交付继续 Draft PR52，包含 Shopify draft/publish 与 `repair_draft`，后端固定952db1a。见 [修复验收](DRAFT-REPAIR-ACCEPTANCE.md)：普通客户端与原微信协议71/71；截图为原源码Chromium/本地HTTP模拟，真实微信和真实Shopify验收未完成。旧ZIP保持旧版标记，不包含本轮增量。

# 微信开发客户端导入

解压 `Workspace-Agent-WeChat-Client.zip`，在微信开发者工具选择“导入项目”，选择含 `project.config.json` 的解压根目录。也可先 `npm ci --cache /tmp/wechat-npm-cache`，再 `npm run build:mini`，导入 `release/miniprogram`。

交付包是原单页小程序的编译代码和既有精灵素材，已经对照源码编译结果逐字节核对。`touristappid` 仅为开发项目配置；默认 `baseUrl` 空、`loginBroker` 缺省，首页会清楚提示服务尚未绑定，登录不能伪造身份。`urlCheck` 保持 true。账号/真机/微信平台审核没有在此环境完成，不要把编译和 Chromium 模拟截图当作这些验收。

最少接入操作：

1. 由服务负责人按 `CONTRACT-GAPS.md` 接入微信 code 到已有企业 subject 的 broker，并配置已经审核的 HTTPS ingress。AppSecret、成员/角色决策和 ingress 签名只在服务端。客户端只设置公开的 baseUrl 与 broker 调用；会再读 `/api/session` 核对真实 subject/role。
2. 在已有微信小程序账号中设置真实 AppID、请求/下载合法域名及所需隐私声明，使用支持当前 API 的基础库（request.redirect 要求 3.2.2 或更新）。通过开发者工具及 iOS/Android 真机执行登录、断网、退出重进、原审批/停止/文件 SHA 与预览验证，记录结果。
3. 正式提审/发布仍由有权限的账号负责人操作。当前没有订阅通知功能或通知权限申请；如需要，再配置真实订阅模板并通过用户点击授权。

首页直接表达目标，图片/文件按需附加，既有产品/企业/资料在“引用资料”中展开。图片/PDF真实存档，但当前模型不能解析，需文字说明；文字输入文件在发送时进入既有治理的模型输入。关联私有资料不授予外发权限。方案与真实云端进度显示在会话中，完整范围审阅里明确批准/拒绝，执行另行确认。文件从原云端 ID/version/SHA 下载，校验成功才预览。

离开页面只停止客户端读取；云端任务继续。结果不确定时保留同一原请求，可查看原对象再核对。会话令牌、微信 code、CSRF 不落盘；原请求恢复记录按服务和已核对的 subject 分开保存。冷启动需重新登录，再读云端状态。确定拒绝后可修正输入；未知提交结果不会通过换 requestId 解锁。

本环境交付了 Node Page 回调、真实本地 HTTP/Pi/Store 协议测试和原 WXML/WXSS 的 Chromium 运行模拟。没有原 Muse 真实账号执行、模型付费调用或生产访问；实际外部执行仍须原 Connector，客户端不冒充执行端。
