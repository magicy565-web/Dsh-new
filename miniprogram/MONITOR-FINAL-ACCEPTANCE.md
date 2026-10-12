# 统一监测与七天总结通知客户端

固定主后端 **622fbfb6e9d037e548c3ed1d10e5a34a82038da7（PR53）**；代码契约 **ad1545d0efebddadf24e545f93dbdb8571a1e4ab** 的 [JSON](../docs/SUPPLIER-MONITOR-CLIENT-CONTRACT.json)。客户端功能源码 **09edc8b**，继续同一独立分支 `codex/wechat-shopify-write-20261012`、[Draft PR52](https://github.com/magicy565-web/workspace-agent/pull/52)。最终交付为本PR固定head的源码、编译入口、普通测试与证据；旧写入/repair报告是历史检查点，不代表当前统一版本。

客户端作者改动只有 `miniprogram/`：原 conversation Page、原审批 Component、shared DTO/Client/恢复记录、普通测试、说明与证据。后台和公共API完全来自主任务固定提交；没有自行改server、根依赖/锁/共享构建。复用原卡片、资源入口、审批sheet、Muse精灵和素材，没有新后台或另一套UI。保留原 draft/publish/repair 交互和原批准/执行边界。

## 当前可用代码

七天监测仍按原商品、变体范围、明确UTC起点/原核验发布时间创建，保存配置不启用原Schedule。原卡片显示当前采样与通知状态；“查看完整来源与回执”展开原详情，“审阅并读取一次”只调用原check。“停止原监测”通过原stop接口联动取消原通知，没有新队列或调度器。

v2 traffic 明确显示 **商品详情浏览事件**，`metrics.productDetailViews.value`只有原数值才显示数值，null保持不可用，sessions始终不可用；不转换成访客、销量或商品转化率。保留原source/requestedWindow/coverage/granularity/sample time/freshness/dataLag/pagination/sampling/quality/definitions/error；`partial`、`complete=false`、freshness unknown、延迟null不变成完整七天已采集。显式源行0可显示临时0；未配置、缺权限、不支持与无数据不能变成0。v1 sessions保留其原定义。

七天总结通知沿用原monitor/outbox和domain接口，全部围绕准确monitor/hash、既有绑定修订、原一次性订阅、当前总结hash/revision、原notification operation/scopeHash。界面分开：准备服务端challenge → 另一次明确点击原生API → 服务端既有可信设施核验订阅 → 明确审阅/批准或拒绝 → 独立execute → 提供方接受/失败/unknown。原Schedule审批不授予通知权限。默认确认未勾选，文字和引用不替代批准。

原生点击同步调用 `wx.requestSubscribeMessage({tmplIds:[serverTemplate]})`，之前不await/请求HTTP/读取设置。只取准确模板的accept/reject/ban/filter，errMsg或设置单独无效；不构造OpenID、原生证明或授权回执。`notification-subscription-record`由后端可信callback核验准确session/subject/nonce/AppID/template；客户端accept本身不产生权限。拒绝/ban/filter保持revoked，失败不记录accept。

通知配置、传输声明与实际执行证据分开。只认 `notification.delivery.evidenceKind`；platform_accepted只表示提供方接受，userRead保持unknown，businessAcceptance保持not_recorded。local_fixture只能作本地证据。unknown显示automaticRetry=false、reconciliationRequired=true，只GET原status；没有deliveryKey真送达查询设施，不伪造核对或重发。取消已交接通知只记请求，不能声称撤回。

已有发送的submittedSummary不变，原来源更正更新同一latestSummary/messageId，界面显示更正而不再推送。新总结/监测范围变化清空原确认、禁用旧scope；准确deny、cancel、revoke、stop不自动send。execute丢本地响应后跨退出冷恢复只GET准确op/scope；若GET证明没有connectorRun且原审批仍可用，先显示未接收，须另一次明确确认才提交同一原UUID/body。

订阅record回执丢失会复用原body，冷恢复不再次调用微信API。challenge回执丢失同样先复用原UUID核对；重新登录后的新会话不能用旧session-bound challenge取得授权，所以恢复后要求用户为当前可信会话重新准备，再另一次点击原生API。不会自动换nonce/弹订阅来掩盖未知结果。

本地journal只保存非秘密订阅引用（monitor/hash、subscriptionId、bindingId/revision、state/evidenceKind）与原请求；引用不构成权限，服务端每次仍核验。按原owner/baseUrl隔离，换账号/退出清空内存，不保存session token、CSRF、微信code、OpenID、access token或原生proof。

## 组合验证

| 验证 | 结果 | 记录 |
|---|---|---|
| 官方API typings5.2.3的build:mini | pass；不是微信运行 | [build](evidence/monitor-final/build-final.txt) |
| 原客户端/Muse/采购/供应商/draft/publish/repair及新监测通知普通组合 | **97/97，0fail/skip**；其中新流程26项含子用例 | [完整回归](evidence/monitor-final/client-regression-final.txt) |
| 原Page/Component/WXML/WXSS有限Chromium + 本地服务 | **十组检查，零页面错误，320无横向溢出** | [结果](evidence/monitor-final/browser/acceptance.json) |
| 统一后端上原repair流程浏览器回归 | **十组检查通过，零activate/publish，原一次create/upload/variant** | [结果](evidence/monitor-final/repair-browser/acceptance.json) |

实际链路为编译native Component回调 → 原Page → 签名本地企业HTTP → 原Store/capabilities/GA4/Shopify/通知adapter → **loopback HTTP合成GA4/微信/Shopify来源**。wx.requestSubscribeMessage是明确标注的callback fixture，不是开发者工具/微信引擎/真机调用。模型事实整理仅官方Pi faux；所有账号、绑定、源授权、Connector启用都是本地合成测试布置。

26项新流程覆盖：v2事件/sessionsnull、原采样持久回放、不重复GA4读取、同一总结真实更正；缺配置/可信provider/宿主读取边界零native调用/零send；errMsg-only/fail零记录；reject/ban/filter revoked；accept未经可信callback核验不授予引用；订阅、准确审批、独立execute、accepted/read/business分开；deny/revoke/cancel/stop；订阅record与challenge断线恢复；provider unknown与本地execute响应丢失后冷只读无重发；未接收execute同body再确认；总结变更重置；provider拒绝；已accepted后取消不声称撤回。

- [默认provider缺失与未配置/null来源](evidence/monitor-final/browser/default-provider-blocked-null-source-390.png)
- [商品详情浏览事件，sessions不可用](evidence/monitor-final/browser/actual-product-view-events-not-sessions-390.png)
- [独立原生模板challenge](evidence/monitor-final/browser/separate-native-template-challenge-390.png)
- [准确总结/订阅审阅](evidence/monitor-final/browser/exact-summary-subscription-review-390.png)
- [原通知独立批准](evidence/monitor-final/browser/original-summary-approval-390.png)
- [批准尚未执行](evidence/monitor-final/browser/notification-approved-unexecuted-390.png)
- [本地provider接受，已读未知](evidence/monitor-final/browser/fixture-provider-accepted-read-unknown-390.png)
- [同一总结更正，没有二次推送](evidence/monitor-final/browser/same-summary-corrected-without-resend-390.png)
- [准确原通知unknown，只读不重发](evidence/monitor-final/browser/unknown-notification-status-no-resend-390.png)
- [320px原卡片](evidence/monitor-final/browser/same-original-card-compact-320.png)

首轮HTTP18pass/2fail日志[保留](evidence/monitor-final/http-first.txt)：GA4新检查需兼容性+report，测试少算一次；本地微信HTTP response.url被adapter正确判为异址unknown，fixture现保留同一loopback字节而修正仅测试传输元数据，服务端判断未改。扩展恢复首轮[25pass/1fail](evidence/monitor-final/http-recovery-initial.txt)发现旧会话challenge不能授权新会话，按上述边界修正代码；[原组合失败](evidence/monitor-final/client-regression-initial.txt)保留，最终97项通过。浏览器[首次脚本失败](evidence/monitor-final/browser-first.txt)是原确认按钮文字定位不符，已按真实WXML修正；同时移除了模拟器覆盖原WXSS截行的通用样式，客户端视觉未变。旧证据按原版本保留，新组合放独立目录。

复现：`npm run build:mini` → `node --test miniprogram/test/*test.mjs test/miniprogram-client.test.mjs` → `node miniprogram/test/monitor-browser.mjs`。repair组合截图：`WECHAT_BROWSER_OUTPUT=../evidence/monitor-final/repair-browser/ WECHAT_BACKEND_SOURCE=622fbfb6e9d037e548c3ed1d10e5a34a82038da7 node miniprogram/test/draft-repair-browser.mjs`。当前生成的 `release/miniprogram` 可按 [IMPORT](IMPORT.md) 导入；本轮未重复打包，旧20:30 ZIP/client v2不含PR52增量。

## 剩余代码和最少配置

**明确缺代码**：生产可信原生订阅证明设施仍未实现；首采样通知/smoke动作未实现，当前只覆盖完成七天窗口总结。状态DTO不提供首次既有收件人bindingId/revision发现接口。客户端已留 `WorkspaceClient.Options.notificationBinding(context)` 只读宿主边界，由既有可信宿主提供非秘密引用，再由服务端核验；默认app.ts不注入，明确blocked。需要宿主/主任务提供原设施与该引用读取，不接受用户输入openid、receipt或手写accept替代，不猜新鉴权/授予权限。

代码边界完成后，最少用户/负责人操作：绑定微信测试AppID与工具/合法域名/受信loginBroker/baseUrl；核对已授权GA4 property、店铺/商品item映射、采集起点与原token provider；核对原微信AppID/一次性模板/固定字段和原token provider、当前官方服务端发送契约；负责人审阅原Connector/Schedule所需动作，用户在真实工具/设备上明确原生订阅和每项通知批准/执行，并验收真实来源和回执。客户端不创建这些凭据或权限。

真实微信登录/工具/真机/审核、真实Shopify写入、真实GA4首采样、真实消息/已读/业务验收、实际连续七天和真实Muse在线均未完成。没有发真实消息/访问生产/部署/付费/扩权/main修改合并强推。没有重跑或替代独立安全审核；后端全量646pass/7skip来自主任务，不作为本轮自行跑出的客户端或安全审核证据。
