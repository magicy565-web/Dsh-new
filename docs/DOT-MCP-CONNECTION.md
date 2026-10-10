# Dot xy · 真正的 MCP 连接与验收

## 当前状态

项目的旧版 `/api/dot-worker/v1/...` 是**REST 任务接口**，不是 MCP 协议服务端。仅让工具名称等于 `workspace_worker_inbox` 并不能使 ChatGPT 的个人 dot 自动调用这个服务。必须用真正的 Streamable HTTP MCP 服务端包装既有的队列和租约函数。

本次新增 **`POST /mcp`**（别名 `POST /api/dot-worker/mcp`），直接复用原有 `server/dot-worker-bridge.mjs`，而不是实现第二套执行引擎。使用已有的 11 项 reviewed 工作任务工具，`tools/list` 使用运行时随 `server/` 一同打包的 `dot-mcp-tools.mjs` 提供精确输入 Schema，额外测试会与 `docs/dot-worker-openapi.json` 对照防止漂移，`tools/call` 使用封闭 switch 调用原有被隔离的队列、租约、上传、提交接口。

- 协议 `2026-07-28`：stateless Streamable HTTP；`server/discover`、`tools/list`、`tools/call`；严格比对 `MCP-Protocol-Version`、`Mcp-Method`、`Mcp-Name` 与 JSON-RPC `_meta`。
- 协议 `2025-11-25` 与 `2025-06-18`：兼容 `initialize`、`notifications/initialized`、`tools/list`、`tools/call`；不创建跨请求 MCP Session，任务级 attemptId/fence 仍持久存在。
- 既有的 `/api/dot-worker/v1/...` REST 路由继续保留，供原有可信客户端使用，但**ChatGPT 插件连接需要指向 `/mcp` 而不是 REST 路由或 JSON OpenAPI 文件**。
- 不支持任意 shell、任意 URL、通用网络代理、私人 RFQ、自动消息发送或未审核工具。

### 双重鉴权/权限边界

MCP 和 REST 共用 Dot 独立的主机私有 Bearer hash 校验；此凭据**不是** ChatGPT 登录 token 或个人 dot session。禁止 Cookie、浏览器 Origin、Referer。工具错误不会把内部原始异常或凭据返回给模型。新桥接默认关闭；缺少受审核身份与费用硬上限，无法把 Dot 注册为有执行能力的 Worker。

请记住：MCP 工具连通，不代表用户私人 dot 实际在线、正在执行，也不代表其个人记忆/插件的数据隔离或任何第三方费用上限已经得到审计。

## 连接工作流程

1. 在受审核的**持久 Node.js 主机**部署当前 `main`，执行 `npm ci`、`npm run build`、`npm test`，确认 `GET /api/health` 成功。存储必须在单写者持久磁盘上，不能把这个可写状态机直接迁到无持久存储的普通 Vercel Serverless 函数。
2. 给这台主机配置经审查的 TLS 域名或 OpenAI **Secure MCP Tunnel**（如果当前账户提供）。机器内 Node 服务继续只监听 127.0.0.1:8787，通过受控 ingress 对外暴露插件专用 `/mcp`。不要暴露整个后台或把企业本地开发端口公开无保护。
3. 在可信服务器或 Secret Manager 里存 32 字节以上随机生成的私有插件令牌，主机环境仅保存对应的 64 位小写 SHA-256。不要把明文令牌放在仓库、聊天、网页、截图或日志中。
4. 使用同一个主机凭据（通过受支持的安全认证设置）连接现有 dot xy 的 Workspace 插件或创建新的受限 MCP 插件。**MCP Server URL 格式为** `https://<verified-host>/mcp`，绝对不是旧的 `.../api/dot-worker/v1`。
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
