# Optional business plugin uninstall fix

Base: `b2a490f31706bbe50e147636645d573cdf1ac6a7`. This is a focused fix on the existing development branch, not another migration or business project. New paid model calls: **0**. Historical conservative API cost remains **CNY 0.074952**, with no unconfirmed fee. Main, deployment, actual account credentials and permissions are unchanged.

## Defect and repair

The earlier outside-repository lifecycle test removed only the local/probe copies. The real local entry still indirectly needed installed legacy business packages: Session statically imported seven factories, shared input/hash modules referred to procurement, and the local CLI imported business launch/configuration modules just for runtime checks and model configuration. Deleting an unselected legacy source directory could therefore fail before local startup. The earlier migration document now records this coverage limitation instead of claiming that broader uninstall proof.

Session now resolves business factories/required protocol helpers only for the corresponding selected legacy profile. It keeps the original client/authorization closures and existing profile/tool/Skill selection. A genuinely required missing business entry throws **`WORKSPACE_PLUGIN_REQUIRED`**, identifying the package and entry and suggesting reinstalling it or disabling the profile; there is no silent substitute or auto-install. This does not claim that an enabled legacy business profile can run without its own required dependencies.

Pure model configuration and pinned runtime checks are separated into host modules without business imports. Existing configuration/runtime exports remain compatible through re-exports. The local entry and cost policy use those pure modules; shared public input admission no longer imports the procurement package. The original Bun binary SHA/version checks, provider configuration, budget and unknown-charge rules remain intact.

Explicit directory configuration is also precise: an unselected or explicitly directory-disabled missing package does not block local startup. A missing, explicitly enabled path reports **`PROJECT_PLUGIN_REQUIRED`** with its package ID and required manifest. The CLI includes a safe structured `pluginError` for these two known error types. A directory disable or `--no-plugins` wins before a missing enabled entry is treated as required. Uninstall instructions now require removing the enable entry or disabling the directory ID before deleting the package.

## Focused verification

All model choices below are finite synthetic SDK responses or mocked HTTP. The native OMP loader, Session, file executors, persistence and original synthetic Host/service bindings are real. No real model endpoint or Personal Agent is called.

- **Seven cumulative physical removals from an isolated actual source copy**, in fresh processes: customers, ingestion, inquiries, materials, market-validation, procurement, Shopify-product. Server/scripts/plugin code is copied, not linked back to the original source; only reviewed runtime/dependency installations are reused. After each removal, the actual Node local entry passes zero-model preflight and a fresh Bun process loads the local package, reads selected synthetic material, saves a new native draft and normally stops. One native Session ID persists across all seven processes. All seven legacy directories are absent in the last case. These file operations use 21 finite synthetic SDK responses, zero real provider requests.
- After all seven are absent, selecting each legacy business profile yields the corresponding useful required-package error before any model request. Seven negative profile cases pass.
- An explicitly enabled missing directory is rejected with its ID and zero requests. The same missing entry succeeds when explicitly directory-disabled or overridden by `--no-plugins`. The existing local/probe lifecycle test now removes enabled entries before physical uninstall and continues to verify no hidden tools.
- Local loading, uninstall, native path/source guards, concurrency, same-Session recovery and budget suites: **15 passed, 0 failed**.
- Representative original business bindings: **8 passed, 0 failed** — public factory, Session read-only, customer, inquiry, material read, ingestion, plan, and Shopify adapter paths. These use original synthetic identities/services and finite models; they do not establish real Shopify publication or external account access.
- `npm run build` passes static prebuild pack checks for the nine installed packages, TypeScript and Vite. Only the existing non-blocking large-chunk advisory remains. No full backend suite was run.

The new regression is `node --test test/workspace-omp-plugin-uninstall.test.mjs`; lifecycle coverage is `test/workspace-omp-plugins.test.mjs`. It creates and removes its private temporary source/material/Session copy; no runtime journal, actual model output or credentials are committed. Sanitized counts and private-log hashes are in `checks.json`.

## Boundaries recorded, not implemented

`plugins/ARCHITECTURE.md` now distinguishes Muse/Grokbot as real Personal Agents linked by the user's server to authorized accounts and account quotas, not ordinary MCP tools or model substitutes. Seven-day verification is a launcher establishing budget, Worker delegation and Goals. No such integration, authorization, deployment, queue or Agent Loop is added by this uninstall fix. OMP remains the main application, with the user's server retained as a service bridge.

No blocker remains for this focused uninstall repair. No new paid-model acceptance is claimed or required to demonstrate this pre-inference dependency defect.
