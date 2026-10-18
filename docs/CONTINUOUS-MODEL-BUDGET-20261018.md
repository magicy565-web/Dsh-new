# Continuous reviewed business conversations: source candidate

Parent: `e63b33a56b51244f194c562c8332649a83adcc18`.

This change connects a durable, explicitly configured allowance to the existing
business Agent and bounded DeepSeek transport. The original two-Run
`paidAcceptance` remains a separate finite acceptance option. No production
configuration, credentials, paid request, or service deployment is included.

## Existing startup entry

Use the original `startWorkspaceServer` and business web command:

```sh
npm run build:web
npm run workspace -- --profile business --serve
```

The operator's existing private `WORKSPACE_BUSINESS_REVIEW_FILE` may include
`modelBudget`, instead of `paidAcceptance`. It still requires the original
reviewed Library/Goal/document/fact/Docling inputs; selecting a Library reference
in the browser does not create those permissions. This patch does not remove
the current coupling or authorize arbitrary uploaded versions.

The exact `modelBudget` fields are:

- `kind`: `workspace-deepseek-budget-v1`
- `reviewed`: `true`, recording the operator's explicit configuration choice
- `budgetId`: stable identifier for this approved allowance; never rotate it to
  hide charges or automatically create another allowance
- `workspaceId` and `subject`: the same existing authenticated owner scope
- `expiresAt`: explicit expiry, checked before reservation and each provider send
- `limitCny`: the approved total ceiling, not an account-balance assertion
- `historicalUpperCny`: operator-reviewed conservative prior costs outside this
  Store's recorded Runs; a new adapter or empty Store cannot establish history
- `receiver`: exact `provider`, `id`, `baseUrl`, currently the existing pinned
  `workspace-deepseek`, `deepseek-flash`, `https://api.deepseek.com`

Credentials remain in their original private server configuration. No example
contains an API key, signing key, parser secret, or deployable login. The original
reviewed provider-cost configuration is still required. Its boolean environment
marker alone is not a persistent allowance or a billing verification.

## Durable accounting and original boundaries

`server/workspace-model-budget.mjs` uses only the existing `Store.update` queue
and `state.runs[].modelBudgetReceipt`. It adds no second database, budget loop,
or worker-accessible Store. Store validation checks every optional receipt.

Before the worker starts, an atomic original Store transaction reserves the
existing `LOCAL_DEEPSEEK_LIMITS.maxTaskReserveCny` (CNY 2.70). Concurrent Runs see
one another's outstanding reservations. The policy, fixed receiver, original
prices and limits are hashed. Recreating an adapter or reopening the Store does
not reset confirmed charges, reservations or historical allowance. A changed
policy under the same budget identifier fails closed.

Settlement reuses `validateLocalDeepseekReport`, the original dispatched-event
protocol, token arithmetic and tariff. Charges are conservatively rounded up to
integer millionths of a yuan; the ceiling is rounded down. Complete known usage
is retained even if a turn later fails. Missing, incomplete or inconsistent
reports retain the entire reservation and stop subsequent sends. An interrupted
unsettled Run remains fully reserved when the original runtime marks it
interrupted at startup. This does not certify a real bill or the provider's
account balance. A reported provider-limit violation cannot prove a cost upper
bound; it stops further work and retains the full reservation for review.

The production marker only selects the existing bounded transport. The worker
does not receive budget configuration, Store authority or new permissions. The
original actual SDK/native Session handshake, tool schemas, receiver checks,
source/current/commit gates, request counts, cancellation and final normalized
wire gate remain. Durable settlement occurs **before** the original complete
final journal/source checks, avoiding a filesystem await after the last current
check. No additional model/tool loop or fixed business sequence is introduced.

The original four-call default and eight-call document capability ceiling,
32-tool cap, payload and output caps remain. Ordinary new messages may continue
beyond two Runs while the same reviewed allowance permits a full next-turn
reservation. Unknown charges require operator reconciliation; there is no
automatic replay or automatic budget renewal. This patch adds no reconciliation
API, legacy receipt migration or Session-recovery permission.

## Real Goal creation

The existing `POST /api/goals` now passes the trusted original HTTP identity to
`runtime.createGoal`. Omitting `conversationId` creates an ordinary conversation
owned by that identity, allowing the original reviewed Goal projection to use
it. No preparatory direct runtime call or Store seed is required. A supplied
conversation must belong to the same owner/workspace, and the original refusal
to adopt a business-owned chat remains. Creating a draft Goal starts no Run,
model request, external action or approval. It does not automatically add the
Goal to an operator-reviewed Brain selection.

## Candidate verification

Actual local Node 24.19.0 tests:

```sh
node --test test/workspace-model-budget.test.mjs test/workspace-goal-owner.test.mjs
```

12/12 passed, with real original Store and Runtime: three normal settlements,
Store reopen, concurrent reservation, exhausted/history checks, missing usage,
interrupted reservation, malformed reports, known failed-turn usage, live gates,
invalid durable records, trusted Goal ownership and existing caller behavior.
The first local run had one cleanup-order failure in the new test hook; the hook
was corrected to close Runtime before Store. No production assertion was relaxed.

These two files still require the original installed dependencies and SDK:

```sh
node --test test/workspace-goal-owner-http.test.mjs
node --test --test-concurrency=1 test/workspace-continuous-budget-sdk.test.mjs
```

The one HTTP case uses real index/signed ingress/CSRF with an unconfigured model.
The two SDK cases use original `startWorkspaceServer`, uploaded synthetic
material, real tool-driven remember, Brain and same-Session continuation with
finite SSE/loopback Docling fixtures. They cover three Runs and durable unknown
usage blocking the next Run. All tool identifiers come from actual schemas/tool
results. There are no preseeded facts or real model fallbacks. They are **pending
execution**: this local installation still lacks locked
`@earendil-works/pi-ai@1.1.0`, so importing the real index fails before a test body.
No dependency stub, import workaround or lock change was used.

The previously accepted finite mainchain and budget evidence remains separate
in `NATIVE-DOCUMENT-SCHEMA-CORRECTION-20261018.md`. It does not prove this new
continuous-budget production path until the new HTTP/SDK cases actually run.
