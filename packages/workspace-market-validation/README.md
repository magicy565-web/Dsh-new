# Market validation plan package

Standard Pi/OMP manifest, five thin tools and an intent-driven Skill. No dependencies, model loop, scheduler, spend ledger or Shopify connector. Load with the official extension loader; the default export safely reports `unconfigured` without an injected original Host client.

The host factory is `marketValidationExtension({ client, authorize })`; client methods are `read(input, signal, model)` and `save(input, signal, model)`. The cloud adapter is `createMarketValidationPlanClient` in `server/market-validation-plan.mjs`. Use its `revalidateReceipt(receipt, model, signal)` before every provider request over the original owned journal. Do not install an unguarded global client or send private Library data to public research tools.

`src/plan.mjs` exports the input JSON Schemas and runtime validators. Its strict rules validate provenance selectors, separate metric units, bounded budgets and explicit commission terms; substantive business steps and text come from the model. It does not verify commercial claims or select channels.

See [integration contract](../../docs/MARKET-VALIDATION-PLAN.md) for original services, deployment limits and verification commands.

Version 0.2.1 includes three optional original monitor tools through `marketValidationMonitorExtension({client,authorize})` (`./monitor` export): draft/approval request, current progress, and persisted human control request in the original approval ledger. The default manifest loads all five tools safely unconfigured. See [monitor contract and migration](../../docs/MARKET-VALIDATION-MONITOR-TOOLS.md). Older plan artifacts remain valid; assessment selection is optional and never supplies an approved market average. Human approval/enable/control uses existing Host endpoints; no tool self-confirms.

Version 0.3.0 adds pre-service multi-platform comparable references, recomputed sample statistics and explicitly proposed seven-day sales standards. Human confirmation comes only from the original trusted receipt reader; service target attainment and direct market comparison remain separate. See [pre-service contract and PR81 integration](../../docs/MARKET-PRE-SERVICE-SALES-TARGET.md). No new MCP/vendor plugin or Host wiring is introduced.
