---
name: editorial-typography-system
description: Complete art-directed typography and kinetic typesetting design system for web applications, lookbooks, luxury e-commerce, and bilingual (CJK and Latin) digital publications. Use whenever the user asks to elevate font design, fix flat or generic typography, design expressive headlines, pair fonts, calibrate Chinese-English mixed typesetting, or apply Swiss, French Couture, Literary Monograph, or Brutalist Lab typographic architecture.
---

## Native DSH integration contract

Use this supplied skill and all five resource files as the typography authority. Author `cover.headlineLines` as 2–3 exact text segments with roman/italic/sans voice, keeping their joined wording equal to cover.headline. Use original OpenType/staircase/CJK primitives embedded by the shared renderer. CJK stays upright; apply actual available serif/gothic/mono stacks. No font binaries are bundled: inspect actual fallback fonts and don't claim a named font was loaded merely because CSS lists it. External font loading requires an available authorized host path, not an undisclosed CDN dependency. Render and inspect at 375/768/1440 before accepting.

## Preserved original design method

# Editorial Typography System

Transform flat, uniform web text into gallery-grade typographic architecture. This skill replaces generic single-weight headings and uncalibrated body paragraphs with multi-voice headline choreography, OpenType micro-typography, CJK-Latin optical baseline calibration, architectural numerals, and physical ink materiality.

## When to Use

  - The user states that a website's fonts or typography feel flat, generic, under-designed, or lacking visual tension.
  - The project requires high-fashion, magazine, luxury DTC, portfolio, or archival typographic art direction.
  - The layout mixes Chinese/Japanese/Korean (CJK) and Latin/English text and needs optical harmony.
  - The user wants expressive display lockups, kinetic typography, editorial drop caps, tabular spec tables, or Swiss grid typesetting.

## Supplementary Resource Files

Load these auxiliary files before writing code so you can apply exact font stacks, CSS primitives, and HTML lockup blueprints:

  - `resources/font-pairings-and-scales.md`: Curated Google Fonts bundles for 5 typographic archetypes, fluid mathematical scale tokens, OpenType feature presets, and `@font-face` unicode-range CJK-Latin optical calibration rules.
  - `resources/font-pairings-cjk.md`: Curated Four-Voice Font Pairings & CJK-Latin Optical Harmonization matrix.
  - `resources/typographic-primitives.css`: Production-ready CSS classes for staircase headlines, inline rule bridges, OpenType numerals, couture price lockups, inline pilcrow prose, bilingual ruby glosses, and SVG ink-bleed filters.
  - `resources/lockup-patterns.md`: Ready-to-use HTML and CSS structural blueprints for 6 signature typographic lockups that replace plain `<h1>` and `<p>` tags.
  - `resources/html-lockup-patterns.md`: Additional structural HTML & SVG typographic lockup patterns (Rotating SVG colophon seal, split-level price lockups, staircase hero headlines).

## Steps

### Step 1: Ban Single-Voice Headings and Plain Paragraphs

Never render a major display headline as a uniform string of text in a single font weight (`<h1> Our Collection </h1>`). Every primary display title must function as a multi-voice typographic lockup combining at least three of the following mechanisms:

1.  **Voice Switching Within a Sentence**: Alternate between upright high-contrast Roman serif, expressive swash *Italic* serif (`font-style: italic; font-weight: 300`), and condensed grotesque or small-caps within the same phrase.
2.  **Staircase Indentation (`.typo-staircase`)**: Stagger multi-line display titles across the horizontal axis (for example: Line 1 flush left, Line 2 indented `14%` to `24%` with an inline horizontal rule bridge, Line 3 flush right or paired with a tucked monospace metadata block).
3.  **Inline Typographic Furniture**: Insert superscript bracketed index numerals (`<sup class="typo-sup-index">(01)</sup>`), hairline rule bridges (`<span class="typo-rule-bridge"></span>`), or pill-bordered callout words directly inside the headline flow.
4.  **Tightened Display Leading with Negative Tracking**: Set display serifs at `line-height: 0.84` to `0.92` and `letter-spacing: -0.03em` to `-0.045em` so ascenders and descenders create intentional architectural tension.

### Step 2: Configure the Five-Tier Font Stack and CJK-Latin Calibration

Never fall back to system sans-serif (`Inter`, `Roboto`, `PingFang SC`, or `Microsoft YaHei`) for editorial or luxury interfaces. Load a 5-tier font hierarchy from `resources/font-pairings-and-scales.md`:

  - `--font-display-serif`: Ultra-high-contrast Didone or expressive transitional serif (*Bodoni Moda*, *Fraunces*, *Instrument Serif*, *Playfair Display*).
  - `--font-display-sans`: Architectural grotesque or geometric display sans (*Syne*, *Space Grotesk*, *Plus Jakarta Sans*).
  - `--font-editorial-prose`: High-legibility literary serif for long-form reading (*Newsreader*, *Cormorant Garamond*, *EB Garamond*).
  - `--font-cjk-editorial`: High-contrast Songti / Mincho serif for Chinese and Japanese (*Noto Serif SC*, *Shippori Mincho*, *ZCOOL XiaoWei*), optically scaled to `90%` to `94%` of Latin size via `unicode-range` or explicit classes so CJK characters do not overpower Latin letterforms.
  - `--font-archival-mono`: Technical monospace for indices, coordinates, and tabular specs (*JetBrains Mono*, *Space Mono*).

