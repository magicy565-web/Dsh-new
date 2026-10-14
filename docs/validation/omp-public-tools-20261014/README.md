# 公开能力契约与验收（2026-10-14）

`server/workspace-omp-public-tools.mjs` 是官方 OMP 18.10.4 工具前的窄准入适配，复用其公开搜索 provider、ReadTool 与 browser prelude。没有新搜索引擎、浏览器引擎、业务执行器或身份。此检查点独立测试模块契约；原 Conversation/Run 入口整合另做实际回归。

工具契约：

| 工具 | 允许输入 | 配置与限制 |
| --- | --- | --- |
| `workspace_public_search` | `query`，可选 `limit`（1–5） | 固定 DuckDuckGo，或宿主明确选择 Startpage；每原 Run 最多两次、15 秒、256 KiB；403/429/挑战保留失败，零来源，禁止自动换 provider、付费或解挑战 |
| `workspace_public_document` | 精确 `documentId` | 宿主选定公开 md/txt/csv 与 SHA256 后快照；每文件 64 KiB、最多八个；拒绝隐藏目录、凭据文本、路径外文件、符号链接与变更字节；没有私库、PDF/OCR或任意路径 |
| `workspace_public_browser` | 公开 HTTPS `url` | 已有 Chromium、独立 profile、固定解析到公开 IPv4、精确 hostname 限制、禁用页面脚本；没有账户附着、表单、任意 JS、忽略证书、私有地址或自动下载 |

每次调用和来源返回前均调用原 `authorize`。搜索来源及页面内容是未核验的公开证据，不能表示真实买家、库存、制造能力或联系同意。资料回执仅含 ID 与 SHA256，不向模型暴露宿主原路径。

已实际运行 `node --test test/workspace-omp-public-tools.test.mjs`：3/3，通过固定 Bun 1.3.14 调用真正发布包中的搜索 provider 与 ReadTool。搜索 HTTP 使用明确合成响应；验证来源、403 空来源、撤权零网络请求、指定文本读、变更字节拒绝，以及浏览器私地址/DNS在启动前拒绝。这里不宣称生产模型执行、真实客户发现或公开浏览器导航成功。

后续同入口整合检查实际27/27、零跳过：`workspace-omp.test.mjs`、`workspace-omp-launch.test.mjs`、`workspace-omp-public-tools.test.mjs`、`workspace-omp-task.test.mjs`、`workspace-omp-terminal.test.mjs`。真实官方SDK在原HTTP/Store中接收文件正文与搜索来源，再提交唯一原factory-export任务，四个原阶段保存三份文书；前台一Run，后台四Run，没有第二账本。公开来源保持未核验；后台文书阶段仅接收已提供的公开输入，不能冒充这些阶段自行检索。搜索拒绝保留零来源与工具失败；撤销文件或同ID更换SHA时在下次模型前拒绝旧缓存。

同组合验证默认Node启动命令真实PTY→官方InteractiveMode→原Run→原回复，UI模型流禁用；缺模型/绑定时409且零Run/任务；窄回执保留原企业Session、成员/Run归属及凭据样文本拒绝。原生TaskTool以两个无工具child执行公开文字审阅，父子总四模型请求/1600输出额度、合成usage全部计入原Run；原取消传至实际child/provider并观察Bun worker退出。原Pi/Library/包53/53、原factory/business/service17/17亦独立通过。已有Chromium上脚本禁用、真实合成页面HTTP200及关闭另实际通过；这些是不同范围，不将组件诊断当真实客户获客。

另分别按原网络尝试 DuckDuckGo 与 Startpage 的公开无密钥查询，两次均 `unavailable`，返回零来源；没有代理改道、挑战处理、付费或客户联系。证据保留实际检查结果，不能将此写成已连接搜索。

未调用付费模型，未读/创建真实密钥，未发布、发送、下单、付款或开发七天未来通知。未来通知仍须原持续同意与持久收件人机制获批。
