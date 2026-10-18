# Harness Web 测试版前端交付 · 2026-10-18

本交付是可整合的现有 React/Vite 前端，不是部署或真实模型验收。

独审补修见文末：当前浏览器脚本强制启用沙箱，但本环境未执行新版浏览器检查。此前无沙箱的 11 项和 5 项通过只属于原源码提交的历史有限证据。

- 固定基线：`7e88a7807a2a16fc324de582dc8605b76f748d83`。
- 独立分支：`codex/harness-web-release-20261018`。
- 原交付被测源码：`31ca2ca71d0fc387e7d0d07a5cd572fbf3e65b4a`。当前独审补修另有下述纯/DOM/构建证据，不能继承旧浏览器通过结论。
- PR 目标：`codex/omp-all-plugins-integration-20261017`，不是 main。
- 环境：Node 24.19.0、npm 11.9.0、原锁 TypeScript 6.0.3 / Vite 8.0.16 / Playwright 1.61.1、实际 Chromium 151.0.7922.173。
- 本地工作目录：`/workspace/harness-web-release`，由原仓库建立独立 worktree；原 `work` 分支未改。
- 仅修改前端、相关合成测试和本文件。没有修改 server、plugins、共享 loader、根 package/lock、Docker/Caddy 或系统配置；没有部署、读取凭据/真实企业数据、创建凭据、扩大权限或调用付费模型。

## 最小发布范围与实际行为

复用 `App`、`SessionGate`、`@assistant-ui/react` 原外部 Store 适配器、原资料库及原 Modal。桌面默认显示聊天记录，活动面板按需打开；移动端保留原抽屉和底部导航，统一聊天、资料和插件入口。

1. 同一 `conversationId` 持续发送、刷新读取原历史；不从 URL 不存在的会话暗中创建另一个会话。明确新聊天后，首次发送沿用原创建/消息幂等契约。
2. 网络结果未知时继续使用原请求 ID、原输入和原会话核对。核对成功清空恢复的输入，避免残留内容被再次作为新消息发送。
3. 聊天中的上传入口直接打开原企业资料上传页。返回时恢复原会话及未发送草稿。原文件/资料保存、固定版本引用、下载及来源状态继续由原 API 提供。
4. 已确认的业务运行时只开放公开文字消息，`workspaceExecution:false`，`inputContext` 为空；上传和资料引用明确标为本地关联，不显示为已送入模型。原 Host 已获授权的工具读取仍由后端自己的绑定政策决定。
5. 业务入口的长期 Goal 创建/启动不在本次验收范围，显示待验收；相关已有页面在此入口仅作读取。旧服务仅在运行时接口返回可识别的原 JSON API `404 / NOT_FOUND` 时保留原导航与原功能，不更换运行时。
6. 插件/连接页只读展示聊天配置、Medusa 配置和原连接器配置。配置存在始终标为“在线待验证”；未配置、错误/不可读、禁用、失效快照分别显示。没有完整 OMP 插件 HTTP 清单，明确显示“状态不可用”，没有新增虚构的插件 API 或安装/启用/执行按钮。
7. 官方 Medusa Admin 独立链接：`https://medusa.cnsubscribe.xyz/dashboard/`，来自基线的 `docs/MEDUSA-HTTPS-PROXY-ACCEPTANCE-20261017.md`。链接不代表 Workspace 已连接该服务，也不共享或创建登录凭据；本任务没有访问该真实站点。
8. 服务快照失效、运行时读取失败、会话地址缺失、未配置模型或只读成员均不会显示可发送的业务聊天。原 401/CSRF/成员失效事件继续关闭工作空间并返回 `SessionGate`。

## 已核对的真实 API

以下均来自固定基线源码；本任务不创建新服务接口。

