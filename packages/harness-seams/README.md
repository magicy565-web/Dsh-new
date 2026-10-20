# @workspace-harness/seams

Mountable service providers for the Workspace Harness, implementing the frozen
contract in `packages/harness-contracts/CONTRACT.md` §5:

| Module | Service | Factory |
| --- | --- | --- |
| `src/storage.mjs` | `ctx.storage` | `createStorageProvider({ directory, root })` |
| `src/approval.mjs` | `ctx.approval` | `createApprovalProvider({ clock, ttlMs })` |
| `src/tools.mjs` | `ctx.tools` | `createToolsProvider({ policy })` |
| `src/artifacts.mjs` | `ctx.artifacts` | `createArtifactsProvider({ directory, maxBytes, maxTotalBytes, maxArtifacts })` |
| `src/index.mjs` | all four | re-exports |

Every provider is `{ apply(ctx, config) }`: it publishes the service on the
kernel context (Cordis `ctx.provide`) and returns an async disposer.

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
