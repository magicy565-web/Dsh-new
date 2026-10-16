# Project plugins

This is the unified, trusted source directory for the current branch's real Pi/OMP packages. It is **not** a new agent framework, execution engine, registry service or memory database. Original OMP 18.10.4 resolves declared package entry points and loads extension factories. Build discovery reads manifests and validates files without importing factories, running business tools or calling a model.

OMP is the main application; the user's server is a retained optional service bridge, not a prerequisite for local material work. The cloud-computer MCP / seven-day adapter direction and remaining work are recorded in [ARCHITECTURE.md](./ARCHITECTURE.md); no real MCP connection is claimed here.

| Directory | Package / purpose | Default local state | Access boundary |
| --- | --- | --- | --- |
| workspace-procurement | pi-factory; public RFQ and supply preparation, historical task compatibility | installed, not enabled | Public-field drafts; original business tasks require existing reviewed binding |
| workspace-factory-materials | Factory Library material/document reads | installed, not enabled | Original client + per-disclosure authorization required |
| workspace-factory-customers | Factory customer drafts/records | installed, not enabled | Original client + authorization required |
| workspace-factory-inquiries | Factory inquiry records | installed, not enabled | Original client + authorization required |
| workspace-factory-ingestion | Source-backed product material intake | installed, not enabled | Original client + authorization required |
| workspace-market-validation | Plans, comparable references, monitor and seven-day standard contracts | installed, not enabled | Original client + authorization; no new external data source |
| workspace-shopify-product | Existing controlled product/image/draft/publication adapter | installed, not enabled | Existing client + original human approval; no new Shopify connector |
| workspace-local-materials | Selected local files/drafts, optional owner references and separate memory proposals | explicitly enabled | Exact selected paths/hashes; private owner directory; no customer sharing |
| workspace-plugin-info | Side-effect-free loader probe | explicitly disabled | Static identity only |

The first seven packages were moved from `packages/` with interfaces preserved; there is one canonical copy, no dual registration. Their controlled remote Host integrations retain existing explicit client injection and guards. The new local package extracts the former host-registered local capabilities. MCP data sources, Worker adapters, ordinary server modules and other branches are not promoted to plugins by this migration. No existing business plugin remains under packages/ on this branch.

## Discovery, explicit enable/disable and uninstall

`config.json` uses OMP's `extensions` path list plus `disabledExtensions`. Startup inventories immediate child packages, validates their native `pi`/`omp` declarations, and passes **only enabled declared files** through original OMP discovery and file loading with ambient discovery disabled. It never executes unlisted package code, undeclared hooks, project `.omp/extensions`, home extensions or arbitrary outside directories. An explicitly supplied `--plugin-dir /ABS/reviewed-root` selects a different trusted source root; it does not recursively discover a parent directory. Extensions are trusted code with the host process's existing permissions, not a JS security sandbox.

Enable by adding `./directory-name` to `extensions`. Disable by removing the enabled path, or retaining it and adding `extension-module:directory-name` (or the exact installed package name) to `disabledExtensions`. **Disable wins**, including per-invocation `--disable-plugin directory-name` and `--no-plugins`. The bounded host applies this filter before explicit-only OMP loading because OMP explicit-only discovery does not otherwise apply ambient disabled settings. To uninstall, remove its enabled path or disable its directory ID first, then delete the package directory and restart/reinvoke. A missing unselected/explicitly disabled package does not block the local Agent. An explicitly requested missing package produces `PROJECT_PLUGIN_REQUIRED` with its name and required manifest, rather than silently pretending it loaded. Legacy controlled business profiles resolve their actual dependencies only when selected and report `WORKSPACE_PLUGIN_REQUIRED` if one is missing. This is a local-entry uninstall guarantee, not a promise that a legacy business profile works without its own required packages. No hot-unload engine is invented. Adding a new compliant package and enabling its declared path requires no Session source edit.

Duplicate tool names across enabled entries fail startup, rather than registering two executors or silently shadowing one. In particular, the historical factory package and the new local package share three public draft tool names: choose one of those two in a local profile. The independent probe and other non-colliding packages can coexist. OMP-injected inline experiment tools are not admitted by this host; only declared, enabled package entry points contribute active tools.

```sh
npm run plugins:check                 # source/manifest/entry/dependency/resource checks; zero execution
npm run plugins:pack-check            # also verify npm pack dry-run closure; no install scripts
npm run factory:local -- --input /ABS/product.md --output-dir /ABS/output \
  --session /ABS/project/conversation.jsonl "一句话目标"
npm run factory:local -- --input /ABS/product.md --output-dir /ABS/output \
  --session /ABS/project/conversation.jsonl --disable-plugin workspace-local-materials "继续对话"
```

The original local CLI's model configuration and reviewed price/budget prerequisites are unchanged; commands above contain no key. Add `--check` for zero inference. Each invocation resumes the selected native Session when the source paths/hashes, model and output directory match. Disabling removes executable capabilities; ordinary draft Sessions retain their previously authorized history. An owner-reference Session with a persisted required disclosure guard refuses resume when that guard is disabled or missing. Re-enabling revalidates source hashes before restoring successful prior reads. Existing files cannot be overwritten.

`predev`, `prestart` and `prebuild` expose project discovery; build additionally checks pack contents. No plugin code or model is run during those static hooks. Ordinary web/remote business profiles keep their original explicit bindings; discovery does not auto-enable all migrated packages there.

## Development knowledge and runtime memory

Every package has README.md (purpose, lifecycle, interfaces, configuration, permissions, dependencies, evidence), declared skills/*/SKILL.md (business guidance, not a workflow) and AGENTS.md (maintenance memory for future developers). Package source files can be read directly by later development Agents.

These are committed development artifacts. Real company material, credentials, native JSONL, model outputs, drafts and operational memory stay **outside Git**, in explicitly selected per-project/per-enterprise directories and existing OMP Session persistence. Use separate inputs/output/Session directories for separate enterprises; there is no invented memory database or automatic cross-enterprise discovery. The original 128KiB request, output-token/request-count/usage reconciliation and unknown-cost stop remain; trusted plugin tools are admitted dynamically and frozen before inference (at most 32 schemas) so adding a tool needs no hardcoded Session allowlist.

Optional file-first owner references, source versions and separate memory proposals are documented in [workspace-local-materials/README.md](./workspace-local-materials/README.md). They use originals, readable parsed files, references and INDEX; no RAG or fixed workflow. They are not connected to real customer identity/permissions and must not be shared with customers. Native dependency snapshots now preserve all previously read source restrictions across resume/compaction, with resource checks even at unchanged epoch; old protected Sessions without trustworthy snapshots refuse continuation. This protects bounded CLI delivery, not customer UI streaming or export.

## Validation scope

The lifecycle test uses real native OMP file discovery/loading, actual native filesystem tools and native JSONL recovery, with explicitly finite mocked model HTTP. It covers outside-repo package copies, all nine independent entries, disable priority, restart/re-enable, uninstall, coexistence and ambient/undeclared-code exclusion. It is not another real-model acceptance. The prior historical real API conservative cost stays CNY 0.074952; this migration adds zero paid calls. Real enterprise services and Shopify publication are not exercised.
