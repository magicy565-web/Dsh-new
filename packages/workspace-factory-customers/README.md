# Workspace factory customers

Private local standard Pi/OMP package for a Chinese factory researching public overseas buyer/distributor candidate sources. Tested host targets are official Pi 1.1.0/Node 24.19.0 and OMP 18.10.4/Bun 1.3.14. The package has no runtime dependencies, install hooks, storage, network client, search/browser engine or model executor.

The default extension registers three tools with an honest blocked state. It reads no environment variables or enterprise Library files. A controlled Host may inject `factoryCustomersExtension({client, authorize})`:

- `authorize(signal, model)` rejects changed/revoked authority. Every Host call is guarded before and after; the current official model must be present.
- `client.status(signal, model)` returns `{toolNames: string[], businessSubmit: boolean}` describing actual configured original capabilities. It must not claim connectivity from configuration alone.
- `client.invokeTool(name, input, signal, model)` returns the original SDK ToolResult. This package invokes only `workspace_public_search` and, if requested, `workspace_public_browser`. The original Host retains URL/DNS admission, keyless provider selection, per-Run limits, cancellation and any budget rules.
- `client.businessSubmit(input, signal, model)` delegates to the original Workspace client, preserving the original `allowBusinessSubmit` gate, member binding and stable request ID. It returns the original business receipt `{task: {taskId, ...}, ...}`. The plugin always submits `type: 'factory-export'`.

Tools:

- `workspace_factory_customers_status({})`: configuration only; no search observation or buyer verification.
- `workspace_factory_customers_research({product, targetMarket, query, limit?, inspectPages?})`: one original search, at most two source pages and optional original browser inspection. It preserves URL/time/tool provenance; source-reported text, empty inference and missing facts remain separate. A hit is not a matched customer.
- `workspace_factory_customers_save({title, product, spec, targetMarket, researchCallId, requestId})`: explicitly save an original same-transcript research receipt through the existing factory-export task. Product and market must match that receipt. No arbitrary evidence object, original file selector, private Library receipt or automatic save is accepted.

Private-material tools are a separate scope. Their authorization receipts, artifact/version references or extracted enterprise contents must not become public-search input. The Host remains responsible for exact public admission and current authority; text checks here are a narrow input guard, not a new permission system. Missing buyer identity, purchasing intent, factory fit and contact consent remain unknown. Browser failures stay partial or blocked, without alternate-provider or paid fallback.

Local package lifecycle: Pi `install /absolute/path`, resource settings `extensions: [], skills: []`, then `remove /absolute/path`; OMP `plugin link /absolute/path`, `plugin disable @workspace-agent/pi-factory-customers`, `plugin enable ...`, `plugin uninstall ...`. None publishes to npm. Removing the plugin does not delete original Workspace tasks, documents or enterprise data.

The ordinary host's native tools and other plugins remain untouched. No private permission, generic shell interception, external sending, contact scraping, order, payment or shop operation is supplied. SDK fixture providers are finite/keyless test transports only; synthetic source-response fixtures must be reported as synthetic, never as observed buyers. A separately observed public network refusal is retained as a refusal.
