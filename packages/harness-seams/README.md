# @workspace-harness/seams

Mountable service providers for the Workspace Harness, implementing the frozen
contract in `packages/harness-contracts/CONTRACT.md` §5:

| Module | Service | Factory |
| --- | --- | --- |
| `src/storage.mjs` | `ctx.storage` | `createStorageProvider({ directory, root })` |
| `src/approval.mjs` | `ctx.approval` | `createApprovalProvider({ clock, ttlMs })` |
| `src/tools.mjs` | `ctx.tools` | `createToolsProvider({ policy })` |
| `src/artifacts.mjs` | `ctx.artifacts` | `createArtifactsProvider({ directory, maxBytes, maxTotalBytes, maxArtifacts })` |
| `src/llm.mjs` | `ctx.llm` | `createLlmProvider({ providers, defaultProvider })` |
| `src/skills.mjs` | `ctx.skills` | `createSkillsProvider({ roots, maxSkills, maxBytes })` |
| `src/audit.mjs` | `ctx.audit` | `createAuditProvider({ limit })` |

Every provider is `{ apply(ctx, config) }`: it publishes the service on the
kernel context (Cordis `ctx.provide`) and returns an async disposer.

### `ctx.llm` (offline-first model seam)

The package never performs network calls. A deployment registers a real provider
(pi/OMP or the DeepSeek API); without one the service fails closed with
`HARNESS_LLM_NOT_CONFIGURED` instead of inventing a reply.

```js
import { createLlmProvider, createEchoProvider, createReplayProvider } from '@workspace-harness/seams';

ctx.llm.register(createEchoProvider());                       // offline smoke
const result = await ctx.llm.complete({ messages: [{ role: 'user', content: 'hi' }] });
// → { provider, model, text, toolCalls, usage }
```

`complete()` validates the request/response shapes, refuses ambiguous provider
selection, records metadata-only audit entries (no message bodies, capped at 100)
and maps provider failures to `HARNESS_LLM_FAILED` without forwarding provider
messages. `createReplayProvider({ responses })` scripts offline acceptance runs.

```js
import {
  createStorageProvider,
  createApprovalProvider,
  createToolsProvider,
  createArtifactsProvider,
} from '@workspace-harness/seams';

const providers = [
  createStorageProvider({ directory: '.harness-data' }),
  createArtifactsProvider(), // requires ctx.storage; defaults to <storage.directory>/artifacts
  createApprovalProvider(), // defaults: clock = Date.now, ttlMs = 60_000
  createToolsProvider(),    // optional policy(actor, tool, args) for approval: 'policy'
];

const disposers = [];
for (const provider of providers) disposers.push(await provider.apply(ctx));

// later, reverse order
for (const dispose of disposers.reverse()) await dispose();
```

A composition only needs the rows (CONTRACT §2); the kernel resolves
`@workspace-harness/seams/<name>` to `src/<name>.mjs`:

```yaml
plugins:
  - id: storage
    name: @workspace-harness/seams/storage
    config: { directory: .harness-data }
  - id: artifacts
    name: @workspace-harness/seams/artifacts
  - id: approval
    name: @workspace-harness/seams/approval
  - id: tools
    name: @workspace-harness/seams/tools
```

`artifacts` declares `requires: [storage]`; the kernel injects storage and refuses
the composition (`HARNESS_PLUGIN_MISSING_DEPENDENCY`) if no storage provider is
mounted.

Direct construction for embedders and tests: `await createStorage({ directory })`,
`await createArtifacts({ store, directory, maxBytes, maxTotalBytes, maxArtifacts })`,
`createApproval({ clock, ttlMs })`, `createTools({ storage, approval, policy, clock, ctx })`.

## Storage directory rule

- a relative `config.directory` resolves against the repository root (derived
  from the package location, overridable with `root`) and must stay inside it;
- an absolute `config.directory` is honoured as explicit operator intent
  (tests/CI/dedicated volumes);
