# 当前固定客户端组合：首次采样与原生登录报告

本轮固定主后端 **1ebc5f7e6a34fa4965fb2abfc61f73b891a920d9（PR54）**，接口代码 **7e2fa155197e42bb2020b53c38527ad8b309553d**，消费 [闭合JSON契约](../docs/NOTIFICATION-CLOSURE-CONTRACT.json)。客户端功能 **4f7d800**，最终弹窗说明修正 **185c82b**；同一独立分支 `codex/wechat-shopify-write-20261012`、[Draft PR52](https://github.com/magicy565-web/workspace-agent/pull/52)。本PR当前head是最终单一组合源码，前面的25c5559/97项和repair/publication检查点保留为历史记录。

作者只改 `miniprogram/` 源码、普通测试、说明与证据；后台/API/.env.example都是合入主任务固定提交，没有自行改server、根依赖/锁、共享构建或另建后台/UI。保留原Muse精灵、主会话、原商品卡片、资源详情和审批sheet，保留草稿/图片外发、精确渠道发布、repair及原请求只读恢复。

## 实现与信任边界

首次采样在同一个原监测卡片单独呈现，只用服务端 `/notification-first-status/:monitorId` 的原首次完成check来源、messageId/revision/contentHash；未结束七天时不生成或冒充七天总结。所有首次动作明确带 `phase:first_sample`，独立一次性客户端报告、模板、approval、scopeHash与outbox，单独配置和Connector action默认关闭；原summary路径省略phase保持兼容。旧Connector不自动增加 `supplier.monitor.first_notification`。

准备challenge之后，另一次明确点击同步调用 `wx.requestSubscribeMessage`，准确模板取自服务端，默认确认未勾选。首次采样和七天总结各调用自己的模板，不自动追加弹窗/订阅/发送。errMsg、设置或用户文字不能代替准确模板决定；AppID不符、未登录、绑定缺失、未配置时阻挡，不能手填OpenID。

当前客户端直接读取服务端 `recipientBindings` 的非秘密id/revision/AppID，匹配当前原生AppID。身份由原code2session、原审核成员映射和原Session登录接入；客户端不创建账号、身份、token或角色。旧 `Options.notificationBinding` 仅保留旧DTO的宿主只读边界，新闭合DTO不允许通过它绕过空绑定或AppID不符。

弹窗决定是 **authenticated_client_report**，**platformAuthorization=unverified_until_send**：服务端核对当前原登录、Session/challenge/phase/AppID/template，并记录客户端报告；不是签名或独立核验的微信订阅授权证明。认证用户仍可能谎报弹窗结果，客户端及文档不掩盖这一限制。原独立review/approve/deny/execute仍必要，实际发送API是平台权限最终执行点。提供方accepted不等于设备送达、用户已读或业务验收；local_fixture不是真实发送，userRead仍unknown、businessAcceptance仍not_recorded。

审批展示准确phase、原来源check/消息/hash/revision、当前绑定、客户端报告引用、模板、原operation/scopeHash。批准不执行；首次和summary不能跨用报告或审批。unknown只GET准确phase/operation，不重发或编造deliveryKey送达查询；未接收执行须先读取，再另一次明确确认同一原UUID/body。取消/撤销保留phase，只作用于准确原对象；已交接取消不能声称撤回。七天总结更正保留submittedSummary、同一messageId，不再次推送。原GA4详情浏览事件保持sessions:null、partial/quality/null含义。

首次status读取不会延迟原summary采样投影，旧冷恢复流程保留；首次来源与summary分别复验和展示。journal按owner/baseUrl隔离，保留原UUID/body及phase下的非秘密报告引用，不存微信code、OpenID、session token、CSRF、access token或原始proof。旧Session challenge冷恢复先复用原请求核对，之后需为当前会话重新准备并明确点击，不沿用旧会话授权。

## 最终实际验证

| 验证 | 结果 | 证据 |
|---|---|---|
| build:mini + 官方API typings5.2.3 | pass；编译不是微信运行 | [build](evidence/closure/build-final.txt) |
| 普通客户端、原微信协议、Muse/采购/供应商/publication/repair/GA4/summary/first组合 | **105/105，0fail/skip**；原97加首次闭合8项含子项 | [最终原日志](evidence/closure/client-regression-final.txt) |
| 首次采样原界面有限Chromium | **十组检查、零页面错误、320无横向溢出** | [结果](evidence/closure/browser/acceptance.json) |
| 最终后端上的七天summary原界面回归 | **十组检查、零页面错误、320无横向溢出** | [结果](evidence/closure/summary-browser/acceptance.json) |

普通测试链是编译native Page/Component → 原签名loopback企业HTTP → 原Store/capabilities/GA4/Shopify/notification adapter → **loopback HTTP合成来源**。事实整理是官方Pi faux。wx弹窗是明确标注callback fixture，既有Session的身份注册也是明确的本地测试布置：使用隔离的合成原生身份调用原私有登记端口，不是实际code2session或真实微信登录。平台结果、绑定与消息均不能拿来当作官方/真机/实店通过。没有运行受阻独立安全审核。

新增8项覆盖：实际第一次完成check在七天前，独立first模板/客户端报告/source/hash/approve/execute且无summary/outbox；first独立关闭、summary报告不能跨用；两个phase需要两次明确弹窗和不同引用/审批，旧Connector不扩能力；公有绑定只含id/revision/AppID、AppID不符零弹窗；first provider+本地响应未知冷读准确phase不重发；first取消/撤销不动summary。原26项summary/traffic与原71项含草稿/发布/repair全部保留通过。

首次浏览器记录 **一个原生callback fixture、一次本地provider POST**，没有创建七天summary/outbox；接受仅local_fixture，未验证设备送达/已读。summary浏览器另用两个明确原monitor，各一次本地provider POST；更正不再发，unknown只读保持原次数。

- [首次原check，不是七天总结](evidence/closure/browser/first-real-original-check-no-seven-day-summary-390.png)
- [原生弹窗决定仅客户端报告](evidence/closure/browser/first-native-popup-report-not-platform-proof-390.png)
- [首次原来源审阅](evidence/closure/browser/first-original-source-review-390.png)
- [独立准确first审批](evidence/closure/browser/first-separate-exact-scope-approval-390.png)
- [批准尚未执行](evidence/closure/browser/first-approved-not-executed-390.png)
- [本地提供方接受，不是设备送达](evidence/closure/browser/first-fixture-provider-accept-not-device-delivery-390.png)
- [同一卡片、独立phase、320px](evidence/closure/browser/single-original-card-two-independent-phases-320.png)
- [summary仍保留商品事件/sessionsnull](evidence/closure/summary-browser/actual-product-view-events-not-sessions-390.png)
- [summary未知结果只读不重发](evidence/closure/summary-browser/unknown-notification-status-no-resend-390.png)

[首次组合78pass/19fail](evidence/closure/client-regression-first.txt)保留：旧fixture只有注入callback、没有原登录公开绑定，被新客户端正确阻挡；first状态读取也增加了旧冷恢复投影的等待。fixture现在明确登记隔离测试Session，客户端先投影原summary再读取first。[补验25pass/1fail](evidence/closure/monitor-second.txt)仅旧错误文案断言没有包含新的“客户端报告”，修正文字匹配但保留零伪授权断言；最终105项通过。新UI说明额外修正native阶段通用“执行已批准操作”注记，明确尚未批准或发送。旧检查点截图/包未覆盖。

复现：`npm run build:mini` → `node --test miniprogram/test/*test.mjs test/miniprogram-client.test.mjs` → `node miniprogram/test/notification-closure-browser.mjs`。summary组合截图使用 `WECHAT_BROWSER_OUTPUT=../evidence/closure/summary-browser/ WECHAT_BACKEND_SOURCE=1ebc5f7e6a34fa4965fb2abfc61f73b891a920d9 WECHAT_CONTRACT_SOURCE=7e2fa155197e42bb2020b53c38527ad8b309553d node miniprogram/test/monitor-browser.mjs`。当前可导入目录由本固定源码构建为 `release/miniprogram`；本轮不重复归档，旧20:30 ZIP/client v2不包含当前PR52增量。

## 剩余实际操作与未通过项

PR54已实现此前原生绑定/客户端报告接线与first动作，不再把它们列为缺代码；它没有把客户端报告变成独立微信授权证明。当前官方微信发送/订阅协议仍待负责人核对，`officialContractReviewed`应继续false；官方网页访问失败和官方types编译都不能代替该核对。[官方API typings来源](https://github.com/wechat-miniprogram/api-typings/blob/master/types/wx/lib.wx.api.d.ts)仅用于客户端参数/回调边界。

最少配置/用户操作：提供既有受审AppID、工具/设备、原成员映射和受信loginBroker/baseUrl/合法域名；负责人选择既有私有配置和token snapshot的读取路径，核对AppID、一次性模板/字段/当前官方服务端契约；first模板另行配置启用、原Connector action与Schedule按原权限审阅；用户通过原登录进入，在真实设备明确点击各phase原生订阅、准确批准和执行，再核对真实回执。现有GA4/shop/item映射、采集起点和原授权仍需真实验证。客户端不配置私有token路径、不创建/刷新token、不注册模板、不扩权。

未执行：真实微信code2session/弹窗/工具/真机/审核、真实模型/Shopify/GA4/消息/设备送达/已读/业务验收、实际连续七天、真实Muse在线。未真实请求权限、发送、生产探测/部署、付费、main修改合并强推或创建凭据；关闭华为未访问。后端651pass/7skip是主任务的证据，本轮自行完成的是上述105项客户端组合和本地界面验证。
