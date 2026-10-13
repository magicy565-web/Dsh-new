# Workspace 原 Work 开发交付

源码 **`13b268edebbc3a26dd7e4197dfecb2dde37d3164`**，Git tree **`3b45b5e34c13ee9d6deba594240961a213ee526c`**，版本 `0.5.0-rc.2`。[PR60](https://github.com/magicy565-web/workspace-agent/pull/60) / `codex/unified-pi-agent-api-20261013`。此目录及交付包属于后续文档/证据提交 D；冻结源码和所有新运行记录均指向上述 S。D 的执行代码、测试与锁文件和 S 逐字节一致，仅更新 docs/AGENT-ACCEPTANCE.md 的历史/当前说明并新增本目录与交付包，详见 SOURCE-PRESERVATION.json。

**本地自动检查通过；整体 `release_blocked`，未部署。** 本轮修复两个实际 CSS 问题：手机伴侣抽屉被隐藏，以及空会话原委托标题被压成竖排。保留原 App、产品/资料库、业务 Store、Pi、身份和批准机制。

| 本轮最终 S 检查 | 实际结果 |
| --- | --- |
| 原 `test:agent:acceptance` | 五个子命令全 exit0；runner 自身 exit1，准确保留 release_blocked |
| 网页 / 小程序构建 | 通过 / 通过 |
| 全后端 | 757 总，750 通过，7 条件跳过，0 失败 |
| Agent / Python 客户端 | 41/41、27/27 |
| DOM | 19 原 UI +17 会话 +6 当前 Library +7 退役组件契约，49 通过 |
| 当前真实网页 Chromium | 13 流程，29 PNG，0 页面错误、0 模型调用 |
| 解包/重建 | 1244 源文件/模式/blob/SHA 和 Git tree 匹配；干净锁定离线安装后 3 网页+39 小程序文件逐字节匹配 |
| 上线门槛 / CI | 门槛 ready=false/exit1；CI startup_failure，jobs=[] |

[完整索引](VALIDATION-INDEX.json)、[原 runner 报告](final/acceptance/report.json)、[网页检查与测量](final/web/VERIFICATION.json)、[源码包核验](final/ARCHIVE-VERIFICATION.json)、[干净重建](final/reconstruction/REBUILD-VERIFICATION.json)、[CI 原状态](final/CI.json)。全 stdout/stderr、命令、源码前后 SHA、工作树状态和 SHA256 均随附。

## 当前产品入口截图

- [390px 会话与可读委托入口](final/web/03-conversation-mobile-390.png)
- [320px 原助手抽屉](final/web/02b-assistant-drawer-320.png)
- [短屏可滚动到原委托](final/web/03b-empty-delegation-390-600.png)
- [真实私有产品与固定资料 v1](final/web/08-product-pinned-v1-mobile.png)
- [企业资料桌面入口](final/web/13-company-1440.png)

这是当前生产 App 构建、真实 loopback HTTP/原持久 Store 与合成数据的产品截图；viewer 部分仅为浏览器 Session DTO 控件检查。完整企业认证有原后端合成回归，生产登录另待验证。文件上传、文档 v1/v2、SHA、固定版本关联及实际 host/Store 重启均通过；没有伪造真实账号、模型质量、外部回执或微信真机验收。

## 已验证且未改动的部分

父任务要求无需重复已验证部分。原 **49d5360** 上小程序协议 126、10 个 mini browser 驱动、TUI 9/3/2 tests 和 8/7/8 PTY checkpoints、PR59 V4 原持久 checkpoint 升级 2 项、Muse 客户端 40 项均保留原日志和原 SHA。它们没有被改名成 S 的新运行。[11 文件字节证明](reused/pi-client/SOURCE-EQUIVALENCE-13b268e.json) 与 [原服务/mini tree、39 编译文件证明](final/MINI-SOURCE-EQUIVALENCE.json) 记录其与 S 的一致范围。合成 Agent PTY provider 15 请求、外部 0、后端模型 0；当前真实 Host/Muse/Dot 仍未签署。组间重叠，不累加为独立总数。

## 原失败与剩余门槛

`history/` 保留首轮 dist 未生成导致的 9 项后端失败及顺序通过记录、旧 browser 的过时 Dot 区域断言、两个真实 CSS 问题的 before 图/测量、各候选与测试 harness 修正记录。`candidate-ba14e14` 通过记录仍是该源候选，最终截图用 S。原独立 overlay 两文件因缺少原 Host 模块在导入阶段失败，未添加替代模块。历史和 dirty candidate 不能充当最终新源通过。

7 个后端跳过是 6 个缺受审原生源码/构建导出的检查和 1 个 Windows 专用检查。华为主机重启由用户报告，本任务没有验证当前生产版本、Identity 登录、服务目标或接入；父任务单独核查密码恢复。生产目标/TLS/身份/完整备份恢复、真实已批准模型和业务、微信/七天、正式参考验收、独立安全门槛及 CI jobs 仍未完成。历史独立安全任务曾被平台拒绝，没有重启、换人或改措辞绕过。七天持续同意/持久收件人权限没有新开发。

[发布与回滚准备](../../WORKSPACE-RELEASE-PREP-20261013.md) 基于原单 writer 和一致快照，不替换数据库、身份/OAuth、租约或 fence。本轮没有生产修改、部署、main 合并、凭据读取/创建、权限扩大、付费或外部业务写入。交付只选源码、测试、报告/日志和截图，未复制运行 Store/数据库/Session/checkpoint/上传目录或 node_modules。

## 同源包

[源码 ZIP](../../../deliverables/workspace-release-prep-13b268e/Workspace-Agent-Source-13b268e.zip)：SHA256 `e5f30bce7fdd692a2fac89e40d56fb88a8db23e8d7bf425a35e85346133d298d`。

[小程序导入 ZIP](../../../deliverables/workspace-release-prep-13b268e/Workspace-Agent-WeChat-Import-13b268e.zip)：SHA256 `dd8c089e84957f309aa8c60d496204753460adad4d47d7e5fa3cb839d21de9a5`。

包内 SOURCE/BUILD-MANIFEST 使用同一 S。源码保留该树所有历史文件原字节，旧 ZIP 明确标为历史；本包不带 Git 历史。小程序 appid=touristappid、baseUrl 为空、urlCheck=true，准确未配置；不能作为已连接商店或真机通过。
