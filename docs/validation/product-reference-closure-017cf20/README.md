# 固定资料检查与委托准备：当前产品增量

当前源码为 **017cf2030836398513319a7c910c6ad732e43b16**，tree `9829e53955063f5a4a321e14ae71d880b85276f8`。两项修复已推送至 [Draft PR60](https://github.com/magicy565-web/workspace-agent/pull/60)，保留原 Workspace/Pi/Store/身份及审批。整体仍为 **release_blocked**。

在已选资料固定 v1、资料库随后已有 v2 时，原界面点击“资料 v1”却预览和下载了 v2。现在检查界面打开准确 v1；缺失版本明确报错，禁止选择，且不会默切其他版本。旧产品引用 r1 的详情仍只能取得原数据模型提供的当前 r2，现在明确说明“当前展示 r2，会话仍引用 r1”；只有主动重选并保存才更新引用，没有虚构历史产品快照。

Muse 准备流程原先先读检输入，再进入落单事务。若同一工件在中间被普通删除，已检结果可能失效却仍生成待审订单。现在在原准备意图的 Store 事务中重检同一 run/input snapshot/工件，失效即拒绝，零订单和零派发；原订单的丢失回执重试路径继续保留。

Library 关联继续只保存引用。原 Muse 准备窗口需要用户主动打开，公开事实为空、确认未勾选；手填并确认后仍仅产生待审订单。审批与派发是原有独立步骤，检查资料不会导出私有价格、名字、文件字节或引用 ID。

| 在干净固定源码上实际执行 | 结果与证据 |
| --- | --- |
| `npm run build` | exit0；[准确构建记录](final/build.json) |
| `npm test` | 758总、751通过、0失败、7条件跳过；[记录](final/backend.json)、[原日志](final/backend.log) |
| 原会话三文件 + 新引用 DOM | 19/19，含精确 v1/缺失版本/显式产品重选；[记录](final/conversation-dom.json) |
| 原 HTTP/Store + 当前 App 的 Chromium | 320/390px，5流程、8PNG、0页面错误/0模型调用；[记录](final/web/VERIFICATION.json) |
| GitHub CI | [38367556687](https://github.com/magicy565-web/workspace-agent/actions/runs/38367556687) startup_failure、jobs=[]；[只读回执](final/CI-SOURCE.json) |

可看截图：[手机固定 v1](final/web/01-fixed-document-v1-390.png)、[旧产品 r1/当前 r2](final/web/02-product-current-r2-pinned-r1-390.png)、[待手填公开范围](final/web/03-explicit-public-scope-blank-390.png)、[原待审订单](final/web/05-original-order-awaiting-review-390.png)。每张均为本地合成数据的实际 Chromium 页面，原生产 React/HTTP/Store 参与执行；原生身份与审阅 binding 使用明确的本地合成 fixture，不能据此声称真实 Host/生产账户已通过。

[修复前资料检查](history/frontend/BEFORE-PINNED-INSPECTION.json)和[准备竞态失败](history/backend/muse-input-delete-race.baseline.json)保留 `3f84eb0` 身份。中间 dirty candidate 有自己的状态，未重标为本次固定提交的新运行。后端删除回归的 Pi intake 是原签名 HTTP 与本地合成 provider；准备事务本身调用原 `service.prepare`，不是虚称真实生产或 prepare HTTP 测试。

原 Pi SDK 的显式公共 v1输入 → 两步任务 → 最终文件 → 下载 → 取消 → Store重开专项在 `3f84eb0` 已 1/1 通过、3次本地合成 SDK 调用、0外部 provider 调用。[原记录](reused/pi-client/PRODUCT-PATH-CHECKS.json)及[八文件逐字节证明](reused/pi-client/SOURCE-EQUIVALENCE-017cf20.json)指出复用范围；未为了计数重复全 TUI/小程序。多输出文件假设被当前 `done:false` 不允许 artifact 的协议拒绝，故未修改 Runtime/ConversationFiles；初次 fixture 错误及该拒绝日志也保留。

`13b268e` 的全组合验收、源码包/干净重建和 `3f84eb0` 的原文档证据继续以其原 SHA 保留：[原交付索引](../workspace-release-prep-13b268e/README.md)。本次新增日志、截图、测试和构建包不改写旧包为当前源码。测试分母互有重叠，浏览器流程/PTY/Node tests 不相加为独立总数。

七项跳过仍为六项缺少受审原 native source/build exports，加一项 Windows 在 Linux 上跳过。真实 Host、Identity 登录、Muse/Dot/provider、Shopify/GA4、微信与七天执行均未验收。持续同意和持久收件人授权仍待用户批准，保留原手动审批。独立审查没有重启、换人或绕过。没有生产调用、凭据/权限扩张、通知/发布、付费、部署、main 合并或强推。

三个开发子代理均按用户要求使用 gpt-6.1-sol/xhigh，root 为唯一集成提交与推送者；[原分工证明](../workspace-release-prep-13b268e/AGENT-ASSIGNMENTS.json)。本目录只含源码、验证记录和已请求的合成截图，不含运行 Store、session、JSONL/checkpoint 或依赖目录。

按用户新增“完成前端构建让我看到”要求，在保持 S2 的当前构建上补齐真实 Chromium 页面。新增 [逐图来源与状态](visible/VISIBLE-SCREENS-INDEX.json)记录43截图：主入口/原资料库13流程29图、待审委托10图、本地 Pi 成果4图。截图期间仅本目录验证资料未跟踪，执行代码/测试/锁未变化。待审委托无派发或成果；另一个明确的本地 Pi 合成任务经原 SDK/Runtime 实际生成文件，并由浏览器预览/下载核对SHA `20353dc27460ba13a912567ffa18d4799457c9c017dbb217458bb1a7267828e3`，Host/Store重开仍保留原run/file且不重放。1次本地SDK请求、0真实模型/Muse执行。

| 实际页面与数据状态 | 手机390px | 桌面1440px |
| --- | --- | --- |
| 主入口，尚未运行任务 | [当前合成会话](visible/main-library/03-conversation-mobile-390.png) | [空会话](visible/main-library/01-conversation-desktop.png) |
| 产品库，一份内部合成草稿，无公开Listing | [产品库](visible/main-library/12-products-390.png) | [产品库](visible/main-library/12-products-1440.png) |
| 企业资料库，合成上传文件v1/v2均保存 | [企业资料](visible/main-library/13-company-390.png) | [企业资料](visible/main-library/13-company-1440.png) |
| 原Muse待审订单，无派发 | [待审范围](visible/delegation/06-pending-delegation-390.png) | [待审范围](visible/delegation/06-pending-delegation-1440.png) |
| 原Pi本地合成成果，真实文件已返回 | [成果文件](visible/pi-results/01-original-result-card-390.png) | [成果文件](visible/pi-results/01-original-result-card-1440.png) |

[当前前端构建包](../../../deliverables/frontend-visible-017cf20/Workspace-Frontend-Build-017cf20.zip)为185687bytes，SHA-256 `99a2ea099759090fac489c8616fd235f352de21cca0fce2d797c81cab6ceacd9`；[包内原文件清单](../../../deliverables/frontend-visible-017cf20/BUILD-MANIFEST.json)。它包含真实构建的三个dist文件和回执，完整功能依赖原同源API和身份，不是离线可委托应用。没有已核实的外部预览URL；没有提供localhost链接、伪造静态后端或创建部署。[预览状态](../../../deliverables/frontend-visible-017cf20/PREVIEW-STATUS.json)。Library当前准备上传助手在只读工具发现阶段network失败，无confirmed library_file_id；[准确保存状态](LIBRARY-DELIVERY-STATUS.json)供父会话选择仓库附件路径。

完整机器索引：[VALIDATION-INDEX.json](VALIDATION-INDEX.json)。文件完整性：SHA256SUMS.txt。