| 能力 | 原请求及返回/约束 |
| --- | --- |
| 登录状态 | `GET /api/session` → 原 `Session`：`mode/authenticated/workspaceId/user/csrfToken/expiresAt/idleExpiresAt`。 |
| 登录/退出 | 同源 `POST /api/session/login`，JSON `{}`、`X-Workspace-Login:1`；`POST /api/session/logout`。仍由原 cookie/CSRF、企业 ingress 和成员表处理。 |
| 工作空间快照 | `GET /api/bootstrap` → 原 conversations/messages/runs/artifacts/capabilities/diagnostics；保留原 2 秒轮询及只读 SSE 刷新通知。 |
| 业务运行时 | `GET /api/conversations/runtime` → `engine:'omp'|'pi'`、`engineScope`、`frontend:'original-workspace-conversation-run'`、`privateLibrary`，以及可选 `contextReset`。只把原 JSON API `404 / NOT_FOUND` 视为旧接口未提供该接缝；HTML/坏 JSON/其他 404、503、超时或坏 DTO 均阻止发送并允许显式只读重试。没有启动或切换另一引擎。 |
| 创建会话 | `POST /api/conversations`，原 `inputContext/requestId`；业务 adapter 在服务端绑定原 owner。返回 `{conversation}`。 |
| 连续消息 | `POST /api/conversations/:encodeURIComponent(id)/messages`，原 `content/requestId/inputContext/workspaceExecution`；业务聊天本次固定空上下文及 `false`。保持不透明 ID 的斜杠/冒号编码。 |
| 取消 | 原 `POST /api/conversations/:id/cancel` 及原运行卡；不声称下游已提交的业务任务已回滚。 |
| 上传 | 原企业资料页先 `POST /api/artifacts`，使用原文件 `filename/title/base64/metadata.businessLibrary.visibility:'internal'/requestId`；再 `POST /api/library/documents` 保存原 `asset:{artifactId,version,sha256}` 和资料字段。原 5 MiB/格式限制不变。 |
| 本地会话引用 | `GET/PATCH /api/conversations/:id/library-references`。PATCH 使用原 `expectedRevision/requestId/references`，产品固定 `productRevision`，资料固定 `documentVersion`；响应包含原 `libraryReferences/resolution`。 |
| 原文件查看 | `GET /api/artifacts/:id/content?version=N`、`/download?version=N`；继续核对原版本与 SHA。 |
| Medusa 配置 | `GET /api/medusa/catalog/status` → `{medusa:{configured,connection,mode,reason,...}}`。仅 admin/operator 可读；这只是本地配置状态，不会探测真实 Medusa。 |
| 原连接器 | `/api/bootstrap.capabilities.connectors` 中的 `enabled/status/adapterConfigured/credentialConfigured`，不等同于 OMP 插件加载状态或在线调用成功。 |

新增的两个 GET 状态读取使用原 API 客户端，沿用 cookie、CSRF 失效事件和 10 秒只读超时。没有浏览器签名、身份头伪造、令牌输入框或新的 auth 系统。

## 父任务需协调的接口/发布阻塞

1. **可信在线入口**：`docs/DEPLOYMENT.md` 要求原企业身份校验、静态资源保护，以及每次请求新鲜 Ed25519 `X-Workspace-Assertion`。普通反向代理/Vite 代理不能替代身份。前端没有私钥，也没有新建认证实现；登录与逐请求签名的真实集成必须由父任务验收。
2. **真实模型/Host**：`configured` 只说明配置存在。本任务没有调用真实模型、验证当前模型接收方/预算、建立真实 owner 绑定或证明持久会话原生锁。`npm start` 默认离线 TUI 成功也不证明 Web 可用。
3. **资料作为消息输入**：`server/pi-business-agent.mjs` 的 `publicContext()` 当前拒绝任何非空 `artifacts/skills/memoryIds/connectorActions`，返回 `BUSINESS_AGENT_PUBLIC_INPUT_ONLY`。现有资料引用 API 仅保存本地引用，没有“附件已送入业务聊天”的契约。本次不绕过此门；若要开放，需原后端明确获审的输入/披露契约和准确错误语义，再接线前端。
4. **完整插件清单**：基线没有返回所有 OMP 包加载/启禁/Host 配置状态的 HTTP API。需要原 Host 明确只读状态契约、状态来源和缺依赖/未配置/不可用语义；不能把原连接器列表或静态包目录冒充插件已可执行。本前端保留明确的状态缺口，不自造路径或假清单。
5. **Goal owner 接缝**：原 `POST /api/goals` 与 business conversation owner 的组合尚未验收。本次不以空系统能创建/启动任意 Goal 为前提，也没有新增 Goal API。
6. **生产与移动设备**：真实企业登录、真实业务/模型链路、部署后读取、真实手机键盘和系统浏览器仍需父任务独立验收。已测 320/390 px 是真实 Chromium 视口，不是实体手机验收。

## 逐文件变化

