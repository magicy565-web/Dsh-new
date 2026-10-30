# Development

Current source is the clean native DSH core described in [CLEAN-CORE](CLEAN-CORE.md).
Do not append superseded ERP or all-plugin installation directions here.

## Boundaries

Use a dedicated development branch, preserve main and parallel checkouts, and
stage explicit paths. DSH owns Session, tools, permissions, Connection, attachments
and Client. Preserve existing evidence revision/review fences and Worker scopes.
Shopify is the new business commerce system; the local library supplies evidence,
not a second inventory/order ledger. Branding is optional and remains native.

Removing source does not authorize deletion/migration of any runtime data.
No credentials, databases, sessions, artifacts or generated archives belong in Git.

## Commands

Node.js 24+; `npm ci --ignore-scripts` installs locked dependencies.

- `npm run build`: builds the current Commerce Client and checks retained bundles/locales.
- `npm test`: retained plugin/domain tests and cleanup-boundary regressions.
- `npm run check`: build plus tests.
- `npm run test:client`: Library and retained Commerce/Billing/AI Work DOM checks.
- `npm run package:business-services`: standalone Commerce/Billing archives in ignored dist.
- `npm start`: read-only instructions, no installation or server startup.

The production Client uses the host's React, not a new frontend server. Source
lives in Commerce `src`; rebuild `client.js` after edits. The brand/library clients
remain their existing native factories. Use [Shopify setup](SHOPIFY-ADMIN-SETUP.md)
and [Worker setup](../integrations/dsh/dsh-commerce-network/AI-WORK-CONNECTIONS.md)
for current external access limits. Do not invent configured connections.

See [validation](../VALIDATION.md). Local and synthetic tests do not demonstrate
real external services, current browser behavior, DSH host installation or deployment.
