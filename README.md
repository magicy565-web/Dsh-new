# DSH Enterprise Core

A focused set of **native DeepSeek Harness plugins**. DSH owns model execution,
sessions, tools, permissions, cancellation and the web UI. `npm start` prints
instructions only; this repository is not a standalone application.

## Source scope

| Plugin | Purpose |
| --- | --- |
| [Commerce Network](integrations/dsh/dsh-commerce-network/README.md) | Existing AI Work, channel canvas, business mandates, scoped Worker tasks and delivery acceptance |
| [Service Billing](integrations/dsh/dsh-service-billing/README.md) | Independent service bills and owner-recorded receipts/refunds |
| [Shopify Admin](docs/SHOPIFY-ADMIN-SETUP.md) | Official commerce backend binding; bounded read-only shop/product summaries |
| [Workspace Library](integrations/dsh/dsh-workspace-library/README.md) | Enterprise/product evidence and exact document-version reads used by Commerce |
| [Workspace Brand](integrations/dsh/dsh-workspace-brand/README.md) | Optional existing native branding, with host-owned layout |

`packages/domain-commerce-network` and `packages/dsh-commerce-contracts` are the
only shared domain packages. Legacy modules and dead transaction adapters are
removed from this tree, not hidden behind navigation. Historical source remains
in Git. No existing runtime records are deleted or migrated.

## Development and packaging

Node.js 24+:

```sh
npm ci --ignore-scripts
npm run check
npm run test:client
npm run package:business-services
```

The last command packages Commerce and Billing only. The evidence library,
Shopify and brand remain independently installable native bundles. Install only
what the target environment needs; see the [pilot guide](docs/COMMERCE-PILOT-QUICKSTART.md).
React is host-owned at runtime; root React/jsdom dependencies are for development.

See [development](docs/DEVELOPMENT.md), [cleanup scope](docs/CLEAN-CORE.md),
[validation](VALIDATION.md) and [Worker connection boundaries](integrations/dsh/dsh-commerce-network/AI-WORK-CONNECTIONS.md).
Real Shopify authorization and external Grok/Muse execution are not established
by local/synthetic tests. Billing is not a payment gateway or tax invoice system.
