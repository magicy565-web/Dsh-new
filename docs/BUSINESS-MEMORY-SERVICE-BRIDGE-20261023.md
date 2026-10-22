# 企业经营记忆：服务通道（B 拓扑）

日期：2026-10-23
分支：`stack/trunk-20261023`（基于 `codex/plugin-library-completion-20261020`）
决策：以后产品开发以本地 Harness 为宿主，应用侧只做客户端。

## 拓扑

```
应用进程（server/runtime.mjs）                  Harness 进程（harness.mjs）
  │                                              ┌──────────────────────────────┐
  │  POST /api/business-memory/service/context   │ workspace-business-memory    │
  │  Authorization: Bearer <service token>  ───► │  · 账本（唯一权威）           │
  │  { taskId, query, refs, budgetChars }        │  · 审核 / 撤回 / 简报         │
  │  ◄─── { text, items, revision, counts }      │  · 注入回执 injections        │
  │                                              │  · /business-memory 区域页面   │
  │  POST /api/business-memory/service/verify    │                              │
  │  { ids }  ─────────────────────────────────► │  只读校验，不重编译、不重写回执 │
  └──────────────────────────────────────────────┴──────────────────────────────┘
```

Harness 是记忆的唯一持有者；应用不保存事实、不自己拼上下文。应用侧只有
[server/business-memory-client.mjs](../server/business-memory-client.mjs)。

## 为什么不是 A（账本放在应用进程里）

应用正在被 Harness 取代。把账本放在应用里，等于给一个即将退役的壳续命：
每个功能都要在应用里再实现一遍，然后随应用一起搬走。B 让数据权威先落到 Harness，
应用退化成客户端，后续把会话/运行也搬过来时，记忆不需要二次迁移。

代价是跨进程的失败语义和身份传递，下面两条把它钉死。

## 鉴权：服务令牌，不是成员表

Harness 的 HTTP 层会从 `x-harness-actor` 这类请求头派生 actor——这适合本地开发，
**绝不能**成为服务间通道的身份来源。服务通道单独加一层：

- 令牌只存在于一个私有文件里（绝对路径；POSIX 要求 0600、属主是当前用户、拒绝符号链接；
  大小 16–4096 字节；严格 UTF-8；32–256 字符）；
- 只在 `Authorization: Bearer <token>` 且常量时间比较通过时才放行；
- 放行后的 actor 固定为 `service:workspace-host`，角色 `operator`，**绑定到本组合的
  `workspaceId`**，不接受请求体里的 workspace；
- 未配置令牌 → 503 `BUSINESS_MEMORY_SERVICE_UNCONFIGURED`（默认关闭，不会意外开一个裸口子）；
- 令牌不写配置、不进日志、不进健康输出、不进错误消息。

对应实现：[service-auth.mjs](../plugins/workspace-business-memory/src/service-auth.mjs)。

## 接口契约

### `POST /api/business-memory/service/context`

```jsonc
// 请求
{
  "taskId": "run-...",        // 必填，注入回执的主键
  "sessionId": null,          // 可选
  "query": "海祺 补货",        // 任务文本，用于相关性
  "refs": [{ "subjectType": "customer", "subjectId": "customer-haiqi" }],
  "budgetChars": 2400,        // 400–8000
  "maxItems": 24              // 1–50
}
// 响应
{
  "workspaceId": "local",
  "revision": 12,
  "generatedAt": "2026-10-23T…",
  "taskId": "run-...",
  "text": "【企业经营记忆 · 自动注入】…",
  "items": [{ "id": "…", "statement": "…", "why": "subject-match" }],
  "counts": { "active": 3, "injected": 2, "omitted": 1 },
  "warnings": ["BUSINESS_MEMORY_EMPTY"]   // 没有可用事实时出现
}
```

