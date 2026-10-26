# Traceable editorial and visual acceptance

Maintain a private sidecar production record, separate from schema-valid issue
JSON. It should be concise and contain actual decisions/results, not just copied
checklist headings. A plan is not a completed observation.

## Required production record

| Stage | Minimum recorded evidence |
| --- | --- |
| Brief / identity | Reader, category, market, decision, language/surface; assumptions; concrete voice and visual recipe (Studio 03/05). |
| Research | Actual collection tool; source IDs/URLs/files and observation times; product-to-source map; admitted/unknown/conflicting facts; image availability and rights evidence (01/02/04). |
| Edit | Editorial question and angle; selected and excluded products with reasons; issue-specific contrast and questions; reading budget; reference to the completed original editorial plan (05/06). |
| Storyboard | Section order, distinct reader question and intended emphasis per section; what the opening screen must communicate; static fallback for each interaction (07/12). |
| Images | Each proposed image's product/variant, documentary/editorial role, original source, rights basis/evidence, crop/focal point, alt/caption, mobile behavior and acceptance decision. Explicitly state unavailable/no-image where applicable (08/09/10). |
| Typography | Chosen actual font stack and fallback, headline/body/data roles, quantity/price qualifiers, wrapping/zoom/narrow-screen observations; no claim that preferred fonts are bundled (11). |
| Theme | At least two genuinely rendered theme directions when comparison is needed; identical-fact check, narrow/wide observations, selection reason and artifact pointers. If only one is possible, record why and the missing comparison rather than claim it passed (08/12). |
| Compile / present | Exact tool names and outcomes, immutable issue/output identity or SHA, warnings, generated file and separate present result. Never report a future intended call as performed (15). |
| QA / release | Each required check: observed environment/surface, result `passed`/`failed`/`not-run`/`blocked`/`not-applicable`, evidence pointer, defect/fix, reviewer, and release decision (16). |

Use truthful timestamps. Reusing original sources does not reset their capture
time. Record user-approved assumptions and limitations without copying credentials
or full private source content into the sidecar. Public output never includes
restricted procurement data.

## Gates and stopping conditions

### 1. Evidence and editorial gate

- Product identity, variants, claims and purchase terms match the cited evidence.
  Supplier statements remain supplier-stated; retail is not wholesale; uncertainty
  and contradictions remain visible. No filler SKU, unverifiable certification,
  invented image permission or unsupported claim is admitted.
- Read the issue without imagery and by headings alone: the buyer's decision,
  meaningful differences and next questions must still be clear. Generic praise
  and interchangeable buyer-fit text require editing, not a new theme.

### 2. Image and art-direction gate

- A documentary photograph identifies the correct SKU/variant and has a recorded
  reuse basis. Inspect originals and final crops; generated art must be visibly
  labelled and must not substitute for evidence.
- Inspect the first screen at thumbnail and reading sizes: product/category and
  editorial angle must be recognizable. A large `THE RECORD` fallback means
  photography is missing; it is not an accepted product cover merely because it
  is intentional template behavior.
- Compare genuinely rendered styles when required; inspect product framing,
  emphasis, captions and procurement hierarchy. Inspect one missing/broken-image
  case. Remote image loading and offline portability are separate checks.
- If there are no permitted images, preserve a clearly labelled **draft**. An
  explicitly requested text-led edition may have a deliberate alternative design
  brief, but cannot be silently declared visually complete from the generic
  fallback. Missing visual evidence is a blocker, not a right to fabricate assets.

### 3. Actual reader-journey gate

- Inspect full-page output at 375, 768 and 1440 px (or document justified actual
  equivalents), fallback fonts and 200% text zoom where supported. Check heading
  wraps, body size, contrast, units/price basis, tables/cards, clipped text and
  page-wide overflow. A single first-screen screenshot is insufficient.
- Test applicable filter, save/remove, comparison, source modal/keyboard/Escape,
  inquiry download contents, reload/local-state isolation, storage-denied fallback
  and reduced-motion states. For a two-product issue, do not invent a third/fourth
  product to claim the three-item limit was tested; use a separate labelled fixture
  only when that boundary is relevant and permitted.
- Review print/email only if promised or produced. Mark unsupported output
  surfaces not applicable; never imply their compatibility from HTML checks.
- Do not send inquiries as a test. Do not launch prohibited browsers or install
  dependencies to force a pass. Record blocked checks and keep the output a draft.

### 4. Delivery and status gate

`compiled-draft`: validation/compilation passed, but required editorial or visual
checks remain incomplete. **This is the maximum status for a generic no-image
fallback or unobserved visual output.**

`review-ready-draft`: evidence/editorial decisions and artifacts are complete and
ready for the declared reviewer; material open QA is explicitly listed. This is
not `final-ready`.

`final-ready-for-requested-surface`: evidence, issue-specific design and actual
visual/interactive gates are passed, all blocking defects resolved, and the
requested artifact is intact. Record who reviewed what and the relevant version.
This is an editorial release assessment, not an authorization to send/publish or
remove the native generator's draft-only banner.

`presented`: independently record the official presentation tool's observed
result. A magazine can be presented as a draft; presentation does not raise its
editorial status. Conversely, passing editorial review is not proof of present.

Stop when the requested surface's gates are observed and delivery status is known,
or when a specific missing input/authorization/tool blocks progress. Report the
exact action, target and reason plus completed work; do not repeatedly re-run an
unavailable operation or invent unrelated infrastructure.
