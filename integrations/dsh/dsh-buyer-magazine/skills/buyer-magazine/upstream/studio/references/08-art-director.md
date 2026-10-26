# 08 · Art director

## Contract

**Input:** storyboard, documentary assets, source identity, and editorial theme. **Output:** a consistent image/layout treatment and an image plan. **Consumer:** Product Image Studio, AI Image Studio, typography, and layout. Choose the composition from the information, not from a generic “luxury magazine” prompt.

## Use an implemented editorial archetype, not a one-size-fits-all recipe

The default renderer uses Fraunces/Georgia for editorial display and Manrope/Arial for body/UI; no font binaries are bundled, so local system fallbacks are available. Use warm paper `#f4f1ea`, surface `#fffdf8`, ink `#202820`, muted `#65675e`, coral `#a83f2c`, forest `#263c33`, rule `#c8c5b8`, and sage `#dfe5d7`.

Treat color as hierarchy: ink carries facts, coral marks a meaningful action or emphasis, sage gives a quiet image field, and rules organize procurement data. Avoid coloring every category and every metric. A “verified” label requires evidence regardless of its color.

Use approximately 80/48/24 px section rhythm at wide/medium/narrow layouts, and a maximum page measure around 1280 px. Use the actual renderer CSS as authority for implementation. The renderer now implements four selectable themes (`porcelain`, `atelier`, `foundry`, `fieldnotes`) in CSS, with `theme` enforced by the issue schema. Theme choice changes visual hierarchy; it never validates a product claim. See `docs/EDITORIAL-ATLAS-v1.3.md`.

## Specify image roles

| Role | Purpose | Allowed treatment |
| --- | --- | --- |
| Product documentary | Identify actual SKU, finish and geometry | Crop/reframe without altering relevant features |
| Product detail | Explain a sourced component or texture | Tighter crop with context and truthful caption |
| Editorial atmosphere | Give the issue mood and category context | Licensed or generated scene, visibly attributed when generated |
| Technical illustration | Explain proportions or a concept | Original schematic, labelled illustrative; no invented dimensions |
| Evidence document | Show a legible relevant source excerpt | Preserve context; no decorative certificate recreation |

Never use an invented factory photo as the lead to a supplier capability story. Never put a photorealistic generated SKU next to documentary pricing without making its illustrative status unmistakable.

## Keep a common photographic language

Choose one light direction, one background temperature, one shadow behavior, and two crop families for an issue. Keep three featured products at comparable apparent scales unless the editorial point is a size comparison. Preserve shadows that help readers interpret real form. Avoid excessive background removal that makes transparent or reflective products misleading.

Use empty space deliberately for hierarchy, not as a substitute for a clear story. Place typography outside the image when precise text matters. Generated image text is not a reliable typesetting surface.

## Control decorative motion

Use short transitions to signal state changes. Avoid automatic parallax, spinning products, scroll hijacking, continuous animated gradients, and fake page-flip effects in the morning reading path. If a future animation explains a material mechanism, provide controls, a still fallback, and reduced-motion treatment.

## Review at thumbnail size and reading size

At thumbnail size, confirm one dominant headline, one dominant image, and an obvious sequence. At reading size, confirm actual product details, captions, data rows, source labels and actions. Reject an attractive thumbnail whose important text collapses into tiny gray marks.

## Gate

Require consistent product framing, readable image labels, a restrained palette, and a visible difference between documentary and editorial art. Check both the “all images available” and “one image missing” layouts. Do not let a remote image failure collapse the procurement content.

**Style variation:** industrial products may use tighter technical crops and stronger numeric hierarchy; beauty packaging may use larger silhouette shots and shade distinctions. These choices are implemented as CSS-level editorial archetypes. Test with `buyer-magazine theme-proof --input ISSUE.json --out ./proofs`. Never use a theme to mask missing factual evidence.


## V1.3 editorial review before accepting a theme

1. Inspect **both** the cover (2-second visual read) and procurement index (10-second decision read). A luxurious cover that hides MOQ and lead time fails.
2. For Atelier, request a visual difference between shade, material/finish and packaging. Do not create chemical claims from the image.
3. For Foundry, show part hierarchy and tool-access or interface details *only if evidenced*. Editorial schematic dimensions are never actual tolerances.
4. For Fieldnotes, give textile composition, weave, care and shrinkage tests priority over decorative texture.
5. Force an image-missing version and inspect the text-only abstract cover. A missing licensed image cannot block reading or create a deceptive factory photo.
6. Keep only a small set of color tokens; 1 focus accent per issue. Use the accent for chapter/CTA hierarchy, not as a fictitious verification mark.
