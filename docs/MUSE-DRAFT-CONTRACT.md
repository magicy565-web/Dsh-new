# Muse draft client contract v1

Base: fixed `e5ae75584b45c8be02dc10b048ebd27b7ea7d3c3`. Backend branch:
`codex/cloud-muse-draft-20261012`. Review baseline stays untouched. This document
describes the implemented endpoints; ordinary fixture verification is recorded below. The
interrupted independent security review has no new pass conclusion.

All endpoints use the original enterprise session/CSRF/signed ingress and exact
original Muse admin owner/conversation. Normal Pi messages remain unchanged.
The one-page client offers an explicit Muse-draft intent from its composer;
it does not treat every message or product association as permission to delegate.

`POST /api/conversations/:cid/muse-drafts`

```ts
{ requestId: string, content: string,
  productReference?: { productId: string, productRevision: number } | null,
  inputContext?: InputContext }
// 202
{ draftId: string, revision: number, scopeVersion: number, run: { id: string, status: string },
  message: Message, duplicate?: boolean }
```

`POST /api/conversations/:cid/muse-drafts/:draftId/messages` adds required
`expectedRevision:number` to that body. Use it for missing-field replies.
Omitted inputContext/productReference inherits the original reviewed selection;
explicit null productReference clears the pin. Selected connectorActions must be
empty. No model or tool can run an external effect while drafting.

`GET /api/conversations/:cid/muse-drafts` → `{drafts:MuseDraft[]}`;
`GET .../muse-drafts/:draftId` → `{draft:MuseDraft}`. Poll these alongside the
ordinary conversation; original Run cancellation/recovery APIs still apply.

```ts
type MuseDraft = {
  id: string; conversationId: string; requestId: string;
  revision: number; draftHash: string | null;
  scopeVersion: number; scopeHash: string | null; // equal DTO aliases only runId: string;
  phase: 'pending'|'needs_information'|'ready_for_review'|'preparing'|
         'prepared'|'rejecting'|'rejected'|'failed'|'blocked';
  scope: { serviceId: string|null; product: string|null; market: string|null;
           objective: string|null; budgetCredits: number|null;
           deadlineAt: string|null; publicDataConfirmed: false };
  productReference: {productId:string;productRevision:number}|null;
  missingFields: string[]; // six data-field keys only; no invented defaults
  questions: Array<{field:string;question:string}>;
  error: {code:string;message:string}|null;
  prepareRequestId: string|null; // exact uncertain request for reconciliation
  orderId: string|null; reviewHash: string|null;
  executionStarted: false; wakeVerified: false;
}
```

Pending/blocked/failed expose truthful original Run state. A completed Pi proposal
with missing data becomes needs_information, not task execution. With all six
data fields it becomes ready_for_review. Show scope in the same conversation and
ask only questions returned in `questions`. Budget is INTERNAL CREDITS, not a
currency quote. Deadline needs an explicit date/time; unknown values stay null.
Unconfirmed `suggestions` have {field,value,label} and never fill `scope`/`order`.
`order` aliases the six data fields plus publicDataConfirmed:false, not a submitted
order. `publicText` is the exact six-field text proposed for disclosure; references,
notes and attachments are not implicitly included. The backend verifies factual
quotes against admitted user messages/selected text
snapshots. A product reference must already belong to this exact conversation and
revision. Its private name is resolved locally for human review, never exported
to Pi or converted into public-data authorization.

`POST .../muse-drafts/:draftId/prepare`

```ts
{ requestId:string, expectedRevision:number, expectedDraftHash:string,
  confirmed:true, budgetConfirmed:true, deadlineConfirmed:true, publicDataConfirmed:true }
// 200
{ draft:MuseDraft, delegation:OriginalMuseDelegation, duplicate?:boolean }
```

Show the exact scope and amount; require explicit amount, deadline and public-data
confirmations before calling prepare. Body cannot override scope/identity/order.
Prepare uses one stable original native order requestId per draft. A lost response
or preparing phase retains the original request body/id; retry only that request.
Read-only receipt/status is not wake, dispatch, execution or acceptance evidence.
Prepared drafts are immutable. Scope edits require a new draft and the existing
order cancellation/finish rules; no replacement task engine is introduced.

`POST .../muse-drafts/:draftId/reject` takes `{requestId, expectedRevision,
expectedDraftHash, confirmed:true}`. It records one explicit rejection, cancels
only through the original Run/native order operations, and invalidates old review
execution. `rejecting` means its cancellation receipt is still pending; it never
claims the worker has stopped. Pending Pi can also use the original Run cancel API.
Failed draft extraction is clarified via a new message/version, not ordinary Pi
retry. Original interrupted recovery remains scoped to the current draft version.

Next actions are the existing unchanged routes:
`.../muse-delegations/:orderId/approve` and `/dispatch`, each with
`{confirmed:true,expectedReviewHash:reviewHash}`. Original refresh/cancel/accept,
Attempt/lease/fence/files and exact receipt hash remain authoritative.

Same message requestId + exact body returns its original Run/version. Reusing a
key for another body conflicts. New clarification must match the current version;
old version/hash is 409 `MUSE_DRAFT_STALE_SCOPE`. Missing facts are 409
`MUSE_DRAFT_INCOMPLETE`; missing confirmations are 400 `MUSE_DRAFT_CONFIRMATION`.
Concurrent changes/unknown preparation never authorize another order. The draft
and every version/request receipt persist within the original locked Store.

No live model/account, production, paid inference or real Muse execution is part
of local fixture acceptance. Independent security review remains unfinished.

Actual initial business checks: `node --test test/muse-draft-flow.test.mjs` 4/4,
0 skip; official Pi faux tool + real signed enterprise HTTP/Store/Worker protocol.
Original Pi/Muse runtime suites also passed 11/11 during implementation. These are
normal development regressions, not the interrupted independent security audit.

Client may enable this path only for the original Muse binding and runtime
capability `inert-muse-draft-proposals`. A missing capability/endpoint blocks this
intent; do not substitute an ordinary Pi message. Reopening can list drafts and
reconcile the exact first requestId even if the initial 202 was lost.
