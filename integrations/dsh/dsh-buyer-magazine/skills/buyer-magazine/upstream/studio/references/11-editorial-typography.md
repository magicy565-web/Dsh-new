# 11 · Editorial typography

## Contract

**Input:** issue text, supported fonts, surface constraints and buying data. **Output:** a coherent responsive type hierarchy with readable procurement tables. **Consumer:** every visible component. Use typography to distinguish editorial narrative, factual data, source qualification and action.

## Assign jobs to fonts

Prefer **Fraunces** for masthead and feature display and **Manrope** for body, data, labels and controls when installed or provisioned by the host. The npm package does **not** distribute font binaries; it carries OFL attribution text and uses Georgia / Arial / system sans fallbacks by default. Do not import fonts from an external CDN as a hidden dependency.

Use display text sparingly. A serif headline can supply character; six different display treatments create noise. Do not use condensed lettering for technical numbers or tiny light weights for data. Use font weights actually available to the runtime and inspect fallback rendering.

## Set an intentional type scale

These are editorial targets; inspect the actual renderer CSS when making changes.

| Role | Wide screen | Narrow screen | Leading / behavior |
| --- | --- | --- | --- |
| Lead display | 80–112 px | 44–56 px | 0.95–1.05; avoid clipped ascenders |
| Feature title | 40–56 px | 30–38 px | 1.05–1.15 |
| Section heading | 24–32 px | 22–28 px | 1.2 |
| Deck | 20–24 px | 18–20 px | 1.35–1.5 |
| Body | 16–18 px | 16–18 px | 1.5–1.7 |
| Procurement value | 15–18 px | 15–17 px | 1.35–1.5 |
| Caption/metadata | 12–14 px | 12–14 px | 1.4–1.6 |
| Control label | 13–15 px | 14–16 px | Adequate hit area independent of text |

Use fluid `clamp()` values with sane minima/maxima. Do not scale the whole page with viewport units. Keep body line lengths approximately 45–75 Latin characters. Make long headings wrap naturally; rewrite bad breaks instead of manually inserting breaks that fail at another width.

## Typeset purchasing data as data

Use `font-variant-numeric: tabular-nums` for comparison values, prices and counts. Use ISO currency codes where ambiguity exists. Keep a value and its unit adjacent; use nonbreaking spaces where needed without forcing a whole long sentence unbreakable. Align genuinely comparable numeric columns consistently, and keep textual unknowns legible in the same cells.

Do not use typography to imply precision the evidence does not have. “About 30 days” must not become a tightly displayed “30” metric with a detached “days” caption. Keep “retail”, “starting from”, quantity tier and quote basis alongside the amount.

| Row treatment | Rule |
| --- | --- |
| Price | Amount and currency first, basis directly below or adjacent |
| MOQ | Number plus unit and scope; never a lonely number |
| Lead time | Duration plus what it covers |
| Unknown | “Not disclosed”, with equal readability |
| Source note | Small enough to be secondary, large enough to read |
| Restricted | Absent from public output, not merely visually muted |

## Manage spacing and emphasis

Use a small repeatable spacing scale around labels, values, paragraphs and sections. Prefer rules, alignment and whitespace over shaded boxes around every fact. Use bold for the key contrast, not every noun. Limit all-caps text to short labels and give it modest tracking; avoid spaced-out paragraphs.

Contrast is a functional constraint. Check actual computed text/background combinations. WCAG 2.2 AA specifies at least 4.5:1 for ordinary text and 3:1 for qualifying large text; the exact large-text definition matters. The design system should exceed the minimum where practical. Primary source: [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum).

## Handle CJK intentionally

Fraunces/Manrope do not provide a complete Chinese editorial type system. For Chinese content use a system CJK sans stack for data and body, and an appropriate installed/licensed CJK serif for display if available. Preserve language-aware punctuation and line breaking; do not apply Latin all-caps tracking to CJK. Keep model codes and mixed Latin units legible.

A Chinese localized edition needs authored Chinese copy and review of fixed labels. Setting the issue locale is not a translation engine. Test longer German/French names and mixed-script supplier names even for an English issue.

## Test fallback and print typography

Disable custom font loading once and inspect for overflow. At 200% zoom and narrow widths, content should reflow without hiding controls or facts. Inspect print at its real page size: screen display sizes should reduce, procurement rows should remain readable, and no essential text should depend on background color.

## Gate

Reject clipped headlines, tiny essential facts, malformed unit wrapping, inaccessible contrast, or a price qualification separated from its amount. Read the issue in grayscale and with custom fonts unavailable. If the information hierarchy survives, the typography is doing its job.



## V1.3 runtime type design

- `porcelain`: Georgia/Fraunces-style scholarly product edit, familiar body sans, oversized mixed-case cover.
- `atelier`: Baskerville/Iowan-style old-style editorial, rose palette, soft headline shape and airy image fields.
- `foundry`: condensed heavy sans display in uppercase; numbers sit in the same technical voice as headings, but body/specs stay a readable sans. Do not apply uppercase to paragraphs, source URLs, or data labels.
- `fieldnotes`: artisan old-style serif, calm warm paper, material-first captions and texture terminology.

Keep tabular numerals for MOQ, quantities, lead times and buyer comparison columns. On mobile, transition the procurement index from a six-column semantic table to a set of semantic cards: *do not* hide the value behind horizontal panning. No status may be conveyed through color alone. For arbitrarily long brand or supplier names use `overflow-wrap` and verify the masthead at 375px. Package ships no font binaries; do not embed commercial licensed font files in the theme.
