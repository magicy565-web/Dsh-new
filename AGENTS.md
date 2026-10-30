# DSH clean core development boundary

DeepSeek Harness is the only execution host. Reuse its native Session, tools,
Connection, attachments, permissions and Client. Do not introduce another Agent
Loop, model gateway, standalone Workspace Harness, Pi/OMP or web server.

## Retained scope

- Commerce Network: existing AI Work, canvas, mandates, scoped Worker delegation
  and delivery acceptance.
- Service Billing: independent service bills and owner-recorded collections/refunds.
- Shopify Admin: official commerce backend binding and bounded read-only access.
- Workspace Library: enterprise/product evidence and fixed-version document reads.
- Workspace Brand: optional existing native branding; not a second UI shell.
- Shared packages: domain-commerce-network and dsh-commerce-contracts only.

Do not restore the retired Mini ERP, RFQ/quote/sample adapters, Sourcing, magazine,
memory or inquiry modules from old instructions. Recover historical source from
Git only when a new explicit task requires it. Shopify owns new business commerce;
this repository does not create an alternative inventory or transaction ledger.

Work in a dedicated development branch. Never change/merge main, force-push,
rewrite Git history, deploy, create credentials or widen permissions as a cleanup
side effect. Preserve runtime databases, attachments, sessions and user files.
Source removal does not delete or migrate existing runtime data. Stage explicit
paths and review deletions. Do not copy old branches wholesale.

Node.js 24+. Run npm ci --ignore-scripts, npm run check, npm run test:client and
npm run package:business-services. These local/synthetic checks are not real
Shopify/Grok/Muse connectivity, browser/DSH-host acceptance or production proof.
Never commit credentials, runtime data, generated archives or test logs.

See docs/DEVELOPMENT.md and docs/CLEAN-CORE.md for current boundaries.
