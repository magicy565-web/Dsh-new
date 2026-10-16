# Native OMP plugin migration acceptance

Base: `aa6262f14a7252c8a83c57237654623b59811d18`. Implementation checkpoint: `764d8cf994ed83dfdf3967d8100f71315e8bb965`. Work remains on `codex/local-context-budget-fix-20261016`; main and deployment are unchanged. This migration adds **zero paid model calls**; historical conservative API cost remains **CNY 0.074952**. No credentials were created or printed, and no operational material or actual model output is committed.

## Delivered

- All seven business packages present on the base branch moved from `packages/` to canonical `plugins/` paths. Their source modules and Skills retain their interfaces; active imports, packaging scripts, tests and guides now use the new paths. No parallel copy or dual registration remains. Historical validation documents keep their original historical references.
- New independent `plugins/workspace-local-materials`: selected local native read/write, public-only RFQ/offer preparation and original native context projection. Its files have no reverse `server/*` or repository-only imports. The host only validates selection/configuration, supplies the original native runtime/session context, loads enabled files and retains model/budget/session guards. The local path no longer directly registers file tools, factory draft tools or context hooks in Session code.
- New independent `plugins/workspace-plugin-info`: a static no-side-effect tool proving discovery and coexistence are not hardcoded to one package.
- Native `pi.extensions`/`pi.skills`, separate `plugins/config.json`, per-package README/SKILL/AGENTS development memory, and static discovery/pack hooks for local startup/build. Adding a compliant package and enabled path requires no Session source edit.
- OMP is the main application; the user's server remains a bridge option. Local operation needs no Workspace business server or remote client. Existing remote adapters still need their reviewed clients/authorization. The cloud-computer MCP/Shopify/seven-day direction and missing adapter work are in `plugins/ARCHITECTURE.md`; none is claimed connected or deployed here.

The full inventory, startup and install/disable/uninstall instructions are in [plugins/README.md](../../../plugins/README.md). Each package separately records its interfaces, permissions, dependency peers and tested/unverified scope.

## Native loading and security boundary

The trusted project root is inventoried without importing factories. Original OMP 18.10.4 `discoverExtensionPaths` resolves enabled package manifests with ambient discovery disabled; only explicitly declared, validated files are then passed to the original `createAgentSession` file loader. Undeclared package hooks and ambient home/project extensions never execute. Disabled entries are filtered before explicit-only loading, so scanning cannot revive them. Missing/uninstalled packages do not fall back to host registration.

Active tools come only from those explicitly loaded file extensions. Native inline experiment tools are excluded. Duplicate tool names fail rather than shadow or double-run: the historical factory and new local plugin share three public draft names and should not be enabled together in a local profile. Native plugins are trusted executable code, not a sandbox or newly granted filesystem permission.

The original selected path/inode/hash and source receipt checks, no-overwrite/flat-output guards, profile/session binding and native journal remain. Current source hashes are verified before cached reads are restored. Real company memory/history/output stays in explicitly separated project/enterprise directories and existing native OMP persistence, not Git or a new memory database.

Costs remain protected by 128KiB serialized payloads, 64 messages, 8 actual requests per task, 512 output tokens, raw/SDK usage reconciliation, 32k observed-input continuation admission and a 1.1M-input one-unconfirmed-request reserve. The schema count is now bounded at 32 and frozen from the actual configured plugin tools before the first model request, allowing non-colliding plugins without a factory-specific allowlist. The rigorous failure-inclusive cost bound is unchanged (CNY 2.680768 per task; two-turn group stopping on any failure CNY 3.225536). Model transport is still original OMP; no extra Agent Loop, queue or retry is added.

## Evidence

All model behavior in these checks is explicitly finite synthetic/mocked HTTP. The SDK loader, tool schema validation, native filesystem execution and native JSONL are real. This must not be described as new real-model or enterprise-service acceptance.

- **16 local/loader/context/pairing/budget tests passed**. This includes source mutation and receipt checks, write concurrency/overwrite guards, model request/unknown-fee limits and native contextual resume.
- The lifecycle fixture copies **all 9 packages outside the repository**, independently loads every declared entry with the real OMP loader, and then exercises selected local read/write through the original provider/Session path. Eight normal-stop turns prove: local enabled; explicit config disable; fresh invocation/re-enable with a restored source read and direct save; coexistence with the second tool; per-invocation disable priority; all-plugins override; local uninstall; second-plugin uninstall. The same native Session ID persists, earlier user goals and saved file hashes stay intact. An ambient extension and undeclared hook that would throw were never executed. These turns use **14 finite mocked HTTP requests, zero provider requests**; temporary runtime artifacts are removed.
- **33 migrated package/interface tests passed**, covering actual Pi 1.1.0 and OMP 18.10.4 package manifest/Skill installation or link, disable/remove/uninstall, portable interfaces, authorization semantics and finite SDK callbacks. No live private client, Shopify action or MCP service was invoked.
- **1 public draft parity test passed**: the independent public-only schema adapter matches existing factory capability/RFQ/match outputs and refuses extra authority fields. Total targeted tests: **50 passed, 0 failed**.
- `plugins:pack-check`: all **9** source manifests/entrypoints/dependencies/resources and `npm pack --dry-run --ignore-scripts` closures pass. The checker never imports extension factories or runs business tools/model calls.
- `npm run build` passes its static prebuild check, TypeScript and Vite production build. Vite reports the existing large-chunk advisory; it is not a build failure. No full backend suite, deployment or main merge was performed.

Sanitized counts and hashes of private test logs are in `checks.json`; raw logs, native Session JSONL, generated drafts and responses are not uploaded. Source tests are reproducible with `node --test test/workspace-omp-plugins.test.mjs` and the package/interface suites listed in `checks.json`.

## Remaining scope

No blocker remains for this directory/extraction acceptance. This new plugin extraction has not had a new paid-model acceptance, deliberately. The prior real test on aa6262f is not relabeled as a test of the migrated source. Real MCP discovery/bridge adapter implementation, server query/task integration changes and real Shopify/seven-day execution remain future work described in ARCHITECTURE.md, with existing task/receipt identities reused rather than replaced.