| 文件 | 变化 |
| --- | --- |
| `src/App.tsx` | 原界面接线、业务运行时能力限制、桌面侧栏/按需面板、原会话返回、草稿保留、缺失/断连发送保护、只读插件入口和可处理错误码。 |
| `src/api.ts` | 仅将两个真实 GET 状态路由加入原有只读超时集合。 |
| `src/assistant/WorkspaceAssistant.tsx` | 原聊天组件的公开文字模式、真实运行时名称、上传入口、准确资料提示；修复原请求核对成功后的恢复草稿清空。 |
| `src/harness/useConversationRuntime.ts` | 读取/校验真实运行时 DTO，明确区分加载、业务接缝、原 404、不可用；不会运行模型或切换引擎。 |
| `src/harness/PluginStatusDialog.tsx` | 使用原 Modal/useRead 展示有来源的配置状态、失效快照及独立官方 Medusa 链接。 |
| `src/harness/harness-workspace.css` | 现有组件的局部视觉/移动端修复；修复旧样式隐藏移动活动入口的问题。 |
| `test/harness-web-release.browser.mjs` | 真实 Chromium＋生产构建，明确合成 API 的 11 个用户流程回归；保留源码与制品 SHA256 证据。 |
| `test/harness-runtime-status.dom.test.mjs` | 独审补修新增：原真实 404 shape 和合法 legacy、HTML/坏 JSON/其他 404、503、坏成功 DTO 的 7 个 DOM 回归。 |
| `test/conversation-integration.dom.test.mjs` | 一处更新：活动面板改为按需打开后，先点击真实入口再检查原分组活动。 |
| 本文件 | 固定基线、接口、证据边界、失败记录、整合顺序和未验项。 |

## 安装、构建与启动

在已授权的依赖环境中（本轮实际执行了前三条）：

```sh
npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/harness-npm-cache
npm run typecheck
npm run build:web
```

原锁安装 280 个包，未使用 stub SDK、替换包或新的锁。未启用生命周期脚本。根文件 SHA256 与固定基线相同：

- `package.json`：`2491412413bf931503c6f34295fe46bdfb4a520c29650b895529a557d527fb94`
- `package-lock.json`：`2a7969eb6e35551c7d75cf9aa944d4f461de86d1e84e1afb28312d8187fa19bb`

前端开发命令：`npm run dev:web`，原 Vite 监听 `127.0.0.1:5173`，`/api` 仍代理原 `127.0.0.1:8787`。这不能代替企业签名入口。

已在源码确认的完整 Web 入口为 `npm run workspace -- --profile business --serve`，需父任务已经验收的原运行时/企业/Host/模型配置。本任务**没有执行该真实服务启动或读取其配置**。`npm start` 仍是默认离线 TUI；根 `npm run build` 是 OMP 构建，网页必须使用 `build:web`。

## 原交付历史实测结果与证据层次（31ca2ca）

以下是源码提交 `31ca2ca71d0fc387e7d0d07a5cd572fbf3e65b4a` 的历史结果，不能作为本次补修后的浏览器验收。无沙箱命令仅作历史记录，禁止用于本次或发布安全验收。集合有重叠，计数不要相加。

| 命令 | 实际结果 | 能证明的范围 |
| --- | --- | --- |
| `npm run typecheck` | 退出 0 | 原锁前端类型检查。 |
| `npm run build:web` | 退出 0；814 modules | TypeScript＋正式 Vite 构建。保留 JS 大于 500 kB 的告警，未改阈值：JS 878.41 kB / gzip 255.76 kB，CSS 212.43 kB / gzip 42.82 kB。 |
| `node --test test/conversation-create-idempotency.test.mjs test/assistant-runtime-adapter.test.mjs test/conversation-routing.test.mjs` | 10/10，失败/跳过 0，退出 0 | 原创建幂等 HTTP/Store、纯适配器、版本/调用来源及路由契约。无真实模型。 |
| `node --test --test-isolation=none test/conversation-integration.dom.test.mjs test/library-reference-inspection.dom.test.mjs test/muse-conversation-ui.dom.test.mjs test/procurement-conversation-ui.dom.test.mjs` | 20/20，失败/跳过 0，退出 0 | 生产 React＋JSDOM＋原 loopback HTTP/Store；provider/部分原生传输 DTO 为合成夹具。JSDOM 没有布局能力，不能证明手机显示或真实原生 Host。 |
| `node --test test/harness-web-release.browser.mjs` | 11/11，失败/跳过 0，退出 0 | **真实 Chromium、生产 JS/CSS、合成 API 响应**：空系统创建、同 ID 连续对话、刷新、创建/消息结果未知时原请求核对、上传/固定版本引用、未发送草稿、插件状态、320/390 px 几何、缺失会话、断连、只读角色和会话失效。没有运行原 server/SDK/SSO。 |
| `CHROMIUM_PATH=/usr/bin/chromium CHROMIUM_NO_SANDBOX=1 node test/library-reference-scope.browser.mjs /tmp/harness-original-http-browser-final` | 5/5 checks，退出 0，pageErrors 0，modelCalls 0 | **真实 Chromium＋生产 React＋原 HTTP/Store**，使用合成既有用户/session/binding 标记与文件；证明固定 v1 原字节/SHA、r1/r2 区分、未自动外传及原公开范围人工确认。只准备一个合成待审核订单，没有派发或调用模型，不证明真实账户/OMP/企业认证。 |

