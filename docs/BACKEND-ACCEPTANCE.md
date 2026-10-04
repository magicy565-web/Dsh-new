# Backend acceptance matrix · 0.2.0

Verified on 2026-10-04 with Node v24.19.0 on Linux. This is an independently implemented Workspace backend, not a claim of undocumented Muse parity.

States: Implemented = working source/API exists; Passed = specified evidence ran successfully; Unverified = not exercised against the real external service/environment; Blocked = intentionally unavailable until explicit configuration or a supported interface exists.

| Capability | Implementation and evidence | State |
|---|---|---|
| Durable workspace | Atomic v1→v2 migration, byte-exact backup, strict JSON, file corruption checks, single-writer/recovery fencing, private files; 12 store tests | Implemented / Passed |
| Sessions and conversation API | Persisted messages, request idempotency, explicit retry, cancellation and restart; existing HTTP/DOM contracts retained | Implemented / Passed |
| Durable runs/queue | FIFO queue, concurrency/queue limits, execution fingerprints, pending versus dispatched distinction, no automatic replay of interrupted attempts | Implemented / Passed |
| Goals and budgets | Pause/resume/cancel/review, step/time/output bounds, durable allowance reservation, invalid-response/unknown-usage accounting, revision fences | Implemented / Passed |
| Memory | Explicit scope/enablement, saved-output exclusion, exact configured credential and credential-format guards | Implemented / Passed |
| Files/artifacts | Actual private bytes, immutable versions, SHA-256, optimistic edit checks, quotas, MIME/signature validation, symlink/hardlink/path defenses; 18 artifact tests | Implemented / Passed |
| Skill registry | Persisted instructions, disabled default, explicit activation and bounded model context | Implemented / Passed |
| Connector registry | Host-installed named adapters, declared capabilities, approved env references, safe errors and credential-echo redaction | Implemented / Passed with local adapters; real connectors Unverified |
| Exact approvals | Action/resource/payload/config binding, expiry, deny, single consumption, concurrent replay rejection | Implemented / Passed |
| Scheduling | Default disabled, explicit consent, model/budget/runtime binding, atomic admission hash check, no duplicate occurrence or catch-up burst, bounded uncertain-result recovery | Implemented / Passed locally; no external scheduler enabled |
| HTTP/SSE/search | Exact loopback origin, bounded bodies, inert downloads, safe static serving, committed invalidation cursors, actual-data search | Implemented / Passed |
| Official Harness SDK | Actual bundled SDK stdio transport, live Session continuation, event attribution/filtering, process cancellation and shutdown | Implemented / Passed keylessly |
| Native persistent Session bridge | Explicit custom extension delegates to public native agents.resume and native JSONL; real source Context/AgentLoop/SDK-server used with a scripted no-network model across complete runtime restart | Implemented / Passed keylessly |
| Native Goal/context/MCP services | Continue to run inside reviewed Harness profiles; local Workspace goals are not presented as native Goal projections | Reused by profile; live tools Unverified |
| Native approval replies | Current SDK/bridge has no native approval-response RPC; rejects unsupported approval integration, requires reviewed fail-closed native interaction policy | Blocked, not simulated |
| Worker adapter | Disabled-by-default wrapper over real MultiWorkerEngine/gateway exports, fixed reviewed catalog, host identity verifier, native budget/lease/cancel logic; actual built exports tested with local identities/results | Implemented / Passed locally; remote identity/executor Unverified |
| UI compatibility | 2 production React-bundle + real HTTP + jsdom scenarios; chat/history/goals/search/settings/notes/review and real approve/deny; only necessary API display wiring changed, CSS/layout assets unchanged | Passed functional DOM; visual browser Unverified |
| TypeScript and build | npm run build executes tsc --noEmit and Vite | Passed |
| Clean release | Manifest/ZIP integrity, fresh extraction without node_modules/.env/.data, packaged frontend, blocked no-key request, persisted memory/file, graceful stop and second startup | Passed; see validation instructions |
| Live model and external actions | No real model key, account operation, remote Worker, MCP service, external message, cron, purchase or deployment used | Unverified / Blocked pending explicit setup and authority |

## Executed aggregate checks

- `npm test`: 131/131 backend tests passed, 0 skips in this environment
- `npm run test:ui`: 2/2 production-bundle DOM/HTTP scenarios passed
- `npm run build`: TypeScript and production build passed
- `python scripts/check-release.py release/Workspace-Agent-v0.2.0-Backend.zip`: clean startup and durable restart passed

Native source tests require the supplied same-version source tree and relevant built exports/dependencies. On a machine without them, the integration tests explicitly skip; local fixture tests alone do not establish native integration. The verified source snapshot accompanies the small App ZIP in five sub-8 MB ZIP parts; scripts/reconstruct-native-source.mjs verifies them and reconstructs backend/deepseek-harness-source.tar.gz. Its manifest and original working-tree digest are included in the App ZIP.

## Review fixes covered by regression tests

- Native Session reset no longer passes invalid null IDs
- Invalid JSON, omitted/zero usage and uncertain failure cannot erase goal allowance
- Invalid falsey memory scopes never become global
- Scheduled consent cannot be reused after budget/model/runtime changes or a concurrent definition edit
- Queued text-only work cannot become native tool execution after restart
- Model changes during a goal reservation cannot use a more expensive model under old admission
- Shutdown aborts work even if persistence fails; connector shutdown cannot delay native cancellation
- No-op scheduler ticks do not rewrite state; failed HTTP bind starts no recovered queue
- Old-run cancellation cannot cancel a newer chat or resumed goal attempt
- Missing native/provider usage is null with explicit unknown/partial completeness, not measured zero
- Pending approvals and blocked error details are visible in the existing UI

## Release constraints

Loopback single-operator only; no public authentication/multi-tenancy. Advanced connector/artifact/schedule/session/budget administration is partly API-only. Optional native bridge deployment still requires building and reviewing the same-install CLI/server/profile. Native internal tool/model budgets and external Worker execution must be controlled separately in reviewed profiles; outer local goal bounds are not a billing guarantee. Native resume preserves native Inbox/Goal semantics and does not promise exactly-once external actions. macOS/Windows execution and visual browser fidelity were not verified in this run.
