# 18:56 同源只读就绪检查点（提前完成）

唯一当前源码：`65252e24f4b467f32d77f8dd755168e5a04b2be5`；Git tree `c410a55fae58d6bbb9679293ed677f019da9ff8a`。只读契约提交：`e60f1a8bf873fce4ba0b5c90c313d8a6e9474fea`。继承原已完成组合 PR52 `8ce17ef22190a878f520bad1871029748f211513`、后端 PR54 `1ebc5f7e6a34fa4965fb2abfc61f73b891a920d9`。此包是 PR56 增量的同源检查点；旧 fixed-8ce17ef 包只作为历史交付保留。

- 当前源码：`Workspace-Agent-Source-65252e2.zip`，30,735,834 bytes，SHA256 `3faf708652284bc9199e704572f7d2be38f2426ff65b66a2260aa78dd3f4ef28`。
- 当前小程序导入包：`Workspace-Agent-WeChat-Import-65252e2.zip`，92,648 bytes，39 个编译文件，SHA256 `b311eb5c67dce990e5e65dce0d39ede5963b4547b4ebef56e28680eafc5d2f00`。
- `SOURCE-MANIFEST.json` / `BUILD-MANIFEST.json` / `CLEAN-EXTRACTION-PROOF.json` / `CLEAN-REBUILD-PROOF.json` 提供原始 Git blob、路径、权限、SHA、源码树和全新编译一致性的检查记录。源码包不含 Git 历史；不能将本地新 init 的提交伪称原 Git 历史。

源码包包含这个固定 Git 树的全部 1,056 个文件，不含本机 `.git`、`node_modules`、运行数据、实际上传数据和账号秘密。树内已跟踪的旧归档明确列为 historical；请仅导入本批 WeChat-Import-65252e2.zip。解压后在开发者工具导入含 project.config.json 的目录。appid=touristappid、baseUrl 为空、urlCheck=true；未配置账号/服务时明确阻挡是预期。

## 已验证

- 原构建 + 后端全量：661 项，654 通过、7 跳过、0 失败。首轮漏静态构建产生 9 个 missing-dist 失败，补原构建后通过，未改变鉴权或测试。
- 原工作树全部 mini 测试：106/106；全新 ZIP 解压 + npm ci + 原 Web/mini 构建后，加原协议测试为 112/112。
- 原 commerce + readiness 契约测试：15/15；干净解压目录重跑也 15/15。
- 原 Page/Client/WXML/WXSS 在有限 Chromium 渲染器中调用签名本地 HTTP 和原 Shopify 适配器；只使用合成 Shopify 回应，核验和查看依据走实际编译回调，320/390 宽度无横向溢出、无 pageerror。图在 ../readiness-checkpoint/，原 Muse 中央精灵和素材保留。
- 无自动 Shopify 探测：进入/返回读原 GET 状态；原管理员明确点击才 POST。重复点击合并；丢回包后 GET；断网/响应不完整/过期变 unknown；401、403、错店、缺权限与未配置区分；没有授予写入/通知权限。

## 未验证 / 最少后续操作

真实微信 Developer Tools、AppID/企业身份/真机/审核、真实 Shopify/GA4/通知/连续七天业务结果均未通过，也未执行。官方网页直接访问本轮返回 `cannot be opened (non-retryable error)`；已检查本机官方 types 5.2.3 的 request 方法、sha256、login 和准确订阅模板决定/点击约束。类型编译不是运行或官方验收。GitHub run 38284242811 为 startup_failure、zero jobs，不是通过的 CI。

由负责人使用既有授权配置 AppID、受信 HTTPS baseUrl/loginBroker/合法域名与原企业角色；服务器绑定原目标店铺并明确只读核验。用户声明目标 `vubm17-ak.myshopify.com` 不等于已观察到该身份。通知仍需既有可信收件人绑定、准确模板、原生物理点击及原独立审批。引用资料/文字“同意”不替代具体外发审批。

Library 已知上传路由错误：`library upload failed: hosted apps tools/list request failed: network`，发生在准备上传之前；无 prepared upload、file ID 或 Library 成功记录。本批以已授权的私有 GitHub 源码/测试/说明/定版归档为备份。没有为新包冒用旧 Library ID。

未改 main、未合并、未强推、未访问关闭的华为生产、未部署、未付费、未创建凭据或扩大权限。供应商 owner MCP / Pi TUI / 原 Muse 进一步集成由并行任务负责，此检查点没有声称包含尚未交回的固定提交。
