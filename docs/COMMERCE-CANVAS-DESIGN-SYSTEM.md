# Commerce canvas: design system

A neutral, tool-like canvas where node content is the subject. Colour is used for three things only: node kind (icon
and a 2 px top bar), business status (semantic tones) and the single accent for primary actions and selection. There
are no gradients, glows or decorative illustrations.

## Tokens

All colour values live in the two token blocks at the top of `src/styles.css`
(`/* cn-tokens:light */` on `.cn`, `/* cn-tokens:dark */` on `.cn[data-theme=dark]`). `styles.css` and `canvas.css`
reference variables only; `test/canvas-tokens.test.mjs` fails on any colour literal outside the token blocks, on any
token missing a dark value, and on text, badge or kind colours below WCAG contrast.

| Group | Tokens |
|---|---|
| Surface | `--cn-canvas`, `--cn-grid`, `--cn-surface`, `--cn-surface-glass`, `--cn-surface-sunken` |
| Text and lines | `--cn-ink`, `--cn-muted`, `--cn-line`, `--cn-line-strong`, `--cn-edge` |
| Accent | `--cn-accent`, `--cn-accent-ink`, `--cn-focus` |
| Status tones | `--cn-tone-{green,blue,amber,red,muted}` and `-bg` |
| Kind colours | `--cn-kind-{factory,distributor,ai,service,product,channel,market,trade,neutral}` |
| Shape and depth | `--cn-radius-*`, `--cn-shadow-e1..e4`, `--cn-z-*`, `--cn-dur-*`, `--cn-ease` |

`--cn-paper`, `--cn-bg` and `--cn-soft` are aliases kept for the business dialogs.

The theme is chosen from the host: `data-theme` on the root follows the stored choice (auto, light, dark) and falls back
to `prefers-color-scheme`.

## Typography

Inter with PingFang SC and Microsoft YaHei, and a monospace face for ids, amounts and timestamps. Scale (size/line):
meta 10/14, aux 11/16, body 12/18, node title 13/20, panel 15/22, inspector 18/26. Body copy in Chinese keeps a line
height of at least 1.6; figures use tabular numerals.

## Components

| Component | Notes |
|---|---|
| Node card | 264 px; kind bar, 28 px kind icon, status badge, title (2 lines), summary (2 lines), optional thumbnail, evidence footer |
| Node level of detail | zoom below 0.45 shows a 184 x 56 compact card; 0.45 to 0.9 hides thumbnails; above shows everything |
| Ports | 8 px, 12 px on hover; valid targets are highlighted while connecting, invalid ones are greyed |
| Edge | 1.5 px; active (running) edges flow; label pills use a glass background |
| Toolbar, zoom, selection bar | glass surface, 32 px controls, groups separated by a 1 px rule |
| Search palette | input, kind and status chips, keyboard navigable results; non-matches fade to 25 % |
| Add menu | grouped capabilities; unavailable items stay visible with the reason |
| Inspector | 360 px drawer (bottom sheet below 700 px), four tabs: overview, relations, records, activity |
| Activity drawer | newest first, ids in monospace |
| Banners | info, success, warning, error, with the action the user can take |

Icons are Lucide at 1.5 px stroke (14, 16, 18 px). Every icon-only control has an `aria-label` and a tooltip.

## Accessibility

Focus ring 2 px with a 3 px offset on every control. Nodes are focusable and labelled with kind, title and status.
Canvas results are announced through a live region. Moving a node has a keyboard route (arrow keys, Shift for 8 px).
Starting a connection still requires dragging from a port; a keyboard or menu route for connecting is not built yet.
`prefers-reduced-motion` removes flow and sweep animations.