上述历史两组 Chromium 均仅访问本地合成页面，浏览器外部请求被拦截，未访问真实服务。当前容器正常 Chromium 沙箱启动失败，故通过的浏览器结果使用现有测试支持的 `--no-sandbox`；没有修 SUID、改系统或扩大权限。不得将其写成正常沙箱/生产安全验收。

本地证据未提交到仓库：

- `/tmp/harness-web-release-browser/report.json`：确切源码提交、文件及产物 SHA256、11 项检查、浏览器版本与边界。
- 同目录：`desktop-conversation.png`、`document-reference.png`、`plugin-status.png`、`mobile-conversation.png`、`mobile-320.png`。截图全为明显标注的合成测试数据。
- `/tmp/harness-original-http-browser-final/VERIFICATION.json` 及该目录固定版本/范围截图。
- `/tmp/harness-typecheck-final.log`、`/tmp/harness-build-web-final.log`、`/tmp/harness-contract-tests-final.log`、`/tmp/harness-existing-dom-final.log`、`/tmp/harness-browser-tests-final.log`。

原交付历史产物 SHA256（不代表补修后的产物）：

- `dist/index.html`：`f1d813afde6b8011289682cc232dd88bf61ac51d28f94a381557c4253b5c922d`
- `dist/assets/index-B7FYAhKm.js`：`ab9c976f91e819beb5aef02fc6d0a7c2fb20c09c5483c6c85d518333aed940f3`
- `dist/assets/index-B_-ohpj1.css`：`fd772f2dc482fdf9bb057abc9a901d1841cf0d967cc53f50dfc15cc35b3eb44f`

## 保留的失败与修复记录

1. 首次 `npm ci --ignore-scripts --no-audit --no-fund` 退出 254：默认 `/home/agent/.npm/_cacache` 不可写，伴随解包/清理错误。工具输出保留在本轮记录。改用授权可写的 `/tmp/harness-npm-cache` 后，原锁安装通过；未改锁或申请权限。
2. 初轮 DOM 3 个失败：导航精简影响旧服务 Goals/Brain 入口。恢复明确 404 的旧入口兼容后降为 1 个失败；剩余失败是测试仍假定默认展开活动面板。测试现按真实入口打开后验证。原 3 失败日志保留在 `/tmp/harness-existing-dom.log`，中间 1 失败保留于本文件和工具输出；最终 20/20 不覆盖其历史事实。
3. 初轮新 Chromium 测试 7/8：旧 CSS 在窄屏隐藏活动按钮，移动测试点击超时。局部样式修复后通过；保留 `/tmp/harness-browser-tests.log`，未删场景或跳过失败。
4. 原资料浏览器检查的**正常沙箱**尝试退出 1：Chromium 报 `The SUID sandbox helper binary ... is not configured correctly`。保留 `/tmp/harness-original-http-browser.log` 和 `/tmp/harness-original-http-browser/FAILURE.json`。后一次仅改变测试支持的沙箱选项，不修改应用/SDK/系统；其 5/5 有限通过不能抹去这个环境阻塞。

## 整合顺序与回退

1. 父任务先完成原 server/SDK 修复与根审，核对企业登录、签名、当前运行时/owner 和模型配置。在检查时，目标开发分支 `e63b33a56b51244f194c562c8332649a83adcc18` 比固定基线多 2 个提交，只改文书验收文档/测试，未与本前端修改重叠；这是当时快照，不是永久无冲突保证。
2. 审查并将本 Draft PR 整合到原开发分支，再在最终整合版本重跑前端/接口验证。本任务没有合并、rebase、强推或修改 main。
3. PR111 是独立插件服务抽离，不由本任务合并，也不是把缺失插件状态假定为可用的依据。
4. 父任务负责实际服务、静态产物部署与真实登录/聊天/资料验收；前端通过不能代替它们。
5. 本改动不迁移业务数据或认证。回退由父任务撤回这份前端源码补丁、使用原锁重建/恢复先前静态产物；原 Store、OMP、插件和身份配置不随本 PR 变化。

本轮按 `docs/plugins/PLUGIN-STANDARD.md` 1.0.0 的来源、状态和分层证据口径记录；不是插件生命周期或全套业务模块验收。已检查本地 `.agents/skills` 与固定树：没有适用于此任务的本地 SKILL.md/根 AGENTS.md；没有读取无关插件 Skill。


