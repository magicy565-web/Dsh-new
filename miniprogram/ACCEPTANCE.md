# 微信客户端交付与验收 — 2026-10-12

已完成原单页微信客户端的真实代码开发并保存于 Draft PR36。固定起点 `e67596dc31ce61ed5d1121e1d6f79d0563a043d9`；随后在独立分支内整合 PR34 冻结交付 head `cf6de2935c9c57d86dac57a58ed79e79e5d990d5`（源码 `ee1ad6c16a528284a9bfaf47512094295adb06bb`）的原 Muse 客户端契约，不回退它的补齐。客户端源码检查点为 **`e0afb7d852e063cb2b22cca759cfb9bedf06166b`**。该点之后只增加本交付说明、导入包/打包脚本与证据，未改执行源码。

改动限于 `miniprogram/**`、其独立审核测试副本和 `docs/WECHAT-CLIENT.md`。相对于 cf6，`server/`、Pi/durable、Muse 协议、公共 API、`src/` 网页、根 package/lockfile 与共享构建脚本无改动。没有 main 修改或合并、强推、生产访问/部署、收费请求、生产凭据或权限创建。

## 交付文件

- [可导入编译 ZIP](deliverables/Workspace-Agent-WeChat-Client.zip)：14 个原客户端编译/配置/素材文件，38,179 bytes；内含 BUILD-MANIFEST 与导入说明。
- ZIP SHA256：`6ace1adafc05812cb1f340356a75c8305a36a2c9c1f45e0c216d3c1614d95892`；[hash 文件](deliverables/Workspace-Agent-WeChat-Client.zip.sha256)、[逐文件 manifest](deliverables/BUILD-MANIFEST.json)、[干净解压/逐字节验证](evidence/package-verification.json)。每项匹配当前 `release/miniprogram` 重编译字节，所有 JS 通过 Node syntax check；该核对不是微信引擎运行。
- [最少导入与账号接入步骤](IMPORT.md)，[具体后端契约缺口](CONTRACT-GAPS.md)。
- 截图均含“浏览器运行模拟 · 原 WXML/WXSS · 非微信真机”标记：[主会话 390](evidence/browser/main-conversation-390.png)、[确切审批](evidence/browser/exact-review-390.png)、[成果卡](evidence/browser/delivery-390.png)、[SHA 校验后文件预览](evidence/browser/verified-file-preview-390.png)、[按需资源/输入 PDF](evidence/browser/resources-390.png)、[未知原请求](evidence/browser/uncertain-original-request-390.png)、[320px](evidence/browser/compact-320.png)、[默认服务阻挡](evidence/browser/setup-blocked-390.png)。

## 已通过的客户端行为

1. 默认空 baseUrl/loginBroker；编译后的实际 App 入口不能调用网络或取得微信 code，不产生假身份。并行登录点击共用一次 code/broker 尝试；实际 `/session` subject 必须与 broker 返回一致，角色只取实际服务端会话。
2. 未知结果保留原请求体、requestId、原对象和完整审阅范围，先写 subject + baseUrl 隔离的原生文件记录再提交。同用户冷启动重新登录后可读取原请求；新用户不复用旧用户的请求。令牌、code、CSRF不落盘。存储无法写入时不提交；损坏记录重复初始化仍失败关闭。
3. 确定 409 admission 拒绝解除发送锁，允许纠正输入；网络断开/丢失响应/5xx保留同一原请求。原请求核对按钮不会以新 requestId 解锁；恢复、继续、上传、引用都有同样原请求保留。并行页面点击由 loading 门及共享请求合并阻止重复效果。
4. 恢复原会话和云端状态；onHide/onUnload只停止读取，延迟读取不能覆盖已卸载页面。会话/CSRF过期会清旧账号页面并重新显示登录。离开/回来不取消、不自动恢复或执行云端工作。
5. 方案/状态来自真实消息、Run 与原 Muse DTO；展示排队/处理中/待审批/中断/完成/失败/取消等真实阶段，不编造百分比或执行凭证。审批完整范围可滚动读取，超过旧 3000 字符限制也保留尾部；明确批准/拒绝分别提交准确 proposal，批准后另需明确继续。原连接器在批准前、仅批准后均不执行；文字中的“approved/yes”不构成同意。
6. 实际本地 Pi/durable 取消：明确停止原 run，丢失停止回执后冷启动核对仍是同一 run，云端已取消且无新模型调用。中断恢复：原 run/submission 不变，未知恢复响应重试同一 requestId，云端只有一个 run。
7. 原 Muse 采用已有 approve/dispatch/refresh/cancel/accept 和确切 review/receipt hash、原会话 owner，不替代原 Connector、不声称 wake 或真实模型执行。通过真正签名企业 HTTP/原 Worker 领取→上传→返回 fixture 回执后，原会话文件可见；人工验收后仍可见/下载。failed终态明确显示“失败”；cancel_requested显示等待停止确认，未当作已停止。
8. 文件通过原 ID/version/SHA 下载，实际字节 SHA256 不符就拒绝预览；图片/PDF调用 native预览边界，文本显示校验后的字节。实际 PDF/PNG存档且重进后仍在按需资源中；图片/PDF不进入 text-only模型输入，不假称提取。引用现有产品/企业/资料不授权向模型或 Connector 导出私有文件。
9. WXML 条件和列表使用微信 `{{ }}` 表达式，修复原缺括号的绑定。沿用既有精灵 PNG/SVG、配色与单会话布局，无后台重写或第二套 UI。

