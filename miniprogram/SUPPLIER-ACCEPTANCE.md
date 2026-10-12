# 原供应商会话客户端交付（b210576历史版本）

当前交接以 [faaf124最终验收](SUPPLIER-FINAL-ACCEPTANCE.md) 为准；本记录保留3e33f22/v1/47项与旧失败，不代表当前阻挡。

源码检查点 **3e33f22efbd5b8c75172d001b7642f32df74deaa**；独立分支 `codex/wechat-supplier-integrated-20261012`，Draft [PR46](https://github.com/magicy565-web/workspace-agent/pull/46)。保留采购 PR42 `1666719` 与供应商组件 PR43 `dd91cfc`，整合后端固定 **b210576438f72ee7683e736aa17452a3097a33cf**。相对后端基线只新增/修改小程序客户端、其测试/证据/说明；server 变更来自该固定提交，没有自行修改 server、根 package/锁、共享构建或网页。

用户在原主会话点“商品服务”，复用同一输入框和 Muse 精灵：Pi 保存明确引述的商品事实→只展示服务端缺项/未确认建议→单独审阅真实图片来源→准确字段生成服务端预览→原内部产品库回执→已有 Shopify 商品观察→七天原任务配置、采样、同一原会话总结、停止。商品资源按需展开，无表单后台。MOQ/批发价/建议价/生产期不能代填零售包装、消费售价、处理/运输期。字段选择默认空，事实/修订变化重置；输入关联/图片来源不授权外发，图片/PDF没有解析或假提取。

## 已通过

| 检查 | 实际结果 | 证据 |
|---|---|---|
| 官方 miniprogram-api-typings@5.2.3 编译 | pass；不能冒充微信运行 | [build](evidence/supplier/integrated/build-package.txt) |
| 客户端正常业务/回归合跑 | **47/47 pass，0 fail/skip**；含原 Muse、采购与供应商 | [完整日志](evidence/supplier/integrated/final-47-tests.txt) |
| 其中供应商原 Page→签名本地 HTTP/Pi SDK/Store | **4/4 pass**；第四项含明确标注的只读 Shopify 响应 adapter fixture | [供应商 HTTP](evidence/supplier/integrated/http-with-check-recovery.txt) |
| 原 Page/Component/WXML/WXSS 有限 Chromium 模拟 | 十组检查、零页面错误、390/320 无横向溢出 | [结果](evidence/supplier/integrated/browser/acceptance.json) |
| 新导入 ZIP 干净解压/文件哈希/JS syntax/依赖 | **32 文件**逐字节一致、只有本地 imports、无后端/账号秘密/DSH/Cordis Runtime | [包核验](evidence/supplier/integrated/package-verification.json) |

真实本地业务链观察到：quote-verified 供货事实→同一服务必要零售缺项→明确零售事实→原 artifact 上传返回实际 ID/version/SHA→单独确认内部图片来源→九个准确预览字段确认→实际持久 preview/revision/contentHash→鉴权图片下载，SHA 不符拒绝显示、匹配后原字节预览→原产品库保存实际产品/供货 SKU/MOQ/价格/生产期→Shopify 未配置返回 blocked。没有外部模型付费或创建/发布调用。

丢 intake/preview/library 回执后重启客户端与服务，原 UUID/body 复用，仍只有原 Pi run/预览/原产品；原事实不会变成普通 Pi/Muse 代替请求。七天配置创建原 goal/schedule，保持 disabled；确认后读取的缺销量/流量仍 null，附状态、覆盖、采样时间与来源。原总结只有一条稳定消息；重读/重进保留该消息，停止准确原 monitor/hash 与原 Schedule。

第四项 HTTP 用例经实际后端只读 Shopify client、**确定性远端响应 fixture（非真实店铺/授权）** 验证 ACTIVE+未发布状态。首次七天 cohort 保留 3 单位，晚到退款后保留 2、退款 1；实际后端将同一 summary/messageId 修订为 2，notificationCount 仍 1。丢这次采样回执并冷重启，复用同一原 UUID/body，未再次读 adapter，未新增总结或模型调用。所有 adapter GraphQL 均为 query，未调用 mutation。这里的订单/GID、临时签名身份和模型响应均为明确标注 fixture，不是线上业绩或账号。

47 个通过测试**不包含、也不替代受拦的独立安全审核**。没有重新执行它。原 Muse 回归仍是已有业务协议测试，未声称真实 Muse/Dot/微信执行。Pi 使用官方 faux provider；浏览器为原编译 Page/Component 回调加有限 WXML 渲染器，不是微信引擎/开发者工具/真机。签名网关身份只在测试内存，测试目录和后台不进入包。

## 页面与导入包

每张截图注明“小程序原源码 Chromium 模拟 · 本地 HTTP/Pi faux · 非微信/Shopify”：

供应商预览截图亦已按用户请求保存 Library：`/actual-service-listing-preview-390.png`，实际返回的文件/版本身份见 [保存记录](evidence/supplier/integrated/library-screenshot.json)。保存的是上述源码模拟图片，没有真实账号、支付或店铺信息，没有外部共享。

- [商品事实与必要缺项](evidence/supplier/integrated/browser/necessary-product-facts-390.png)
- [准确图片来源审阅](evidence/supplier/integrated/browser/exact-image-source-390.png)
- [默认未选择的零售字段](evidence/supplier/integrated/browser/exact-retail-scope-390.png)
- [实际服务端 Listing 预览](evidence/supplier/integrated/browser/actual-service-listing-preview-390.png)
- [原鉴权图片 SHA](evidence/supplier/integrated/browser/original-image-sha-390.png)
- [真实 Shopify 阻挡](evidence/supplier/integrated/browser/shopify-blocked-390.png)
- [准确七天配置](evidence/supplier/integrated/browser/seven-day-exact-configuration-390.png)
- [七天缺数与原会话总结](evidence/supplier/integrated/browser/seven-day-null-data-summary-390.png)
- [重进原总结](evidence/supplier/integrated/browser/reopened-original-summary-390.png)
- [320px](evidence/supplier/integrated/browser/compact-320.png)

[可导入 ZIP](deliverables/Workspace-Agent-WeChat-Supplier-Service-Client.zip)：**66,214 bytes**；SHA256 **31aab0192cfafe75941d1fb538693c1e0ec0ae4922bbc69dc5f2015060844a81**；[manifest](deliverables/Workspace-Agent-WeChat-Supplier-Service-Client-BUILD-MANIFEST.json)、[最少导入/账号步骤](SUPPLIER-IMPORT.md)。默认 touristappid/空 baseUrl/urlCheck:true；未配置真实 broker 时阻挡。32 个编译/配置/素材文件与检查点构建一致，无 DSH/Cordis/fullHarness 或 Pi SDK 运行依赖、秘密或后端。Pi SDK 与业务审批/预算/任务记录在云端 Cnsubscribe Agent Service，Durable 恢复由主任务验证。旧采购/Muse 包按原检查点保留，不能当本次新构建。没有用户可访问的云端预览 URL。

复现：`npm ci --ignore-scripts --cache /tmp/wechat-npm-cache` → `npm run build:mini` → `node --test miniprogram/test/supplier-http.test.mjs` → `node miniprogram/test/supplier-browser.mjs`。47 项完整命令为原 Muse 验收六文件、采购测试、supplier-view、supplier-review-component、supplier-http 合跑。复现不需真实账号、网络店铺、付费模型或生产。

## 当前阻挡与未通过项

**原产品再次保存：实测未通过。** 在 b210576，首次保存成功，修改事实后第二次保存同一原产品返回 **409 SUPPLIER_SAVE_PENDING**；当前仍只有一个原产品，最新商品事实已保存。客户端如实阻挡，没有另建产品/换请求绕过；[实际记录](evidence/supplier/integrated/product-update-gap.txt)、[普通业务复现](test/supplier-contract-gap.mjs)。需要主后端处理已完成的旧保存回执，按新修订更新原产品并保留原请求恢复。该阻挡单列，不计入47个通过项。

真实微信 code/account、官方工具+iOS/Android真机、审核发布和通知权限仍未验收。真实 Shopify 授权未提供，商品创建/渠道发布在当前后端仍禁用；ACTIVE 不能当发布，预览不能当真实商品 ID。七天配置 **disabled_requires_original_schedule_approval** 不代表已启用或实际持续采样；null 缺数不是零，原站内 summary/notificationCount 不代表外部送达。外部通知未配置。真实店铺七天数据、线上 Pi/Muse执行与独立安全验收仍待完成。

首次 HTTP 失败是 fixture 图片事件漏 index；第二次是 fixture 用 `skuCode`/`wholesaleUnitPrice` 标签不符合原引用校验而保存为未确认建议，导致 SKU 缺失。[首轮](evidence/supplier/integrated/http-first.txt)、[第二轮](evidence/supplier/integrated/http.txt)保留；修为真实控件 index 和后端支持的明确 SKU/批发价标签，增加原事实断言，未绕过后端校验或削弱 SHA/唯一记录断言。全程没有生产部署、关闭华为访问、付费、真实凭据创建/扩权、主分支修改、合并或强推。
