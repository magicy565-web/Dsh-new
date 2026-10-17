# Medusa v2 internal catalog extension

Zero-extra-license-cost optional Medusa v2 core integration using original Workspace Library + Pi/OMP. This package installs neither a second catalog nor a Medusa process.

Native read-only tools: `workspace_medusa_status`, `workspace_medusa_preview`, `workspace_medusa_reconcile`. Standalone installation is unconfigured; the trusted original Host must inject `client` and `authorize`. No secrets are in the Pi context.

The existing Workspace product detail UI provides a separate administrator-only review action for creating unpublished Medusa drafts. No model can self-approve a write. Products remain owned by Workspace. No MOQ, wholesale prices, documents, media, inventory or sales channels are copied. Existing Shopify plugin and approvals remain independent.

See [integration guide](../../docs/MEDUSA-CATALOG-INTERNAL.md) for configuration, tenant boundaries, admission requirements, tests and remaining production validations.
