# 02 · Product intelligence

## Contract

**Input:** collected pages or authorized product records. **Output:** normalized issue products, each with comparable procurement fields and field-level evidence. **Consumer:** editor, tables, comparison drawer, and request export. Preserve differences between listed product properties and terms that require a business quotation.

## Build one record per meaningful buying decision

Use a stable product ID separate from the display name. Treat color-only variants as one family when specification and price basis remain equivalent. Split variants when power, capacity, material, compliance scope, price basis, or intended use changes the procurement decision. Do not combine a low price from one SKU with the best specifications of another.

Map into the package contract:

| Field | Representation | Editorial obligation |
| --- | --- | --- |
| Product and supplier | `name`, `supplier`, `category`, `region` | Use legal/brand identity as sourced; qualify identity gaps |
| Buyer rationale | `summary`, `buyerFit`, `watchout` | Separate observation from inference |
| Specification | `specs[]` with key, label, value, unit, status, sourceIds, visibility | Keep units and property scope |
| Price | `price.kind`, amount, currency, unit/basis, sourceIds, status | Distinguish retail, wholesale, request-quote, unknown |
| Quantity and timing | `moq`, `leadTime` | Explicit unknowns when unavailable |
| Action | `cta` | Link only to a valid source/contact/sample destination |

## Normalize without increasing certainty

Preserve original units in evidence. Add a converted display value only when the conversion is deterministic and useful, label rounding, and retain the original. Treat “30 days” as ambiguous unless the page says whether it concerns production, dispatch, shipping, or delivery. Keep “sample lead time” separate from “production lead time” in a labelled specification row; never map one into the other.

Use `status: "supplier-stated"` for product claims supported only by supplier material. Use `verified` only when the supporting evidence and verification scope are explicit; a successful web request is not verification of the claim. Use `unknown` with a visible string such as “Not disclosed” when a fact is absent. Do not encode unknown prices as zero or unknown MOQ as one.

## Handle price with its full basis

Before displaying an amount, check currency, unit, SKU, quantity tier, tax, delivery/Incoterm basis, region, and date. Display only the context actually supported. “USD 19.90 / listed retail unit” is usable when wholesale terms are missing. A price range is meaningful only if its endpoints refer to comparable conditions; otherwise show variant-specific values or request a quote.

The current JSON contract has a limited `basis` field. Preserve a concise truthful basis there; put additional sourced terms in labelled `specs`. Do not introduce a new unrecognized price model that the renderer silently ignores.

## Define comparability before creating a table

For each category, choose three to six differentiating specifications plus MOQ, lead time, price basis, and evidence. Use the same row key across products only when it refers to the same concept. “Battery capacity (mAh)” and “runtime (hours)” are different rows. “CE” as a logo on a page is not a shared quality score.

| Case | Correct display |
| --- | --- |
| MOQ omitted | Not disclosed |
| MOQ says 500 pieces for private label | 500 pieces · private label |
| Delivery says 3–5 days to US consumers | Consumer delivery: 3–5 days; production lead time unknown |
| Certificate applies to another model | Do not mark the current product certified |
| Private quote is approved for one buyer | Exclude it from a public issue and public request export |

## Gate

Require stable IDs, valid source references, consistent units, explicit unknowns, and no restricted rows in public output. Reject a record that depends on combined incompatible variants. Fewer accurate products are better than filling six slots with unsupported assumptions.

**Worked transformation:** source “From $18, select a size” → price `retail`, amount 18 only if the currency is identified, basis “starting price; size-dependent”, unknown MOQ/production lead time. If currency cannot be established, omit the numeric price and explain the ambiguity.

