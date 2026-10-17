# ERPNext enterprise adapter maintenance

- This package owns only mapping, provenance and an optional extension. The sole HTTP client remains PR #86's `@workspace-agent/pi-free-trade/adapters`.
- Host-selected exact record and fields only. Reuse `createFreeTradeSessionBinding().open()` and its current authorization/proof methods. Configuration never grants permission.
- Library remains the enterprise fact authority. No migration, writes, pricing rules, memory store, permission registry, queue or Agent loop here.
- Default loading is unconfigured. Private tools require the original disclosure gate. Restored private receipts require a separately reviewed integration; reject them here.
- Synthetic test grants and HTTP are not real ERP/SDK/business acceptance. Never read credentials or call external services/models in these tests.
- Run package build, `npm test`, and the repository plugin pack check. Keep root dependencies, shared registration, Host and UI untouched.
