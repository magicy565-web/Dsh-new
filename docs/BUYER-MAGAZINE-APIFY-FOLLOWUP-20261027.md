# 真实 Apify 采集续验与 0.4.3

2026-10-27，北京时间。续接 `3f58a5a7`，显式 fetch 指定分支后远端无新增提交，
本地工作区干净。没有重置、覆盖其他模块或复用旧成品。

## 上次失败的进一步证据

上一 Run `uWNk4So7V2M2hKCw8` 的日志多次记录 975–976 MB / 1024 MB、
95% 内存占用及 `Memory is critically overloaded`，随后浏览器创建／导航失败。
因此资源不足有实际证据；不再只记录最后一条 browser closed 错误。
这不能证明网站反爬或其他所有原因均已排除。

只读取得官方 Actor 默认 build 的输入 schema：其 `crawlerType` 默认值为
`playwright:firefox`；支持 `cheerio`，且说明该模式不执行网页 JavaScript。
`maxCrawlDepth: 0` 表示只读 start URLs。这些选项不是猜测的私有协议。
官方 schema 与 readme 保存在 Git 外 `actor-build.json`。

## 0.4.3 的具体变化

- 默认显式固定 Firefox，引擎不再依赖远端默认值；内存从 1024 改为 2048 MiB。
- 单并发、最多一次网络重试；原费用上限、页数上限、180 秒限制及额度检查保留。
- 可显式选择 `crawlerType: cheerio`，使用 1024 MiB；不自动换引擎或账号。
- `pageUrls` 支持同 origin 的选定研究页面，与主 URL 合计不能超页数预算；
  传入后禁用跟随链接，空数组表示只读主 URL。非法页面在任何 API 请求前被拒绝。
- FAILED / ABORTED / TIMED-OUT 的实际部分 Dataset 也被读取保存，标为
  `failed / APIFY_RUN_FAILED / partialDataset`，不冒充成功。
- 没有附件存储时仍可执行 GET-only preflight；有费用的 start 和保存结果的
  status 继续要求真实附件服务。不会为预检伪造服务或 Session。

## 本轮唯一一次真实任务

用户要求继续开发后，沿用 1 号凭据，重新 preflight：月限额 USD 5，
已用 USD 2.261614620476872，差额 USD 2.738385379523128。
明确选择真实独立站 Heath Ceramics（私人研究，不声明第三方图片商业授权），
显式使用同一 `apify/website-content-crawler` Actor 的 cheerio 模式。

| 字段 | 真实结果 |
| --- | --- |
| URL | https://www.heathceramics.com/ |
| 凭据 | 1；启动和所有查询一致 |
| Run | ZfJGDj82G7n3aFukA |
| Dataset | hO2OS1APv8lKRwdf5 |
| 启动 / 完成（北京时间） | 18:58:04 / 18:58:22 |
| 限制 | 3 页，USD 1，180 秒 |
| 实际引擎 / 内存 | cheerio / 1024 MiB |
| 终态 | SUCCEEDED / collected |
| 请求 | 3 成功、0 失败 |
| 原始 Dataset 条数 | 3 |
| Run usageTotalUsd | 0.0011665461972918778 |

实际页面为首页、`/pages/accessibility-statement`、`/products/virtual-gift-card`。
首页抽取正文约 400 字符；礼品卡页有图片、USD 25–2000 面额等真实内容。
这些资料证明 raw HTTP 真实采集成功，**不足以证明陶瓷产品编辑研究完成**。
不是陶瓷材质／规格档案，也不是五跨页设计依据。为防止三页预算再次花在法律声明
等无关页面，随后增加了上述 `pageUrls` 功能；本轮真实 Run 尚未使用这一新选项。
没有再次启动任务验证新选项，也没有以合成测试替代它的现场验证。

本轮 `preflight.json`、`start.json`、逐次状态、`final.json`、原始 `dataset.json`、
`actor.log` 和检查日志均保存在 Git 外
`/workspace/scratch/magazine-followup-20261027/`。没有密钥值、前缀或哈希进入输出。
本次仍通过插件导出函数调用真实 API，没有原生 Session 工具执行事件；不伪造
原生附件或 present 回执。当前聊天的工具目录未暴露 DSH 工具连接。

## 验证与边界

回归覆盖资源参数、显式引擎、不合法引擎、指定页面跨 origin／私网／页数边界、
失败终态的部分数据保留，以及无附件服务的只读预检。`npm run check` 的构建、静态
检查和全部 257 项测试通过；官方 SDK 结构检查的 17 次分派通过。这些结构检查不是
本网站原生 Session 或设计验收。完整结果见本轮日志。
Firefox 2048 MiB 和 pageUrls 有协议／回归检查，但没有本轮真实浏览器采集验证。

本轮没有创作本网站 HTML、PDF 或图片包；未执行桌面、375px、交互、PDF 页图
审阅和原生交付，也没有设计合格结论。没有追加模型客户端、Agent 循环、执行宿主、
应用或固定模板。没有发布云环境或公开网站。
