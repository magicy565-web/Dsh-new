# Medusa Enterprise Product Context

Independent vertical plugin for a self-hosted Medusa v2 product catalog.

## Boundary

Medusa owns Product, Variant, Option, Image, Category, Collection, Tag, Price and Inventory primitives. This module owns business context that an AI worker needs to decide whether a product is usable for market development.

## Context data

- buyer_profile
- target_markets
- use_cases
- selling_points
- evidence
- commercial_policy
- missing_evidence
- agent_summary
- readiness_score
- review status and audit fields
- source_hash / review_version

## API

Authenticated admin routes:

- GET /admin/products/:id/context
- POST /admin/products/:id/context
- GET /admin/product-contexts

The server enforces a release gate: status approved requires readiness_score >= 80 and zero missing evidence. The reviewer identity is taken from the authenticated Medusa user, not from an arbitrary browser field.

## Registration

Register the module in the Medusa application's medusa-config.ts, register the Product Context read-only inverse link under src/links, then run the normal Medusa migration/link synchronization for the application's pinned version.

## Agent boundary

Do not give a worker an Admin JWT or Secret API Key. The intended worker integration is a separate read-only context tool that returns approved Product Context records only. This keeps commerce administration and agent consumption as separate authorization surfaces.

## Reproducible source checks

Use Node 24 and `npm ci --ignore-scripts`, then `MEDUSA_DISABLE_TELEMETRY=1 npm test`. The lock pins Medusa 2.21.2. The package emits CommonJS to `.medusa/server`; `src/admin` is intentionally empty of UI extensions. The compile/contract tests load the actual SDK but use explicit persistence stand-ins. They do not prove a running Medusa instance, migrations, credentials, or OMP disclosure authorization.

The Product Context `product_id` relation has read-only graph joins in both directions. Neither join writes or synchronizes Library data. The original Workspace Library draft projection and this native Medusa catalog retain separate authorities; see `../../docs/OMP-ALL-PLUGINS-INTEGRATION-20261017.md`.
