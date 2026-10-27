# Apify 真实采集验收：未取得资料

2026-10-27，北京时间。指定分支 `agent/harness-20261023` 从
`ce1f4bdf` 快进到远端 `8adafeee`，包含 `28af511a`。原工作区干净；没有
重置、重放历史修改或改动其他模块。origin 的默认 fetch refspec 仅包含 main，
因此显式 fetch 指定分支后才核对其最新进展。

## 配置、认证与网络

实际运行环境检测到四个编号变量：`APIFY_TOKEN1`、`APIFY_TOKEN2`、
`APIFY_TOKEN3`、`APIFY_TOKEN4`。现有 `apifyCredentials` 列表与之相同，
无带下划线别名、无旧默认变量。未输出任何凭据值、前缀或哈希。
配置服务报告这些绑定状态为 unknown，不能以配置元数据断言认证通过。

本聊天未暴露 DSH 原生工具连接，因此本次 credentials / preflight / start /
status 实际调用的是插件现有导出函数 `apifyCredentials` / `collectWithApify`，
不是原生 Session 工具执行事件。没有伪造 attachments 服务、Session 或 present。

默认 Node fetch 的预检返回 APIFY_REQUEST_FAILED。继承环境代理的只读 HTTPS
请求使用相同 1 号凭据返回 HTTP 200；Node 24.19.0 启用
`NODE_USE_ENV_PROXY=1` 后，插件原有 preflight 也返回 ready。
这支持环境代理未启用的诊断，不支持“密钥无效”或“需要重新录入密钥”的结论。
未绕过代理或关闭 TLS。仅验证 1 号认证，没有测试或轮换其他账号。

2026-10-27 18:52:02 +08:00 的 preflight 快照：月限额 USD 5，
已用 USD 2.254794810949286，差额 USD 2.745205189050714，
请求上限 USD 1。该差额是账户限额余量，不是预留余额。

## 唯一一次真实任务

用户授权自行选站后选择 https://www.patagonia.com/ 做私人研究。
此前考虑的练习商店未启动任务。第三方素材未获得商业复用授权。

| 字段 | 实际结果 |
| --- | --- |
| 凭据编号 | 1，启动和查询一致 |
| Actor | apify/website-content-crawler |
| Run | uWNk4So7V2M2hKCw8 |
| Dataset | qu1one9cgOt0BWOvV |
| 页数上限 / 费用上限 | 3 / USD 1 |
| 启动 / 完成（北京时间） | 18:52:24 / 18:54:12 |
| Actor 终态 | SUCCEEDED |
| 请求统计 | 1 个请求；0 成功，1 失败 |
| Dataset | 实际查询返回 `[]` |
| 插件判定 | blocked / APIFY_DATASET_EMPTY |
| Run usageTotalUsd | 0.0051225736771639855 |

Actor 日志最终错误为 `Request failed and reached maximum retries.
page.goto: Target page, context or browser has been closed`。这是 Actor 浏览器
采集失败证据，不能由此推断网站反爬、认证失败或账户额度不足。
日志中 Actor 内部重试不等于再次启动收费 Run；本次仅发起一次 start。
未自动切换凭据、重启任务或换用普通网页读取。没有来源正文或可选图片。

完整启动响应、逐次状态响应、最终 Run、原始空 Dataset、Actor 日志及检查日志
保存在 Git 外 `/workspace/scratch/magazine-apify-20261027/`。
`start.json`、`final.json`、`dataset.json`、`actor.log` 可直接核查。

## 修复、检查与未完成项

补充宿主环境代理启动说明，移除 README 对历史“五个密钥绑定”的推断。
传输异常仅返回白名单 transportCode，不返回可能包含凭据或 URL 的异常正文；
回归覆盖允许代码和不允许字符串的脱敏边界。未擅自改变宿主全局代理。

`npm ci --ignore-scripts` 后，正常执行权限下 `npm run check` 的构建、静态
检查和 253 项测试通过；沙箱内首次运行有 Node 内部断言和文件服务测试失败，
没有把首次失败记为通过。官方 SDK 结构检查另通过（17 次 dispatch）；这是
合成结构测试，不是本网站原生会话、浏览器或模型验收。

当前 LLM 已读取四个技能入口及相关设计／字体参考，但由于真实 Dataset 为空，
未创作本网站 HTML、未执行 buyer_magazine_review_artifact、375px 手机与桌面
交互审阅、PDF 页图审阅或原生 present。没有可交付的本网站成品，也没有设计
合格结论。未调用其他模型、Agent 循环或旧模板；未发布环境或公开站点。
