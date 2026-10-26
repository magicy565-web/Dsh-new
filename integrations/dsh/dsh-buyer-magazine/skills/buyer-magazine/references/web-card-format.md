# Five-spread editorial business card

Use the canonical Studio issue with `composition: "web-card"`, a required `design`
object, 1–3 products/capabilities and this additional `webCard` object:

```json
{
  "tone": "Monocle/B2B-Craft",
  "archetype": "monocle",
  "issueTag": "品牌特刊 / 01",
  "locationStamp": "Actual evidenced location or an empty string",
  "pullQuote": {"text":"An issue-specific editorial thought","kind":"editorial","sourceIds":[]},
  "metrics": [{"value":"Source-backed value","label":"What it measures","sourceIds":["source-id"]}],
  "cta": {
    "title":"A concrete useful next step",
    "body":"What the visitor will actually receive or do",
    "label":"Action matching the actual destination",
    "mode":"contact-link",
    "url":"https://actual-company.example/contact",
    "sourceIds":["actual-contact-source"]
  }
}
```

The example URL is explanatory only; live output requires the actual destination.
Tone is one of Vogue/High-Fashion, Kinfolk/Minimalist, Monocle/B2B-Craft,
Architectural-Digest, Loewe/Monograph or 032c/Technical-Archive. Optional archetype
is kinfolk, loewe, monocle or archive032c. It changes supported typography/spacing/image composition in
the same renderer. Use `editorial` for authored pull quotes; `source` quotations
require evidence. Every metric requires source IDs. Omit unsupported metrics;
do not inherit demonstration MOQ, delivery, sampling or certification numbers.

`title` is the brand masthead; `cover` is the cover story and original hero image;
`editorNote` is the drop-cap lead. Up to three `products` become curated visual
cards. Their existing names, categories, summaries, buyerFit, specs, sources, images
and CTAs are actually bound to the template. `insights` supplies brief editorial
notes; sources and dataNotes retain evidence and attribution.

For a local inquiry-file interaction set cta.mode to `download-brief`, omit url
and use sourceIds `[]`. The form validates the visitor's name/company, email and
request, then downloads a text brief locally. It never claims to submit a lead.
Contact-link navigates to a real source-backed destination. No unimplemented
webhook, CRM sync, instant quote or mailing service is implied.

The file is one responsive HTML document with embedded CSS/JS. Product images
remain source URLs; it is not an offline image archive. A deliberately licensed
offline export is a separate capability. No Tailwind CDN or external font script
is required. There is one shared compiler, schema and native Session boundary.


The same responsive document contains five spreads: brand cover, quiet photographic
story, darkroom/material notes, interactive material study, and curated archive
with tear-out action. Visitors switch between scroll and flip modes; arrow keys
navigate in flip mode. Material selection, zoom, vellum notes and a brand vCard
are functional. The vCard includes only the recorded brand and website.

Optional `cover.headlineLines` contains 2–3 `{text, voice}` entries. Voice is roman,
italic or sans; their joined text must match `cover.headline` ignoring whitespace.
Chinese glyphs stay upright. Optional `webCard.craftStages` contains 1–5
`{title, body, sourceIds}` entries, each with actual evidence; otherwise real
product specifications fill the material notes. Do not invent a manufacturing story.

Review overview, both spreads batches (start 0 and 3) at width 1440 and 375,
then readingMode:flip captures, product cards and editorial.
Then review actual PDF page images via print, following nextPrintStart until null.
Any revision changes the artifact SHA and requires rechecking the affected views.
Screenshots must actually be inspected by the model; a returned status alone does
not establish visual quality. Mechanical browser checks cover all three widths;
inspect mobile screenshots separately for readability and visual hierarchy.
