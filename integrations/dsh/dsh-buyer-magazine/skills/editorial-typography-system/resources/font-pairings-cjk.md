# Curated Four-Voice Font Pairings & CJK-Latin Optical Harmonization

Use these production-tested Google Fonts bundles and CSS custom property presets to give any web project an unmistakable typographic signature.

---

## 1. Universal Master Google Fonts Import

Include this single `@import` or `<link>` block to unlock all four typographic voices (Didone Display, Calligraphic Old-Style, Geometric/Condensed Gothic, Archival Monospace, and Songti CJK):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400..800;1,6..96,400..700&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400;1,600&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:ital,wght@0,300;0,400;0,500;1,400&family=Newsreader:ital,opsz,wght@0,6..72,300..500;1,6..72,300..500&family=Noto+Serif+SC:wght@300;400;600;700&family=Syne:wght@500;700;800&display=swap" rel="stylesheet">
```

---

## 2. Six Signature Typographic Foundry Presets

### Preset I: Haute Couture Didone (*Vogue Paris / Harper's Bazaar / Luxury Beauty*)
Extreme thick-to-thin hairline stroke contrast paired with razor-sharp geometric interjections.

```css
:root[data-type-preset="didone"] {
  --font-display: 'Bodoni Moda', 'Noto Serif SC', Georgia, serif;
  --font-calligraphic: 'Cormorant Garamond', 'Noto Serif SC', serif;
  --font-editorial: 'Newsreader', 'Noto Serif SC', serif;
  --font-gothic: 'Syne', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --display-tracking: -0.038em;
  --display-leading: 0.85;
}
```

### Preset II: Poetic Gallery Monograph (*Loewe / Acne Paper / Art Exhibition*)
Tall, narrow editorial proportions (`Instrument Serif`) mixed with lush Renaissance italics (`Cormorant Garamond`).

```css
:root[data-type-preset="monograph"] {
  --font-display: 'Instrument Serif', 'Noto Serif SC', serif;
  --font-calligraphic: 'Cormorant Garamond', 'Noto Serif SC', serif;
  --font-editorial: 'Cormorant Garamond', 'Noto Serif SC', serif;
  --font-gothic: 'Syne', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --display-tracking: -0.025em;
  --display-leading: 0.88;
}
```

### Preset III: Botanical Apothecary & Slow Living (*Aesop / Kinfolk / Le Labo*)
Warm literary Venetian serifs (`Newsreader` optical size) paired with typewriter-grade laboratory telemetry.

```css
:root[data-type-preset="apothecary"] {
  --font-display: 'Cormorant Garamond', 'Noto Serif SC', serif;
  --font-calligraphic: 'Newsreader', 'Noto Serif SC', serif;
  --font-editorial: 'Newsreader', 'Noto Serif SC', serif;
  --font-gothic: 'JetBrains Mono', monospace;
  --font-mono: 'JetBrains Mono', monospace;
  --display-tracking: -0.02em;
  --display-leading: 0.92;
}
```

### Preset IV: Brutalist Technical Archive (*032c / Prada Linea Rossa / Lab Instruments*)
Monumental wide gothic display (`Syne`) colliding with classical italic serifs and dense monospace grids.

```css
:root[data-type-preset="brutalist"] {
  --font-display: 'Syne', 'Noto Serif SC', sans-serif;
  --font-calligraphic: 'Instrument Serif', 'Noto Serif SC', serif;
  --font-editorial: 'Newsreader', 'Noto Serif SC', serif;
  --font-gothic: 'Syne', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --display-tracking: -0.045em;
  --display-leading: 0.86;
}
```

---

## 3. CJK × Latin Optical Harmonization Matrix

Chinese characters (`汉字`) occupy a full square em-box, whereas Latin serif characters have ascenders, descenders, and lighter stroke density. Apply these rules whenever Chinese text is rendered:

| Typographic Element | Latin Setting (`EN`) | Chinese Setting (`ZH-CN`) | Why It Matters |
| :--- | :--- | :--- | :--- |
| **Display Headline Tracking** | `-0.035em` to `-0.045em` | `+0.02em` to `+0.06em` | Negative tracking crushes Chinese strokes together. |
| **Emphasis Mechanism** | True Calligraphic Italic (`font-style: italic`) | **Never oblique!** Use `font-weight: 600`, spot color, or `text-emphasis: filled circle` (着重号). | Browser-synthesized CJK oblique destroys Songti stroke geometry. |
| **Body Copy Line Height** | `1.78` to `1.88` | `1.95` to `2.10` | Square CJK glyphs need deeper inter-line breathing room. |
| **Body Copy Font Size** | `1.02rem` (`16.3px`) | `0.95rem` (`15.2px`) | Optical size reduction makes CJK match Latin x-height weight. |
| **Mixed CJK + Latin Spacing** | Normal word spaces | Insert `0.16em` breathing pad around inline Latin words/numbers | Prevents Latin numerals from colliding into adjacent CJK glyphs. |
