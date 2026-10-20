# Workspace Harness 契约（P0，冻结版）

所有工作包必须按这份契约实现；改契约必须先改本文件并通知其他工作包。

## 0. 运行时事实

- Node 24.21.0，绝对路径：`C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`
- pnpm：同一 node 执行 `...\dependencies\pnpm\bin\pnpm.mjs`；`.npmrc` 用 `registry=https://registry.npmmirror.com`。
- 已安装依赖（repo 根）：cordis 尚未安装；工作包 A 负责在 repo 根加 `cordis@4.0.0-rc.11`、`yaml@2` 并把它们写进根 `package.json`。
- 不允许改 `server/**`、`src/**`、`test/inquiry-recovery*`（Lead 所有）。

## 1. 插件清单 `harness.plugin.json`

```json
{
  "id": "workspace-inquiries",
  "version": "0.1.0",
  "kind": "plugin",
  "description": "Historical inquiry recovery",
  "entry": "./src/index.mjs",
  "requires": ["tools", "storage", "approval"],
  "provides": ["inquiries"],
  "configSchema": { "type": "object", "properties": {}, "additionalProperties": false },
  "routes": ["GET /api/inquiry-recovery/status"],
  "tools": ["inquiry_recovery_opportunities"],
  "skills": ["skills/inquiries"]
}
```

校验函数在 `packages/harness-contracts/src/index.mjs` 的 `validateManifest`。

## 2. 组合文件 `harness.local.yml`

```yaml
version: 1
name: local
server: { host: 127.0.0.1, port: 8790 }
plugins:
  - id: storage
    name: @workspace-harness/seams/storage
    config: { directory: .harness-data }
  - id: approval
    name: @workspace-harness/seams/approval
  - id: tools
    name: @workspace-harness/seams/tools
  - id: inquiries
    name: workspace-inquiries
    config: {}
```

`name` 解析规则（按顺序）：

1. 以 `@workspace-harness/` 开头 → `packages/harness-<rest>/src/index.mjs`（例如 `@workspace-harness/seams/storage` → `packages/harness-seams/src/storage.mjs`）。
2. 否则视为 repo `plugins/` 下的目录名（例如 `workspace-inquiries` → `plugins/workspace-inquiries/harness.plugin.json`）。
3. 显式相对路径（`./` 开头）按组合文件所在目录解析。

校验用 `validateComposition`；行对象 `{id,name,config,disabled,isolate}`。

## 3. 内核 API（`packages/harness-kernel/src/app.mjs`）

```js
export async function createHarness({ compositionPath, root = process.cwd(), logger = console } = {})
// → {
//   ctx,                       // cordis Context；ctx.<service> 由 provider 注册
//   rows,                      // 已校验的组合行
//   plugins: Map<id, {manifest, dispose}>,
//   start(): Promise<{server, address}>,
//   stop(): Promise<void>,
//   healthz(): { status: 'ok'|'degraded', plugins: [{id,status,error?}] },
// }
```

规则：

- 按 `requires` 拓扑排序挂载；缺依赖 → `HARNESS_PLUGIN_MISSING_DEPENDENCY`，不得部分启动。
- `apply` 抛错 → 已挂载的插件按逆序 `dispose`，进程退出码非 0，错误信息含插件 id。
- `disabled: true` 的行不导入、不挂载、不注册任何路由或工具。
- 同一 service 被两个 provider 提供 → `HARNESS_PLUGIN_DUPLICATE`。

## 4. HTTP 契约（`ctx.http`）

```js
ctx.http.route({ method: 'GET', path: '/healthz'|'/api/...', handler: async (req, res, context) => Response|{status,body} })
ctx.http.health(name, fn)   // fn() → {status:'ok'|'degraded', detail?}
```

- 内核在 `server.host:port` 上起一个 `node:http` 服务；`GET /healthz` 恒存在。
- 路由路径支持单段参数 `:name`（例如 `/api/inquiry-recovery/leads/:leadId`）：恰好匹配一个非空路径段，参数已 percent-decode；解码失败 → 400 JSON，绝不 500。
- 静态路由优先级高于参数路由；两个模式能匹配同一具体路径 → 启动失败（冲突）。`/leads/:id` 与 `/leads/:id/identity` 不冲突。
- handler 收到 `context.params`（对象）；返回值 `{status, body}`（JSON）；抛 `HarnessError` → 对应 `error.code/status`，其它异常 → 500 且不泄漏堆栈。
- 请求上下文对象：`{ method, pathname, query, params, actor: {subject, role, workspaceId}, body }`；P0 的 actor 由 `x-harness-actor`/`x-harness-role`/`x-harness-workspace` 头模拟，默认 `{subject:'local-operator', role:'admin', workspaceId:'local'}`。

## 5. 服务契约

### `ctx.storage`（provider：`packages/harness-seams/src/storage.mjs`）

```js
ctx.storage.read() → state（只读快照）
ctx.storage.update(fn) → Promise<result>（fn(state) 同步修改，原子落盘）
ctx.storage.close() → Promise<void>
ctx.storage.directory → string
```

实现复用 repo 的 `server/store.mjs` 的 `openStore(directory)`；目录必须由组合 `config.directory` 指定，默认 `.harness-data`。**绝不写现有 Workspace 数据目录。**

### `ctx.artifacts`（provider：`packages/harness-seams/src/artifacts.mjs`）

```js
ctx.artifacts.create({ requestId?, filename, content, title?, description?, metadata? }) → { artifact, duplicate }
ctx.artifacts.update(id, { content?, filename?, expectedRevision?, ... }) → { artifact }
ctx.artifacts.read(id, { version? }) → { artifact, content }
ctx.artifacts.download(id, { version? }) → { bytes, filename, mimeType }
ctx.artifacts.inspect(id) / ctx.artifacts.get(id) / ctx.artifacts.list()
ctx.artifacts.close() → Promise<void>
ctx.artifacts.directory → string
```

