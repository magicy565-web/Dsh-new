# Uploaded Library document → native Agent memory → Brain → continuation

Base: `016a2eaecad9b303fbb8c14b45b708c5edc83053`. This is the first operational product slice; its new SDK acceptance has **not yet run**.

## Ordinary product path

1. Use the existing enterprise Library page to upload an actual file. Its unchanged HTTP sequence is `POST /api/artifacts` (base64 bytes, internal visibility), then `POST /api/library/documents` (exact Artifact version/SHA).
2. The administrator supplies the original reviewed Library/model policy, reviewed Goal, exact document pins and fact keys, explicit read/remember selection and separate complete-file Docling consent. A page reference does not grant either model disclosure or parser transfer.
3. Open a **new** original business conversation and use its existing document picker before the first message. It can narrow the administrator's selected documents, never expand them. Missing approved selection gives `BUSINESS_AGENT_DOCUMENT_SELECTION_REQUIRED` before model work.
4. Ask the Agent to read the selected document, save the source-bound structured fact and propose a Decision against the existing Goal. The original SDK chooses tools and order; no fixed-stage DAG is installed. Available extra tools are exactly original parse, exact-key lookup and remember. Model-authored memory remains an unreviewed, source-bound statement; parsing does not independently certify it.
5. Open Business Brain. Existing GET routes read the same source/current authority through a separate branded human read-only capability. It cannot impersonate a running Run or save model Context/Decision. The saved Decision retains its original Goal and version. Ordinary non-fact GET keeps the original viewer/createdBy read gate without resolving a model binding; only an actual persisted fact scope enters the new view gate, and a fact mismatch never falls back. The detail button returns to the exact displayed conversation; another conversation becoming newer cannot redirect continuation.
6. A second message uses the same SDK native ID and original Context. Ordinary source version changes, revocation or mapping changes refuse stale reads. New document versions require explicit renewed configuration and a new compatible Session; old catalog/receipt migration remains prohibited.

An already existing, owned and reviewed Goal is a prerequisite. The synthetic setup creates its ordinary owner through the original runtime service and associates the Goal through the existing HTTP endpoint. It does not seed the Store or prove the empty-system Goal-creation product flow.

No Goal execution, supplier promises, external business actions, approval bypass, Mem0 or vector infrastructure is introduced. Human review/feedback POST capability is unchanged; this slice only adds the facts-aware GET projection.

## Existing startup, explicit trusted configuration

The existing `startWorkspaceServer` accepts `reviewedBusiness` and an explicitly supplied environment. The ordinary existing command can load the same data through `WORKSPACE_BUSINESS_REVIEW_FILE`:

```sh
# Existing signed enterprise ingress, original Agent principal, selected model,
# reviewed pricing and remaining budget must already be configured.
# Supply the already authorized Docling credential through the existing private
# process environment as WORKSPACE_DOCLING_API_KEY. Never put it in this file,
# repository, command arguments, examples, logs or acceptance archives.
WORKSPACE_BUSINESS_REVIEW_FILE=/absolute/private/reviewed-business.json \
  npm run workspace -- --profile business --serve
```

The private JSON contains only these existing-input groups:

- `libraryModelReadPolicy`: original full `enabled/reviewed/workspaceId/subject/expiresAt/recipient/company/products/productFields/factoryMaterials` policy. Document entries pin ID, revision, documentVersion and Artifact ID/version/SHA.
- `goalBrainOptions`: originalReceiver and original reviewedGoals. No inferred budget or Goal approval.
- `selection`: original enabled/reviewed/customerId/sources plus explicit allowMemoryRead/allowMemoryWrite; never synthesized from browser references.
- `brainMemoryFactKeys`: exact `{subjectType, subjectId, factKey}` triples; `brainDocumentTools: true` explicitly opts in at initial Session binding.
- `connection`: original Docling `reviewed`, `baseURL`, optional `timeoutMs`. Credential values are rejected in JSON; only the supplied private environment is used.
- `parserTransfer`: explicit `approved: true`, `recipient: {kind: "docling", destination: "<exact original /v1/convert/file URL>"}`, `purpose: "document-extraction"`, `transfer: "complete-file"`. The adapter checks the exact original member, receiver and reviewed document/revision/version/Artifact/SHA against each original Host callback. Model-field read consent is not substituted.
- `pluginConfiguration`: optionally only `{disabled:[...]}`, passed to the existing `projectPlugins` narrowing. For this document/Brain slice, explicitly disable `workspace-factory-materials`, `workspace-market-validation`, `workspace-shopify-product`, `workspace-medusa-catalog` and `workspace-marketplace`. That leaves the original Brain eight tools, `workspace_skill`, and the three exact document tools (12 total), below the unchanged bounded transport limit of 32. Alternate root/configuration/none fields, unknown IDs, or disabling required Brain/Skill are refused. The default without this selection remains unchanged; enabling all business tools plus document tools would exceed the transport limit and is not this slice's usable configuration.
- Optional `paidAcceptance`: the already existing bounded native acceptance selector and its explicit carried historical upper bound. It remains the original two-Run acceptance closure, **not** a product budget ledger or evidence of remaining account balance. Do not enable paid calls without the separately approved current budget.

The original Host still validates all policy fields. Configuration errors name missing groups without echoing the file. No file means the previous default path; no profile is automatically enabled. Changes to private startup authorization take effect through the normal controlled restart, not a hidden hot-reload grant. Source/current Session/revocation checks continue on each actual call.

The existing member principal and signed ingress are prerequisites; this change does not create credentials or grant account access. The configured sources form a bounded reviewed set (original max 8). New or changed documents outside that set require administrator review, not developer source edits.

## Evidence so far

- Local Node 24.19.0: five new pure facade cases and four existing Brain HTTP cases passed (9/9; fail/cancel/skip/todo 0).
- New Host/bridge/worker/session modules and fixtures passed syntax checks.
- The two edited Brain components type-check against actual locally installed TypeScript 6.0.3 and matching React types. The full App build still needs the complete locked dependencies.
- Three new **actual SDK** cases are prepared but unexecuted: original startup + real upload/Library/Session/Run + finite Docling HTTP and finite provider SSE through model remember/Brain/two turns/page GET/revocation; explicit document capability's original eight-call bound (ninth refused); default four-call bound with document tools absent.
- One additional real index HTTP test is prepared but unexecuted: signed viewer-owned ordinary Brain GET succeeds without a write role/business-owner/model binding; it also checks invalid plugin narrowing inputs are refused.
- No package/lock change. No dependency stubs. Local `@earendil-works/pi-ai@1.1.0` is unavailable; SDK execution must use the already installed isolated verifier.

Focused acceptance command (requires original lock-installed Node dependencies, exact Bun 1.3.14 and OMP 18.10.4 paths):

```sh
node --test test/workspace-native-document-tools.test.mjs \
  test/goal-brain-http.test.mjs \
  test/workspace-brain-read-http-compat.test.mjs \
  test/workspace-native-document-mainchain-sdk.test.mjs
npm run typecheck
```

The finite SDK fixture calls the real `startWorkspaceServer` twice: initial unchanged upload and existing-reviewed-Goal setup, then the reviewed private JSON entry with the explicit 12-tool subset. The bounded paid selector remains enabled against finite SSE so this path does not hide the original budget/32-tool checks. It starts with zero facts. The model tool writes the memory from the actual finite parser result. It uses generated test identities/documents only; no real provider, enterprise data, SDK mock or server deployment is involved. These new assertions cannot be replaced by earlier Host71/native17/transport63 results.

The old rejected receipt restoration/security review is outside this work. The named existing tool factory is used without invoking the old `registerNativeContext` restoration lifecycle; its pure message-pairing helper alone is shared unchanged.