行为：只取 `active` 且未过期的事实；按主体引用、文本命中、主体类型、来源可核对性、
置信度与新近度打分；按主体分散配额；按字符预算裁剪；**每次编译都落一条注入回执**
（taskId + revision + 实际披露的 id），审核员可反查某个 run 到底看到了什么。

### `POST /api/business-memory/service/verify`

```jsonc
{ "ids": ["<uuid>", "…"] }        // ≤50 条，必须是编译时拿到的 id
// →
{ "workspaceId": "local", "revision": 12, "current": false, "changed": ["<uuid>"] }
```

只读：重新读一次分区，逐条检查「存在、仍 active、未过期」。被替代、被撤回、已过期
都会出现在 `changed`。它不重编译、不写第二条回执——这是“派发前复核”，不是“重新召回”。

## 失败策略（调用方必须显式选择）

| 客户端错误码 | 含义 | 应用侧应有的行为 |
| --- | --- | --- |
| `BUSINESS_MEMORY_UNAVAILABLE` | 超时/不可达/重定向/响应不可读 | 记 `MEMORY_CONTEXT_UNAVAILABLE` 告警继续，不伪造事实 |
| `BUSINESS_MEMORY_UNAUTHORIZED` | 令牌缺失或错误 | 视为配置故障，告警；不要重试放大 |
| `BUSINESS_MEMORY_INVALID` | 请求或响应不合约 | 告警并丢弃本次记忆，不要猜测补全 |
| 编译成功但 `verify` 返回 `current=false` | 已披露事实在派发前失效 | **阻断本次运行**，要求重新准备上下文 |

客户端固定：`redirect: 'error'`、`cache: 'no-store'`、响应上限 1 MiB、默认 2s 超时、
只允许 HTTPS 或 loopback 上的明文 HTTP。

## 如何启用

1. 生成令牌并落到私有文件（示例，不要提交）：

   ```powershell
   $dir = "$env:USERPROFILE\.workspace-secrets"
   New-Item -ItemType Directory -Force $dir | Out-Null
   $bytes = New-Object byte[] 32
   [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
   [Convert]::ToBase64String($bytes).Replace('+','-').Replace('/','_').TrimEnd('=') | Set-Content "$dir\business-memory.token" -NoNewline
   ```

2. 在组合的 `business-memory` 行加绝对路径（`harness.local.yml` 里保留了注释示例）：

   ```yaml
   - id: business-memory
     name: workspace-business-memory
     config:
       workspaceId: local
       productLibraryBaseURL: 'http://127.0.0.1:8790'
       serviceTokenFile: 'C:\Users\<you>\.workspace-secrets\business-memory.token'
   ```

3. 应用侧读取同一路径，通过 `createBusinessMemoryClient({ baseURL, tokenFile })` 使用。

## 验证

| 项 | 结果 |
| --- | --- |
| 服务通道单测（`plugins/workspace-business-memory/test/service-bridge.test.mjs`） | 5/5 |
| 客户端单测（`test/business-memory-client.test.mjs`） | 5/5 |
| 记忆全量（domain / plugin / service / DSH index / injection） | 50/50 |
| 端到端冒烟 `node scripts/memory-bridge-smoke.mjs` | 11/11，真实组合 + 真实 HTTP + 真实令牌 |

冒烟覆盖：空记忆编译出带告警的块、候选不是事实、审核后生效、服务块引用该事实、
revision 存在、verify 判定当前、事实被替代后 verify 判为 changed、无令牌被拒。

## 下一步

1. **应用接线**：`server/task-context.mjs` 的 `enterpriseFacts` 改为消费客户端的 `text` +
   `items`，runtime 在 provider 派发前调 `verify`，`current=false` 时阻断。
2. **存量迁移**：把 `server/enterprise-memory-ledger.mjs` 里的既有事实导出为候选，走一次
   批量审核入库，然后停用该账本（避免两套权威）。
3. **Harness 原生消费**：未来 Harness 自己的 run 循环直接进程内调用同一服务，
   不再经过 HTTP——这条通道只服务过渡期的应用。