复用 `server/artifacts.mjs`（元数据在 `state.artifacts`，字节在私有目录）。`requires: ['storage']`；默认目录 `<ctx.storage.directory>/artifacts`，相对路径按 storage 目录解析，绝对路径必须位于其内；仓库根、逃逸路径、storage 根一律 `HARNESS_STORAGE_INVALID`。同一 `requestId` 相同内容幂等返回同一工件，不同内容 → 冲突。

### `ctx.llm`（provider：`packages/harness-seams/src/llm.mjs`）

```js
ctx.llm.register({ id, model?, label?, complete(request) }) → deregister()
ctx.llm.providers() → [{ id, model, label }]
ctx.llm.complete({ provider?, messages, tools?, maxTokens?, signal? }, { actor? })
  → { provider, model, text, toolCalls: [{ name, arguments }], usage }
ctx.llm.lastRequest() / ctx.llm.audit()      // 只含元数据，绝不记录消息正文
ctx.llm.close() → Promise<void>
```

该包**不进行网络请求**：真实 provider 由部署代码注册（pi/OMP 或 DeepSeek API）。未注册任何 provider 时一律 fail-closed（`HARNESS_LLM_NOT_CONFIGURED`），绝不编造回复。`createEchoProvider()` / `createReplayProvider({responses})` 仅供离线验收；provider 报错统一转成 `HARNESS_LLM_FAILED` 且不转发其消息；audit 上限 100 条、只记录 provider/model/计数/结果码。

### `ctx.skills`（provider：`packages/harness-seams/src/skills.mjs`）

见该模块 README：注册/扫描/读取技能，技能正文是数据，永不执行。

### `ctx.approval`（provider：`packages/harness-seams/src/approval.mjs`）

```js
ctx.approval.request({ actor, tool, args, reason }) → { id, status: 'pending' }
ctx.approval.decide(id, 'approve'|'deny', actor) → { id, status }
ctx.approval.consume(id, actor) → true | 抛 HARNESS_APPROVAL_REQUIRED
ctx.approval.list({ status }) → items
```

一次性：consume 后失效；过期（默认 60s）自动 deny；未知/过期 id 一律拒绝（fail-closed）。

### `ctx.tools`（provider：`packages/harness-seams/src/tools.mjs`）

```js
ctx.tools.register(toolDefinition)      // validateTool；重名 → HARNESS_TOOL_DUPLICATE
ctx.tools.list({ actor }) → [{name, description, parameters, approval}]
ctx.tools.execute(name, args, { actor, signal }) → Promise<unknown>
```

`execute` 顺序：查表 → `validateArgs`（JSON Schema 子集：type/required/enum/minLength/maxLength/pattern/minimum/maximum/additionalProperties:false）→ 若 `approval !== 'never'` 则要求 `ctx.approval` 的已批准票据（参数 `args.approvalId` 或 `{ actor, tool: name }` 的 policy 决定）→ 执行 `tool.handler(args, execution)` → 审计事件写入 `ctx.storage` 的 `harnessAudit` 数组（最多 1000 条）。

`execution = { actor, signal, ctx, storage, approval, tools }`；handler 不得接收原始 req/res，也不得闭包捕获另一个 actor。`approval: 'never'` 的工具必须同时声明 `readOnly: true`；返回值必须可 JSON 序列化，否则在执行前拒绝。

P0 策略：`approval: 'never'` 只允许只读工具；`'always'` 必须消费票据；`'policy'` 由注入的 `policy(actor, tool, args)` 决定（默认 = always）。

### `ctx.health`

`ctx.health.register(name, fn)`；内核 `healthz()` 汇总。

## 6. 业务插件契约（C 工作包）

`plugins/workspace-inquiries/src/index.mjs`：

```js
export async function apply(ctx, config) {
  // ctx.inquiries 由本插件注册（provides: ['inquiries']）
  ctx.http.route({ method: 'GET', path: '/api/inquiry-recovery/status', handler: ... });
  ctx.tools.register({ name: 'inquiry_recovery_opportunities', approval: 'never', ... });
  return async () => { /* dispose */ };
}
```

领域服务复用 `server/inquiry-recovery.mjs` 的 `createInquiryRecoveryService({ store: ctx.storage, artifacts: null, workspaceId, clock })`；
路由映射复用同文件的 `inquiryRecoveryHttp`，actor 取 `context.actor`。

工具（P0 只读，`approval: 'never'`）：

- `inquiry_recovery_status` → `{ engineVersion, counts }`
- `inquiry_recovery_opportunities`（参数 `asOf?: YYYY-MM-DD`）→ 前 20 张卡片的摘要（`leadId, decision, daysStale, nextStep.action`），不返回完整历史。

写操作（import/identity/select）P0 **只走 HTTP**，不暴露为工具；P1 再加工具与审批。

## 7. 验收（A/B/C 各自必须提供）

```sh
node node_modules/typescript/bin/tsc --noEmit          # 不许回归
node --test packages/harness-kernel/test                # A
node --test packages/harness-seams/test                 # B
node packages/harness-kernel/bin/wh.mjs list --composition harness.local.yml
node harness.mjs --composition harness.local.yml        # 启动后：
#   curl -s localhost:8790/healthz
#   curl -s localhost:8790/api/inquiry-recovery/status
```

C 额外：禁用 `inquiries` 行后，上述 route 与 tool 同时消失（测试断言 404 与 unknown tool）。
