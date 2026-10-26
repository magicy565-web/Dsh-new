# 10 · Product image studio

## Contract

**Input:** actual product images, the correct SKU/variant, source URLs, and reuse permissions. **Output:** faithful, optimized assets with alt text, captions and image-role records. **Consumer:** ProductFeature and CoverStory. A product picture should reduce uncertainty rather than introduce a more attractive fictional product.

## Establish the original before editing

Keep the untouched source. Record the product ID, variant, capture/download date, source and rights status. Confirm that the image actually belongs to the product: collection pages can reuse a family image that does not show the selected variant. Treat packaging and included accessories as meaningful product information.

Check the original at sufficient resolution to see labels, controls, connectors and edges. If text is not readable, do not reproduce it from a model's guess. If a dimension is not supported by evidence, do not add a dimension arrow.

## Choose the minimum useful treatment

| Task | Safe objective | Reject when |
| --- | --- | --- |
| Crop | Emphasize product silhouette or relevant detail | Crop removes a material caveat or included component |
| Background removal | Separate product from clutter | Transparent, reflective or fine features are damaged |
| Exposure correction | Restore legibility while preserving material/color | Finish or color appears materially different |
| Shadow cleanup | Remove distracting artifacts | Product floats or geometry becomes ambiguous |
| Scene placement | Show an editorial context | Scale, compatibility or usage is falsely implied |
| Detail annotation | Point to a sourced property | Label invents features or claims |

Use licensed/authorized originals for any edit. If the host has image-editing tools, follow that host's rules. The CLI adapter's available edit functionality must be checked; do not promise masking, segmentation or deterministic label preservation from a generic image-generation endpoint.

## Apply crop rules

Prefer `object-fit: contain` for the main product image when buyers must inspect the whole item. Use a deliberate 4:3 or 3:2 stage with quiet background and consistent internal padding. Use `cover` only when a defined crop keeps the essential silhouette. Set explicit width/height or aspect ratio to prevent layout shifts.

At 375 px, preserve the same product identity as desktop; do not use a separate attractive variant crop. A detail image should always retain enough accompanying context to identify what the buyer sees.

## Write useful image text

Use alt text such as “Ivory table lamp with a cylindrical shade and a round base”; include the model only when it adds identity. Do not repeat promotional claims, price or every table row. Decorative atmosphere can have empty alt text if its caption already explains it and it carries no information.

Use a caption when the image is illustrative, AI-generated, a prototype, a detail crop, or shows optional accessories. Put the qualification near the image; an invisible metadata property is insufficient.

## Optimize without losing inspection value

Deliver a display asset adequate for the rendered size, with a sensible byte budget. Treat about 150–400 KB per ordinary product image as a starting editorial target, not a universal limit. Preserve sharp edges and fine product labels; increase quality when the information requires it. Use explicit dimensions, lazy loading for below-fold assets and a stable fallback.

Inspect the full issue when one remote image fails. The product name and procurement facts must remain usable. Do not hotlink images as a substitute for resolving redistribution permission.

## Gate

Compare original and final side by side for silhouette, proportions, color, finish, labels, controls and accessories. Require source and rights records, a truthful image role, useful alt text and a tested mobile crop. Reject unresolved fidelity changes even if the edited image is more visually polished.

**Example:** a render adds a USB-C port to a lamp photographed only from the front. Remove the render from documentary use; neither a plausible modern design nor an image model's output establishes that port exists.

