# Native Marketplace extension

Four original tools discover published Workers, prepare an internal draft, and read
reviewed owner-scoped order/task status. Ordinary installation is **unconfigured**.
The default local profile remains local-materials. Selecting the business manifest
registers tools; it does not grant identity, private data or spending authority.

## Original Host binding

Mount the existing `mountMarketplace(app, options)` on the original enterprise Host
before `listen()`. Its existing WorkerDesk, Store, provider bindings, price/budget,
review and human commercial-action gates remain authoritative. The optional
`readReviewedScope(context)` callback connects an **existing reviewed Host decision**
to the model projection. It must be synchronous so the original Store transaction
can recheck it at draft admission; it must return null when unavailable/revoked.
No HTTP/model tool creates this scope, and no new grant database or permission role
is installed. Never derive private permission from ownership, a public listing,
model arguments, `publicDataConfirmed` or `workspaceExecution: true` alone.

The callback receives the original identity, conversation, pinned recipient and
fixed purpose `marketplace-local-planning-status-v1`. Its reviewed result contains:

- `reviewed: true`, exact `workspaceId`, `subject`, `conversationId`, `recipient` and purpose.
- Stable `revision`, future `expiresAt`, and independent boolean `allowDiscovery`,
  `allowDrafts`, `allowOwnedOrderStatus` decisions.
- `fields`: only `orderId`, `status`, `serviceId`, `workerId`, `updatedAt`, `termsHash`.
  Private status requires orderId/status. Raw task inputs, delivery bodies, errors,
  payment details and provider account references are never admitted by this bridge.

The original signed Session, current original Run/conversation ownership, model
recipient, purpose, field mask, scope revision/expiry and exact source snapshot are
rechecked. Proof metadata is a source/authorization description, **not a bearer
permission token**; every use reruns the original Host checks. Public discovery
permission cannot read private orders. Other buyers and workspaces remain excluded.

The original native loader obtains the trusted client through the existing
`workspace:plugin-host` binding. A mandatory original journal guard protects every
private receipt before model calls, after restore, after Request.text serialization
and at original Node final delivery. Disabled plugins cannot restore guarded history.
Only one text block matching its details may be carried; extra images/text/private
fields are refused. The old raw `marketplace`/`readActor` injection does not configure
this extension without a reviewed client and guard.

## Draft and status semantics

`workspace_marketplace_propose` calls the original Marketplace/WorkerDesk create
operation with `human: false`. It checks the selected original quote and budget,
and checks live scope/Run again inside the original serialized Store admission.
It creates one existing WorkerDesk draft/contract, no second queue or execution row.
A lost acknowledgement reports `writeOutcome: unknown` and forbids a new-request
retry. The same original request can confirm the existing durable draft.

No confirmation, checkout, approval, dispatch, refresh/poll, cancellation of external
work, acceptance, metering, provider write or payment tool is exposed. A committed
draft remains committed if its Run is cancelled; cancellation stops model delivery.
The original human confirmation view must review the complete task inputs and terms.

Order status is a **strict snapshot**. Source, quote, scope or field changes invalidate
old receipts; history is never silently replaced with new proofs. Status reads do
not contact a remote Worker and do not include freeform delivery evidence.

## Explicit same-session continuation

When a legal order/status change blocks old history, the original business Run
reports `OMP_CONTEXT_REFRESH_REQUIRED`. The owner can explicitly clear the model
context through the existing authenticated human-control endpoint:

`POST /api/conversations/{conversationId}/terminal-controls`

```json
{"operation":"resetContext","confirmed":true,"requestId":"unique-stable-human-request"}
```

Use the application's existing Session and CSRF transport. The response is 202
with an original Run ID; read its original terminal-status until it succeeds.
An active Run must finish or be cancelled first (409). Retry an uncertain control
with the same requestId; this is not a model tool or a natural-message flag.

The original OMP `resetSessionContext()` keeps the same native Session ID and
append-only audit file, drops all old model messages and provider continuation,
and records its native reset boundary. This control makes zero model calls and
does not cancel/edit orders, renew authority or rewrite any old proof. Then send
a normal turn to reread currently authorized products, decisions and order status.
Current selection/recipient, owner, Run, revocation and final-send checks still
apply; absent reviewed scope is unconfigured. Required disabled plugins still
block restoration. This clears the whole model context; it is not an automatic
snapshot migration or a browser UI button. Other profiles retain their controls.

## Validation scope

See `docs/OMP-MARKETPLACE-NATIVE-INTEGRATION-20261017.md`: original disk Store, signed
Host, WorkerDesk and pinned OMP SDK are exercised. Model/SSE, business identities,
reviewed scopes, provider bindings and all remote/business data are explicit local
fixtures. No real provider, payment, credentials or external business call is claimed.
