# 原采购会话客户端交付

源码检查点 **68328e163619b40a335f7e7c676d7403c980c126**；独立分支 `codex/wechat-procurement-20261012`，Draft [PR42](https://github.com/magicy565-web/workspace-agent/pull/42)，基线 PR41 **a5a524a19adf065f804abc1459f1f573cfd8adf4**（已含 PR38）。相对基线只改小程序客户端、其测试/说明/证据，无 server、根构建/锁或网页改动。

原会话按需显示采购方已确认共享的需求。私有买方草案不在 inbox。关联前显示完整原范围并明确确认，服务端返回新 revision 后回复；同一 composer 切换回复时保留未提交目标与文件，审阅只发送本次准确文字。退出、重进和未知结果复用原 journal 请求，不另建分享或回复；买方通过原 sourcing MCP 读到同一实际记录。无 Muse 绑定时可处理可信原业务会话，但目标流程仍阻挡，不用普通 Pi 冒充 Muse 执行。

仅消费既有两读两写，准确字段见 [消费契约](PROCUREMENT-CLIENT-CONTRACT.md)。客户端不生成买方身份、采购订单、付款、模型任务或外发授权。权限、预算、任务与验收都留在 Cnsubscribe Agent Service；Pi SDK 是云端执行内核，Durable 恢复仍由主任务验证。包内仅本地客户端 imports，未加载 DSH、Cordis、旧 fullHarness 或另一个调度器。

| 已验证 | 结果 | 证据 |
|---|---|---|
| 官方微信 API 类型 5.2.3 编译 | pass；不是微信运行验收 | [build](evidence/procurement/build.txt) |
| 原 Page → 实际本地 HTTP/Store/原 sourcing MCP | 3/3 pass | [业务测试](evidence/procurement/http.txt) |
| 原 Muse/客户端回归 | 35/35 pass | [回归](evidence/procurement/muse-client-regression.txt) |
| 原 Page/WXML/WXSS 有限 Chromium 模拟 | 6 组检查，零页面错误，390/320 无横向溢出 | [运行记录](evidence/procurement/browser/acceptance.json) |
| 新 ZIP 干净解压/文件哈希/JS syntax/依赖 | 22 文件逐字节一致，只有本地 imports | [包核验](evidence/procurement/package-verification.json) |

业务测试真实启动原 HTTP 服务与 Store，测试内的买方 Session 和商品/共享数据仅为明确标注的内存 fixture。覆盖：买方私有草案不可见→确认分享→原范围确认关联→完整文字审阅→双击仅一条回复→买方读回→客户端与服务冷重启读原会话；丢关联/回复回执后重启复用原 UUID/body；TouchEvent 不能退出未知回复状态；未提交目标/文件保留而不外发；买方撤销后不再提供新回复控件。**模型调用、runs、Worker orders 均为零**。首轮一项失败是冷启动回复目标在后续异步读取后才恢复，已改为与 pendingDraft 同步恢复；[原失败日志](evidence/procurement/http-first.txt) 保留，最终断言未削弱。

截图明确标注“原小程序源码 Chromium 模拟 · 本地 HTTP/MCP · 非微信真机”，不是另写页面或官方微信运行：

- [已确认共享需求](evidence/procurement/browser/confirmed-inquiry-390.png)
- [原范围关联确认](evidence/procurement/browser/association-scope-390.png)
- [准确回复审阅](evidence/procurement/browser/exact-reply-review-390.png)
- [重进后的原回复](evidence/procurement/browser/reopened-original-reply-390.png)
- [320px](evidence/procurement/browser/compact-320.png)

[可导入包](deliverables/Workspace-Agent-WeChat-Procurement-Client.zip)：50,704 bytes；SHA256 **5efc837843eade810484c3ff1fc4375996ee82b961a49c0ad91408ec1cf58c7a**；[manifest](deliverables/Workspace-Agent-WeChat-Procurement-Client-BUILD-MANIFEST.json)、[导入步骤](PROCUREMENT-IMPORT.md)。默认空 baseUrl、touristappid、urlCheck:true；无登录配置时清楚阻挡。旧包按其原检查点保留，不能当本次构建。没有用户可访问的云端预览 URL。

复现：`npm ci --ignore-scripts --cache /tmp/wechat-npm-cache` → `npm run build:mini` → `node --test miniprogram/test/procurement-client.test.mjs` → `node miniprogram/test/procurement-browser.mjs`。原 35 项回归命令见 [Muse 验收](MUSE-INTAKE-ACCEPTANCE.md)。没有重新运行或替代被平台中断的独立安全审核。

真实微信账号/工具/真机、真实买方与 Muse、微信审核/通知权限、真实 Shopify 授权与供应商发布/7天指标仍未验证；关闭的华为生产未访问。最少账号操作见导入步骤。供应商后续复用 composer、必要缺项卡、版本/hash 完整审阅、独立确认、原请求恢复和真实结果卡；[最小接口需求](PROCUREMENT-CLIENT-CONTRACT.md) 已列出，等待主任务稳定契约再接线，不猜接口、商品 ID、业绩或通知成功。
