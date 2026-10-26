# Magazine Archetypes & Parametric Design Tokens

Use this reference to select and configure the exact visual DNA, color palette, bilingual typography stack, and layout rules for any project.

---

## 1. Domain-to-Archetype Routing Matrix

| Project / Industry Domain | Recommended Archetype | Primary Visual Mechanism | Border Strategy |
| :--- | :--- | :--- | :--- |
| **Luxury, Lifestyle, Home, Skincare, Handcrafted DTC** | **Archetype A: Slow-Living Lookbook** (*Kinfolk / Cereal*) | 50%+ warm cotton whitespace + 100% full-bleed natural light photography | **Zero grid borders** (`0px` hairlines; separate by whitespace only) |
| **Fashion, Art Portfolio, Game/Character Artbook, Exhibition** | **Archetype B: Avant-Garde Monograph** (*Vogue Italia / Loewe*) | `10vw` overlapping display serifs + tilted Polaroid collage + hollow numerals | **Asymmetric floating frames** (white photo mats + negative-margin bleed) |
| **B2B Supply Chain, FinTech, Trade Intelligence, Whitepapers** | **Archetype C: Global Broadsheet** (*Monocle / Financial Times*) | Multi-column Swiss grid + archival index tables + data monographs | **Exposed `1px solid` hairlines** (`--rule-hairline`) dividing columns |
| **AI Hardware, Audio Gear, Developer Tools, Robotics** | **Archetype D: Technical Archive** (*032c / Teenage Engineering*) | Brutalist spec sheets + X-ray blueprint layers + monospace telemetry | **Technical registration marks** (`+` corner crosshairs + dashed callouts) |

---

## 2. CSS Custom Property Presets by Archetype

### Archetype A: Slow-Living Lookbook (`Kinfolk` / `Cereal` / `Aesop`)

```css
:root[data-archetype="kinfolk"] {
  --paper-primary: #F4F0EA;      /* Unbleached warm cotton */
  --paper-secondary: #EAE3D5;    /* Raw oat pulp */
  --paper-darkroom: #141312;     /* Espresso darkroom spread */
  --ink-primary: #161514;        /* Deep charcoal ink */
  --ink-secondary: #5C574F;      /* Warm graphite */
  --ink-muted: #8C857B;          /* Dry stone caption */
  --ink-spot: #9E3B24;           /* Terracotta / Cinnabar seal */
  --rule-hairline: rgba(22, 21, 20, 0.08);
  --font-display: 'Cormorant Garamond', 'Noto Serif SC', Georgia, serif;
  --font-editorial: 'Newsreader', 'Noto Serif SC', serif;
  --font-mono: 'JetBrains Mono', monospace;
}
```

### Archetype B: Avant-Garde Fashion Monograph (`Vogue Italia` / `Loewe` / `Acne Paper`)

```css
:root[data-archetype="loewe"] {
  --paper-primary: #F7F6F2;      /* Gallery museum rag */
  --paper-secondary: #ECE9E1;    /* Warm archive board */
  --paper-darkroom: #0D0D0D;     /* Pure silver-gelatin black */
  --ink-primary: #0F0F0F;        /* High-density carbon black */
  --ink-secondary: #4A4845;      /* Studio ash */
  --ink-muted: #7D7A74;          /* Neutral pewter */
  --ink-spot: #C8281E;           /* Editorial scarlet */
  --rule-hairline: rgba(15, 15, 15, 0.12);
  --font-display: 'Playfair Display', 'Bodoni Moda', 'Noto Serif SC', serif;
  --font-editorial: 'Cormorant Garamond', 'Noto Serif SC', serif;
  --font-mono: 'Space Mono', 'JetBrains Mono', monospace;
}
```

### Archetype C: Global Intelligence Broadsheet (`Monocle` / `Financial Times`)

```css
:root[data-archetype="monocle"] {
  --paper-primary: #F6ECE1;      /* Classic salmon-ivory broadsheet */
  --paper-secondary: #EBDCCB;    /* Aged dossier manila */
  --paper-darkroom: #141B24;     /* Diplomatic midnight navy */
  --ink-primary: #141413;        /* Rotary press black */
  --ink-secondary: #4A4640;      /* Editorial slate */
  --ink-muted: #787167;          /* Archival index gray */
  --ink-spot: #B8860B;           /* Monocle brass / ochre accent */
  --rule-hairline: #D4C5B4;      /* Crisp visible 1px column rule */
  --font-display: 'Instrument Serif', 'Playfair Display', 'Noto Serif SC', serif;
  --font-editorial: 'Plus Jakarta Sans', 'Noto Sans SC', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}
```

### Archetype D: Industrial Technical Archive (`032c` / `Teenage Engineering`)

```css
:root[data-archetype="archive032c"] {
  --paper-primary: #EBEAE6;      /* Industrial gray cardstock */
  --paper-secondary: #DCDAD3;    /* Punched binder board */
  --paper-darkroom: #0E0F11;     /* Anodized aluminum black */
  --ink-primary: #111111;        /* Technical India ink */
  --ink-secondary: #45474A;      /* Machined steel */
  --ink-muted: #73767A;          /* Spec label gray */
  --ink-spot: #FF3B00;           /* 032c / TE fluorescent vermilion */
  --rule-hairline: #C4C2BA;      /* Blueprint grid hairline */
  --font-display: 'Cormorant Garamond', 'Noto Serif SC', serif;
  --font-editorial: 'Inter Tight', 'Noto Sans SC', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}
```

---

## 3. Typographic Scale & Pacing Formulas

Never use flat, uniform font sizes. Enforce extreme contrast between display headlines, body prose, and archival metadata:

1. **Cover Masthead / Spread Hero Display**:
   - Size: `clamp(3.75rem, 8.5vw, 7.5rem)`
   - Line height: `0.88` to `0.94`
   - Letter spacing: `-0.03em`
   - Styling: Mix Roman upright words with *Italic* emphasis words in the same headline.

2. **Section / Spread Lead Title**:
   - Size: `clamp(2.25rem, 4.2vw, 3.8rem)`
   - Line height: `1.06`
   - Pairing: Precede with a tiny monospace folio kicker (`0.65rem`, `letter-spacing: 0.25em`, uppercase).

3. **Editorial Pull Quote**:
   - Size: `clamp(1.4rem, 2.4vw, 2.15rem)`
   - Style: Italic display serif, framed either by generous whitespace (Archetypes A/B) or a `2px solid var(--ink-primary)` top rule (Archetype C).

4. **Editorial Body Copy**:
   - Size: `0.95rem` to `1.05rem` (`15.2px` to `16.8px`)
   - Line height: `1.85` (English) / `1.95` (Chinese)
   - Measure: Strictly `42ch` to `56ch`.
   - Drop Cap: First paragraph of major spreads uses a `3.6rem` float-left serif initial spanning 3 lines.

5. **Archival Marginalia & Plate Captions**:
   - Size: `0.62rem` to `0.72rem` (`10px` to `11.5px`)
   - Font: `var(--font-mono)`
   - Letter spacing: `0.2em` to `0.28em` uppercase
   - Content: Always include concrete catalog metadata such as `[ PLATE III - 30.2741 N, 120.1551 E - ARCHIVE REF 2026-04 ]`.