## 独审最小补修 · 2026-10-18

保持同一开发分支和 PR114，只补运行时错误分类、浏览器沙箱配置、相关回归及本说明；未重做 UI，也未修改根锁、server 或系统。

### 真实 404 契约与修复

已启动原 `createApp` 的无模型 loopback 合成夹具，实际观察到：

- 无业务 adapter 的 `GET /api/conversations/runtime`：HTTP 404、`application/json; charset=utf-8`，正文 `{"error":{"code":"NOT_FOUND","message":"Conversation not found."}}`。原 router 将 `runtime` 视为不存在的会话标识。
- 原不存在的普通 API：HTTP 404、同一 JSON 媒体类型，正文 `{"error":{"code":"NOT_FOUND","message":"API route not found."}}`。
- 该只读探测的模型调用为 0。错误形状与 `server/index.mjs` 的原错误序列化一致，没有猜测或新增后端错误码。

`useConversationRuntime` 现仅在原 API 客户端产生 `ApiError`、HTTP 404 **且** `code === 'NOT_FOUND'` 时进入 legacy。HTML 或坏 JSON 的 404 会产生 `INVALID_RESPONSE`，保持不可用并禁止发送；其他/未知 404、503 即使携带 NOT_FOUND、以及坏成功 DTO 也不降级。

### 沙箱配置与证据边界

`test/harness-web-release.browser.mjs` 的 launch 现在明确使用 `chromiumSandbox:true`，没有关闭沙箱参数，也不接受关闭沙箱的环境选项。可选 `CHROMIUM_PATH` 仅用于父级已经批准的 Chromium executablePath；未设置则使用 Playwright 原默认浏览器。

报告从 `actualBrowser:false`、`chromiumSandboxVerified:false` 开始，只有要求沙箱的 launch 成功才记为真。新版默认输出目录为 `/tmp/harness-web-release-browser-sandbox`，避免覆盖原历史截图和报告。

**新版沙箱浏览器检查：未执行。** 本环境已有正常沙箱 SUID 配置失败记录；本轮不再次启动浏览器、不降级、不修改系统。父级服务器只能使用其既有获准的 `sandbox=true` Chromium 完成独立验收。旧 11/11 合成 API 和 5/5 原 HTTP 浏览器结果均保留为 `31ca2ca` 的历史无沙箱有限证据，不能用于当前版本或发布安全验收；截图未重做。

父级在其获准浏览器环境下的命令形式为：

```sh
CHROMIUM_PATH=/ABS/APPROVED/CHROMIUM HARNESS_EVIDENCE_DIR=/tmp/harness-web-release-browser-sandbox node --test test/harness-web-release.browser.mjs
```

### 本轮实际验证

| 检查 | 实际结果 |
| --- | --- |
| `npm run typecheck` | 退出 0。 |
| `npm run build:web` | 退出 0；814 modules。JS 878.43 kB / gzip 255.78 kB，CSS 212.43 kB / gzip 42.82 kB，保留 >500 kB chunk 告警。 |
| 原创建幂等＋适配器＋路由的三文件纯/契约集合 | 10/10，失败/跳过 0，退出 0；原锁和原 HTTP/Store，无真实模型。 |
| 原四文件 DOM 集合＋新增 `test/harness-runtime-status.dom.test.mjs` | 27/27，失败/跳过 0，退出 0；生产 React/JSDOM＋原 HTTP/Store，运行时响应故障为明确合成注入。 |
| 新增运行时状态 DOM 单文件 | 最终单独复测 7/7，失败/跳过 0；合法 404 场景还等待输入解除加载，确认真正进入 legacy。 |
| `node --check test/harness-web-release.browser.mjs` | 退出 0，只证明脚本语法，不是浏览器运行。 |
| 新版 `chromiumSandbox:true` 浏览器 | 未执行，不能计作通过。 |

新回归覆盖：原合法 API 404、HTML 404、坏 JSON 404、无法识别的 JSON 404、其他 API 错误码 404、带 NOT_FOUND 的 503、坏 200 DTO。不可用分支均验证发送禁用、零 mutation、未创建会话及零模型调用。

本轮日志仅保留在本地：`/tmp/harness-review-fix-typecheck.log`、`/tmp/harness-review-fix-build.log`、`/tmp/harness-review-fix-contract.log`、`/tmp/harness-review-fix-dom.log`、`/tmp/harness-review-fix-runtime-final.log`、`/tmp/harness-review-fix-browser-syntax.log`。原正常沙箱失败及无沙箱历史证据不删除、不覆盖。
