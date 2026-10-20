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

### 清单能力声明（`env`）

`harness.plugin.json` 可选 `env: ["DEEPSEEK_API_KEY", ...]`（≤16 个、大写名、不重复）：声明插件**允许读取**的环境变量名。它是能力声明，**不是值存储**；代码不得读取未声明变量。`wh plugins --json` 的行输出与 `wh doctor`（"environment reads (declared names only, never values)"）只展示声明名，永不展示值。`llm-bridge` 因此拒绝把 `apiKeyEnv` 指向未声明的变量。

### 组合 patch 层（`packages/harness-kernel/src/patch.mjs`）

```yaml
version: 1
name: offline-readonly        # 可选
entries:                      # 覆盖已存在的行；字段整体替换，config 不深合并
  - id: inquiries
    disabled: true
  - id: tools
    config: { allowedTools: [inquiry_recovery_status] }
insert:                       # 追加新行
  - id: market
    name: workspace-market
    config: { demo: true }
```

- `entries[].id` 必须命中现有行，否则 `HARNESS_COMPOSITION_INVALID`；不允许改名（`name` 只能断言原值）。
- `insert[].id` 不得与现有行重复；行本身按 `validateRow` 校验。
- 空 patch、未知字段、类型错误、重复 target 一律 fail closed；`config` 是整体替换。
- 应用顺序：组合文件 → preset 行覆盖（`composePreset` 时合并）→ `--patch`/`patchPaths` 按给出顺序（启动时应用）。因此 patch 总是最后生效，可以覆盖 preset 注入的 `allowedTools`/`deniedTools`，也可以禁用 preset 依赖的插件行。
- `createHarness({ compositionPath, patchPaths, patches })`；`harness.patches.applied` 记录每步 action（`disable`/`enable`/`config`/`insert`）。
- 被 `disabled` 的行**不会 import**，其路由、工具、health 一并消失——这是运行时可装卸的最小真实形态。
- `writePatch` / `setRowDisabled`：先校验再原子写（同目录临时文件 + rename），旧字节存 `<file>.bak`；清空最后一层时删除文件而不是写入空 patch；原文件损坏时拒绝改写。
- `digestComposition`：有效行（id/name/config/disabled）的稳定 SHA-256，暴露为 `harness.composition.digest` 与 `harness.patches.digest`，用于记录/比对"实际挂载了什么"。
- CLI：`wh patch show|disable <id>|enable <id> --patch <file>`。- `wh audit`：直接读 storage 状态文件（`workspace.json`）中的 `harnessAudit`，不挂载、不加锁、不写入；支持 `--state/--kind/--limit/--json`；旧工具条目归一化为统一 schema；缺文件 → exit 2、非法 JSON → exit 1、无 storage 行 → exit 2。
- 审计：每次 patch 写入/删层追加一行到 `<file>.journal.jsonl`（`at/event/action/rowId/beforeDigest/afterDigest/backup`，不含业务数据）；`wh patch journal --patch <file>` 读取。`createHarness({ auditPath })` / `node harness.mjs --audit <file>` 记录 `harness.mount|start|stop`，每行带组合 digest、patch digest、preset 与插件 id 列表。

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

### `ctx.audit`（provider：`packages/harness-seams/src/audit.mjs`）
```js
ctx.audit.record({ kind, action, actor?, ok?, code?, detail?, ref? }) → entry
ctx.audit.list({ kind?, actor?, since?, limit? }) → entry[]   // 最新在前
ctx.audit.summary() → { byKind, total, failed }
ctx.audit.close()
```

`requires: ['storage']`，条目持久化在 `state.harnessAudit`（与 tools seam 同一数组），`list()` 会把 P0 的旧 tool 条目（`{tool, ok, errorCode}`）归一化成统一视图。只存元数据：`detail` ≤2KB 的浅对象、`code` 必须是大写错误码、禁止未知字段；**绝不自动记录消息正文或客户数据**。调用方显式传入的 `detail` 由其自己负责合规。

### `ctx.workspace`（provider：`packages/harness-seams/src/workspace.mjs`）

```js
ctx.workspace.resolve(actor, { workspaceId? }) → { workspaceId, workspaceName, subject, role }
ctx.workspace.assertRole(actor, ['admin'|'operator'|'viewer', ...], { workspaceId? }) → 同上
ctx.workspace.list(actor) → [{ id, name, role }]     // 只返回 actor 自己的成员关系
ctx.workspace.close()
```

`requires: []`；租户与成员来自组合配置（`workspaces: [{id,name,members:[{subject,role}]}]` + `defaultWorkspaceId`），不读网络、不存业务数据。失败关闭：未知租户 → `HARNESS_WORKSPACE_INVALID`（HTTP 400），已存在租户但非成员 → `HARNESS_WORKSPACE_FORBIDDEN`（HTTP 403）；**角色以成员记录为准**，actor 头部自称的 role 不能提权；没有默认租户且 actor 未带 workspaceId 时拒绝而不是猜测。业务插件在 HTTP 与工具入口先 `resolve()`，未挂载 `ctx.workspace` 时跳过（向后兼容）。

**数据隔离（`packages/harness-seams/src/scope.mjs`）**：`scopeStorage(storage, workspaceId)` 返回一个 store 形状的视图，读写落在 `state.workspaces[<id>]` 分区；分区缺失时读为空对象、首次 update 时创建，非法 id → `HARNESS_WORKSPACE_INVALID`，分区根被损坏 → `HARNESS_STORAGE_INVALID`。业务插件为每个解析出的租户各建一个领域服务并绑定其分区，因此租户之间的线索/选择/冲突在磁盘上就是分开的；共享顶层状态（如 `state.artifacts`、`state.harnessAudit`）不进入分区。

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

