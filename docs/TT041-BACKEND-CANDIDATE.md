# TT041 backend integration candidate

Status: launchReady:false; no deployment or production configuration change. Original Muse account execution: unverified. The candidate is application source/build plus an overlay for the existing original Host. It does not include or replace the complete original Harness. The frontend in this backend package remains the reviewed PR28 base; task1 owns the next conversation UI and its browser acceptance.

PR30 head `8a6583c8d223a4b7797b6874b8194fb7a8b14061` was reviewed: its eight paths contain no backend changes. Following the user's latest scope restriction, its separate resource UI was not integrated. Its request/revision/navigation safety fixes remain available to reuse in a qualifying original-conversation UI. No frontend source is changed in this backend revision and no incomplete resource screen is offered as the requested Muse product.

Independent worktree: `task-2/integration-worktree`, branch `codex/tt041-managed-workspace-integration-20261012`. Application parent is `b4e59a99d3ea68e5e62e14d0b38384bab2fe4e7b` (PR28), with verified PR25/26 source integration already present. GitHub was read before publication: PR28 branch still at that parent; main at `b9546e1d7e6d7ac1381f84327a4f15cbfc60598f`. Main, other worktrees, original uncommitted frontend and production were untouched. Current payload hashes are in `deploy/muse-native-overlay/INTEGRATION-MANIFEST.json`; old overlay approval manifests are historical evidence only.

## Resulting behavior

- The original native conversation can prepare exactly one explicit `provider:muse` delegation, review its original scope/budget, approve and dispatch through the original WorkerDesk and eleven-operation Muse Connector. `requestId`, original conversation/order/task/attempt/fence and exact file ID/version/SHA remain fixed across retry, restart, cancellation and late return. No second queue, approval store, DAG or execution engine was introduced.
- Existing supply records gain exact saved enterprise product/SKU/revision and configured merchant bindings. Personal buyer requests remain private until the buyer approves the exact review hash. The specified merchant can bind a request once to their owned conversation and persist an actual reply. The buyer's original authenticated procurement MCP reads actual replies. Foreign buyer/merchant/workspace identities receive no private request. Revocation blocks subsequent merchant reads and replies; replay of a historical share receipt cannot reactivate access.
- Both app and original native Host use the same existing resource services and shared HTTP dispatchers. Native bindings retain original actor/epoch checks and the original Store writer. The ordinary app rejects explicit Muse when no reviewed original native conversation binding exists; it creates no text model Run. That rejection does not disable or reclassify the existing Muse Connector.
- The same logical Worker cannot admit unfinished native and REST work simultaneously. Guards read original registry/delegation and REST/order records inside the original Store transaction. Uncertain, overdue or unverified identity bindings remain blocked. Existing one-person/one-Worker and single-mount limits are unchanged.
- Windows privacy checks inspect the real DACL, not POSIX mode bits. Only empty caller-owned application objects receive a narrow DACL before data is written; unknown/unsafe nonempty data fails closed with exact bytes preserved. The fixed, bounded native descriptor reader refreshes every decision and creates no cached authorization. Directory fsync, rename uncertainty, lock ownership and observer receipts still use the existing Store protocol.

## API and account boundaries

`MUSE-CONVERSATION-API.md` contains the original native conversation endpoint contract. `CONVERSATION-PROCUREMENT-API.md` covers procurement/resources. Bodies cannot select actors or Workers. Native owner/epoch and enterprise session/CSRF remain authoritative. No credential, account login, Connector, schedule or persistent account authorization has been created. The new optional procurement principal file only loads previously reviewed bindings from an absolute private file; default remains disabled. All configured procurement digests must differ from Dot/Muse credentials, and buyer subjects must differ from enterprise members. It is not a new Muse execution channel.

`MUSE-CONNECTOR-WAKE-EVIDENCE.md` separates the original client/account history, actual supported routes and official wake contracts. Pending work is not a wake receipt; claim is not a model-start receipt. `agent.send(...,'next-step',false)` inserts the result and does not start a model turn. Native wake and actual account execution remain independent acceptance gates.

## Verification and remaining gates

Current offline validation logs are stored under `docs/validation/tt041-backend-candidate`. They distinguish actual Windows disk/HTTP/byte verification from synthetic Muse/Session sender and registry record-shape fixtures. Independent task3 PR29 acceptance sources are copied byte-for-byte; assertions are unchanged. Source boundary checks explicitly pin the reviewed two changed library/Shopify module hashes rather than claim all imported files are unchanged.

The current native frontend/service overlay is syntax-checked but cannot boot independently: it imports original Harness/Host modules absent from this task checkout. The actual original register/admit/settlement implementation, native frontend listening against that Host and current Muse execution are not claimed as tested. Task1/source owner must supply the exact verified original source path/version before overlay integration or full native boot; no guessed FileDrive materialization or replacement Host is used.

The original unchanged Python client locally reaches 29/40 on Windows; eleven POSIX persistence tests fail because `os.O_DIRECTORY` is unavailable. These are recorded failures, not skipped or treated as success. Historical Ubuntu 40/40 in its README remains historical. Windows application Store tests exercise actual NTFS flush and DACL independently of this POSIX-only original Muse client.

Package commands use existing tooling:

```text
python scripts/package-release.py --application-overlay <candidate.zip>
python scripts/check-release.py <candidate.zip> --application-overlay
```

The explicit application/overlay package mode verifies every file/hash and clean extraction, actual application HTTP startup/close/reopen, exact artifact bytes and no Muse-to-model fallback. It does not claim the original Harness or Muse account boot. Default backend packaging and `--light` still require the original source archive/hash and source manifest; those full-package gates were not bypassed. No package is approved for launch.

Remaining gates: independent task3 checks the new exact head/package; task1 integrates and browser-tests the conversation UI; original source owner verifies current Host baseline/imports and common slot using its real module; original Muse account owner demonstrates existing Connector access, exact one-task execution, wake if supported, files to the original Session and separate human acceptance. New persistent account authorization requires the parent task's precise authorized flow. Production deployment is not authorized by this candidate.
