# Fifth route: minimal host wiring specification (not applied)

Base: PR68 `d82d35fd7213012ff6b0e5f2f24d765aba021a9e`. Development branch: `codex/agent-factory-library-20261015`. No AGENTS.md or .agents/skills existed in the selected checkout or its /workspace ancestors. Existing materials/inquiries/customers/factory Skills were read. No writing subagent was started.

This branch adds an independently installable product intake plugin, an original-service adapter, native local reader and tests. Shared runtime files and all other plugins are unchanged. Unified integration owns the following edits; this is a patch specification, not a claim that production startup is already wired.

| Existing file | Small required change and reason |
| --- | --- |
| `server/pi-business-agent.mjs` | Admit a distinct reviewed `omp:18.10.4:factory-ingestion-v1` scope; construct `createFactoryLibraryIngestionClient` using its existing original Store/artifacts, original member identity, owned conversation/Run, original live Library Session and original model recipient. Pass `ingestionClient` to `engineAdapter.complete`. Do not derive private scope from an Agent Bearer or tool argument. |
| `server/library-model-read.mjs` | Expose a server-private original Session assertion/selection seam for exact authorized uploaded assets, product/company revisions and field masks, if the unified host has no equivalent. The current `readFactoryForSession` assertion is enclosed and read-only; a plain Agent `authorize()` is insufficient. Return synchronous live `assertCurrent(state)` without new HTTP endpoint/permission storage. New upload ingestion must have explicit original upload/field consent; existing product-only permissions are insufficient. |
| `server/workspace-omp-bridge.mjs` | Add only this profile's fixed RPC methods `factoryIngestionStatus/Read/Save/Query/Revalidate`. Dispatch to the original adapter with the original input.signal and current exact model; retain timeout, cancellation, frame limits, binding, shutdown and stale-Run fences. Transfer image content only over the existing private fd. Other profile allowlists stay unchanged. |
| `server/workspace-omp-worker.mjs` | Create a plain RPC facade for status/read/save/query/revalidate, flush the original journal before saves, forward model and original cancellation. Add no worker queue, tool orchestrator or arbitrary method dispatch. |
| `server/workspace-omp-session.mjs` | Select the standalone ingestion extension plus officially loaded ingestion Skill and its existing constrained `workspace_skill` reader. Expose only the four plugin tools and that reader. Before every provider call use `client.revalidateReceipt` for **every** historical ingestion result, including restored/forked/switched/compacted context. Bind distinct engineScope; refuse public/other-private transcripts and unexpected receipt fields. Disable public search/browser/task, shell/general file read and other plugins in this private profile. Keep the original official SDK as the sole agent loop. |
| `server/workspace-omp-host.mjs` and `scripts/workspace-omp.mjs` | Add the explicit profile selector and private-profile admission, while preserving the existing verified model/destination/billing requirements. Advertise startup only after the above original authority seam and cached context protections are implemented. |

The original `library-model-read` scope currently pins documents/products and selected fields; it does not authorize arbitrary unregistered uploaded artifact versions or expose a synchronous general write assertion. This is the concrete shared-service integration gap. The new independent adapter intentionally refuses incomplete host injection. Do not fill it with an unreviewed environment JSON permission file, a no-op assertion or an Agent token. A separate future Shopify publication still requires its own original authorization and reviewed connection; no Shopify publishing connector is copied or enabled here.

The integrating host should map its **existing** reviewed policy into the package's ephemeral scope (see package README), retaining the exact destination/provider/model and original Session expiry/revocation. `authorize(signal,model)` must first retain existing `bindingIdentity` checks and `assertActive`, then return `assertCurrent(state)` that checks the live `access.nativeSessionById(identity.sessionId)`, original reviewed field/upload recipient policy, member role/workspace and current owned Run. It must throw synchronously if any changes occur inside the original transaction. `canSave` reuses the existing running Run and explicit `businessAgentContext.allowBusinessSubmit === true`. This is reuse of original authorization, not authorization from a document or from this specification.

Import seam (the authority functions below must be the integrating host's real original functions, never test doubles):

```js
import { createFactoryLibraryIngestionClient } from './factory-library-ingestion.mjs';
import { factoryIngestionExtension } from '../plugins/workspace-factory-ingestion/src/extension.js';

const ingestionClient = createFactoryLibraryIngestionClient({
  store, artifacts, identity, conversationId: conversation.id,
  scope: originalReviewedUploadAndTargetSelection,
  authorize: originalSessionAndRunAuthorization,
  canSave: originalExecutionIntent,
});
// Pass only the narrow RPC facade to the existing isolated OMP worker.
// In that worker's official Session extension list:
factoryIngestionExtension({ client: ingestionClientFacade, authorize: originalWorkerAuthorization });
// Existing before-provider/cache guard, for each original ingestion tool result:
await ingestionClient.revalidateReceipt(receipt, currentModel, input.signal);
```

Once unified integration is complete, the existing `npm run workspace -- --serve` launcher can select the new reviewed profile. **Currently that profile selector is absent**; do not run a fabricated `WORKSPACE_OMP_PROFILE=factory-ingestion` command and claim success. Independent reproducible startup/dispatch acceptance is the official SDK fixture driven by `node --test test/factory-ingestion-package.test.mjs`. It creates only disposable synthetic local files, uses no credentials and makes no paid model or external requests.

Post-integration acceptance must exercise the complete real original upload/session path, one-sentence instruction, multi-file/multi-product native reading, save, subsequent query, current field masks, actual Session revocation between reads/commits/provider calls, cancellation/restart, and frontend visibility of original Products/Profile/Library. The current test results cannot substitute for those checks. No paid model may run until safe configuration and the original cumulative CNY5 remainder/hard cap are proven by the owning thread.
