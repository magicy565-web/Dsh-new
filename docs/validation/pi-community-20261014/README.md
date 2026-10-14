# 固定社区插件：隔离审计与官方 Pi 验收

对象固定为 `pi-web-access@0.40.0`、`pi-quiver@6.13.2`、`pi-subagents@0.78.0`，官方 Pi `1.1.0`、Node `24.19.0`。产品场景是中国工厂提供本厂产品资料，整理海外经销商候选的公开来源证据；本次只使用公开合成资料、有限的无密钥 faux 模型与中性公开查询，没有完成真实商机验证。

`pins.json` 保存 npm 元数据 URL、tarball/SRI/SHA、gitHead、标准 Pi 入口、runtime/peer/dev 依赖及脚本。tarball 实际验证 SHA512、SHA1；gitHead 对应的 GitHub manifest 版本及依赖名/范围实际按键值核对一致。来源线索与内容完整性已检查，npm 签名及构建 provenance **未验证**。三份 package-lock 固定传递依赖；没有安装生命周期 hook，始终使用 `--ignore-scripts`。

| 项目 | 实际结果 | 适用边界 |
|---|---|---|
| 三包正规 npm 安装及复现 | 通过；独立 `/tmp`，精确 lock，0 个 scripts 运行 | 官方 Pi peers 显式复用固定宿主包；仅 quiver 必要旧 peer `@sinclair/typebox@0.34.49` 单独安装在隔离目录 |
| 官方 CLI 安装/发现/加载/卸载 | 通过；实际 install/list/help/print/remove/settings | CLI print 实际无密钥模型调用工厂 capabilities 和原生 read |
| 三标准 extension 入口与工厂默认插件共存 | 通过；官方 DefaultResourceLoader 无加载错误 | quiver 开发 Pi 依赖为 `^0.87.1`，此次实际 Pi 1.1.0 验证，不依据 `*` 推断 |
| quiver `fetch` HTML→Markdown | 通过；受控公开合成来源 | 不把合成 distributor 当真实经销商 |
| quiver `fetch` 取消 | 通过；官方 session.abort；实际 Abort 错误及短时返回 | 断言具体取消回执，不仅看时延 |
| web-access 私网防护 | 通过；实际拒绝 127.0.0.1，断言具体 internal-address 理由 | 未关闭 SSRF/private-IP 防护 |
| web-access 公开 URL/无凭据 DDG search | **受阻**；工具实际调用 | URL DNS `EAI_AGAIN`；明确传入现有白名单代理后 DDG 返回 no HTTP status，未取得候选来源 |
| 官方内置 MCP + 原 web-access stdio server | 连接/工具调用/移除通过 | 官方 `mcp add/list/remove`、createMcpExtension；2 个工具，公开 fetch 保留同样 DNS 阻塞；未测 HTTP MCP |
| 发布版 subagents 实际子进程 | 通过；原 detached runner 内官方 Pi SDK、原生 read、acceptance `attested` | 两个有限 faux 场景；未复制执行引擎，不代表真实工作者或业务 Goal 成功 |
| 发布版 subagents 原 stop 控制 | 通过；`stopped`/`processTerminal: observed`，已记录 PID 全死亡 | 非交互 SDK 原生 auto-drain；在同一 faux 工具链明确 stop，未伪造交互授权 |
| 正常 `doc_to_md` Python/OCR 链 | **受阻，未执行** | 已审计源码会先 uv 下载多组件，或建立 venv/pip 安装；现有 Python 缺要求的 pymupdf4llm，不触发自动下载 |
| 缺运行依赖 PATH 的额外合成 `doc_to_md` 场景 | 通过；实际官方工具，纯 JS unpdf | 改 PATH 后文字 PDF 有文本，扫描页明确空；结构未保留、无 OCR；不能当正常主机可用证明 |
| 发布 Python 脚本辅助文字/扫描/OCR | 通过；现有 Python/PyMuPDF/Tesseract eng | 直接运行已审计发行脚本 `pdf-fallback`/`ocr-pages`，OCR 文字带明确标记；不是正常 Pi doc 工具完整链 |
| 嵌入 SDK host dispose | **有限通过** | 子进程终态/死亡已验证；发布插件仍保留服务 timers，fixture 在验证及 dispose 后显式 exit。不能称资源全自动清理通过 |

可重跑命令（仅使用已经安装且固定的官方宿主 Pi）：

```bash
node scripts/pi-community-install.mjs
# 用上一步输出的独立 installRoot，不指向宿主 node_modules：
PI_COMMUNITY_INSTALL_ROOT=/tmp/pi-community-pinned-install-XXXX/install \
  PI_COMMUNITY_EVIDENCE_FILE=/tmp/pi-community-result.json \
  node --test test/pi-community-plugins.test.mjs
```

实际最新验收为 **2/2 通过，0 skip**。不设置安装根时只跑固定锁/来源结构检查，集成测试明确 skip，不能当完整验收。安装脚本只下载已审计且 SRI 固定的三份 npm tarball，`npm ci` 从提交的 locks 解析，关闭 scripts/dev/自动浮动 Pi peers。必要旧 typebox peer 已包含 quiver lock；宿主 Pi peers 版本逐个断言 1.1.0。`legacy-peer-deps` 用于避免自动下载浮动 peer，兼容性结论来自实际运行。

`optional-settings.json` 与 `optional-web-search.json` 是此次验收的限制配置，须分别合入隔离用户 agent 目录的 `settings.json` 与 `web-search.json`，不覆盖已有设置。包源由官方 CLI 安装脚本解析后的本地目录；不要直接把 `npm:...` 配置写入普通启动并触发未审计安装。测试专用 user agent 显式指定无密钥 provider/有限工具/child extension，`toolActivation: eager` 仅为显式授权验收；产品使用不应据此自动授权委派。

配置源核对：quiver 从 `quiver.slack/sessionAutoName/fastMode/swordHeader/providerStallWatchdog.enabled` 读取 opt-in 设置，真实 registry 中没有 Slack 工具；web-access 暴露 DDG-only search，关闭当前模型搜索、云抓取和 answer 模式，workflow 为 none；公开网络失败原样保存。配置只限制所测路径，不构成整个第三方插件的 OS 沙箱。隔离 env 保留 PATH/代理/可信 CA 与明确测试变量，HOME、PI_CODING_AGENT_DIR、TMPDIR、npm prefix 均独立；未读宿主 HOME、企业私库或账号授权。

失败清理代码先请求原 Pi abort/shutdown，再依据此 mkdtemp fixture 的 launch/PID 回执与 `/proc/<pid>/cwd` 范围限定清理其进程组，不扫描或 kill 全局 Node。**尚未做强制超时故障注入测试**。raw session/log/result 均留 `/tmp`，Git 仅保存精炼 `results.json` 与公共合成文件 hash。

没有执行 cookie 读取、Slack/邮件发送、商店写入、真实模型/付费搜索/云 OCR、自动 uv/pip 安装、部署、合并或 npm 发布。宿主原 Runtime/Store/任务账本未修改。真实经销商候选证据及正常文档前置依赖仍为阻塞。
