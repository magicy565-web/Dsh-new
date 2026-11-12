---
name: buyer-ai-assistant
description: Embed a buyer-facing AI sourcing assistant in a ChatGPT Site and connect it securely to the central OpenMausBot and Sourcing MCP runtime.
---

# Buyer AI Assistant Skill

## Architecture
The Site hosts the public chat UI and page context. A central HTTPS API gateway authenticates the Site and issues short-lived anonymous visitor sessions. The gateway routes conversations to the OpenMausBot Buyer Assistant Worker and approved Sourcing MCP tools. Business records live in the central tenant-aware database. ChatGPT Sites can also host an MCP server and create a ChatGPT plugin after owner publication, but that plugin is for ChatGPT/Codex conversations; it does not automatically provide an embedded assistant to anonymous visitors on the public website. Keep the public visitor chat UI and its API gateway as a separate integration.

Do not assume public Site visitors have ChatGPT accounts or connected-app permissions. Do not rely on the Site creator's personal connectors. Do not put OpenAI, model-provider, Apify, Shopify Admin, database, or Worker credentials in browser code.

## Context contract
Each assistant request may include:
- site_id and publication_id (server-validated)
- page_url and page_type
- current product/supplier identifiers (public IDs only)
- visitor_session_id (short-lived, opaque)
- conversation turn and locale
- consent state and attribution context

The server must resolve tenant, allowed facts and tool permissions from trusted configuration. Never trust client-supplied tenant_id, factory_id, prices, quotas, roles or permissions.

## Conversation lifecycle
- Create a short-lived anonymous visitor session without requiring ChatGPT login.
- Keep each visitor's conversation thread isolated.
- Archive idle conversations after the configured inactivity window (default 6 hours); do not delete submitted RFQs, consent records, or audit events.
- Persist conversation summaries only when needed and with an explicit retention policy.
- When a visitor submits an RFQ, create a durable case independent of the chat lifecycle.
- Support human handoff with case reference and transcript summary.

## Allowed tools
- get_product_details (read-only)
- get_supplier_capabilities (read-only)
- compare_products (read-only)
- explain_buying_terms (read-only)
- create_rfq_draft (write draft only)
- submit_rfq (requires explicit buyer confirmation)
- handoff_to_human (create follow-up task)

## Guardrails
- Only answer from current approved supplier/product evidence and clearly marked general knowledge.
- Unknown MOQ, price, capacity, lead time, certifications and export terms must be stated as unknown and offered for confirmation.
- No promises, quote acceptance, order placement, external messages or personal-data sharing without explicit authorization.
- Prevent cross-site and cross-tenant retrieval; enforce authorization server-side on every request.
- Rate limit by Site, IP/session, and abuse signals; apply origin allowlists where feasible, CSRF protection for cookie flows, strict CORS, payload limits and request IDs.
- Sanitize rendered markdown; never inject model output as raw HTML.
- Log security events without storing secrets or unnecessary sensitive personal data.

## API contract
Implement these routes on the central API (not by exposing private credentials to the browser):
- POST /v1/public-sites/{siteSlug}/sessions -> short-lived visitor session
- POST /v1/public-sites/{siteSlug}/chat -> streaming or chunked assistant response
- POST /v1/public-sites/{siteSlug}/rfq-drafts -> create RFQ draft
- POST /v1/public-sites/{siteSlug}/rfqs/{rfqId}/submit -> submit only after explicit confirmation
- POST /v1/public-sites/{siteSlug}/handoff -> human handoff

Responses must use stable JSON envelopes, request_id, and explicit errors. The gateway, not the Site, maps public slug to tenant and runtime worker.
