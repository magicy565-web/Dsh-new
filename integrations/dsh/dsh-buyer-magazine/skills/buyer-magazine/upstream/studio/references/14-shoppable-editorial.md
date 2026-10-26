# 14 · Shoppable editorial

## Contract

**Input:** buyer intent, product evidence, validated destination links and disclosure context. **Output:** truthful next-step controls and a useful inquiry brief. **Consumer:** web/email/print. The current package prepares local content and links; it does not itself negotiate, send messages, place orders or process payment.

## Match the next action to the known facts

| Evidence situation | Appropriate action | Misleading action |
| --- | --- | --- |
| Product detail only | View product / review source | Order wholesale at inferred price |
| Public inquiry page | Prepare inquiry / open inquiry page | Claim a quotation has been requested |
| Documented sample program | Review sample terms | Promise a free sample |
| Verified retail purchase link | View listed retail offer | Claim an approved trade purchase |
| Missing MOQ/lead time | Ask targeted commercial questions | Hide the omissions behind “Get best price” |

Use the issue's `cta.type` and label consistently. Validate the destination URL's scheme and host. Never put credentials, internal IDs, private prices, or sensitive buyer information into public query strings. If a contact link is absent, use the genuine source page and say what information is needed.

## Create a specific conversion hook

A good hook reduces the work required to take the next step. Build an inquiry around the actual missing terms: exact model, requested quantity, destination, customization, packaging, test documents, sample cost and production lead time. Do not prefill an invented buyer quantity or pretend the buyer has accepted terms.

The request export should preserve selected product names and IDs, source links, known facts, the basis of prices, unresolved questions, and the issue date. Keep demo status visible if it came from the demonstration issue. It should remain useful outside the magazine.

## Keep persuasion evidence-led

Use a sourced differentiator and a practical question. “Published dimensions suggest a compact shelf footprint; confirm carton dimensions before ordering” is an inference with a next step. “Guaranteed to sell out” is an unsupported outcome claim.

Do not create artificial scarcity, invented buyer testimonials, fake supplier response times, or unsubstantiated margin calculations. A paid placement is acceptable only when clearly labelled near the placement and carried into email/print adaptations.

## Preserve buyer choice

Save and compare should work without requiring an email address. A local request download should not subscribe a reader or send anything. If a future connected messaging workflow is added, show the exact recipient, message, selected products and commercial scope before the authorized send step. The package's present link/export UI must not imply that later integration already exists.

Do not implement opaque lead scoring or blanket buyer verification as part of this design package. Supplier confidential-pricing policies belong in an authenticated backend with explicit authorization, not hidden browser logic. Public magazines should contain only approved public material.

## Check the whole destination path

Open or validate the actual CTA target when possible. Confirm that a “sample” link leads to a relevant sample path, a product link resolves to the right SKU, and a region-specific storefront is labelled appropriately. If a destination cannot be verified, record that limitation; do not replace it with a random homepage while preserving a precise label.

## Gate

Every CTA must match an actual behavior and valid destination. Every exported request must preserve qualifiers and avoid private data. No automatic transmission should occur from save, compare or download. Report link preparation, file creation, provider sending and successful delivery as separate states.

