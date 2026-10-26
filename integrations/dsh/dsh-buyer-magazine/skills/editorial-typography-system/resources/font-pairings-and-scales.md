# Curated Font Pairings, Fluid Scales & CJK-Latin Optical Calibration

Use this reference to load production-grade Google Fonts bundles, configure fluid mathematical type scales, and calibrate bilingual (CJK + Latin) optical baselines.

---

## 1. Five Art-Directed Font Bundles (Google Fonts `<link>` Presets)

Always include the full weight and italic axes in `<head>` so `font-style: italic` and variable weight transitions render true foundry glyphs rather than browser-synthesized faux styles.

### Bundle A: French Couture & High-Contrast Monograph (*Vogue Paris / Loewe / Mugler*)
Combines razor-thin Didone hairlines, ball terminals, expressive variable soft-serif italics, and high-contrast Songti.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400..800;1,6..96,400..700&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400;1,600&family=Instrument+Serif:ital@0;1&family=Noto+Serif+SC:wght@300;400;600;700&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
```

### Bundle B: Contemporary Expressive Variable (*Fraunces / Cereal / A24 / Jacquemus*)
Uses `Fraunces` with its `SOFT` and `WONK` optical axes alongside `Newsreader` for literary prose and `Syne` for avant-garde geometric accents.

```html
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,SOFT,WONK,wght@0,9..144,0..100,0..1,200..700;1,9..144,0..100,0..1,200..600&family=Newsreader:ital,opsz,wght@0,6..72,300..500;1,6..72,300..500&family=Syne:wght@500;700;800&family=Noto+Serif+SC:wght@300;400;600&family=JetBrains+Mono:ital,wght@0,300;0,400;0,500;1,300&display=swap" rel="stylesheet">
```

### Bundle C: Neo-Swiss & Industrial Lab (*032c / Kunsthalle / Teenage Engineering*)
Contrasts tight neo-grotesque display headers with razor-sharp editorial serifs and dense telemetry monospace.

```html
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter+Tight:ital,wght@0,300;0,500;0,700;1,300;1,500&family=JetBrains+Mono:ital,wght@0,300;0,400;0,600;1,400&family=Noto+Sans+SC:wght@300;400;500;700&family=Noto+Serif+SC:wght@400;700&display=swap" rel="stylesheet">
```

---

## 2. Parametric Typographic Scale & Voice Tokens (`:root`)

```css
:root {
  /* 5-Tier Font Families */
  --font-display-didone: 'Bodoni Moda', 'Noto Serif SC', Georgia, serif;
  --font-display-editorial: 'Instrument Serif', 'Playfair Display', 'Noto Serif SC', serif;
  --font-display-expressive: 'Fraunces', 'Cormorant Garamond', 'Noto Serif SC', serif;
  --font-editorial-prose: 'Cormorant Garamond', 'Newsreader', 'Noto Serif SC', serif;
  --font-grotesque: 'Syne', 'Inter Tight', 'Noto Sans SC', sans-serif;
  --font-mono-archive: 'JetBrains Mono', 'Space Mono', monospace;
  --font-cjk-song: 'Noto Serif SC', 'Songti SC', serif;

  /* Fluid Mathematical Type Scale (12.5:1 Extreme Contrast Ratio) */
  --type-monolith: clamp(4.5rem, 11vw, 9.8rem);   /* Mastheads & Bleed Numerals */
  --type-display-xl: clamp(3.2rem, 7.2vw, 6.4rem);/* Spread Hero Headlines */
  --type-display-lg: clamp(2.2rem, 4.4vw, 4.1rem);/* Section Architecture Titles */
  --type-display-md: clamp(1.55rem, 2.6vw, 2.45rem); /* Pull Quotes & Sub-Lockups */
  --type-prose-lead: clamp(1.12rem, 1.35vw, 1.32rem); /* Lead Deck Paragraph */
  --type-prose-body: clamp(0.98rem, 1.05vw, 1.08rem); /* Long-Form Editorial Body */
  --type-caption: 0.75rem;                        /* Sidenotes & Museum Labels (12px) */
  --type-micro-mono: 0.625rem;                    /* Archival Telemetry & Folios (10px) */

  /* Precision Leading & Tracking Tokens */
  --leading-monolith: 0.78;
  --leading-display: 0.88;
  --leading-tight: 1.05;
  --leading-prose-en: 1.82;
  --leading-prose-cjk: 1.96;

  --tracking-tightest: -0.042em;
  --tracking-display: -0.028em;
  --tracking-prose: 0.005em;
  --tracking-smallcaps: 0.14em;
  --tracking-mono-wide: 0.24em;
  --tracking-mono-ultra: 0.34em;
}
```

---

## 3. CJK + Latin Composite Optical Calibration

When Chinese characters (`Noto Serif SC`) sit next to Latin serif glyphs (`Cormorant Garamond` or `Bodoni Moda`), the CJK ideographs fill the entire em-square and appear ~12% too large and slightly too high on the baseline.

Apply these rules to achieve seamless bilingual typesetting:

1. **Never italicize CJK glyphs**:
   - Browser-synthesized oblique CJK characters destroy the brush/knife geometry of Songti strokes.
   - Always keep CJK spans at `font-style: normal` while wrapping adjacent Latin words in `<em class="voice-latin-italic">`.

2. **Optical Size Differential (`.cjk-calibrated`)**:
   - When a headline is primarily Chinese, set `font-size: 0.88em`, `letter-spacing: 0.06em`, and `font-weight: 400` or `600`, paired with an inline Latin display word at `1.14em` italic.

3. **Punctuation Compression**:
   - Full-width CJK punctuation (`「」`, `《》`, `——`, `，`, `。`) includes built-in half-em whitespace that breaks flush-left margin alignment.
   - Always apply `font-feature-settings: "halt" 1, "palt" 1;` on Chinese display lockups and pull quotes.
