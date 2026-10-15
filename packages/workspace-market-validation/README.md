# Market validation plan package

Standard Pi/OMP manifest, five thin tools and an intent-driven Skill. No dependencies, model loop, scheduler, spend ledger or Shopify connector. Load with the official extension loader; the default export safely reports `unconfigured` without an injected original Host client.

The host factory is `marketValidationExtension({ client, authorize })`; client methods are `read(input, signal, model)` and `save(input, signal, model)`. The cloud adapter is `createMarketValidationPlanClient` in `server/market-validation-plan.mjs`. Use its `revalidateReceipt(receipt, model, signal)` before every provider request over the original owned journal. Do not install an unguarded global client or send private Library data to public research tools.

`src/plan.mjs` exports the input JSON Schemas and runtime validators. Its strict rules validate provenance selectors, separate metric units, bounded budgets and explicit commission terms; substantive business steps and text come from the model. It does not verify commercial claims or select channels.

See [integration contract](../../docs/MARKET-VALIDATION-PLAN.md) for original services, deployment limits and verification commands.

Version 0.2.0 adds three optional original monitor tools through `marketValidationMonitorExtension({client,authorize})` (`./monitor` export): draft/approval request, current progress, and human control request. The default manifest loads all five tools safely unconfigured. See [monitor contract and migration](../../docs/MARKET-VALIDATION-MONITOR-TOOLS.md). Older plan artifacts remain valid; assessment selection is optional and never supplies an approved market average. Human approval/enable/control uses existing Host endpoints; no tool self-confirms.
