# Shopify 原写入审批客户端

当前单一统一版本采用622fbfb，组合97项及当前监测/通知界面见 [MONITOR-FINAL-ACCEPTANCE](MONITOR-FINAL-ACCEPTANCE.md)。

此文件保留原 publication 基线788948d的57项验收记录。**当前PR52增量已接952db1a修复契约**；当前源码afb4972、71项完整客户端回归与修复界面请见 [DRAFT-REPAIR-ACCEPTANCE.md](DRAFT-REPAIR-ACCEPTANCE.md)。旧ZIP不包含当前增量。

客户端源码检查点 **788948d**，独立分支 `codex/wechat-shopify-write-20261012`、Draft [PR52](https://github.com/magicy565-web/workspace-agent/pull/52)。保留 PR46/组合738000f，固定后端 **04cbad4ff5f74fa97e46a0845939233ce66cf35f**；消费40b9601的 [publication JSON契约](../docs/SUPPLIER-PUBLICATION-CLIENT-CONTRACT.json) 与 [实现说明](../docs/SUPPLIER-SHOPIFY-WRITES.md)。最新c2ba9ea只改测试断言；04cbad4与40b9601的接口代码一致。没有取通知WIP96fb4914，也没有取尚未统一的通知/流量DTO。

只改小程序源文件/其测试/说明/证据，没有自行修改server、根依赖/锁、共享构建或另一套UI。沿用原主会话、输入框、预览/资源抽屉、Muse精灵与视觉。旧客户端v2与组合归档按原版本保留，**不包含本轮新写入控件**；此轮按要求不重复打包，从本分支`npm run build:mini`构建。

## 已实现交互

原服务完整Listing预览→“审阅草稿创建与已选图片上传”→草稿与图片传输两个独立默认未勾选确认→准备原待审操作（不批准、不执行）→完整原shop/preview/imageID/version/SHA/scopeHash审批，明确批准或拒绝→再次独立确认执行→显示原connectorRun/步骤/草稿回执。草稿完成只显示尚未发布。

精确渠道发布使用原输入框提供一个真实既有Publication GID；不造名称/渠道ID/默认渠道。完整原草稿核对后，渠道发布另建review/approval，再独立execute。只用域内`shopify-decision`，不走通用approval或connector execute旁路；文字意图不代替审批。当前服务配置/host writes/原Connector未就绪会显示实际blocked，不制造操作ID或成功回执。

所有写入先保存原body/requestId。执行丢本地响应后“核对原请求”先GET准确原operation/scopeHash，不重新POST外部执行。已有admission的unknown/partial只能POST原只读reconcile；这个只读请求丢响应时保存并复用其原body/requestId。若GET证明原审批仍未使用、没有connectorRun，先显示未接收，再由用户另一次明确确认提交**同一原执行请求**。不会换nonce盲重试，也不自动补写partial草稿。最近30个publication请求按原owner/baseUrl恢复命名空间保存；没有token/CSRF/账号秘密。完整已确认原回执可通过GET关闭本地响应丢失，不制造多余写入。

预览/修订变化重置原控件勾选，旧scope不可执行；历史回执明确标范围已变。原始SHA/已上传字节与远端MediaImage ID/READY是不同证据，显示 **remoteBytesVerified=false**，不声称CDN转码字节一致。所选任意渠道`publishedAt:null`显示不能作为监测起点；独立`onlineStorePublishedAt`单列，不替渠道编造日期。目标/其他未提交输入不会自动追加到外发scope。

## 实际证据

| 验证 | 结果 | 记录 |
|---|---|---|
| 官方API types5.2.3编译 | pass；不是微信运行 | [build](evidence/publication/build-final.txt) |
| 原客户端/Muse/采购/供应商/新控件合跑 | **57/57，0fail/skip** | [完整回归](evidence/publication/client-regression-final.txt) |
| 新publication交互 | **9/9**（含两项子用例） | [实际HTTP](evidence/publication/http-recovery-final.txt) |
| 原编译Page/Component与WXML/WXSS有限Chromium模拟 | **九组检查、零页面错误、390/320无横向溢出** | [结果](evidence/publication/browser/acceptance.json) |

实际联调链为编译的native Component回调→原Page→签名本地企业HTTP→原Store/capabilities/Shopify adapter→共享**本地Shopify HTTP fixture**，没有访问真实店铺。事实整理使用官方Pi faux；写入链不是模型工具。fixture中原Connector启用和店铺dummy配置是明确的测试布置，不是授予真实权限/创建凭据。

九项覆盖：默认无勾选零审批/零创建；只批准仍零执行；独立执行一次原图片上传/原草稿、回执draft_only；精确Publication/另一approval/另一execute才出现发布回执；缺配置blocked无虚构ID；deny不写入、下一次明确review有新原操作；丢本地执行响应后冷GET原operation不二次create；未提交请求须再次明确确认、原UUID/body不变；远端create响应未知，读回partial、variant未写入、无补写；只读partial核对响应丢失后冷复用原reconcile body，仍一次create/零variant；真实预览修订变化清空控件勾选，旧批准不可执行、零图片上传/创建。

浏览器fixture实际记录 **一个草稿/一次图片上传/一次精确渠道publish**，丢远端发布响应后只读核对，没有第二次publish；模型调用1。所有界面截图标记“原小程序Chromium模拟 · 本地HTTP/Shopify fixture · 非微信/真店”，不是另一套网页或真实微信/Shopify验收。

- [明确草稿/图片外发scope](evidence/publication/browser/draft-transfer-explicit-scope-390.png)
- [独立原草稿批准](evidence/publication/browser/original-draft-approval-390.png)
- [批准尚未执行](evidence/publication/browser/approved-still-unexecuted-390.png)
- [原草稿回执与未验证CDN字节](evidence/publication/browser/actual-original-draft-receipt-390.png)
- [精确渠道另一次审阅](evidence/publication/browser/separate-exact-channel-review-390.png)
- [独立渠道批准](evidence/publication/browser/separate-channel-approval-390.png)
- [未知渠道结果](evidence/publication/browser/unknown-channel-result-390.png)
- [只读原渠道回执](evidence/publication/browser/read-only-exact-channel-receipt-390.png)
- [320px](evidence/publication/browser/compact-320.png)

一次补充测试预期第二次POST reconcile，但此前只读核对已将原操作确认succeeded，冷GET可直接关闭响应丢失。[原日志](evidence/publication/http-final.txt)保留。补充用例改为持续partial，保持“同body两次只读请求/无额外写入”断言，未削弱它；初始7/7与55/55记录保留，不当最终57项。

复现：`npm run build:mini` → `node --test miniprogram/test/publication-client.test.mjs` → `node miniprogram/test/publication-browser.mjs`。后端全量由主任务完成，本轮未重跑或替代受拦独立安全审核。

## 尚未完成与协调边界

真实微信code/account/工具/真机/审核、真实Shopify账号授权/原Connector启用/每项批准及一次真实草稿媒体/发布验收没有提供或执行。该代码有真实可调用协议与adapter联调，不能把fixture回执、官方types编译或截图当作真实店铺/上线通过。默认host writes关闭；客户端不能启用Connector、安装店铺、创建凭据、扩权、付费或部署。

渠道名称/列表DTO未提供，当前仅消费明确的既有Publication GID。原04cbad4契约不含partial修复；952db1a已提供独立repair_draft契约，当前客户端实现和范围见上述增量验收，仍禁止盲补写。通知/产品流量有独立任务；本轮不改其后台、不制造微信订阅接受或启用状态，待统一最终DTO后只消费真实数据可用/未授权/已提交状态。真实订阅只能由用户触发。没有访问关闭华为、main修改/合并/强推、生产发布，也没有新视觉/重复归档。
