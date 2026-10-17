---
name: workspace-medusa-catalog
description: Preview existing original Workspace products in optional Medusa v2 internal drafts.
---

# Medusa v2 internal product preview

This optional skill extends the original enterprise Workspace. There is no separate Agent, Store, product authority, queue or approval engine.

- Use `workspace_medusa_status` to check the explicitly reviewed Medusa connection. Unconfigured is not connected.
- Use `workspace_medusa_preview` only with an exact, selected and authorized original Library product UUID. The tool reveals a current limited source revision and copied title/description for review without remote changes.
- Use `workspace_medusa_reconcile` only for read-back of that exact selected product from the configured internal Medusa instance. A linked draft is not published, in stock, available in Shopify or selling.
- Products require a reviewed original material disclosure including name, description, category, status and provenance; missing source grants must block all private reads.
- The original Workspace UI permits an administrator to confirm draft-only creation separately. You have no Medusa write tool; do not perform writes via browser, shell, generic HTTP, MCP, or credentials.
- Do not transmit confidential MOQ, tier prices, supplier terms, source documents, images or customer policies to Medusa.
- A stale revision, revoked source, unknown Medusa response or non-draft remote item is a conflict: stop and request human review. Never overwrite automatically.
- Shopify publication and original human approval are separate. Never describe a Medusa internal draft as a Shopify publication.
