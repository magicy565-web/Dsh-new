# @workspace-harness/domain-inquiry-recovery

Standalone domain package for **historical inquiry recovery**: authorized
CSV/JSON import of historical inquiries, row normalization, evidence-bound
recovery decisions, human identity review, and selection that produces an
**unsent** follow-up draft plus a **non-enabled** Goal draft.

The domain never sends anything, never calls a model, and never fabricates
research, prices, MOQ, lead times, certifications or stock. Every write path
persists under `state.inquiryRecovery` through the host-provided store.

The package imports only Node builtins (`node:crypto`) and its own files. It
has no dependency on `server/**`, on any harness package, or on an HTTP layer:
the host injects its store, artifact writer, clock, workspace identity and
error class.

## Public surface

```js
import {
  createInquiryRecoveryService, // factory, see signature below
  inquiryRecoveryHttp,          // framework-agnostic route mapper
  parseCsv,                     // exported RFC-4180 reader (throws InquiryError)
  InquiryError,                 // default domain error class
} from '@workspace-harness/domain-inquiry-recovery';
```

`InquiryError extends Error` with own `status` and `code` properties, matching
the historical `server/runtime.mjs` `ApiError` shape. It is also the module's
default export.

### `createInquiryRecoveryService({ store, artifacts, clock, workspaceId, staleDays, ApiError })`

| seam | required | meaning |
| --- | --- | --- |
| `store` | yes | object with `read()` and `update(callback)`; recovery state lives under `state.inquiryRecovery` |
| `artifacts` | no (`null`) | original artifact writer with `create(...)`; when absent selections still persist but carry `artifact: null` |
| `clock` | no (`Date.now`) | `() => ms`; decisions and audit timestamps use it |
| `workspaceId` | no (`'local'`) | binds persisted recovery data to one workspace |
| `staleDays` | no (`7`) | follow-up threshold, integer 1–365 |
| `ApiError` | no (`InquiryError`) | error class constructor to throw (see below) |

Returns a frozen service with the unchanged method surface:
`importInquiries`, `status`, `opportunities`, `lead`, `reviewIdentity`,
`selectLead`, `selections`, `conflicts`, `commandReceipt`.

Import and identity/select commands take a stable UUID `requestId`; retries of
the same request return the stored receipt, and a reused `requestId` with a
different payload fails with `INQUIRY_IDEMPOTENCY_CONFLICT`.

### `inquiryRecoveryHttp({ recovery, method, pathname, body, query, actor, ApiError })`

Maps the `/api/inquiry-recovery/*` routes to the service and returns
`{ status, body }` (or `null` when the path is not ours). It performs no I/O.
The optional `ApiError` constructor is used for the mapper's own path-decoding
errors (`INQUIRY_PATH_INVALID`).

## Injecting the host error class

Internally the domain throws `InquiryError`. A host that already has an error
class (for example the legacy `ApiError` from `server/runtime.mjs`) passes it:

```js
const recovery = createInquiryRecoveryService({ store, clock, workspaceId, ApiError });
```

The factory bridges the public method boundary: every domain error, whether it
is thrown synchronously or rejects an async method, is re-thrown as
`new ApiError(status, code, message)` with extra fields preserved (for example
`error.rejected` on `INQUIRY_IMPORT_REJECTED`). `instanceof ApiError` therefore
keeps working for hosts whose HTTP layer serializes only that class.

`server/inquiry-recovery.mjs` is the compatibility shim that does exactly this
with `runtime.mjs`'s `ApiError` for the original server and test callers.

## Behavioural invariants (preserved from the historical module)

- Imports are bounded: 64 KiB input, 50 rows, unique columns from the documented
  set, per-row rejections reported with row numbers (`rejected[]`).
- Facts must quote imported history verbatim (`INQUIRY_FACT_UNSUPPORTED`).
- Dates are only trusted when explicit and unambiguous; impossible or
  timezone-less datetimes stay unknown instead of being coerced.
- A follow-up draft requires `follow_up` (stale + evidence complete); identity
  review binds to the exact imported `sourceHash`; a stale revision/source is
  refused with `INQUIRY_REVISION_CONFLICT` / `INQUIRY_SOURCE_CHANGED`.
- Selection never sends: `draft.sent === false`, `humanReviewRequired === true`,
  `goalDraft.enabled === false`, `goalDraft.notWritten === true`. Artifact
  writes happen only after the selection commits.
- Damaged `state.inquiryRecovery` sections fail closed
  (`INQUIRY_STORE_INVALID`) without overwriting data.

## Tests

```sh
node --test
```

`test/package.test.mjs` imports only this package's public entry point (no
`server/**`), exercises an import → decide → select flow against a temporary
store, and proves the injected error class is what callers receive.