### Step 3: Enforce OpenType Micro-Typography

Plain web text looks amateurish because browser defaults disable advanced OpenType tables. Apply explicit feature settings across four text roles:

1.  **Display Lockups (`.ot-display`)**: Enable discretionary ligatures, swashes, and kerning (`font-feature-settings: "kern" 1, "liga" 1, "dlig" 1, "swsh" 1`; `font-optical-sizing: auto`).
2.  **Long-Form Prose (`.ot-prose`)**: Enable proportional oldstyle numerals (`font-variant-numeric: oldstyle-nums proportional-nums`) so numbers blend into the lowercase x-height rhythm rather than shouting like capital letters. Start opening paragraphs with a 3-line small-caps lead-in phrase (`.typo-lead-smallcaps`) paired with an engraved or overhanging drop cap.
3.  **Prices, Specs, and Telemetry (`.ot-tabular`)**: Enforce lining tabular numerals and slashed zeroes (`font-variant-numeric: lining-nums tabular-nums slashed-zero`) so columns of figures and live counters never jitter horizontally. Format e-commerce prices using `.typo-price-couture` (superscript currency symbol, oversized integer, superscript underlined cents).
4.  **CJK Punctuation Compression (`.ot-cjk-halt`)**: Apply `font-feature-settings: "halt" 1, "palt" 1` and `text-spacing-trim: space-first` on Chinese headings so full-width brackets, quotes, and commas do not leave gaping holes in alignment.

### Step 4: Deploy Structural Typographic Furniture

Replace standard web UI components (badges, bullet lists, cards, and tabs) with print-grade typographic mechanisms from `resources/lockup-patterns.md`:

  - **Continuous Pilcrow Prose (`.prose-continuous-pilcrow`)**: Instead of stacking multiple short paragraphs with vertical margins, set editorial essays as a continuous block where paragraphs flow inline, separated by vermilion or spot-ink pilcrow/fleuron symbols (`¶`, `§`, `❦`).
  - **Interlinear Bilingual Gloss (`.typo-bilingual-stack`)**: Instead of showing only one language or awkwardly placing translations in parentheses, stack a micro-tracked uppercase English gloss (`0.58rem`, `letter-spacing: 0.25em`) directly above or beside a high-contrast Chinese Songti headline, or use vertical CJK columns (`.typo-vertical-cjk`) intersecting horizontal Latin titles.
  - **Cropped Monolith Numerals (`.typo-cropped-monolith`)**: Use `8rem` to `16rem` italic display numerals with `line-height: 0.72` clipped against container edges (`overflow: hidden`) as structural room dividers.
  - **Physical Ink Materiality (`.ink-bleed-subtle`)**: Apply an SVG `feMorphology` and `feDisplacementMap` filter at microscopic scale (`scale="0.6"`) to major mastheads to simulate warm ink absorption into cotton paper fibers.

### Step 5: Run the Typographic Quality Audit

Before returning code, verify these six quantifiable typographic rules:

  - **Zero Uniform H1/H2 Rule**: 100% of hero and section headlines must include at least two contrasting typographic voices (for example, upright Roman + light Italic + superscript mono index) or staircase indentation.
  - **Scale Ratio >= 12:1**: The largest display masthead (`clamp(4rem, 9.5vw, 8.8rem)`) must be at least 12 times larger than the smallest archival marginalia (`0.62rem`).
  - **Strict Measure Constraints**: Long-form prose must stay between `38ch` and `56ch`; side-notes and captions must stay between `18ch` and `28ch`.
  - **OpenType Numeral Separation**: Prose paragraphs use `oldstyle-nums`; all prices, dates, tables, and counters use `tabular-nums`.
  - **Zero Orphaned Words**: Apply `text-wrap: balance` to all headings and pull quotes, and `text-wrap: pretty` to all prose paragraphs.
  - **Bilingual Rhythm Check**: Every Chinese display heading must pair with an archival Latin/Mono coordinate or interlinear gloss to maintain cross-script tension.

## Gotchas

  - **Faux Bold and Faux Italic on CJK Fonts**: Never apply `font-style: italic` to Chinese Songti characters (`Noto Serif SC`), which produces ugly browser-sheared glyphs. Wrap Latin words in `<em>` or `.voice-italic` and keep Chinese characters upright (`font-style: normal`).
  - **Over-Tracked Lowercase**: Never apply wide positive letter-spacing (`letter-spacing > 0.05em`) to lowercase serif words. Reserve wide tracking (`0.18em` to `0.32em`) strictly for uppercase monospace, small-caps, or spaced CJK poetry.
  - **Ink Filter Blur**: Keep SVG ink-bleed displacement scales under `0.85` on high-DPI screens so letterforms acquire warm organic edges without becoming blurry or illegible.
