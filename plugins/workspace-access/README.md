# workspace-access

本地登录会话。它不是第二套权限系统：成员与角色始终来自 `ctx.workspace`，
会话只证明“现在是谁在说话”。

## 它做了什么

挂载时向内核安装 **actor 解析器**（`ctx.http.setActorResolver`）。之后：

- 非 `public` 路由没有有效会话 cookie 一律 `401 HARNESS_UNAUTHENTICATED`；
- `x-harness-actor` / `x-harness-role` 请求头**不再具有权威性**（开发默认的 header 派生被覆盖）；
- `/healthz` 与显式 `public: true` 的路由（登录）保持开放；
- 卸载插件即恢复 header 派生（仅用于开发）。

## HTTP

```text
POST /api/access/login    { subject }     仅 loopback；必须是 workspace 成员
POST /api/access/logout
GET  /api/access/session                  当前 actor
GET  /api/access/sessions                 仅管理员
```

登录成功返回 `Set-Cookie: dsh_session=<64 hex>; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`。
会话默认 12 小时；过期或被撤销后立即失效。

## 边界（重要）

- 登录**只接受 loopback 来源**；远程部署必须由反向代理（Caddy Basic Auth 等）承担外层认证；
- 没有密码：这是“本机单操作员”模型，不是多租户身份系统；
- 没有 CSRF token：依赖 `SameSite=Strict` + JSON 请求体（跨站表单无法发送 JSON）；
- 没有登录页面：未登录访问 `/chat` 会看到 401 JSON，页面化是下一步。

## 验证

```powershell
node --test plugins/workspace-access/test/access.test.mjs
node --test packages/harness-kernel/test/actor-resolver.test.mjs
node scripts/access-smoke.mjs
```

冒烟覆盖：匿名被拒（即使伪造 header）、页面也需会话、成员登录、cookie 属性、角色来自成员表、
非成员被拒、登出后会话立即失效。