## 实际测试与运行方式

Node `24.19.0`、官方 `miniprogram-api-typings@5.2.3`、Chromium `151.0.7922.173`。成功 `npm ci --ignore-scripts --cache /tmp/wechat-npm-cache`，锁文件不变；[安装日志](evidence/npm-ci.txt)。第一次默认 npm cache 在沙盒外不可写而失败，改用 `/tmp` 可写 cache 完成，没有改依赖/锁或请求扩大权限。

| 命令/范围 | 实际结果 | 证据 |
|---|---|---|
| `npm run build:mini` | exit 0，官方5.2.3类型编译；不冒充运行 | [build-mini.txt](evidence/build-mini.txt)、[实际 types版本/文件SHA/API核对](evidence/official-types.json) |
| `node --test test/miniprogram-client.test.mjs miniprogram/test/lifecycle.test.mjs` | **21/21 pass、0 fail、0 skip**；实际编译 App/Page 回调 + wx shim + 本地 HTTP/Pi/Store/原 adapter | [client-tests.txt](evidence/client-tests.txt) |
| PR35 原严格测试副本，`--test-name-pattern='mini\|upload-only'` | **6/6客户端 pass**；保留原断言，非客户端项未选入本次执行 | [independent-client.txt](evidence/independent-client.txt) |
| PR37 原严格测试副本，同样名称过滤 | **8/8客户端 pass**；真实原 Muse acceptance后文件仍留存、失败终态、确定拒绝、登录过期、PDF/PNG、无配置等 | [independent-final-client.txt](evidence/independent-final-client.txt) |
| `node miniprogram/test/browser-simulator.mjs` | **5组完整交互检查 pass、0 page errors**；390/320px；真实 Chromium | [acceptance.json](evidence/browser/acceptance.json)、[日志](evidence/browser-simulator.txt) |
| `python3 miniprogram/scripts/package-client.py` + 干净解压核对 | 14编译文件 hash/bytes匹配、JS syntax通过；touristappid、urlCheck:true、无backend/账号秘密进入包 | [package-build.json](evidence/package-build.json)、[核对](evidence/package-verification.json) |

数量有重叠：PR37的8项包含PR35客户端的6项，与21项亦有重叠，不能相加成独立通过总数。严格源文件逐字节复制自 PR35 `868d8d63234dfff45606e0a717282a5821eba293` 和 PR37 `75babfb424c438122cab695c8b3814785e6bf7c8`；[source SHA](evidence/reviewer-test-sources.sha256)，没有削弱断言。副本放在根 `test/*.mjs`，避免根现有 `*.test.mjs` 自动运行器误把未授权后端审核范围算入客户端验收；复验命令显式选择客户端名称。

首次新增生命周期测试 **10 pass / 1 fail** 原日志保留于 [lifecycle-first.txt](evidence/lifecycle-first.txt)：PDF测试提供的 faux回答是纯文本，不符合 workspaceExecution要求的JSON回答，等待succeeded超时。仅将该模型fixture改为合法 `{done:true,content:...}`，保留原字节不入模型与成功状态断言，再通过。没有以跳过或弱化断言隐藏失败。

浏览器模拟的 [源码](test/browser-simulator.mjs) 执行当前编译 Page JS，在有限 WXML渲染器中消费原 WXML/WXSS，事件调用原 Page 方法，wx request/download/file API shim连接真实loopback HTTP后端和实际文件系统；Pi模型使用官方 faux provider。它能发现绑定/状态/页面交互错误，但不等同微信引擎、原生控件、域名、隐私、账号或设备验收。截图中的文案、文件、连接器作用都为明确标注的本地fixture；没有冒充真实Muse执行或独立外部验收。

## 未通过/剩余阻挡

- **真实登录与账号：未实现/未验证。** 缺真实 AppID/code→已有企业 subject broker、经审核HTTPS ingress/domain配置。`CONTRACT-GAPS.md` 给出最小请求/响应；此包默认失败关闭。无开发者工具安装及真实微信账号/真机，未给出官方工具或平台测试结果。
- **整体验收不能标通过。** 审核报告中的后端原 Muse owner/模型输入隔离与 Pi usage/预算P1由主任务修复。本分支不修server，也不将本地客户端pass用作整体security通过证据。
- **API创建会话无幂等契约。** 客户端可合并同时点击、从云端读取结果；未知创建且无可恢复确切会话时拒绝重放，仍需后端durable requestId支持。
- **从自然语言目标准备新的原 Muse订单尚缺服务端草案/必要缺项契约。** 当前客户端能表达Pi目标、显示/操作真实既有原 Muse订单；不会硬编订单范围、私有资料导出授权或预算。该缺口不通过增加表单后台解决。
- **真实模型/Muse执行、通知、提审/发布：未验证。** 在线Pi、原PersonalAgent Connector身份/实际执行/回执要单独验收。通知功能尚未启用，不伪造权限。当前生产华为故意关闭，未访问。

最少用户/运营操作在 `IMPORT.md`：接入既有成员的真实broker与HTTPS、设置实际AppID/合法域名/隐私并执行工具和双平台真机验收、最后由有权限负责人提审。没有为等待账号而停掉本次可完成的代码/测试/包与备份。
