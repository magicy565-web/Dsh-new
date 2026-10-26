# Attributed price-context patch — candidate.4

## Fixed output defects

1. A valid wholesale record with `price.minQty: 500`, `moq.value: 50` and a
   published price of 12 lost the 500-unit quote condition in comparison and
   downloaded inquiry drafts. Static summaries outside the full product facts
   also omitted that condition. Every price summary now retains wholesale
   `basis` and explicit `quote quantity basis: 500 units`, separate from MOQ.
   The product facts' existing independent quantity row is preserved.
2. The schema permits string amounts. `Number('25-30')` produced `NaN`, which
   `Intl.NumberFormat` displayed without throwing. String amounts are now kept
   as source text, with the declared currency appended; only number amounts use
   currency formatting. No range endpoint, numeric string, from-price, negative
   text or infinity text is interpreted as a numeric offer. Original schema
   trimming/blank rejection remains; numeric zero remains a valid sourced value.

Retail output says `retail reference only`; no wholesale condition is inferred
from retail `minQty`. Unknown/request-quote output remains `Request a project
quote`, never zero. The price source remains attributed data, not independently
verified commercial truth.

## Implementation and provenance

- Patched only the `priceText` helpers in `upstream/assets/magazine.js` and
  `upstream/src/render.js`; static tables/mobile cards/email use the latter.
- No schema change, dependency, service, application frontend, Host setting,
  permission change, collector or orchestration was introduced.
- `docs/upstream-provenance.json` preserves the original source ZIP SHA and each
  original member's `bytes`/`sha256`. Exactly two members additionally record
  `patch.bytes`, `patch.sha256`, reason and regression coverage. Unpatched members
  still match their original SHA. The hash test distinguishes these cases.
- The compiler comment and current wrapper tool map now acknowledge the patch.
  Original archived Skill reference documents remain unchanged.

## Verification

`node --test test/*.test.mjs`: **61 / 61 passed**, including 14 pure Node price
regressions for numeric/text/range/from/zero/blank/retail/wholesale/unknown and
markup-escape cases. Static wholesale context is checked in full product cards,
procurement index, mobile summary and email digest.

Optional source-checkout developer check (not runtime/default tests):

```sh
node dev/artifact-interactions.mjs
# For an isolated copy, resolve only already-installed root devDependencies:
node dev/artifact-interactions.mjs --dependency-root /absolute/existing/repository
```

**28 / 28 passed**, 25 synthetic DOM sessions, 0 external request attempts,
0 application JS runtime errors. No output file is written by the dev script;
its report is stdout. Missing jsdom yields an explicit error and never installs.
jsdom is not added to plugin runtime or default-test dependencies.

The dev check compiles an actual source-backed synthetic issue through the public
compiler, extracts the emitted script, confirms byte equality with the packaged
asset, then executes it unchanged in jsdom. It tests actual event handlers and
generated content, not a reimplemented model of the application.

Explicit test-only APIs: Blob/object URLs/anchor downloads capture Markdown,
MIME and filename without OS download or contact; timers are captured and the
revocation callback invoked deterministically; scrolling and reduced-motion
are minimal stubs. Network/resource APIs and outbound links are blocked. jsdom
uses the application's dialog fallback, not native browser top-layer semantics.
Normal storage, an explicit SecurityError and a genuine jsdom opaque-origin
SecurityError all preserve the page-local shortlist/compare/download fallback.

This is **DOM simulation, not browser/visual/Host acceptance**. No browser,
model, real Host, live enterprise data, image fetch, credential, install,
deployment or external contact was used. Images are null. Browser download
permissions, layout, focus-trap geometry and complete editorial/image workflow
remain unverified.

The one-product fixture used in the SDK check now compiles to **76,425
bytes**, SHA-256 `12cca2c32bf012a3bac444b4d3b120a5b34119991da4d04cefbd08704898d778`.
The final integrated candidate.4 was subsequently rerun with the existing official
SDK: 12 native dispatches, one 76,425-byte write and one official present event,
with same-content reuse preserving mtime/inode. The eight-group Skill discovery
fixture also passed. These remain synthetic contract tests, not live Host,
browser/visual, real download or production acceptance.
