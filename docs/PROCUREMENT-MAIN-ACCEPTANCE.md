# 原主会话采购回复：普通业务开发验收

2026-10-12，云端独立分支 `codex/cloud-procurement-dialogue-20261012`，Draft [PR #41](https://github.com/magicy565-web/workspace-agent/pull/41)。从固定交付 `91dbfdf8fcfe81b8aa8b8a0f0060ab32d894b526` 接续，其祖先包含整合源码 `6a204412f14144cfa58ececcb618c8e0595a43eb`。业务代码检查点 `2007fd216764d16957a67e7ba14030592091ec2c` 已推送并通过远端 PR head 和 Git ref 核验。

## 已有闭环与本次缺口

原服务已具备采购商 MCP 私有草案、指定已绑定企业的精确分享预览与显式确认、撤销、商家原会话关联/回复和采购商结果读取。未重建 RFQ、商城、调度器或支付模块。

本轮先复现两个正常使用问题：通过原 HTTP API 新建主会话后，关联已确认采购需求返回 404 `SUPPLY_CONVERSATION_REQUIRED`；恢复会话的 ID 含斜杠、百分号及中文时，读取其采购关联返回空列表。[修复前日志](validation/procurement-main/reproduced.log)记录两项失败。

修复复用原身份和 Store：每个新主会话由服务端写入 `createdBy`/`workspaceId`；带 requestId 的创建仍核对原创建回执，兼容先前只有创建者和回执、没有会话 workspaceId 的记录。原 native 归属继续支持。不会自动替历史无归属会话认领所有者。读取采购关联时路径 ID 解码一次；无效编码返回 400。

实际前端测试移除了手工为会话补写 `subject` 的旧 fixture。现在新建原主会话即可完成“私有草案 → 买方确认精确分享 → 商家确认关联 → 同会话回复 → 买方 MCP 读取状态/结果 → 重启/同请求核对”。保留原 UI、确认、revision/share hash、幂等回执和撤销机制。读取、关联、回复均不启动 Pi/Muse；模型调用、Run 和执行单为零。

## 本轮实际结果

环境 Node `v24.19.0`、npm `11.9.0`、Chromium `151.0.7922.173`。新工作树先构建再执行依赖 `dist` 的网页测试。

| 检查 | 结果 | 原始输出 |
|---|---|---|
| 修复前两个缺口复现 | 2 失败，预期保留 | [reproduced.log](validation/procurement-main/reproduced.log) |
| `npm run build` | 通过；既有 chunk 大小提示 | [build.log](validation/procurement-main/build.log) |
| MCP/会话创建/采购磁盘/Supply 定向 | 12/12 通过 | [targeted.log](validation/procurement-main/targeted.log) |
| 实际网页组件 + HTTP/MCP/创建相关 | 6/6 通过 | [ui-targeted.log](validation/procurement-main/ui-targeted.log) |
| `npm run test:all` 后台 | 552 总计，545 通过，0 失败，7 跳过 | [full.log](validation/procurement-main/full.log) |
| 同一全量命令 UI / 会话 UI / 小程序编译 | 19/19、14/14、编译通过 | [full.log](validation/procurement-main/full.log) |
| `node --test miniprogram/test/*.test.mjs` | 29/29 通过 | [mini.log](validation/procurement-main/mini.log) |
| `node test/procurement-main.browser.mjs` | 真实本地 Chromium / 原 API / 原 Store 通过 | [browser.log](validation/procurement-main/browser.log) |

7 项跳过属于未提供的原 native built exports/Host 以及 Windows 私有存储环境；不计作通过。正式独立安全审核**未运行**：此前平台已阻挡该审核，按明确指令没有重试、改名或通过替代路线执行。本轮普通业务测试不作为该审核的替代。

## 浏览器证据

本轮运行实际网页源码构建和 Chromium；没有使用 WXML 模拟器替代网页浏览器。390px 下保持一个中央精灵，无水平溢出，确认关联后提交回复，买方 MCP 取回同一持久回复，刷新恢复；未制造会话归属，未调用模型。页面错误为零。

- [确认关联](validation/procurement-main/browser/mobile-confirmed-share.png)
- [刷新后的同会话回复](validation/procurement-main/browser/mobile-reply-reloaded.png)
- [滚动查看当前需求与回复](validation/procurement-main/browser/mobile-current-inquiry.png)
- [机器可读结果](validation/procurement-main/browser/acceptance.json)

全部采用本地合成采购商/企业资料和临时 Store。真实采购商、真实 Muse、微信设备/账号、生产通知与在线执行均**未运行**。华为生产保持关闭，未探测或唤醒；未创建真实凭据、扩大授权或部署。

## 小程序线程接续

客户端尚需消费原采购需求会话入口，而不是新增后台 RFQ 系统。[原契约](CONVERSATION-PROCUREMENT-API.md)已给出两读两写：读取收件需求及当前会话关联；明确确认关联；刷新 revision 后用 active share hash 提交回复。采购商继续使用已审核的原 MCP 绑定，不让小程序创建采购商身份或分享授权。Muse 原委托/文件/回执流程与普通商家回复分开保留。

历史没有可信归属的会话仍不能关联私有采购需求；不可自动认领。新建可信主会话及已有原 native 归属、原 keyed 创建回执均已覆盖。本次未修改独立小程序源码；其原 29 项测试和编译已回归。PR #40 的固定源码 ZIP/小程序 ZIP 保持原字节和原版本，本开发 PR 是后续变更，不把旧 ZIP 标作包含本修复。
