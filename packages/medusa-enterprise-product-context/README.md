# Medusa Enterprise Product Context

A small, independent Medusa v2 module that adds the business context an AI worker needs to use a product.

It does not replace Medusa Product. It extends it with a separate data model and a read-only module link.

## Why a separate model

Medusa owns product, variant, category, collection, tag, image and commerce data. Our vertical fields are different: buyer, target markets, use cases, sales claims, proof, commercial policy, evidence gaps and review state.

Keep those fields in a custom module instead of turning Product metadata into an uncontrolled blob.

## Data model

- product_id — one context per Medusa product.
- status — incomplete / ready_for_review / approved / blocked.
- readiness_score — 0..100.
- buyer_profile
- target_markets[]
- use_cases[]
- selling_points[]
- evidence[] — references and verification status; the module does not ingest private documents.
- commercial_policy — MOQ, sample, lead time, price note, distributor policy.
- missing_evidence[]
- agent_summary
- source_hash
- review_version
- reviewed_at / reviewed_by
- notes

## Install into a Medusa application

Register the module in medusa-config.ts:

    modules: [
      {
        resolve: './src/modules/product-context',
      },
    ]

Copy/register the link under src/links/product-context-product.ts and run the Medusa link/database migration flow for the pinned Medusa minor version.

Expose:

    GET  /admin/products/:id/context
    POST /admin/products/:id/context

Both routes require an authenticated Medusa user. POST is validated and limits readiness_score to 0..100.

## UI contract

The standalone Product Catalog has an Agent Data surface. It should read this context and show:

1. readiness score
2. target buyer
3. target markets
4. use cases
5. selling points
6. evidence state
7. missing evidence
8. last review

Normal users should never edit raw JSON.

## Agent boundary

An Agent should read approved Product Context through a purpose-built read API or tool. It should not receive unrestricted Medusa Admin API access or a secret API key.

The first version intentionally has no write-capable Agent tool. Human/admin review is the write boundary.

## Future vertical modules

Keep these separate instead of expanding Product Context indefinitely:

- supplier-policy — commercial and distributor rules.
- product-evidence — certificates/test reports with expiry and source references.
- product-market-fit — market-specific fit signals and experiments.
- product-performance — sales, lead and conversion outcomes.

This keeps Medusa Product reusable and prevents one vertical table from becoming an ERP.

## Compatibility

Reference implementation is pinned to the Medusa v2.21.x conventions. Keep the module and Medusa application on the same minor line.