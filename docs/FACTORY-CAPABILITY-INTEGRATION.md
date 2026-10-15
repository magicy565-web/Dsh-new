# Unified original Host integration

This branch integrates C `b55f78bf08b2c4edf245bd5e7c6f4ff2ab2ede7b`, E `d7bc90f400127a48cba5246e77d37633691c0c79`, A `cea2b6727acedd0c44dce63fe24576e8c89ccf41` and B `aec8b845adaa48ab9e84fc72eb88e6b98c9f14c9`. The earlier route-specific acceptance documents remain historical evidence for their named commits. This document supersedes their statements that plan/ingestion Host wiring is still absent.

## What is connected

The existing original Host now accepts explicit `factory-ingestion` and `market-validation` profiles alongside its existing profiles. They use the same original Session, member/tenant/recipient binding, conversation/Run, artifact and Library services, private worker transport, official OMP AgentSession and Skill loader. They do not create another Host, model loop, grant store or scheduler. Business steps and record/file choices are model inputs under the actual goal, not a fixed workflow.

| Profile | Engine scope | Tools |
| --- | --- | --- |
| `factory-ingestion` | `omp:18.10.4:factory-ingestion-v1` | Original upload status, native source read, source-backed intake save/query, selected Skill reader |
| `market-validation` | `omp:18.10.4:market-validation-v1` | Original materials/document tools, authorized product read, unreviewed plan save, selected Skill reader |

Each private profile excludes public search/browser/subagents, shell, arbitrary file reads and legacy business-stage tools. New profiles have distinct binding fingerprints and journal admission. They cannot inherit a public or another private profile's tool receipts. Both ordinary `--check` and the original terminal transport recognize these scopes. The existing default profile is unchanged.

```sh
WORKSPACE_OMP_PROFILE=factory-ingestion npm run workspace -- --check
WORKSPACE_OMP_PROFILE=market-validation npm run workspace -- --check
```

These checks do not make model requests and do not grant disclosure. In the current execution environment both correctly return unconfigured, with `modelKeyPresent:false`, no existing backend binding, and no reviewed prices/remainder. They do not prove that the user never supplied an API elsewhere. Starting the service with `--serve` selects the corresponding already-authorized Host capability; it cannot create the missing existing configuration or original reviewed Library policy.

## Original Library selection

The trusted existing `createApp({ libraryModelReadPolicy })` seam may additionally carry `factoryIngestion` inside its already reviewed enterprise policy:

```js
factoryIngestion: {
  uploads: [{ artifactId, version, sha256 }],
  companyRevision: originalCompanyRevisionOrNull,
  products: [{ id: originalProductId, revision: originalProductRevision }],
  fields: { company: ['legalName'], product: ['name', 'skus'] }
}
```

The enclosing original policy still supplies its exact workspace/member, recipient, expiry, and existing company/products/productFields configuration. This is a trusted server option, not a model/tool argument, environment JSON grant, new HTTP endpoint or permission ledger. It is absent by default. An existing product-read grant does not imply upload ingestion/write authority. All uploads require exact versions/hashes and original internal visibility. Current original operator Session and Run intent are rechecked inside the existing Library/artifact transactions. No role, account, credential or permission is created by this integration.

`library-model-read.factoryIngestionForSession()` exposes only this original reviewed selection and a synchronous live Session assertion to `pi-business-agent`. The worker receives narrow RPC callbacks. Original Library/artifact operations remain the only data services. New Products/Profile values are visible through the same existing human-facing `/api/library/products` and `/api/library/company` APIs; their UI was not replaced.

Status now returns selection metadata and pinned record IDs/revisions rather than catalog field contents. This avoids retaining a stale pre-write field snapshot in a conversation after its own authorized write. Source-checked query supplies the exact saved projections. A later human edit still requires fresh original selection; populated fields remain protected.

## Revocation, partial writes and private context

Direct query now reconstructs the original batch journal and re-reads **every source from that batch** before disclosing a saved report or conflict notes. Checking only the currently selected uploads would allow a removed original source to bypass revocation. Exact source/readHash correspondence is required. Saved report artifact, original report-document receipt, current record revisions and field masks are rechecked.

On an original service outage after partial commits, save/query returns `status:'partial'`, `reason:'ORIGINAL_LIBRARY_INGESTION_INCOMPLETE'`, the original stable requestId/plan reference and exact committed record IDs/revisions. It does not claim atomic rollback or completed intake. Replay of the identical body resumes through original durable operations, without duplicates. Safe historical partial receipts may remain in context after their verified batch progresses; forged references or extra fields are rejected. Cancellation and revocation still fail closed without redisclosing private data; a later authorized query reconciles any already committed records.

The original per-provider context guard revalidates ingestion and plan receipts, including restored whole journals. Native image blocks are checked against the original source reader, in addition to the textual receipt/readHash. A duplicate receipt cannot evade that check by substituting a different image. Native local text/PDF/image extraction has separate real component tests; the new positive end-to-end Host tests use synthetic text. Real model image understanding is not claimed or verified.

Per-tool AbortSignal travels through the existing worker request/cancelRequest path, combines with original Run cancellation, and reaches the original read/commit gates. New plugins use the same safe cancellation/authorization meanings as C. Only finite reviewed business codes are propagated; arbitrary exception text/codes are suppressed. Unconfigured and blocked tools are upstream errors. Partial saves remain errors with durable progress evidence. No automatic paid retry occurs.

## Seven-day monitoring and Shopify

B's original service-task association, original Runtime dispatcher, schedule and human HTTP routes are integrated in the same app. A generated/saved plan remains unreviewed and `not_started`. The model has no monitor-start tool and cannot submit `confirmed` to create human permission. The original human Session/CSRF route additionally requires the exact original plan/acquisition approval/execution receipt and baseline before it can create/approve the linked service-only observation task. Generic Goal chat cannot adopt that task as a new model loop.

Shopify publication, order/inventory reads and product metrics continue to use the existing Shopify and reviewed traffic services. There is no new connector, credential or real commercial launch. A missing original acquisition-receipt resolver, account binding or traffic source remains explicitly unavailable; this branch does not manufacture one. The independent Shopify research work is not treated as an implemented publishing plugin.

## Acceptance and actual model status

See `docs/validation/factory-capability-integration-20261015/` for source pins, sanitized verification summaries and current configuration/budget presence evidence. The actual official Host/SDK and original HTTP/Session/Library/Store/artifact execute for engineering tests. All model choices/prose in those tests are explicitly finite keyless scripts over synthetic non-sensitive inputs. The service-only tests separately identify injected synthetic authority/parser callbacks.

The user's existing DeepSeek API and cumulative CNY5 test authorization are acknowledged; no repeat approval is required. The earlier C task explicitly prohibited paid calls, so its engineering acceptance was not a real-model test. Under the latest instruction the remaining blockers are concrete: this execution environment has no injected DeepSeek provider/key/model or existing service binding, and no local runtime ledger or verified historical consumed/remainder amounts. No chat key was recovered or copied, no credential was created/changed and no permission was expanded. This branch's real/paid DeepSeek calls and added API spend are zero; original cumulative spend and remaining allowance are **unknown**, not zero/five. No real model or real enterprise-material acceptance is claimed. If the original secure configuration and amount evidence become available in the authorized environment, the already approved next step is the smallest original Host test using clearly labelled synthetic non-sensitive product input within that same remaining cumulative allowance.
