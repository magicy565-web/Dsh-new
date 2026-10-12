# 单会话原 Muse 委托闭环交付

客户端源码检查点：**17fc90f8b304a6b127e419aa160aa93f864a59d3**；独立分支 `codex/wechat-goal-intake-20261012`，Draft PR38。基线 e5ae755 已含PR36、P1修复、会话创建幂等和原微信broker；本次已整合实际后端源码 **96231bbff32c0bbb03329dd2b218e58a98f557d8** 及PR39交付head **4054c8a4846d07b34b0e94ff6a2588a720d669e6**。相对4054c8a仅改客户端、其测试/证据/导入说明；server、网页、根package/锁和共享构建无修改。

用户从原会话composer表达目标，Pi只整理可审阅草案；只显示服务端真实questions与未确认suggestions，不自动补预算/期限。唯一消费revision/draftHash；DTO的scopeVersion/scopeHash别名不读取也不发送旧请求键。原Muse绑定和runtime `inert-muse-draft-proposals` 缺失会阻挡此意图，未普通Pi替代。完整publicText与范围可滚动审阅，预算、明确期限、公开文字三个独立确认默认未选。prepare仅创建一个原待审订单，approve和dispatch分别明确操作。可以返回/在会话中编辑/持久reject；旧版本/被拒绝review不能执行。prepared范围按原订单取消/结束规则处理。

丢初始202、clarification/prepare/reject响应保留原body/requestId；冷启动重新登录并读取原会话草案/订单，未知结果不会换nonce多建单。文件走原回执ID/version/SHA，真实字节核对后预览，验收后继续保留。原Actor/Session/Attempt/lease/fence不由客户端构造。图片/PDF仍真实存档但不解析；产品/企业关联不自动授权公开或外发。

## 实际结果

| 验证 | 结果 | 证据 |
|---|---|---|
| 官方miniprogram-api-typings5.2.3编译 | pass；不能冒充微信运行 | [canonical-build](evidence/intake/canonical-build.txt) |
| 最终客户端六文件合跑 | **35/35 pass、0 fail、0 skip** | [final-client-tests](evidence/intake/final-client-tests.txt) |
| 其中真实本地业务HTTP三项 | **3/3**；签名原企业Session + 实际Pi faux工具 + Store/原Worker协议 | [latest-backend](evidence/intake/http-latest-backend.txt) |
| 原严格客户端选择子集 | **8/8**，原断言不修改；与其他数量有重叠 | [original-client-review](evidence/intake/original-client-review.txt) |
| 原Page/Component/WXML/WXSS Chromium运行模拟 | **六组检查、零page errors**，390/320无横向溢出 | [browser结果](evidence/intake/browser/acceptance.json) |
| 可导入编译ZIP干净解压 | **21文件**逐字节/哈希匹配、JS syntax通过 | [package verification](evidence/intake/package-verification.json) |

HTTP闭环实际观察：同一草案revision1缺项→同一id revision2可审阅→缺任意确认零订单→三项确认创建唯一pending-review原单→approve仍零任务→独立dispatch唯一任务→原Worker claim/upload/submit生成真实artifactId和字节→refresh返回原会话→SHA不符拒绝打开→SHA正确原JSON预览→人工accept后文件仍留存。另两项实跑了初始202/prepare/reject丢回执后的服务端+客户端重启复用，以及编辑旧revision拒绝、拒绝prepared草案后旧review approve/dispatch被原接口拒绝。

模型是官方faux provider；Worker执行端为明确标注的本地原协议fixture。没有真实微信code/account/tool/device、实时Muse个人Agent或外部研究执行、付费推理、生产访问、权限或生产凭据创建。这里只进行正常客户端业务联调，**没有替代被平台中断的独立安全审查**。此前36/36是e5ae755基线回归记录，不能当作新接口独立安全验收。

首次HTTP新增测试1/3停在Store惰性字段直接.length读取：[原日志](evidence/intake/http-first.txt)。修为现有父测试同样的`(collection || []).length`，保持零订单/零派发和最终唯一实体断言。浏览器初次失败为有限渲染器混合双表达式解析错误，以及事件尚未完成时空draft列表被fixture错误视为settled；[日志](evidence/intake/browser-first.txt)、[日志](evidence/intake/browser-second.txt)、[实际pending调试](evidence/intake/browser-debug.txt)保留。修解析/等待存在且已settled/等待完整事件，不削弱两项缺项、三确认、零提前派发等断言。早期拟议scope字段和TypeScript编译失败也保留在intake证据，最终源码已统一真实字段。

## 截图与导入包

截图都标注“浏览器运行模拟·本地HTTP/faux·非微信/Muse真机”：

- [仅必要两项问题](evidence/intake/browser/necessary-questions-390.png)
- [三项独立确认与完整publicText](evidence/intake/browser/exact-draft-review-390.png)
- [唯一原单尚待审批](evidence/intake/browser/original-order-pending-approval-390.png)
- [原回执进度与文件](evidence/intake/browser/original-receipt-390.png)
- [原文件实际SHA预览](evidence/intake/browser/original-file-sha-preview-390.png)
- [320px](evidence/intake/browser/compact-320.png)

[可导入ZIP](deliverables/Workspace-Agent-WeChat-Muse-Draft-Client.zip)：47,116 bytes；SHA256 **6fa76062c9ff50615cc1c3bdbfa9a51ec232363352a90234bccafbcc0b3a4f88**。21个代码/配置/素材文件匹配本分支构建，touristappid、urlCheck:true、空baseUrl、默认goalMode:muse、没有backend/账号秘密；[manifest](deliverables/Workspace-Agent-WeChat-Muse-Draft-Client-BUILD-MANIFEST.json)、[步骤](MUSE-INTAKE-IMPORT.md)。旧PR36包与证据保留，不当成本次新包。不存在可供用户访问的云端预览URL，本机loopback只供实际测试。

复现：`npm ci --cache /tmp/wechat-npm-cache` → `npm run build:mini` → `node --test miniprogram/test/intake-http.test.mjs miniprogram/test/draft-presentation.test.mjs miniprogram/test/draft-review-component.test.mjs miniprogram/test/intake-client.test.mjs test/miniprogram-client.test.mjs miniprogram/test/lifecycle.test.mjs` → `node miniprogram/test/intake-browser.mjs`。不需真实账号或生产。

## 尚未完成

真实微信帐号/HTTPS域名/隐私/开发者工具+iOS/Android设备及审核发布，实际线上Pi/Muse身份/Connector执行，订阅通知与独立安全验收尚未验证。最少操作在导入说明：用既有审核材料配置原native ingress/broker/成员映射、公开baseUrl和真实AppID/合法域名/隐私，跑真实工具和双平台验收，再由授权账号提审。此任务没有新建任何生产凭据、没有替父任务部署或访问关闭的华为生产。范围合成/后端后续修订由父任务协调；当前独立分支已有可运行整合源码与完整测试记录。
