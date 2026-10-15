# Chinese factory Workspace Pi package

Private Chinese-factory package (`@workspace-agent/pi-factory`) for official Pi **1.1.0**, Node 24+. No npm publication. Copy this whole directory outside the Workspace repository; its supplied-field RFQ/matching drafts need only the official host peers. Original business task/history operations additionally require an existing authorized Workspace service. It does not import Workspace server/scripts or create another runtime, queue, store, ledger or business engine.

```sh
pi install /absolute/path/workspace-procurement
pi list
pi remove /absolute/path/workspace-procurement
# Temporary load without a settings entry:
pi -e /absolute/path/workspace-procurement
```

Use an existing authorized `WS_AGENT_URL` (HTTPS or loopback HTTP) and `WS_AGENT_TOKEN` supplied by the host in memory. Never put tokens in prompts, package files or command arguments. This package creates no token/account/login and persists no credentials. Missing binding returns `unconfigured` for business history/results; the two supplied-field factory draft tools remain available without a service. syntactically valid binding is `configured_unverified` until actual authenticated service calls succeed. A capability receipt never certifies live connection or model access. Pi's own model configuration remains the host's responsibility; there is no model fallback, sample backend or automatic login.

Standard `default(pi)` entry: `src/extension.js`. Manifest: `package.json` `pi.extensions` and `pi.skills`. Host-provided imports use `peerDependencies: "*"`, as required by the pinned official package specification. No host packages are bundled. Verified hosts are Pi 1.1.0 and official OMP 18.10.4; other releases are unverified. Local package trees are not installed/modified by Pi; ordinary Node imports of the `./client` export require the application's peer resolution, while Pi supplies its official extension module mapping.

Ordinary load registers original member-owned task list/result reads plus factory configuration, customer RFQ organization and supplied factory offer matching preparation. No buyer-side supplier comparison or original task submission tool is registered by default. It appends guidance via `before_agent_start`. It does not change active tools, intercept bash/input/terminal, replace models or cancel session switching/forking. Existing task admission, stage execution, document bytes, authorization and approval remain in the original backend. RFQ/matching preparation uses pure supplied-field checks and never calls `businessPresets` or another HTTP endpoint; it neither persists an inquiry nor fabricates factory product/capacity/lead-time data. The original four-stage procurement flow and its task submission tools remain historical compatibility in the explicitly selected controlled host, not a factory core capability.

Private Library is **disabled** in ordinary plugin mode: no Library tool is registered, no enterprise Session is accepted, and no private read is attempted. Ordinary extension hooks cannot guarantee reauthorization of cached private receipts before every model call. Exported `./client` includes the existing controlled `workspaceExtension` factory for an explicitly selected trusted host. The repository's `createWorkspaceAgentRuntime` remains responsible for its per-model-call cached Library checks, exact receiver pin and session replacement guards; selecting the ordinary package does not opt into that profile. Human controls stay in that controlled host and retain existing confirmations.

The factory is the seller/supplier serving overseas customer demand. Default tools cover supplied customer RFQs and preparation against public materials of this factory; missing capacity, available quantity, lead time and supply conditions stay pending. The directory name `workspace-procurement` and `procurementExtension` export are retained compatibility names; the manifest name and default audience are `workspace-factory`/Chinese factory. Legacy `src/procurement.mjs` and `skills/procurement/SKILL.md` are retained but excluded from default registration/skill discovery. No additional buyer-side comparison work is planned.

Factory private product/capacity intake, historical inquiry records, overseas buyer/distributor discovery, quotation/sample/follow-up execution, external Worker delegation and Shopify sale/fulfillment remain unsupported here. No real external sending, order acceptance, payment or persistent future notification is provided. Default guidance and examples are in `skills/factory/SKILL.md`.

Official pinned references used for packaging and shared inline factories:

- [Pi Packages](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/coding-agent/docs/packages.md)
- [SDK](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/coding-agent/docs/sdk.md)

Repository verification: `node --test test/pi-procurement-package.test.mjs`. It copies the package outside the repository, uses the actual official CLI install/discovery/`-e`/remove paths and actual SDK, and uses only isolated original-service data plus explicit keyless faux models. The original procurement chain is exercised only as explicit historical compatibility, not as the factory core workflow. A synthetic pass is not real model/service activation.


For selected local product files and new saved Markdown/text drafts without any Host,
the repository adds `npm run factory:local -- --input ./product.md --output-dir .`.
Add `--session /workspace/factory-session.jsonl --task "your natural-language goal"`
to create/continue an original OMP Session by the same file, including question-only
turns without a fixed report/tool sequence. It reuses the official OMP Session/provider and native read/write tools, with exact
file selection and exclusive output creation. See [local entry](../../docs/WORKSPACE-OMP-LOCAL.md).
The ordinary package remains portable and does not import repository server code.
