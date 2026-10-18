# Continuous reviewed business conversations: bounded synthetic acceptance

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

At the initial local check, these files required the original installed dependencies and SDK:

```sh
node --test test/workspace-goal-owner-http.test.mjs
node --test --test-concurrency=1 test/workspace-continuous-budget-sdk.test.mjs
```

The one HTTP case uses real index/signed ingress/CSRF with an unconfigured model.
The two SDK cases use original `startWorkspaceServer`, uploaded synthetic
material, real tool-driven remember, Brain and same-Session continuation with
finite SSE/loopback Docling fixtures. They cover three Runs and durable unknown
usage blocking the next Run. All tool identifiers come from actual schemas/tool
results. There are no preseeded facts or real model fallbacks. They were initially
pending execution because the local installation lacks locked
`@earendil-works/pi-ai@1.1.0`, so importing the real index fails before a test body.
No dependency stub, import workaround or lock change was used.

The previously accepted finite mainchain and budget evidence remains separate
in `NATIVE-DOCUMENT-SCHEMA-CORRECTION-20261018.md`.

## Server execution, 2026-10-18

Source candidate `5cd167aed7dc37e1746807bbf9650cbb97915d99` ran once in a new
isolated temporary copy, 07:15:14–07:16:02 UTC. Original Node 24.19.0, Bun 1.3.14,
OMP 18.10.4 and `@earendil-works/pi-ai` 1.1.0 were used with an empty inherited
environment and fresh HOME. All six selected stages and the overall runner
exited 0. The 1301-file source subset and 43899 dependency/runtime files and
links matched their complete before/after manifests; root package and lock
were unchanged. This is the fixed 2376015b subset plus explicitly pinned
revisions, not an assertion that every later Git tree file was tested.

Actual results: new Store/Runtime 12/12; signed Goal HTTP 1/1; continuous SDK
2/2; original bounded transport 20/20; original document SDK five acceptance
cases plus one diagnostic body; selected document Host 2/2. Thus **42 product
and compatibility assertions passed**, with **one extra diagnostic completion**.
Raw TAP reports 43/43, fail/cancel/skip/todo 0. The wrapper's negative name
pattern did not exclude the repeated-lookup diagnostic. That packaging deviation
is retained; the diagnostic is not counted as a product-policy pass and no run
was repeated just to change counts.

The new SDK assertions verify actual startup, signed HTTP-created Goal, upload,
zero pre-seeded memories, model-tool remember, Brain, and three Runs retaining
the same persisted native Session. Their finite-provider sends are 7/3/2,
synthetic parser calls total one and all usage is confirmed at 4320 synthetic
micros. Context retains the source statement, Decision references the draft
Goal and no Goal execution occurs. The unknown-usage case retains the full
2700000-micro reservation; the next Run is refused before any provider send.
Both cases assert zero external model requests using the finite fixture.

Evidence hashes (raw logs remain outside Git):

- Full sanitized operator report: 9045 bytes, SHA256
  `c559a6070667dc78b52ac1238f09b015f0355b4c774208d07b917d782a9b079d`.
- New SDK TAP: 1063 bytes, SHA256
  `8f58ca1d7f62a88d62298c008d4b7826a5fe337b5c035e05ee963c917cd7db39`.
- Goal HTTP TAP: 379 bytes, SHA256
  `fc37ea595de507e292b93669ec68023e683577a8935a397ebbc60c334685eb87`.
- Source manifest SHA256:
  `df49f6982b2754871195687f1ec3dd1e3fd0fa01cdc0ddd79c7959460b3737f1`.

This establishes the real original Node/HTTP/SDK path with synthetic documents,
loopback parser and finite model responses. It does not establish a live paid
provider bill, public authentication deployment, unrestricted uploads or an
empty-library public chat mode. Reviewed Host configuration is still required.
