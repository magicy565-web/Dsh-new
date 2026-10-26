# 12 · Magazine layout engine

## Contract

**Input:** validated issue JSON, art direction and typography rules. **Output:** semantic responsive magazine HTML and a static email digest. **Consumer:** publishing and QA. Compose from useful editorial modules; do not invent a new page layout for every SKU.

## Use the implemented component vocabulary

| Component | Responsibility | Required information |
| --- | --- | --- |
| IssueMasthead | Publication identity and date | Title, edition, date, category/market |
| CoverStory | Lead editorial angle | Headline, deck, truthful image role |
| QuickSignals | Fast orientation | Up to three concrete signals |
| ProductFeature | A product-level buying decision | Identity, summary, buyer fit, watchout |
| ProcurementFacts | Scannable purchasing facts | Price basis, MOQ, lead time, selected specifications |
| EvidenceChip | Open source context | Source reference and honest status |
| SourceDrawer | Inspect supporting pages | Titles, URLs, publishers, capture dates |
| ShortlistDock | Reflect local reader choices | Count, clear actions, state feedback |
| ComparisonTable | Compare like-for-like | Shared field semantics and visible unknowns |
| RequestBriefDownload | Prepare an explicit local next step | Selected products, open questions, sources |
| EditorialNotes | Explain scope and limits | Data notes, sponsorship, demo disclosure |
| EmailDigest | Carry a static excerpt | Key story, concise facts, working links |

The names describe the renderer's component responsibilities; the current API renders complete HTML rather than exporting each component as a framework package.

## Build procurement rows from semantics

Use the exact issue schema. A specification contains a stable `key`, readable `label`, value, optional unit, status, source IDs, and visibility. Keep display label changes from altering the row's meaning. Exclude restricted rows before generating public artifacts.

For a three-product comparison, begin with identity and price basis, then MOQ, production lead time, category-specific differentiators, unresolved question, and source. Never hide missing terms by omitting the row from just one product.

| Field | Product A | Product B | Product C |
| --- | --- | --- | --- |
| Price basis | Retail listing | Quote required | Not disclosed |
| MOQ | Not disclosed | 500 units · sourced scope | Not disclosed |
| Production lead time | Not disclosed | Supplier states 30 days | Not disclosed |

This is a schema illustration, not real supplier data. The design makes uncertainty comparable rather than pretending every product has a quote.

## Apply hierarchy at three widths

At wide widths, use a 12-column editorial grid with a clear lead image and reading column. Keep related data aligned. At tablet widths, reduce optional sidebars and allow the lead to become a simpler split. At phone widths, use a single natural sequence; comparison may have its own labelled horizontal scroll region, but normal prose must reflow.

Keep the page max-width near 1280 px and use generous section rhythm. Avoid fixed card heights that clip longer supplier names or unknown-term explanations. Use content-driven height and consistent internal alignment.

## Decide what belongs in the first view

Place product category, product name, main visual, buyer rationale and key purchase terms near each other. Source access should be visible, but not dominate the lead headline. Show “Not disclosed” where needed. Do not make a buyer open a modal to learn whether a price is retail or wholesale.

Keep one primary action per feature. Secondary save/compare/evidence controls should be quieter, sufficiently large and clearly labelled. Do not turn the publication into a toolbar wrapped around tiny content.

## Design empty, long and failure content

Test very long product and supplier names, one product, six products, all trade terms unknown, no permitted image, one broken image, no insights, one sponsored product, and a source list with long URLs. Empty optional sections should disappear cleanly; missing essential facts should remain explicit.

Truncate only nonessential preview text with a way to access the complete text. Never ellipsize technical model identifiers, units, price bases or important uncertainty notes.

## Implement email as its own surface

Use semantic content in a table-based or otherwise broadly compatible static structure with inline styles. Do not embed JavaScript, forms, modal controls or fake compare buttons. Preserve real links and sponsor/demo disclosures. Plain-text output must carry the same essential meaning. Rendering in a browser is not proof of compatibility with every email client.

## Gate

Check both content and layout. A beautifully aligned comparison is invalid if row meanings differ. Reject hidden material terms, fictitious UI actions, whole-page overflow, and private information left in inline state. Use the real data model throughout; avoid copying numbers manually into HTML.



## V1.3 source-linked layout composition

Use the implemented sequence: **Cover → Buyer's desk → Quick signals → Editor note → Procurement index → Product dossiers → Decision → Buyer's margin → Evidence ledger**. This sequence is stable across all archetypes so a buyer need not re-learn navigation from issue to issue.

`BuyerDesk` displays the exact number of products, source links and disclosed trade fields computed from the issue; it is not a quality score. `ProcurementIndex` is a desktop comparison table with a mobile card fallback. `EvidenceLedger` makes original sources and capture dates a full editorial moment, not a buried legal footnote. Unknown values remain first-class content, even when they make the layout less visually symmetrical.

For a one-product enterprise issue, keep the lead dossier, one complete trade card and a source-ledger spread; do not pad it with two invented companion products. For three actual products, keep their common fields aligned. Reading time is based on body words, CJK characters and 15 seconds per product, with hard cap enforced upstream.

Use `buyer-magazine theme-proof` to compare the four styles on *the same* `issue.json`. Choose one only after checking 390px and 1440px and verifying factual data survives unchanged.