- the repository root itself and the live Workspace data directory
  (`<root>/.data`) are always refused with `HARNESS_STORAGE_INVALID`.

Store failures (for example `WORKSPACE_DATA_INVALID` for a damaged
`workspace.json`) are propagated unchanged, exactly as `server/store.mjs`
reports them.

## Artifacts directory rule

Artifacts live under the configured state directory, never the repository root:

- `config.directory` defaults to `<ctx.storage.directory>/artifacts`;
- a relative `config.directory` resolves against `ctx.storage.directory`;
- an absolute `config.directory` is honoured only when it is inside
  `ctx.storage.directory`;
- the storage directory itself, any escaping path (relative or absolute) and the
  repository root are refused with `HARNESS_STORAGE_INVALID` before any I/O.

Artifact metadata is committed through `ctx.storage.update` (the same durable
workspace snapshot the rest of the harness uses); only blob bytes live in the
private artifacts directory. The blob format, locking, quotas and SHA-256
integrity checks are the existing `server/artifacts.mjs` service — the seam only
adapts `ctx.storage` and the directory.

## Behaviour summary

- **artifacts**: `ctx.artifacts` delegates to `server/artifacts.mjs`
  (`create`/`update`/`read`/`download`/`inspect`/`list`/`get`/`close` plus
  `directory`); requires `ctx.storage`; idempotent `create` on a repeated
  `requestId`; `close()` shuts the service down and later operations fail.
- **approval**: one-shot tickets; TTL default 60s with injectable clock; expired
  tickets auto-deny; unknown/expired/consumed ids fail closed; only the
  requesting actor or an admin may decide; only the requesting actor may consume.
- **tools**: `validateTool` on registration; duplicate names refused;
  `approval: 'never'` requires `readOnly: true`; `'always'` consumes
  `args.approvalId` through `ctx.approval`; `'policy'` lets an injected
  `policy(actor, tool, args)` decide (default = always); JSON-Schema subset
  argument validation; JSON-serializable results only; the last 1000 executions
  are appended to `state.harnessAudit` when storage is mounted (best effort).
- Handlers receive `handler(args, { actor, signal, ctx, storage, approval, tools })`.

## Skills service (`src/skills.mjs`)

`ctx.skills` is a bounded, read-only agent-skill registry. Skill bodies are
opaque data: the seam never executes, imports or evaluates them, and no network
I/O exists anywhere in the module. Mount it like any other provider:

| Module | Service | Factory |
| --- | --- | --- |
| `src/skills.mjs` | `ctx.skills` | `createSkills({ roots, maxSkills, maxBytes, root })` / `createSkillsProvider({...})` |

```yaml
plugins:
  - id: skills
    name: @workspace-harness/seams/skills
    config: { roots: ["plugins/*/skills/*"], maxSkills: 200, maxBytes: 65536 }
```

`config` keys are optional and match the factory options; factory options win
over `config`. The direct factory is `createSkills()` and the module also exposes
the provider-shaped `apply(ctx, config)` fallback plus
`manifest = { id: 'skills', kind: 'provider', provides: ['skills'], requires: [] }`.

Service API:

```js
ctx.skills.register({ name, description, body, source, pluginId? }) // -> frozen record
ctx.skills.list({ pluginId?, limit? }) // -> [{ name, description, source, pluginId, bytes }]
ctx.skills.load(name)                  // -> { name, description, body, source }
ctx.skills.scan()                      // -> { skills: [summaries], errors: [{source, code, message}] }
ctx.skills.remove(name)                // -> true
ctx.skills.close()                     // -> void (idempotent; later calls fail closed)
ctx.skills.roots                       // read-only resolved scan patterns (diagnostics)
```

