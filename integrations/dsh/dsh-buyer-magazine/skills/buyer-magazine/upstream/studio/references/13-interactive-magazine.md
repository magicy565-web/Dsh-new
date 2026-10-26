# 13 · Interactive magazine

## Contract

**Input:** validated public issue data and the implemented reader interactions. **Output:** accessible stateful controls with useful no-script/email/print fallbacks. **Consumer:** reader and QA. Interaction should help a buyer inspect, compare and prepare; it should not obstruct reading.

## Specify state before styling

| Component | Entry and active state | Empty/limit/failure state | Exit and fallback |
| --- | --- | --- | --- |
| Category filter | All products visible; selected category reflects pressed state | Show a readable zero-results message if applicable | Reset to All; without JS all stories remain readable |
| Save shortlist | Save toggles product membership and updates count | Storage denied: keep session state and explain persistence limit | Unsave reverses; no server submission |
| Comparison | Select up to three distinct products | Fourth selection gives clear limit feedback; zero selection is explained | Remove/clear choices; close returns focus |
| Source drawer | Open the requested source context with labelled heading | Missing source is a data error, not a blank “verified” panel | Escape/close; focus returns to opening control |
| Request download | Export selected products, questions and citations | No selection gives an explicit instruction | Download is local preparation, not sending |
| Reading progress | Reflect document position without moving content | Short pages and resize remain bounded | No script: no progress bar needed |
| Print | Trigger browser print or use PDF CLI | Report generation failure without fake success | Static content preserves qualifications |

Use native buttons for actions and anchors for navigation. Give toggle actions an exposed state such as `aria-pressed`. Label icons with visible text or meaningful accessible names. Avoid clickable `div` elements.

## Make the source drawer a real dialog

Use the native `dialog` element with `showModal()` where supported, or implement the equivalent carefully. Move focus into the dialog, keep focus contained while modal, support Escape, include an explicit close button, and restore focus to the trigger. Ensure the title labels the dialog. Source links should have safe protocols and clear destinations.

For long evidence lists, focus a heading or the beginning of content rather than scrolling directly to the bottom action. Do not set broad descriptions that cause assistive technology to read an entire long table as one unstructured announcement. Primary pattern: [W3C modal dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

## Keep local state bounded and legible

Scope saved product IDs to the issue identity/version. Validate recovered local storage as data: discard unknown IDs, duplicates and malformed payloads. A changed issue must not display a saved count for products no longer present. Catch storage access errors; private browsing or quota failure must not disable the publication.

Do not store private quotes, buyer contact information, API keys or sensitive inquiry text in local storage. The shortlist is a convenience on that browser, not a cloud account or purchase reservation.

## Preserve semantic comparison

Comparison cells must include units, basis and unknown states. Use proper table headings and a caption. If the table scrolls on mobile, keep it within its own accessible region with an obvious horizontal-scroll affordance. Do not shrink text to fit three products onto a phone. Keep source and watchout information reachable.

If a product is filtered out while selected, keep the selection semantics consistent and visible in the shortlist. Do not silently lose the buyer's choices. Removing a product should immediately update counts and export content.

## Use motion to explain state

Use short opacity/transform transitions for opening panels or confirming a save. Respect `prefers-reduced-motion`; avoid essential information delivered only through animation. No autoplay audio, scroll hijacking, fake loading indicators, or automatic page flips.

Use generous control targets; 44 px is this product's design target. WCAG 2.2 minimum target-size requirements are more nuanced and include exceptions; do not claim this one dimension proves conformance. See [W3C target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

## Gate

Complete the journey with keyboard only: reach a product, save it, compare two, open a source, close with Escape, download a request and recover focus. Repeat at 375 px with reduced motion and unavailable local storage. Verify that downloads contain current selections and their qualifiers. Never show “Inquiry sent” after a file download.



## V1.3 implemented component states

- Cover CTA scrolls to the Buyer's desk. Nav jumps to the procurement index or dossiers; shortlist stays accessible on 375px by condensing nonessential anchor links.
- `ProcurementIndex` reflows from six-column table (desktop) into always-visible MOQ, lead time and quote cards (mobile), rather than requiring swiping to discover buyer-critical information.
- `EvidenceLedger` source rows activate the same accessible source dialog as inline citation chips; Escape closes the dialog and focus returns to the trigger.
- Shortlist is local to the buyer browser, capped at three. Two selected items allow compare; one selected item jumps to that dossier. Export is a Markdown draft; no message is sent.
- All controls must have keyboard focus indication; motion honors `prefers-reduced-motion`; default data may be loaded with JS disabled as a static complete publication.
- `theme-proof` is *editor-internal*, separate from public issue interactive controls; never imply buyers can change factual evidence by switching theme.
