# 最终供应商客户端交接

最终客户端源码 **b7f97f3bed8bdca0592a6b42f01b3035cb5b7f8b**，固定后端 **faaf124d077812b4b86a5d584c1111d3dbdf93fe**；独立分支 `codex/wechat-supplier-integrated-20261012`、Draft [PR46](https://github.com/magicy565-web/workspace-agent/pull/46)。相对 faaf124 只改小程序/其测试/说明/证据，没有自行改 server、根 package/锁、共享构建、网页、主分支或部署。没有使用 PR44 的旧 b210576/dd91cfc 整合覆盖新版。

| 版本 | 实际结果 |
|---|---|
| 采购 PR42 `1666719` | 原采购两读两写、同一 composer、完整范围确认、冷恢复；已保留 |
| 供应商组件 PR43 `dd91cfc` + 后端 `0f12d2a` | 确定字段与原组件 preflight；不是 HTTP 完成声明 |
| 初始集成 `3e33f22`/交付 `9528da0` + `b210576` | 47 项业务通过；二次保存原产品单列 **409 SUPPLIER_SAVE_PENDING**，没有算通过 |
| 最终 `b7f97f3` + `faaf124` | **48/48**；二次保存更新同一原产品 ID/修订2，丢回执恢复；取消/拒绝、旧范围失效与明确新商品通过 |

用户仍在原 Muse 风格主会话表达商品事实。Pi 只保存明确引用的信息，未知保留 null、建议不当事实；零售包装/消费价/处理运输期不从 MOQ、批发/建议价、生产期猜出。原图片上传/鉴权下载核对 ID/version/SHA，不解析图片或 PDF，不把关联资料变成外发许可。资源按需展开，完整预览字段默认不选；确认当前修订/hash 后生成服务端 Listing 预览。原产品库保存使用实际回执，不另建产品绕过失效请求。Shopify 观察仅看明确选择的已有商品；取消/拒绝绑定精确商品 revision/profileHash，保留事实/历史并使预览失效，旧整理不可恢复，新商品须明确选择。原 Pi 进度卡明确为商品事实整理，不冒充外部执行。

## 最终验证

- [官方微信 API types5.2.3 编译](evidence/supplier/integrated/build-final-faaf124.txt)：pass，不能当微信运行。
- [客户端正常业务/回归 **48/48，0 fail/skip**](evidence/supplier/integrated/final-48-faaf124-tests.txt)：保留原 Muse/采购测试，新增供应商五项。
- [真实本地签名 HTTP/Pi SDK/Store **5/5**](evidence/supplier/integrated/http-5-faaf124.txt)：原 Page→业务 HTTP→持久化；Pi 为官方 faux，非真实模型/微信/店铺。包括 intake/preview/library/monitor-check 丢回执冷重启，复用原 UUID/body、唯一原实体、无额外模型或 API 读取。
- [最终原 Page/Component/WXML/WXSS Chromium 模拟](evidence/supplier/final-faaf124/browser/acceptance.json)：**十一组检查，零页面错误，390/320 无横向溢出**；两次 faux 模型调用、零 Worker order/外部 Shopify 调用、一条原总结。是有限源码渲染器，不是微信引擎/开发者工具/真机。
- [新版 ZIP 干净解压/字节/SHA/JS syntax](evidence/supplier/final-faaf124/package-verification.json)：**32 文件**匹配当前源码构建、仅本地 imports、无 DSH/Cordis/fullHarness、后端或账号秘密。

第五项实跑先保存原产品，修改明确事实后更新同一 ID、产品修订增至2；丢第二次保存回执并重启，恢复原保存结果，仍只有一个产品。旧 revision 的预览确认被客户端拒绝；拒绝原商品后预览为 null，旧整理不能再发；明确新商品才创建另一服务，原产品仍唯一。

前后复现：b210576 [原失败](evidence/supplier/integrated/product-update-gap.txt)；faaf124 [同一业务成功](evidence/supplier/final-faaf124/product-update-fixed.txt)。早期 `product-update-faaf124.txt` 使用未更新的日志标签，不能据它认定 b210576 修复；以上最终记录与五项 HTTP 的同一 ID/修订2/唯一产品断言为准。后端修复来自 faaf124 的按请求 `productSaves` 回执与原 `updateProduct`，客户端没有修改后端或另造产品。

只读 Shopify adapter fixture 经真实后端验证 ACTIVE 仍未发布；晚到退款将原七天 summary/messageId 更正至修订2，notificationCount 仍1。丢采样回执后冷恢复不再次读取 adapter、不新增总结或模型调用；所有 GraphQL 是 query。它不是实际店铺/授权/线上业绩。七天配置仍需原 Schedule 单独审批，缺销量/产品流量为 null 与真实状态/来源/覆盖，原会话总结不代表外部通知。

## 图片与包

截图均标注“原源码 Chromium 模拟 · 本地 HTTP/Pi faux · 非微信/Shopify”：

- [当前 Listing 预览](evidence/supplier/final-faaf124/browser/actual-service-listing-preview-390.png)
- [必要事实缺项](evidence/supplier/final-faaf124/browser/necessary-product-facts-390.png)
- [准确字段审阅](evidence/supplier/final-faaf124/browser/exact-retail-scope-390.png)
- [原图片 SHA](evidence/supplier/final-faaf124/browser/original-image-sha-390.png)
- [七天缺数/原总结](evidence/supplier/final-faaf124/browser/seven-day-null-data-summary-390.png)
- [取消状态与失效预览](evidence/supplier/final-faaf124/browser/cancelled-intake-390.png)
- [320px](evidence/supplier/final-faaf124/browser/compact-320.png)

Library 同一文件 `/actual-service-listing-preview-390.png` 已更新至 **版本1**，保留版本0。真实 Library身份/文件ID/源码与后端关系见 [保存记录](evidence/supplier/final-faaf124/library-screenshot.json)。版本0对应3e33f22，版本1对应b7f97f3；未伪造文件ID或外部共享。

[最终导入 ZIP v2](deliverables/Workspace-Agent-WeChat-Supplier-Service-Client-v2.zip)：**66,862 bytes**；SHA256 **b5b873805d4237f400668999cb61f0b0d07caab3296701968e34c23c0e26ab41**；[manifest](deliverables/Workspace-Agent-WeChat-Supplier-Service-Client-v2-BUILD-MANIFEST.json)、[步骤](SUPPLIER-IMPORT.md)。空 baseUrl、touristappid、urlCheck:true，无真实 broker 时明确阻挡。旧 ZIP v1/47项证据保留，不能当当前版本。

复现：`npm ci --ignore-scripts --cache /tmp/wechat-npm-cache` → `npm run build:mini` → `node --test miniprogram/test/supplier-http.test.mjs` → `node miniprogram/test/supplier-browser.mjs`。无需真实账号、付费或生产。合跑命令包含原 Muse 六文件、采购测试、supplier-view、supplier-review-component、supplier-http，共48项。

## 仍未验证

真实微信登录/开发者工具/iOS/Android/审核/通知权限、真实 Shopify 授权/商品创建和渠道发布/七天线上数据、线上 Muse/Dot 原 Connector 与独立安全验收尚未完成。当前 Shopify create/publish 仍 blocked，预览不是真实 Shopify 商品；ACTIVE 不等于发布，UNLISTED 的实际发布仍只能依据原观察。配置不是 Schedule 已启用，null 不按零处理，外部通知 not_configured。

最少操作：用既有授权账号/成员映射/HTTPS broker 配置公开 baseUrl、真实 AppID/合法域名/隐私并跑官方工具和双平台真机；店铺经既有授权流程配置准确只读身份，写入/发布继续等待独立业务审批；原 Schedule 单独审批，通知需真实权限和送达契约。Cnsubscribe Agent Service 管权限/预算/任务/审批/验收，Pi SDK 在云端；Durable恢复由主任务验证。没有另造 Loop/DAG/Worker，没有实际凭据创建/扩权/付费/生产访问/主分支修改/合并/强推/部署，也未重复或替代受拦独立安全审查。关闭的华为生产未访问，无用户可访问的云端预览 URL。
