# 原 Shopify 草稿缺失步骤修复客户端

本文件保留原952db1a/71项修复检查点；当前单一统一版本采用622fbfb，组合97项及当前截图见 [MONITOR-FINAL-ACCEPTANCE](MONITOR-FINAL-ACCEPTANCE.md)。

客户端功能源码检查点 **afb4972**，继续同一独立分支 `codex/wechat-shopify-write-20261012` 和 Draft [PR52](https://github.com/magicy565-web/workspace-agent/pull/52)。后端固定 **952db1a7e5a0986312f896e524114cb9a4a5ce25**（PR51），包含原 publication 基线04cbad4；按 [repair JSON 契约](../docs/SUPPLIER-DRAFT-REPAIR-CLIENT-CONTRACT.json) 消费，不含通知/流量的未完成DTO。修复实现没有客户端接口缺口。

作者改动限于 `miniprogram/src/shared/{publication,client,supplier}.ts`、原 conversation Page、原 `shopify-operation-review` Component、普通客户端测试及本目录说明/证据。server 与公共契约是合入主任务固定提交，未自行改写。无根依赖/锁/共享构建改动，无另一套UI；沿用原 Muse精灵、会话、卡片、sheet和默认未勾选确认。浏览器模拟补载原 Muse Component 的共享同款确认样式，没有新视觉。

## 行为

原 draft unknown/partial → 用户明确只读 `shopify-reconcile` → 原草稿操作的 `reconciliationSource=read_only_shopify_reconciliation`、partial、DRAFT、当前预览与远端哈希确认 → 同一主卡片出现“审阅原草稿缺失步骤修复”。GET历史本身不冒充只读远端对账，不重新创建商品。新准备请求准确绑定 `draftOperationId` 和该原回执的 `expectedRemoteContentHash`，显示原商品/变体、preview/hash、观察媒体ID/status/alt/URL。

修复和“另行批准采用观察到的既有媒体身份”是两个默认未勾选确认。仅当原媒体身份未确认时需要第二项；已确认媒体沿用原回执。勾选修复本身不能把 `approveObservedMedia` 变成true。后端生成准确 repair.steps/mediaSnapshot/basisHash/scopeHash，新审批再次审阅；批准只保存决定，独立执行还需新确认。拒绝不会补写，下一次明确审阅新建原修复操作。用户文字不替代审批。

仅修复后端明确列出的缺失 retail_variant；不创建商品、重新上传/替换图片、激活、发布或扩权。变体已经匹配时 steps=[]，另行确认观察媒体只读完成，零变体写入。修复完成显示“原草稿修复已核对，尚未发布”，`businessCompletion=draft_only`，原商品、原创建/上传steps、原connectorRun保留，原 draft.repairedBy 指向独立修复。媒体确认显示 `remoteBytesVerified=false`，不当作CDN转码字节一致。

缺少既有 Connector 的 `supplier.shopify.repair_draft` 显示实际阻挡，不申请/开启权限。媒体不READY、已确认媒体被替换、公开内容变化、范围过期均受阻。准备中的原哈希/媒体快照/修订变化清空确认，旧事件无效；execute由后端复验准确旧scope。结果未知只核对准确repair operation/scopeHash，不重发外部write；断线/冷恢复保留原UUID/body。GET证明未接收、没有connectorRun时，先显示未接收，再经另一次明确确认才提交同一原请求。

## 实际验证与截图

| 验证 | 结果 | 记录 |
|---|---|---|
| 官方API types5.2.3编译 | pass；不是微信运行 | [build](evidence/draft-repair/build-final.txt) |
| 全部普通客户端/Muse/采购/供应商/publication/repair及原微信协议 | **71/71，0fail/skip** | [完整回归](evidence/draft-repair/client-regression-final.txt) |
| 新修复交互 | **14/14**（含3个子用例） | [实际HTTP](evidence/draft-repair/http-final.txt) |
| 原编译Page/Component + 原WXML/WXSS有限Chromium | **十组检查、零页面错误；390截图、320无横向溢出** | [结构化结果](evidence/draft-repair/browser/acceptance.json) |

测试链是实际编译native Component回调 → 原Page → 签名本地Workspace HTTP → 原Store/capabilities/Shopify adapter → 共享本地Shopify HTTP fixture。浏览器同源渲染用实际按钮/checkbox调用原回调。记录一次原create、一次原图片upload、一次缺失variant mutation、零activate/零publish、事实整理Pi faux模型调用1。未知create无修复入口，明确只读后才出现；缺Connector action受阻，再在**测试布置**中恢复原本地fixture capability继续独立审阅，不是客户端授权。

正常测试还验证：已确认媒体不需采用；deny后新review；远端内容/未READY/已确认媒体替换阻挡；approved后远端改变零变体write；修复mutation与本地response双丢失、冷恢复只read一次原repair；未接收修复execute须再确认并复用原UUID/body；修复失败且read响应丢失后两次read完全同body、一次repair尝试、不补传；重复确认一次review；哈希变化清空原确认；read确认变体已经完整的媒体采用零write。

- [原create未知，尚无修复入口](evidence/draft-repair/browser/original-create-unknown-390.png)
- [明确只读后的原部分草稿](evidence/draft-repair/browser/read-confirmed-partial-draft-390.png)
- [绑定原ID/远端哈希](evidence/draft-repair/browser/bound-original-id-hash-scope-390.png)
- [单独媒体确认默认未勾选](evidence/draft-repair/browser/separate-media-consent-empty-390.png)
- [缺原Connector action阻挡](evidence/draft-repair/browser/missing-original-connector-capability-390.png)
- [后端准确修复scope另一次审批](evidence/draft-repair/browser/exact-repair-approval-scope-390.png)
- [批准尚未执行](evidence/draft-repair/browser/approved-repair-unexecuted-390.png)
- [缺失变体write结果未知](evidence/draft-repair/browser/repair-variant-result-unknown-390.png)
- [只读核对后仍draft_only](evidence/draft-repair/browser/read-only-repair-draft-only-receipt-390.png)
- [320px](evidence/draft-repair/browser/draft-only-compact-320.png)

首轮有1个子用例及其父用例失败（9pass/2fail）：已确认媒体被替换后，UI要求单独媒体确认；测试只勾修复，未发review，错误栏自然为空。改为明确确认观察ID以实际提交review，验证后端仍禁止替换原已确认媒体。没有削弱零新写入断言。[本轮最终HTTP记录](evidence/draft-repair/http-final.txt)14/14；其他旧证据按原版本保留。

复现：`npm run build:mini` → `node --test miniprogram/test/*test.mjs test/miniprogram-client.test.mjs` → `node miniprogram/test/draft-repair-browser.mjs`。无需真实账号；只有本地合成配置/签名fixture和Pi faux。没有重跑或替代独立安全审核。

## 实际运行边界

真实微信开发者工具/登录code/真机、微信审核、真实Shopify账号/店铺grant/原Connector启用、真实草稿媒体/修复/发布验收均未提供或执行。测试、官方types和截图不能作为上述完成证据。外部写入仅发生于本地HTTP fixture；没有访问关闭的华为生产、真实外部写入/授权、部署、付费、凭据创建或扩权。

真实验收最少操作：用户提供微信测试小程序与开发者工具，配置受信loginBroker和服务baseUrl/合法域名；店铺负责人审阅所需原Connector action和既有Shopify授权；用户在真实工具/设备上按本流程逐项批准并验收真实回执。客户端包不包含这些账号秘密。

本轮按指示不重复归档。旧20:30 ZIP与之前client v2是旧版本，**不含PR52写入与本轮repair UI**。当前可导入目录由本分支`npm run build:mini`生成 `release/miniprogram`（仓库不提交运行配置/秘密）；本报告与测试代码是当前交付，不重命名旧包为新版。通知/流量最终接口待主任务完成后再接入。
