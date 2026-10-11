# TT041 managed commerce contract audit

Workspace's current product direction is managed business operations: an
enterprise supplies its product, supply terms, Goal and budget; the platform
manages its Shopify shop and supplier/SKU ownership; original Dot plans/reports,
original Muse executes, and Grokbot may later serve bulk queues. Free built-in
tools and paid ongoing labor are product tiers, not implemented billing facts.
Overseas buyers' existing Agents need an authorized supply/change/inquiry MCP.
A buyer browser demand editor is not the principal product.

This pass edits only this report, one new independent boundary test and its
source/test evidence. It does not integrate shared entrypoints, change the
already submitted PR25 implementation, or edit task 2's worktree. Task 2 owns
assembly of the original Host patch. No second backend or fake Shopify/Muse
implementation was added.

## Evidence scope and the later Library candidate

The authenticated GitHub Connector enumerated all 45 branch heads and 44
distinct non-truncated commit trees. Exact heads and reviewed implementation
blobs are in validation/managed-commerce-sources.json. Default-branch indexed
code searches returned zero results despite known Shopify code in development
branches; that search result is not absence evidence.

Reusable Git commits:

- main b9546e1d7e6d7ac1381f84327a4f15cbfc60598f.
- Commerce 5974f07ab69f47cb03295d81a887404200083116 on
  feat/muse-commerce-workspace-20261010.
- Goal-linked Commerce 7de22b25ee64b0813c6ad16b840a39256c55ce52 on
  codex/v22-goal-commerce-context-20261011, one commit ahead of that Commerce
  commit. Its commerce.mjs adds forGoal() with saved researchGoalId linkage.
- PR22 78f155367524b48381d79b2edebe0e5e2925e85d already includes that same
  commerce.mjs, Shopify and business library blobs. Reuse them; do not rebuild.
- PR25 bac9e8c82ead6a31345a4915f181c963669c1319 adds scoped projection and
  original Host adapters on PR22.
- PR26 9e92fe31dad89677d36932ef7f623a784aec278b supplies original Muse
  conversation/session return contracts on PR15, not a merged Commerce release.
- 90229443c5034c574a3aed10a5bf80c3fe1b3e8e is a private in-page buyer draft
  and share preview. Its own document says save/send are disabled, no server or
  storage integration exists and no merchant recipient can be confirmed.

After this Git audit, the parent supplied a completed Library candidate, with
supply-network.mjs, sourcing-mcp.mjs and Shopify changes. It exists and replaces
the earlier material-location uncertainty; it must not be called missing.
The Library checksum manifest was independently read:

| Library item | Known identity/evidence |
| --- | --- |
| FullSource ZIP | libfile_b8308f0853bc81918723e76abc53a87e; 3,110,485 bytes; SHA256 f3dbc6df232531b450a98d05d06ba70f968da700c03e543c574713bdd6392386 |
| Overlay ZIP | libfile_800f071b280481918363342e6f114aa6; 71,522 bytes; SHA256 c1e97a354056b3188d9282f97dbbc85c09bbc3d6321ecd2224e8a27e2dcfa75d |
| Checksum manifest | libfile_08d7d3517a3481918eac23d47af29c9b, version 1 |

Only FullSource was attempted, using the current official Library helper and
existing Python 3.15. It exited 1 during Library identity/xattr saving because
Windows Python has no os.setxattr. The prepared source file ID was
file_000000004fc48206b9ddce631df86860. Failed intermediate bytes were neither
accepted nor inspected. Library read/find cannot render this ZIP's source.
No helper was altered, no metadata guard bypassed, no alternate copy was used,
and no second ZIP was downloaded. Thus this report has not independently
verified the candidate's entries, SOURCE-CHANGES.json, per-file hashes, schemas
or tests. Parent-verified package hashes are not local module acceptance.

## Exact current Git source/API differences

| File | PR25 / PR22-backed contract | PR26 fixed head / integration difference |
| --- | --- | --- |
| server/business-library.mjs | blob 8d40518352b232daf52168f97878fd1bf514638d; createProduct/updateProduct/readiness; companyId fixed company; private draft/archived products, SKU tiers/terms, exact document versions | File absent. This private library must not be wholesale exposed as buyer supply facts. |
| server/commerce.mjs | blob c1fcac09750e7742d19df1a2d02346a73fab15d2; create/forGoal/stageWorkerResearch/stageResearch/syncOrders | File absent. Its researchOrderId/researchGoalId linkage needs to retain original PR26 order/request/conversation identity. |
| server/shopify.mjs | blob 016a391626829e49048135e69e2be0f39686f5c5; status/fingerprint/verify/readProjectOrders; Admin API 2026-10, read-only | File absent. Existing implementation queries shop/scopes/tagged orders; no product/variant write or supplier mapping API. |
| server/worker-desk.mjs | blob dc65d1d6172049219c2e50b9a61f09b76294820f | blob 3f30625468ef0b8400eddaec3d24fe0529e23a43; original attach hook persists order plus user message in one original transaction. Preserve it when reconciling Commerce. |
| server/capabilities.mjs | blob bc73f0802b05150ea3aad04412ed1c00020386dd | Same blob; exact connectorRevision/action/resource/payloadHash approval and one-time consumption are reusable. |
| server/muse-worker-native.mjs | Primary file absent | blob c63b601eb7d145ba01bc227494619b9895582015; original bindDesk/bindSession/bindConversation with native owner/epoch fence. |
| server/muse-worker-session.mjs | Primary file absent | blob 1ba29e114d6977cdc30d956f5949f4451489dc7b; exact original submitted task, file/receipt hashes and original business message return. |
| server/muse-conversation-delegation.mjs | File absent | blob 3eb0e53d8e71fea10f2a29a9c212aaff049616f2; original user request, review hash, attempt/fence, return/acceptance separation. |
| server/dot-control-plane-host.mjs | blob 6cff6468e16f35bba901fd8298496ec230ec8f07; read/replay/suggestions via original Host reads | File absent; task 2 owns application of the already delivered, unapplied wiring patch. |

