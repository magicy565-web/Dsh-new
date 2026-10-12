# Supplier owner MCP integration contract

Baseline: `8ce17ef22190a878f520bad1871029748f211513` (includes PR54).
The implementation is exercised only with synthetic grants and local HTTP sources; it is not a live connection or production acceptance result.

## Authority and transport

The existing Dot/Muse leased-worker MCP endpoints keep their two supplier read tools. A worker token never becomes owner authority. Two owner protocol facets run behind the original enterprise Workspace access checks (signed ingress, original session, CSRF, exact method/path/body signature, membership, privacy and conversation ownership). Local no-login mode is refused. Both reuse the existing MCP JSON-RPC transport for `initialize`, `tools/list` and `tools/call` (2025-06-18 and 2025-11-25), plus its existing 2026-07-28 per-request headers/metadata and `server/discover`. No new session token, listener or transport loop is created.

`POST /api/conversations/:conversationId/supplier-session-mcp` represents an original authenticated owner HTTP request. It runs the same `access.begin`, `verifyBody`, body privacy guard, `supplierOwned/supplierFind` and original service methods as the business routes, with the same original approvals. It accepts the existing cookie or `X-Workspace-Session` transport, never both, and retains the existing Origin/CSRF requirements. It creates no grant and does not call `readReviewedScope`; an identity object is never returned as a synthetic grant. The original trusted ingress must sign the actual MCP method/target/body for each request. The original TUI/host adapter must reuse this transport, without a new proxy identity or credential. Catalog `ownerSessionMcp` reports only route availability and `original_session_required`, never an external plugin connection.

The separate external-connector `POST /api/conversations/:conversationId/supplier-mcp` requires a trusted host `supplierOwnerMcpBinding.readReviewedScope` callback. There is no default callback, grant-file loader, credential creation, grant store or role-to-grant fallback. The baseline supplies no callable owner grant resolver. Until the original authorized host supplies that resolver, this route reports `SUPPLIER_OWNER_BINDING_REQUIRED`; `ownerMcp` stays `binding_required`. It never falls back to session-only dispatch.

The [existing host source audit](SUPPLIER-OWNER-HOST-AUDIT.md) traces Workspace session readers, Pi/Muse ownership, historical native host and OAuth scopes. It distinguishes the missing supplier authorization implementation from runtime configuration and lists the minimum nonsecret handoff needed to reuse an external original resolver.

Each external-connector call resolves its existing reviewed scope again, including subject, workspace, conversation, closed operation, exact service, expiry and input hash. Mutations require the matching reviewed input hash. Both facets retain service revisions, request IDs, hashes, original publication approvals and schedule approvals. MCP exposes neither approval decisions nor schedule activation nor notification/subscription operations. A tool argument saying `confirmed:true` is not owner grant evidence.

The trusted callback receives `{actor:{subject,workspaceId,role},conversationId,operation,serviceId,inputHash}`. It must resolve an already authorized grant, or return null. The admitted scope is `{subject,workspaceId,conversationId,operations,serviceIds,expiresAt,inputHash,piIntakeApproved?}` with a future ISO expiry and no `revoked:true`. `inputHash` is `supplierHash({operation,serviceId:serviceId||null,input})`; identity comes from the route. `piIntakeApproved:true` is additionally required for text/continuation intake, never inferred from a facts grant. The callback remains responsible for its original approval, budget, revocation and any one-use grant consumption. This module provides no grant creation or renewal API.

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

Arguments are a closed `serviceId` plus `input` object where applicable; identity and conversation come from the authenticated route, never tool arguments. Image upload and initial intake omit `serviceId`; continued text intake includes it. The published tool schema in `server/supplier-owner-tools.mjs` is the authoritative field list. Images are canonical base64 PNG/JPEG/WebP up to 1,300,000 base64 characters, with an explicit provenance note. Original artifact validation, private library metadata and namespaced idempotency remain in force. No URL fetch, arbitrary artifact lookup or external image transfer occurs in upload.

An example tool call body (after the original host has independently admitted this exact input):

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workspace_supplier_owner_intake","arguments":{"input":{"requestId":"original-request-id","facts":{"name":"Explicit owner-supplied product"}}}}}
```

Successful tool values use JSON `structuredContent` and the same JSON in text content; monitor lists use `{monitors:[...]}`. Service denials return `isError:true` with a safe code/message. Ingress/session/body failures retain original HTTP access errors. Uncertain external outcomes retain original operation receipts and are reconciled without automatic retry.

Public image URLs retain `unknown` availability until verified; merely providing a URL does not produce a usable image. Publication request/approval/execution receipts alone do not establish the monitor's start timestamp. Use `shopify_observation`, then `monitor_create` with `startFromPublication:true`; keep the original disabled schedule and manual approval flow.

## File ownership and remaining integration

This branch owns supplier MCP contract/transport tests, GA4 configuration loading, supplier capability accuracy and deployment documentation. `server/index.mjs` receives only imports, service-option wiring and the owner-route adapter. The shared MCP response function now finishes the original access audit and accepts host-supplied server metadata; worker registration/authentication is unchanged. Pi TUI, readiness, shop identity logic and clients remain outside this branch.

GA4 uses the already implemented exact product/item/host `productDetailViews` adapter. A metadata configuration and an existing authorization provider are distinct from an available source. Missing configuration, expired/revoked authorization, missing mapping and partial observations must remain accurate and never become zero or connected claims. Only synthetic configuration is tested.

Seven-day future notification consent and durable recipient permission remain pending user approval and are not implemented here. Existing manual approvals remain in place. No production call, actual publish/notification, credential creation, deployment, paid operation, main change/merge or force push is authorized by this contract.
