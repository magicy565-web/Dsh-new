# Design is a production step

## Observable output

The first screen must name the brand, show the selected product/category and state
one editorial idea. Prefer an actual relevant image occupying roughly half the
opening, a short headline, a concise introduction and an obvious reading route.
Do not fill this area with a generic logo, abstract THE RECORD card or an unearned
claim. The theme is not the identity: derive a restrained palette and visual voice
from the actual site and explain your adaptation for the publication.

Use alternating visual emphasis across product stories: lead image and key
material, specification/detail, comparison and practical interpretation. Preserve
whitespace, crop deliberately and let the product remain identifiable. Avoid five
identical dense text cards. Product cut-outs normally use `contain`; lifestyle
photography may use `cover` with a chosen focal position. Inspect the final crops.

Chinese display type needs CJK fallback faces and comfortable line spacing. Avoid
overlong stacked headlines, English filler eyebrows and tiny letter-spaced Chinese.
Use separate roles for display title, narrative body and numeric specifications.
Keep brand names/SKU names/source quotations intact; localize interface chrome.

## Supported design contract

Add this object to a Studio issue. Values below are illustrative, not an automatic
Allbirds brand prescription. Choose and justify the actual values from evidence.

```json
{
  "design": {
    "brand": "Brand name",
    "reader": "The specific intended reader",
    "editorialGoal": "One question this issue helps answer",
    "visualConcept": "Concrete visual choices and their reason",
    "brandSourceIds": ["brand-home"],
    "imageTreatment": "photographic",
    "distribution": "licensed-publication",
    "textLedRequested": false,
    "fontStyle": "editorial",
    "palette": {"paper":"#f6f4ef","surface":"#ffffff","ink":"#25352b","accent":"#806048"}
  }
}
```

`fontStyle` is `editorial` or `modern`. `imageTreatment` is `photographic` by
default. `text-led` requires the user's explicit request and a deliberate typographic
design; it cannot be a workaround for missing photographs. Palette values are
six-digit hex colours, never raw CSS. Existing four themes still provide layout
foundations; the shared renderer applies these supported overrides.

Image fields retain src/alt/role/generated/rights/sourceId/credit/caption, with
optional `fit: contain|cover` and `position: center|top|bottom|left|right`. Document
the exact SKU and image-to-source match. `permission` means an actual user or owner
authorization statement; never infer it from a public URL. For third-party internal
research only, `editorial-reference` requires distribution `internal-reference`,
generated false, sourceId, credit and caption. It asserts an attributed reference,
not a license for commercial reuse. These images remain remote and require network
access; do not claim offline portability.

## Concrete revision loop

1. Generate with the complete designed issue; retain its SHA and blockers.
2. Review `overview` for 375/768/1440 px cover captures and actual layout checks.
3. For web-card, review `spreads` in both batches at width 1440 and 375. Review `products` with start 0 and follow nextProductStart until all products
   have actual screenshots. Confirm correct images, captions and clipping.
4. Review `editorial` for editor note, interpretation and footer; it also produces
   a native PDF attachment. Use `print` and follow nextPrintStart until all actual PDF page images have been inspected.
5. In the production record, write visible defects with screenshot labels and the
   proposed concrete repair. Do not simply write “looks good”. Repair the earliest
   wrong input, regenerate and compare changed screenshots at the new SHA.
6. Deliver when all requested surfaces meet the brief. If tools or image inputs
   are missing, state the specific incomplete stage and required remedy.

The browser tool performs mechanical checks; the image-capable model performs
visual/editorial judgment. No status string can certify that an image was actually
understood. Present only real attachments/paths; no fabricated download URLs.