**预设工具选择**：provider 的 `config` 支持 `allowedTools`（非空时只允许列出的工具）与 `deniedTools`（永远拒绝，优先于 allowed）；两者重叠 → 配置错误。被隐藏/拒绝的工具从 `list()` 消失，`execute()` 抛 `HARNESS_TOOL_REFUSED` 并写入审计。`composePreset` 会把预设的 `tools`/`denyTools` 注入 `tools` 行配置，因此预设不能调用自己未声明的工具。

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

**业务审计（当前实现）**：命中 `POST /import`、`POST /leads/:leadId/identity`、`POST /leads/:leadId/select` 成功后，插件向 `ctx.audit` 追加 `{kind:'inquiry', action:'import'|'identity-review'|'select', actor, ref, detail:{status, leadId?, requestId?, selectionId?, workspaceId?}}`；审计不可用时业务请求照常成功。`GET /api/inquiry-recovery/audit?limit=`（仅 admin，1–200）返回该插件的审计事件与总数；limit 非法 → 400，非 admin → 403，`ctx.audit` 未挂载 → 500。审计只含元数据，绝不含消息正文、草稿或客户数据。**多租户可见性**：审计按调用者解析出的 workspace 过滤（无 workspace 时保持旧的全局视图）；审批列表同样只返回本租户票据，跨租户 `decide` → 403 `HARNESS_WORKSPACE_FORBIDDEN`；审批列表响应带 `workspaceId` 以便前端核对。

**工件读取**：`GET /api/inquiry-recovery/artifacts/:artifactId` 返回 `{artifact, content}`；领域在创建草稿工件时把 `metadata.inquiryRecovery.workspaceId` 写入，读取时校验归属——非本租户或不存在一律 404 `INQUIRY_ARTIFACT_NOT_FOUND`（不做 403，避免租户探测 id 是否存在）；`ctx.artifacts` 未挂载 → 500。

## 7. 插件包管理（`packages/harness-kernel/src/install.mjs`，离线）

```sh
wh installed [--target plugins] [--json]
wh installed --journal [--json]          # append-only install log`nwh installed --check [--strict] [--json]  # digest drift vs the journal
wh install <dir> [--target plugins] [--upgrade] [--public-key <pem>] [--actor <subject>] [--json]
wh uninstall <id> [--target plugins] [--actor <subject>] [--json]
wh rollback <id> [--target plugins] [--backup <dir>] [--actor <subject>] [--json]
```

- 来源是**本地目录**（`harness.plugin.json` + entry）；不联网、不解压归档、安装期不执行包代码。
- 校验：`validateManifest`、entry 必须位于包内且存在、拒绝符号链接、≤512 文件 / ≤4 MiB。
- 内容摘要 = 对排序后的 `{path, sha256, size}` 列表求 SHA-256（排除 `harness.package.json` 自身）。
- 可选签名：`harness.package.json` = `{version:1, digest, signature, signer}`，`signature` 是对 digest 字符串的 ed25519 签名（base64）。签名包必须提供 `--public-key <pem>` 离线校验；digest 或签名不匹配一律拒绝；未签名包记为 `signature: none` 且 journal `signed:false`，绝不声称已校验。
- 原子性：先复制到 `.staging-*`，校验后 rename 到 `plugins/<id>`；升级先把旧安装 rename 到 `.backup-*`，失败时回滚；卸载 = rename 到 `.backup-*`；回滚 = 恢复最新（或显式）备份，当前安装移到 `.rollback-*`。
- 审计：每次操作追加一行到 `<target>/.install-journal.jsonl`（`at/action/actor/id/version/digest/previousDigest/signed/verified/signer/backup`，仅元数据）；`wh installed --journal` 读取。`--audit-state <file>` 还会把同一操作追加到该 storage 状态文件的 `harnessAudit`（`kind:"install"`），于是 `wh audit`/ctx.audit 与工具、业务事件在同一流中可见；追加是原子的（temp+rename）、上限 1000 条、无法解析的状态文件拒绝覆盖；审计写失败只告警、不回滚安装。
- 安装后的包由常规解析规则（`plugins/<name>`）发现，无需额外注册即可被组合挂载。
- **bundle**：`harness.bundle.json` = `{version:1,name,plugins:[{id,dir,version?}]}`（≤32 个，目录必须在包内）。安装前先做服务核对：bundle 内/已安装插件的 `provides` 冲突 → 拒绝；任一 `requires` 无提供者（`http`/`health` 除外）→ 拒绝且不写任何文件。安装按顺序进行，任一失败则回滚已完成的安装（新装删除、升级恢复备份），并在 journal 写 `bundle-failed`（含 `rolledBack`）；成功写一条 `bundle-install`。CLI：`wh install-bundle <dir> [--upgrade] [--public-key] [--actor]`。

## 8. 验收（A/B/C 各自必须提供）

```sh
node node_modules/typescript/bin/tsc --noEmit          # 不许回归
node --test packages/harness-kernel/test                # A
node --test packages/harness-seams/test                 # B
node packages/harness-kernel/bin/wh.mjs list --composition harness.local.yml`nnode packages/harness-kernel/bin/wh.mjs capabilities --composition harness.local.yml --check-unmet
node harness.mjs --composition harness.local.yml        # 启动后：
#   curl -s localhost:8790/healthz
#   curl -s localhost:8790/api/inquiry-recovery/status
```

C 额外：禁用 `inquiries` 行后，上述 route 与 tool 同时消失（测试断言 404 与 unknown tool）。
