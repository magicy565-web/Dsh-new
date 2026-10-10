# Dot xy · 真正的 MCP 连接与验收

## 当前状态

项目的旧版 `/api/dot-worker/v1/...` 是**REST 任务接口**，不是 MCP 协议服务端。仅让工具名称等于 `workspace_worker_inbox` 并不能使 ChatGPT 的个人 dot 自动调用这个服务。必须用真正的 Streamable HTTP MCP 服务端包装既有的队列和租约函数。

本次新增 **`POST /mcp`**（别名 `POST /api/dot-worker/mcp`），直接复用原有 `server/dot-worker-bridge.mjs`，而不是实现第二套执行引擎。使用已有的 11 项 reviewed 工作任务工具，`tools/list` 使用运行时随 `server/` 一同打包的 `dot-mcp-tools.mjs` 提供精确输入 Schema，额外测试会与 `docs/dot-worker-openapi.json` 对照防止漂移，`tools/call` 使用封闭 switch 调用原有被隔离的队列、租约、上传、提交接口。

- 协议 `2026-07-28`：stateless Streamable HTTP；`server/discover`、`tools/list`、`tools/call`；严格比对 `MCP-Protocol-Version`、`Mcp-Method`、`Mcp-Name` 与 JSON-RPC `_meta`。
- 协议 `2025-11-25` 与 `2025-06-18`：兼容 `initialize`、`notifications/initialized`、`tools/list`、`tools/call`；不创建跨请求 MCP Session，任务级 attemptId/fence 仍持久存在。
- 既有的 `/api/dot-worker/v1/...` REST 路由继续保留，供原有可信客户端使用，但**ChatGPT 插件连接需要指向 `/mcp` 而不是 REST 路由或 JSON OpenAPI 文件**。
- 不支持任意 shell、任意 URL、通用网络代理、私人 RFQ、自动消息发送或未审核工具。

### ChatGPT 插件真正需要的 OAuth 2.1（当前上线阻塞）

**当前 Workspace — xy 插件已安装并提供工具入口，不应该要求用户重新安装。** 但调用 workspace_worker_identity / workspace_worker_inbox 仍返回内部错误；需要排查既有插件后端及平台连接日志。

PR #12 的代码审查确认：目前 /mcp 与旧 REST 共用的自定义预共享 Bearer，仅适用于可信 HTTP 测试客户端，**不是 ChatGPT MCP 插件所支持的用户授权方式**。根据 OpenAI 官方要求，认证 MCP 应实现 OAuth 2.1，发布 Protected Resource Metadata 和 Authorization Server Metadata，使用 PKCE 和用户授权，由资源服务器验证 access token 的签名、issuer、audience、时效与权限。

**不能用 GitHub 合并或刷新插件来代替 OAuth 授权服务器配置。** 优先复用受审查的现成 IdP，不在 Workspace 中临时拼凑自研 OAuth 协议；没有确认 IdP 与实际部署、连接配置前，不声明 xy 已在线或可付费接单。

参考：https://developers.openai.com/plugins/build/auth
代码审查：https://github.com/magicy565-web/workspace-agent/pull/12#discussion_r4236223491

### 双重鉴权/权限边界

旧 REST 工具仍使用独立主机私有 Bearer hash，此凭据不是 ChatGPT 登录 token，不能替代 OAuth 2.1。禁止 Cookie、浏览器 Origin、Referer。MCP 真实 ChatGPT 连接必须先完成 OAuth2.1 认证端的部署与审计；缺少真实身份和费用硬上限时桥接默认关闭。

请记住：MCP 工具连通，不代表用户私人 dot 实际在线、正在执行，也不代表其个人记忆/插件的数据隔离或任何第三方费用上限已经得到审计。

## 连接工作流程

1. 在受审核的**持久 Node.js 主机**部署当前 `main`，执行 `npm ci`、`npm run build`、`npm test`，确认 `GET /api/health` 成功。存储必须在单写者持久磁盘上，不能把这个可写状态机直接迁到无持久存储的普通 Vercel Serverless 函数。
2. 给这台主机配置经审查的 TLS 域名或 OpenAI **Secure MCP Tunnel**（如果当前账户提供）。机器内 Node 服务继续只监听 127.0.0.1:8787，通过受控 ingress 对外暴露插件专用 `/mcp`。不要暴露整个后台或把企业本地开发端口公开无保护。
3. 在可信服务器或 Secret Manager 里存 32 字节以上随机生成的私有插件令牌，主机环境仅保存对应的 64 位小写 SHA-256。不要把明文令牌放在仓库、聊天、网页、截图或日志中。
4. **不要重复安装现有的 Workspace — xy 插件。** 在部署经审查的 OAuth 2.1 IdP 后，核对该已有插件的 MCP 服务 URL 和授权状态。目标服务器格式是 `https://<verified-host>/mcp`，绝不能直接依靠上述自定义 Bearer 冒充 ChatGPT 授权。用户授权需在现有插件的受支持流程中完成。
5. 在 ChatGPT 插件界面执行 **Refresh** 并检查 `tools/list`：应出现 **11 项 `workspace_worker_*` 工具**，而不是零个工具或与其他插件混淆。连接操作会要求使用者自己完成授权；应用不能从 GitHub 端替用户修改已安装插件的服务端 URL。
6. 验证 `workspace_worker_identity` 的响应来自此 Workspace 的账号与邀请身份；验证 `workspace_worker_inbox` 读取的是本项目的公开工作清单。身份握手只验证插件认证成功，不构成外部 worker 在线心跳。
7. 只有负责人另外审查 dot 个人权限、受审核工具、供应商账户的真实费用硬限额，并明确批准后，才能授权真实 Work Order。按每单预算范围 `approve -> dispatch -> queued -> dot claim`；Dot 使用原始 attemptId/fence 续租、上传真实交付、回传来源及工具回执，企业侧随后验收。

## 现有阻塞：为什么“代码合并了”还不能直接接单？

实际连通性检查：

- 已连接的 `Workspace___xy.workspace_worker_identity({})`：返回 `The tool failed internally`。
- 已连接的 `Workspace___xy.workspace_worker_inbox({})`：返回同样内部错误。
- 已连接 Vercel 账户没有 `workspace-agent` 项目，也没有这份单企业持久 Node 服务的上线地址；其他已经部署的网站属于不同代码库，不能拿来冒充它。
- GitHub Actions 在编译测试开始前出现 `startup_failure`，不能宣称 Node24 端到端回归通过。

**所以当前的实际连接状态是：MCP 服务端源码已存在，外部部署与插件路由/凭据握手尚未完成。不能显示“xy 在线”。**

### 已添加的验证用例

`test/dot-mcp.test.mjs` 和 `test/dot-mcp-contract.test.mjs` 覆盖：modern/legacy MCP 初始化、11 工具发现、严格协议/名字请求头验证、未知工具拒绝、未授权连接拒绝以及工作单到上传文件和人工验收的本地 HTTP 全流程。

执行：

```sh
node --test test/dot-mcp.test.mjs
npm run test:all
npm run build
npm run test:browser
```

只在有真实主机时，才有意义执行插件到主机的远程握手。实际 ChatGPT Dot 插件操作必须由插件拥有者在其设置中连接、授权和刷新，不能通过仓库合并自动修改。

官方规范：

- https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- https://developers.openai.com/plugins/deploy/connect-chatgpt
