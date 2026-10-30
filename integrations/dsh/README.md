# Native DSH bundles

Current retained bundles: Commerce Network, Service Billing, Shopify Admin,
Workspace Library and optional Workspace Brand. See the [root inventory](../../README.md)
and [clean-core boundary](../../docs/CLEAN-CORE.md).

Run locked installation and checks from the root. Install selected packages using
the official `dsh plugin --profile web add <bundle.tgz>` command only when explicitly
performing installation; source checkout or `npm start` never changes a host profile.
HTTP authentication uses native Connection and file bytes use native attachments.
No other execution host, historical ERP or abandoned module is required.