Current HTTP routes belong to the existing authenticated/admin host:
POST /api/commerce-projects pins productId/productRevision and explicit
publicDescription/market/objective/budget. stageWorkerResearch prepares a stable
commerce_<projectId>_worker_research WorkerDesk order; stageResearch creates a
stable commerce_<projectId>_research Goal. Neither stage is a Shopify publication
approval, Muse wake proof or business-result receipt. forGoal resolves only
saved researchGoalId, not similar titles. syncOrders is admin-only and pins
shop identity/config fingerprint, page scope and original Shopify order IDs.

The original business library stores internal supply tiers, MOQ, lead times,
documents and product images. A public_reference cannot acquire enterprise
pricing/supply data or be changed into user_provided inventory. Existing generic
workspace-library connector blocks both explicitly internal and library-linked
artifacts before reading bytes. Readiness means ready_for_review, not published.

Current Dot MCP is the owner-approved Worker pull interface with exactly 11
workspace_worker_* tools. It does not implement buyer product/supply/change/RFQ
lookup. Unknown tools and extra private artifact/library fields are rejected.
The original workspaceToolHandlers are owner-bound status plus exact receipt
file download, not a supplier catalog. Their original native owner contract
must not be relabeled as overseas buyer authority.

## Results, publication and version boundaries

Task status and operating results remain separate. Accepted Worker order,
completed Goal, generated draft or returned file cannot establish sales,
supplier fulfillment, profit, attribution, a charge or an external quote.
The existing normalized Shopify evidence counts only recorded non-test,
not-cancelled, paid/partially-refunded and fulfilled orders with positive net
receipts. summarizeOrders retains complete/observedAt, attribution:requires_review,
settlement:terms_and_attribution_required and billableAmount:null. These are
reported receipts, not verified profit or supplier allocation.

Current connector approvals pin exact revision, adapter, action, resource and
payload hash and are consumed once. A productRevision/store ID placed in that
exact payload is protected against cross-version/store reuse; the new tests
verify this using an explicitly synthetic callback. That does not prove the
uninspected Supply V1 Shopify write adapter includes all required binding fields.
Its supplier SKU, Shopify product/variant/shop, enterprise and buyer publication
version schema must first be read and validated. Existing fixed company and
workspace permissions are not proof of multi-tenant platform isolation.

PR26 wake remains false and executionStartedAt remains null. Valid claimed lease
is not model execution. Native result return is not enterprise acceptance; no
receipt is a Shopify publishing authorization. Grokbot bulk execution and paid
labor/billing have not been accepted by this source audit.

## Actual new validation and remaining source gate

test/managed-commerce-boundaries.test.mjs executes original PR22 implementations
after checking eight original Git blob hashes. Ten tests pass, zero failures or
skips. They cover retail/reference quote separation, unimplemented mapping-field
rejection, private generic-connector containment, closed Worker MCP fields,
draft-only/read-only product APIs, exact publication-shaped connector approval,
cross-version/store/config/repeat rejection, pinned hosting/public scope, task
versus operating result, and net-receipt/partial-attribution boundaries.

The writer is a serialized memory copy-on-write fixture. The publication callback
is a named fixture-publisher returning published:false. There is no Shopify
network, publication, original Store fsync, real Muse/model call or buyer MCP.
The log is validation/managed-commerce-boundaries.txt. These ten tests are
additional to the earlier 38 PR25 tests, not a rerun or a test of Supply V1.

The known Supply V1 package must be materialized with preserved Library identity
in a supported environment, or supplied as an explicitly authorized existing
local source path. Then compare SOURCE-CHANGES.json and the exact
supply-network.mjs/sourcing-mcp.mjs/shopify.mjs blobs against these fixed refs.
Review index.mjs/store.mjs/CommerceWorkspace and CSS changes individually; do
not overwrite the ZIP into any shared checkout. Add actual Supply V1 isolation,
retail/quote, supplier/SKU ownership, versioned publishing and buyer MCP tests
only after reading its real APIs. This gate is about source access and evidence,
not absence of business implementation and not permission to rebuild it.
