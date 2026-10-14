# Workspace procurement Pi package

Private local package for official Pi **1.1.0**, Node 24+. No npm publication. Copy this whole directory outside the Workspace repository; it needs only the official Pi host peers and an existing authorized Workspace HTTP service. It does not import Workspace server/scripts or create another runtime, queue, store, ledger or business engine.

```sh
pi install /absolute/path/workspace-procurement
pi list
pi remove /absolute/path/workspace-procurement
# Temporary load without a settings entry:
pi -e /absolute/path/workspace-procurement
```

Use an existing authorized `WS_AGENT_URL` (HTTPS or loopback HTTP) and `WS_AGENT_TOKEN` supplied by the host in memory. Never put tokens in prompts, package files or command arguments. This package creates no token/account/login and persists no credentials. Missing binding returns `unconfigured`; syntactically valid binding is `configured_unverified` until actual authenticated service calls succeed. A capability receipt never certifies live connection or model access. Pi's own model configuration remains the host's responsibility; there is no model fallback, sample backend or automatic login.

Standard `default(pi)` entry: `src/extension.js`. Manifest: `package.json` `pi.extensions` and `pi.skills`. Host-provided imports use `peerDependencies: "*"`, as required by the pinned official package specification. No host packages are bundled. Tested release is Pi 1.1.0; other host releases are unverified. Local package trees are not installed/modified by Pi; ordinary Node imports of the `./client` export require the application's peer resolution, while Pi supplies its official extension module mapping.

Ordinary load registers five original business tools and three procurement tools (configuration, requirements draft, supplied quote alignment). It appends guidance via `before_agent_start`. It does not change active tools, intercept bash/input/terminal, replace models or cancel session switching/forking. Existing task admission, stage execution, document bytes, authorization and approval remain in the original backend. Requirements/comparison tools perform authenticated registry reads plus local organization; they do not persist a task or contact a supplier. Original `workspace_business_task` persists supplied procurement input and executes the existing four-stage document workflow.

Private Library is **disabled** in ordinary plugin mode: no Library tool is registered, no enterprise Session is accepted, and no private read is attempted. Ordinary extension hooks cannot guarantee reauthorization of cached private receipts before every model call. Exported `./client` includes the existing controlled `workspaceExtension` factory for an explicitly selected trusted host. The repository's `createWorkspaceAgentRuntime` remains responsible for its per-model-call cached Library checks, exact receiver pin and session replacement guards; selecting the ordinary package does not opt into that profile. Human controls stay in that controlled host and retain existing confirmations.

Procurement covers supplied public requirements, unverified supplier quote materials and original saved procurement documents. Missing price/MOQ/lead time stays pending. No currency/landed-price conversion, market research, 1688/Alibaba connector, external inquiry, order, payment, Shopify write or persistent future notification is provided. Skill examples are in `skills/procurement/SKILL.md`.

Official pinned references used for packaging and shared inline factories:

- [Pi Packages](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/coding-agent/docs/packages.md)
- [SDK](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/coding-agent/docs/sdk.md)

Repository verification: `node --test test/pi-procurement-package.test.mjs`. It copies the package outside the repository, uses the actual official CLI install/discovery/`-e`/remove paths and actual SDK, and uses only isolated original-service data plus explicit keyless faux models. A synthetic pass is not real model/service activation.