- `name` matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`; `description` is a
  non-empty single line of at most 4096 characters; `body` is a string capped at
  `maxBytes` (default 64 KiB) and `source` is a non-empty one-line string;
  `pluginId` is optional and must match the manifest id grammar.
- The registry holds at most `maxSkills` records (default 200). `list()` returns
  detached summaries sorted by name (deterministic) and honours an optional
  `pluginId` filter and a further `limit`.
- `load()` returns exactly `{ name, description, body, source }`; unknown names
  throw `HARNESS_SKILL_NOT_FOUND`. `remove()` removes and returns `true`.
- `close()` is idempotent: it clears the registry and makes every later
  operation throw `HARNESS_SKILL_CLOSED` (the provider disposer calls it).

### Scan rules

- Default roots are `plugins/*/skills/*` resolved against the repository root
  (derived from the module location, overridable with `root`).
- A relative root resolves against `root` and must stay inside it; an absolute
  root is honoured as explicit operator intent (tests/CI/dedicated checkouts).
  Only one `*` wildcard per path segment is supported (`**` is refused).
- Only `<root>/SKILL.md` files are read; nothing outside the configured roots is
  ever opened. A directory without `SKILL.md` is skipped silently.
- Symbolic links are refused everywhere on the walk (root components, skill
  directories, `SKILL.md` files); they are reported as errors, never followed.
- Frontmatter is parsed with a tiny strict grammar: the file must start with
  `---`, close with `---`, and contain only `name:` and `description:` plain
  (optionally quoted) scalar lines. Unknown keys, duplicate keys, nested YAML,
  block/flow scalars and missing values are malformed.
- A malformed, unreadable, oversized or duplicate skill is reported as an error
  entry in the `scan()` result; it never crashes the scan. Files larger than
  `maxBytes` plus the 8 KiB frontmatter allowance are refused before reading.
  Valid skills are registered, so `list()`/`load()` serve them afterwards; a
  rescan of the same source refreshes the record in place.
- `pluginId` is derived from `<repo>/plugins/<id>/skills/<skill>/SKILL.md` and is
  `null` for roots elsewhere.

### Skills error codes

`HARNESS_SKILL_INVALID` (invalid registration/frontmatter),
`HARNESS_SKILL_DUPLICATE`, `HARNESS_SKILL_NOT_FOUND` — these three are already in
`packages/harness-contracts/src/index.mjs` (`ERROR.skillInvalid`,
`ERROR.skillDuplicate`, `ERROR.skillNotFound`). The seam additionally uses
stable local codes, exported as `SKILL_ERROR`: `HARNESS_SKILL_TOO_LARGE`
(body/file cap), `HARNESS_SKILL_LIMIT` (registry full), `HARNESS_SKILL_ROOT_INVALID`
(unsafe root or symlink) and `HARNESS_SKILL_CLOSED` (operation after `close()`).

## Audit service (`src/audit.mjs`)

`ctx.audit` is one durable, queryable audit stream for plugins. It requires
`ctx.storage` and appends to `state.harnessAudit` — the same array the tools seam
has written since P0 — so tool executions and new business events appear in one
view without rewriting history.

```js
ctx.audit.record({ kind, action, actor?, ok?, code?, detail?, ref? }) // -> frozen entry
ctx.audit.list({ kind?, actor?, since?, limit? })  // -> newest first
ctx.audit.summary()                                // -> { byKind, total, failed }
ctx.audit.close()                                  // -> idempotent; later record() fails
```

- `kind`/`action` are bounded identifiers; `ok` defaults to `true`; `code` must be
  an upper-case error code; `ref` is bounded text (a ticket or call id).
- `detail` is an optional plain object of at most 2 KiB. Unknown fields are
  refused, so a caller cannot smuggle a message body into the trail.
- At most 1000 entries are kept (config `limit`); the oldest are dropped first.
- `list()` normalises the legacy tool entry shape (`{tool, ok, errorCode}`) into
  `{kind: 'tool', action: tool, code: errorCode}`, so consumers never branch on
  which writer produced an entry.
- Durability is the storage seam's: a restarted harness with the same directory
  reads the same trail.

```yaml
plugins:
  - id: audit
    name: @workspace-harness/seams/audit
    config: { limit: 1000 }
```


