# Supplier owner MCP integration contract

Baseline: `8ce17ef22190a878f520bad1871029748f211513` (includes PR54).
This checkpoint specifies the implementation boundary; it is not a live connection or acceptance result.

## Authority and transport

The existing Dot/Muse leased-worker MCP endpoints keep their two supplier read tools. A worker token never becomes owner authority. The owner facet is a separate, optional `POST /api/conversations/:conversationId/supplier-mcp` route behind the original Workspace access checks (signed ingress, original session, CSRF, body signature, membership and conversation ownership). It reuses the existing MCP JSON-RPC transport for `initialize`, `tools/list` and `tools/call`.

Mounting requires a trusted host `supplierOwnerMcpBinding.readReviewedScope` callback. There is no default callback, grant-file loader, credential creation, grant store or role-to-grant fallback. The baseline supplies no callable owner grant resolver. Until the original authorized host supplies that resolver, the route reports `SUPPLIER_OWNER_BINDING_REQUIRED`; the ordinary CLI does not claim an installed owner plugin.

Each call resolves its existing reviewed scope again, including subject, workspace, conversation, closed operation, exact service and input hash. Mutations require the matching reviewed input hash. Service revisions, request IDs, hashes, original publication approvals and schedule approvals remain enforced by the original services. MCP exposes neither approval decisions nor schedule activation nor notification/subscription operations. A tool argument saying `confirmed:true` is not owner grant evidence.

## Closed tool family

Owner tool names use `workspace_supplier_owner_` plus these suffixes:

| Suffix | Original service operation |
| --- | --- |
| `get` | Read one owner supplier service |
| `intake` | Save explicit facts; Pi intake additionally requires original Pi approval |
| `profile` | Update explicit facts at the expected revision |
| `image_upload` | Original image artifact persistence, pinned to this owner conversation |
| `preview` | Original consumer-sale-unit Listing preview |
| `save_product` | Save/reconcile the original private business-library product |
| `shopify_observation` | Read exact product/publication evidence |
| `publication` | Read original publication status |
| `publication_review` | Prepare original exact-scope approval, without deciding it |
| `publication_execute` | Consume an already approved original operation |
| `publication_reconcile` | Read back the same uncertain/partial operation |
| `monitors` | Read this service's monitors |
| `monitor_create` | Configure one disabled original seven-day plan |
| `monitor_check` | Manual exact-scope check |
| `monitor_stop` | Stop the original monitor |

Arguments are a closed `serviceId` plus `input` object where applicable; identity and conversation come from the authenticated route, never tool arguments. Image upload and initial intake omit `serviceId`. The published tool schema is the authoritative field list.

Public image URLs retain `unknown` availability until verified; merely providing a URL does not produce a usable image. Publication request/approval/execution receipts alone do not establish the monitor's start timestamp. Use `shopify_observation`, then `monitor_create` with `startFromPublication:true`; keep the original disabled schedule and manual approval flow.

## File ownership and remaining integration

This branch owns supplier MCP contract/transport tests, GA4 configuration loading, supplier capability accuracy and deployment documentation. `server/index.mjs` receives only the minimal import, service-option wiring and owner-route adapter. Pi TUI, readiness, shop identity logic and clients remain outside this branch.

GA4 uses the already implemented exact product/item/host `productDetailViews` adapter. A metadata configuration and an existing authorization provider are distinct from an available source. Missing configuration, expired/revoked authorization, missing mapping and partial observations must remain accurate and never become zero or connected claims. Only synthetic configuration is tested.

Seven-day future notification consent and durable recipient permission remain pending user approval and are not implemented here. Existing manual approvals remain in place. No production call, actual publish/notification, credential creation, deployment, paid operation, main change/merge or force push is authorized by this contract.
