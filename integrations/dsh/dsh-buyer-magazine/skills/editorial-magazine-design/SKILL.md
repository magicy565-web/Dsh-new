---
name: editorial-magazine-design
description: Universal luxury print magazine and editorial lookbook web design system. Use when the user asks to design a website, landing page, brand lookbook, portfolio, B2B whitepaper, or product showcase with a high-end magazine feel, editorial layout, or Kinfolk, Cereal, Vogue, Loewe, Monocle, or 032c aesthetic, or wants to eliminate generic AI SaaS template styling.
---

## Native DSH integration contract

Read all three supplied resources below. Apply their art-direction methods while
authoring your own HTML and CSS with native file tools. Choose the archetype from
the actual brand and editorial question, then design distinct compositions from
the material. There is no required issue JSON, product count, class naming scheme
or canonical web-card layout. Five spreads describes narrative rhythm; use the
actual copy and images to decide how each spread works. Typography, photography,
whitespace and interactive apparatus must serve the story. Decorative paper,
spines, rules and seals do not establish editorial quality on their own.

Use buyer_magazine_review_artifact for screenshots of your authored file and
revise the file directly. Review all states on desktop, mobile and print; protect
content from ornaments, clipping and unsupported interactions. Do not copy the
rejected Allbirds implementation or use the legacy generator for design tasks.
No extra host or app framework is required. Source facts and image attributions
must remain traceable, while the finished publication's layout is your design.

## Preserved original design method

# Editorial Magazine Design

Transform any web project into a tactile, gallery-grade digital publication that looks and feels like an art-directed print magazine rather than a generic SaaS template. This skill governs archetype routing, paper-and-ink materiality tokens, 5-spread narrative choreography, tactile print primitives, and conversion-ready editorial commerce patterns.

## When to Use

  - The user asks for a "magazine style", "editorial design", "lookbook", "monograph", or "high-end print feel" website.
  - The user references publications or brands such as Kinfolk, Cereal, Vogue, Loewe, Acne Paper, Monocle, Financial Times, 032c, or Teenage Engineering.
  - The user complains that a generated page looks too much like a newspaper grid, a generic SaaS landing page, or "AI slop" with rounded cards.
  - The project involves luxury goods, DTC brand storytelling, creative portfolios, game/worldbuilding artbooks, B2B industry reports, or hardware launches.

## Supplementary Resource Files

Load these auxiliary files before writing code so you can apply exact tokens and reusable CSS primitives:

  - `resources/archetypes-tokens.md`: Complete CSS custom properties, bilingual (English and Chinese) typography pairings, color palettes, and layout rules for all 4 magazine archetypes.
  - `resources/spread-primitives.css`: Production-ready CSS classes for 3D book spine gutters, paper grain overlays, vellum tracing sheets, overlapping display typography, optical loupes, and tear-out postcards.
  - `resources/editorial-commerce.md`: Architectural patterns for turning e-commerce checkouts, B2B inquiry forms, and product specs into museum labels, archive drawers, and stamped requisition slips.

## Steps

### Step 1: Route to One of the Four Magazine Archetypes

Never treat "magazine style" as a single rigid newspaper grid. Classify the user's project into one of four distinct print archetypes before writing HTML or CSS (default to **Archetype A** or **Archetype B** when unspecified, and avoid dense boxed grids unless **Archetype C** is selected):

1.  **Archetype A - Slow-Living Lookbook (Kinfolk / Cereal / Aesop)**
      - Best for: DTC lifestyle brands, home goods, skincare, handcrafted products, hospitality, and wellness.
      - Signature rules: Zero visible grid border lines (`0px` hairlines), 45% to 60% open warm-cotton whitespace, 100% full-bleed photography paired with quiet single-quote pages, and soft natural lighting.

2.  **Archetype B - Avant-Garde Fashion Monograph (Vogue Italia / Loewe / Acne Paper)**
      - Best for: Fashion, luxury campaigns, creative director portfolios, game/character artbooks, and visual exhibitions.
      - Signature rules: Extreme typographic scale contrast (`8vw` to `14vw` serif headlines overlapping imagery via negative margins), asymmetric Polaroid photo collages, hollow stroke display numerals, and dramatic high-contrast pacing.

3.  **Archetype C - Global Intelligence Broadsheet (Monocle / Financial Times / Bloomberg)**
      - Best for: B2B platforms, cross-border trade intelligence, research reports, media portals, and dense directories.
      - Signature rules: Exposed `1px solid` Swiss hairline grids, disciplined multi-column alignment, warm salmon or newsprint ivory backgrounds, structured index tables, and archival metadata badges.

4.  **Archetype D - Industrial Technical Archive (032c / Teenage Engineering)**
      - Best for: AI hardware, developer toolchains, audio gear, robotics, and cyber-industrial brands.
      - Signature rules: Brutalist technical grids mixing high-contrast serifs with dense monospace telemetry, X-ray blueprint toggles, engineering callout lines, and a single high-voltage spot ink (vermilion or international orange).

### Step 2: Configure the Parametric Print Materiality Engine

