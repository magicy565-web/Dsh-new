# Structural HTML & SVG Typographic Lockup Patterns

Copy and adapt these structural patterns to replace flat `<h1>`, `<p>`, and `$99.99` elements with multi-voice editorial lockups.

---

## 1. Three-Voice Staircase Hero Headline with Elastic Rule Bridge

Combines Upright Didone (`.voice-roman`), Calligraphic Italic (`.voice-italic`), Superscript Monospace (`.voice-mono-sup`), Gothic Pill Tag (`.voice-gothic-tag`), and an Elastic Hairline Bridge (`.type-rule-bridge`):

```html
<h1 class="type-staircase text-[clamp(3.2rem,7.8vw,7.4rem)] text-[var(--ink-primary)]">
  <!-- Line 1: Flush Left Roman + Superscript Plate Index -->
  <span class="stair-line">
    <span class="voice-roman">L’ALCHIMIE</span>
    <span class="voice-mono-sup">[N° 09]</span>
  </span>

  <!-- Line 2: Hairline Bridge + Calligraphic Italic -->
  <span class="stair-line stair-indent-sm">
    <span class=" voice-gothic-tag">HEMA-FREE</span>
    <span class="type-rule-bridge"></span>
    <span class="voice-italic text-[var(--ink-spot)]">de la Lumière</span>
  </span>

  <!-- Line 3: Deep Staircase Indent + Roman Finale -->
  <span class="stair-line stair-indent-lg">
    <span class="voice-roman">VITRIFIÉE.</span>
  </span>
</h1>
```

---

## 2. Split-Level Luxury Price & Comparison Lockup

Replaces plain text pricing (`$99.99 $139.99`) with an optical museum requisition price lockup:

```html
<div class="flex items-baseline gap-3">
  <span class="price-lockup text-3xl text-[var(--ink-primary)]" aria-label="$99.99">
    <span class="price-currency">$</span>
    <span class="price-integer">99</span>
    <span class="price-cents">99</span>
  </span>
  <span class="font-mono text-[0.65rem] tracking-[0.18em] line-through opacity-45 ot-tabular">
    SRP $139.99
  </span>
</div>
```

---

## 3. Rotating SVG `<textPath>` Editorial Colophon Seal

Pure vector typographic stamp that slowly rotates on the corner of hero photography or tear-out cards:

```html
<div class="relative w-28 h-28 select-none pointer-events-none">
  <svg viewBox="0 0 120 120" class="w-full h-full animate-[spin_24s_linear_infinite]">
    <defs>
      <path id="sealCirclePath" d="M 60, 60 m -46, 0 a 46,46 0 1,1 92,0 a 46,46 0 1,1 -92,0" />
    </defs>
    <text class="fill-current font-mono text-[7.2px] tracking-[0.26em] uppercase">
      <textPath href="#sealCirclePath" startOffset="0%">
        • BEETLES ATELIER • HEMA &amp; TPO FREE • ARCHIVE EDITION 2026
      </textPath>
    </text>
  </svg>
  <div class="absolute inset-0 flex items-center justify-center font-serif italic text-lg">
    N°9
  </div>
</div>
```

---

## 4. Chapter Opening with Architectural Drop Cap & Small-Caps Lead-In

```html
<p class="dropcap-architectural max-w-[50ch] text-[1.02rem] leading-[1.88] text-[var(--ink-secondary)]">
  <span class="ot-smallcaps-lead text-[var(--ink-primary)]">For nearly a decade</span>
  since its founding in 2017, the atelier has pursued a singular material obsession: how to suspend salon-grade cat-eye ferromagnetism and translucent vitrified pigment inside a zero-HEMA resin.
</p>
```
