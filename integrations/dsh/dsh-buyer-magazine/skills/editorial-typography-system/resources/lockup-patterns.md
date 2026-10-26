# Signature Typographic Lockup Blueprints

Use these 6 structural HTML patterns to replace plain `<h1>`, `<h2>`, and `<p>` blocks with gallery-grade typographic compositions.

---

## Pattern 1: The Staircase Multi-Voice Masthead
Combines upright Didone, swash Italic, an inline hairline rule bridge, a superscript archival index, and a tucked negative-space telemetry block.

```html
<div class="relative">
  <h1 class="typo-staircase ot-display text-[clamp(3.1rem,7.2vw,6.4rem)]">
    <span class="typo-staircase-line-1 voice-didone-upright">
      CHROMA<sup class="typo-sup-index">(09)</sup>
    </span>
    <span class="typo-staircase-line-2">
      <span class="typo-rule-bridge"></span>
      <em class="voice-serif-italic">de l’Alchimie</em>
    </span>
    <span class="typo-staircase-line-3 voice-didone-upright">
      <span class="typo-circled-word voice-grotesque-caps">HEMA-FREE</span>
      <span class="voice-cjk-song ot-cjk-halt">指尖凝固学</span>
    </span>
  </h1>

  <!-- Tucked Negative-Space Telemetry Block -->
  <div class="mt-3 lg:mt-0 lg:absolute lg:bottom-2 lg:left-0 max-w-[26ch] font-mono text-[10px] tracking-[0.22em] uppercase leading-relaxed opacity-75">
    [ REF. 2026-AW / OPTICAL INDEX 1.518 / ZERO PHOTO-INITIATOR TPO ]
  </div>
</div>
```

---

## Pattern 2: The Continuous Pilcrow Monograph Essay
Replaces stacked `<p class="mb-4">` blocks with a single continuous literary block starting with an engraved boxed initial, a small-caps lead-in phrase, oldstyle proportional numerals, and inline vermilion `¶` paragraph dividers.

```html
<article class="ot-prose initial-engraved-box prose-continuous-pilcrow max-w-[50ch] text-[1.04rem] leading-[1.86]">
  <p>
    <span class="typo-lead-smallcaps">Since the autumn of 2017</span>, the domestic manicure has undergone a quiet structural revolution across 30 countries and 1,100,000,000 archived bottles.
  </p>
  <p>
    By eliminating 2-hydroxyethyl methacrylate (HEMA) and trimethylbenzoyl diphenylphosphine oxide (TPO), the oligomer suspension achieves glass-grade vitrification under a 365nm to 405nm dual-spectrum diode in 60 seconds flat.
  </p>
  <p>
    What remains on the natural keratin plate is pure pigment suspended in bio-compatible resin.
  </p>
</article>
```

---

## Pattern 3: The Couture Price & Archival Spec Table
Replaces standard e-commerce `$99.99` text and bullet points with a museum catalog plate label using superscript currency/cents, dotted leaders, and tabular numerals.

```html
<div class="ot-tabular border-t border-b border-current/15 py-3 space-y-2">
  <div class="flex items-baseline justify-between">
    <span class="font-mono text-[10px] tracking-[0.24em] uppercase opacity-70">ARCHIVE ACQUISITION</span>
    <div class="typo-price-couture text-3xl">
      <span class="price-currency">USD</span>
      <span class="price-integer">99</span>
      <span class="price-cents">99</span>
    </div>
  </div>
  <div class="flex items-baseline text-xs font-mono">
    <span class="uppercase tracking-[0.18em] opacity-75">FORMULATION</span>
    <span class="typo-dotted-leader"></span>
    <span>0.00% HEMA / 0.00% TPO</span>
  </div>
  <div class="flex items-baseline text-xs font-mono">
    <span class="uppercase tracking-[0.18em] opacity-75">CURING WAVELENGTH</span>
    <span class="typo-dotted-leader"></span>
    <span>365–405 NM · 60 SEC</span>
  </div>
</div>
```

---

## Pattern 4: Cross-Axis Vertical CJK + Horizontal Didone Lockup
Creates museum-poster spatial tension by pairing a vertical upright Songti column on the margin with a horizontal multi-voice Latin lockup.

```html
<div class="flex items-start gap-6">
  <div class="typo-vertical-cjk ot-cjk-halt text-xs border-r border-current/15 pr-3 max-h-44 select-none opacity-80">
    甲油胶之光影物语・二零二六秋冬典藏卷
  </div>
  <div class="space-y-2">
    <div class="typo-bilingual-stack">
      <span class="gloss-en">SECTION IV · MAGNETIC REFRACTION</span>
      <span class="gloss-cjk text-2xl">猫眼磁流体与微米级折射</span>
    </div>
    <p class="ot-prose text-sm max-w-[44ch] opacity-80">
      Neodymium induction aligns ferromagnetic platelets at a 45-degree velvet trajectory prior to UV polymerization.
    </p>
  </div>
</div>
```

---

## Pattern 5: SVG Physical Ink-Bleed Filter Injection
Place this invisible `<svg>` once at the top of `<body>` and apply `filter: url(#editorial-ink-bleed)` to `.ink-bleed-headline` elements to give digital vector fonts the subtle organic micro-spread of letterpress ink on cotton rag paper.

```html
<svg class="hidden" width="0" height="0" aria-hidden="true">
  <defs>
    <filter id="editorial-ink-bleed" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" result="noise" />
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.65" xChannelSelector="R" yChannelSelector="G" />
    </filter>
  </defs>
</svg>
```