Replace sterile digital defaults (`#FFFFFF` backgrounds, blue-purple gradients, and Inter/Roboto fonts) with physical print tokens defined in `:root`:

  - **Paper Stock Tokens**: Define `--paper-primary` (warm unbleached cotton `#F4F0EA` or cool gallery matte `#F5F6F8`), `--paper-secondary` (oat pulp `#EAE3D5`), and `--paper-darkroom` (carbon espresso `#131211` or midnight navy `#0F141C`).
  - **Ink Tokens**: Define `--ink-primary` (deep carbon ink `#141312`), `--ink-muted` (lead gray `#5E5A53`), and exactly **one** `--ink-spot` accent color (occupying less than 5% of viewport area, such as vermilion `#B8332A` or cobalt `#1B3B8B`).
  - **Three-Tier Typography**:
      - `--font-display`: High-contrast editorial serif (e.g., *Cormorant Garamond*, *Playfair Display*, *Instrument Serif*, paired with *Noto Serif SC* for Chinese).
      - `--font-editorial`: Warm readable serif or humanist sans for body copy, strictly constrained to `38ch` to `58ch` line width and `1.75` to `2.0` line height.
      - `--font-mono`: Archival monospace (*JetBrains Mono* or *Space Mono*) set at `0.62rem` to `0.75rem` with `letter-spacing: 0.2em` uppercase for folio numbers, plate codes (`PLATE IV`), and coordinates.
  - **Paper Grain Filter**: Inject a fixed, non-interactive SVG `feTurbulence` noise overlay at `3.2%` to `4.0%` opacity across the viewport.

### Step 3: Choreograph the 5-Spread Rhythm State Machine

Do not stack homogeneous vertical sections (Hero -> 3-column features -> testimonials). Structure the DOM as a sequence of contrasting magazine spreads, and provide a floating bottom pill switcher allowing users to toggle between **Spread Flip Mode** (dual-page book view with a 3D center spine gutter shadow and keyboard arrow navigation) and **Editorial Scroll Mode**:

1.  **Spread 00 - Cover & Colophon (Frontispiece)**
      - Left page: Quiet colophon with issue number, publication date, curatorial note, and table of contents index.
      - Right page: Full-bleed hero photography with an oversized masthead overlapping the top edge and asymmetric cover lines.

2.  **Spread 01 - The Quiet Weight Spread (Whitespace & Full-Bleed)**
      - Left page: At least 50% open paper whitespace, vertical running head on the outer margin (`writing-mode: vertical-rl`), 3-line drop cap, and an oversized italic pull quote.
      - Right page: 100% edge-to-edge full-bleed portrait with a cross-layer serif title (`margin-left: -4.5rem`) and an interactive optical loupe or hotspot inspector.

3.  **Spread 02 - The Darkroom Atelier Spread (Mood Inversion & Collage)**
      - Invert the background to `--paper-darkroom` (`#131211`) to break visual fatigue.
      - Left page: Overlapping multi-ratio photo collage (a large vertical frame paired with a tilted Polaroid inset) plus a toggleable translucent **Vellum Tracing Overlay** (`backdrop-filter: blur(5px)`) displaying hand-drawn SVG technical annotations.
      - Right page: Interactive 5-stage craftsmanship or architecture breakdown.

4.  **Spread 03 - The Sensory Centerfold (Interactive Editorial Apparatus)**
      - Turn the product's core value proposition into a tactile editorial instrument rather than a static feature list (for example, a rotating vinyl acoustic synthesizer using Web Audio API, a tactile weight prescription slider, or an interactive material comparator).

5.  **Spread 04 - The Curated Monograph & Tear-Out Insert (Editorial Commerce)**
      - Showcase items in an asymmetric Loewe-style lookbook with staggered aspect ratios (`3:4`, `1:1`, `4:5`, `16:10`) and giant Roman numerals (`I` to `V`) overlapping the corners.
      - Place a physical **Tear-Out Postcard / Requisition Slip** rotated at `-1.15deg` on the back spread with a tactile 3D wax seal or ink stamp submission animation.

### Step 4: Run the Quantifiable Visual Linter

Verify the layout against these hard numerical constraints before delivering code:

  - **Zero SaaS Card Rule**: Eliminate all `border-radius > 2px` cards with drop shadows (`rounded-xl shadow-lg`). Use sharp `0px` corners for photography and `1px` rules only where appropriate.
  - **Whitespace Quota**: Text spreads must preserve at least 45% bare paper background.
  - **Extreme Scale Ratio**: Main display headlines (`clamp(3.2rem, 7vw, 7.2rem)`) must be at least 8 times larger than mono folio captions (`0.65rem`).
  - **Z-Axis Overlap Quota**: Every spread must include at least one element that crosses container boundaries via negative margins or absolute positioning.
  - **Line Measure Cap**: Body paragraphs must never exceed `60ch` in width.

## Gotchas

  - **Newspaper Drift**: Adding `1px solid` borders around every paragraph turns a luxury magazine into a 1990s newspaper. For Archetypes A and B, rely on whitespace, image bleed, and scale contrast instead of border boxes.
  - **Unreadable Overlap**: When overlapping giant display typography across a photograph, use `mix-blend-mode` carefully or add a subtle text shadow / contrast backing so the headline remains legible at all viewport widths.
  - **Broken Spread Height on Desktop**: In dual-page `Spread Flip` mode, lock the desktop spread container to a consistent aspect ratio or `min-height: 82vh` with internal overflow handling so left and right pages align like a real open book.
