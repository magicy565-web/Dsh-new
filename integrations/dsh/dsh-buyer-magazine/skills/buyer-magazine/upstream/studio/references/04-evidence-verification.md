# 04 · Evidence and verification

## Contract

**Input:** research records and draft issue. **Output:** admissible claims with field-level source IDs, explicit limitations, and a redacted public record. **Consumer:** every downstream module. Sources explain why a claim is present; they are not decorative footnotes added after writing.

## Use three statuses precisely

| Status | Meaning | What it does not mean |
| --- | --- | --- |
| supplier-stated | A supplier/brand/source asserts the fact | Independently proven or guaranteed |
| verified | Supporting verification is explicit, relevant, and within its stated scope | The whole supplier or every product is verified |
| unknown | Available evidence does not establish the fact | Zero, unavailable, false, or impossible |

A page capture proves what the page said at capture time. It does not prove manufacturing capacity, authenticity, certification validity, or future fulfillment. Reserve `verified` for a check whose object, evidence, and limitations can be described. Do not show arbitrary trust percentages or green “verified supplier” badges.

## Build a claim ledger

Keep a sidecar when the issue contract cannot represent enough context:

```json
{
  "claim": "Listed retail price is USD 39",
  "productId": "lamp-a",
  "field": "price",
  "sourceIds": ["source-lamp-page"],
  "status": "supplier-stated",
  "scope": "one retail SKU, US storefront",
  "checkedAt": "2026-10-26T00:00:00Z",
  "public": true
}
```

The example is a format illustration, not a real source claim. Require exact URLs, publisher identity, access time, and a concise relevant excerpt or page hash. Do not cite a homepage for a technical property found on an unrelated PDF. A source hash supports change detection; it does not prove authenticity or ownership.

## Classify assertions before publishing

- **Product fact:** bind it to the right SKU and configuration.
- **Commercial term:** bind it to buyer/quantity/market/date and permission scope.
- **Editorial inference:** label it as analysis and show the factual basis.
- **Time-sensitive fact:** show the as-of date and recheck before distribution if its age matters.
- **Negative claim:** “not found in reviewed pages” is narrower than “the supplier does not offer it”.
- **Certification:** require exact document, product scope and validity context; a logo or a marketing assertion remains a statement.

When sources conflict, prefer the source that directly applies to the SKU and market, but retain the conflict in `watchout` or `dataNotes`. If no resolution is defensible, mark the field unknown. Never average conflicting prices to create a clean answer.

## Protect nonpublic information

Separate the public issue from buyer-specific quotes and internal economics before rendering. Exclude restricted specifications, customer names, margin/cost data, private contact details, and unapproved contracts. A browser control hiding a row does not make it private; it must be absent from HTML, inline JSON, email, print, exports, and manifest data.

Use `visibility: "restricted"` to identify excluded specification rows where the runtime supports it, and inspect the public projection. Do not assume all top-level fields support access rules. Do not put private terms into `summary`, `watchout`, source excerpts, or an image caption.

## Manage image evidence separately

A publicly accessible image is not automatically licensed for redistribution. Record owned, permission, link-only, or unknown rights as appropriate. Product photography must keep documentary origin; generated editorial images and illustrative diagrams must be labelled and never become support for product claims.

## Gate

Block publication on broken source IDs, invented factual assertions, scope-mismatched certificates, unlabeled sponsored claims, or private data in public artifacts. Allow visible unknowns and qualified inference. Record rechecks and their timestamps; never mutate an old access date to make unchanged evidence appear fresh.

**Worked case:** a source lists “CE certified” without a document. Display “Supplier states CE compliance; documentation not reviewed” only if useful, cite that source, and put verification into the inquiry. Do not display a certification seal or “EU-ready” headline.

