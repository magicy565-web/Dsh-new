# Artifact upload boundary correction

Parent: `011db78f1bc17044d3c9fe23b8ea8ed09c0584b3`.

The original repeated-group base64 regular expression raises Node `RangeError`
on legitimate near-maximum uploads. The PR115 author reported the same failure
through both direct and proxied HTTP. The independent reviewer reproduced the
regular-expression failure in memory; the service red/green tests below locate
it in artifact decoding rather than proxy permissions.

The production change removes only this redundant regular expression. The
existing encoded-length cap, exact `Buffer.from(value, 'base64').toString('base64')
=== value` canonical check, decoded 5 MiB cap, text validation and binary MIME
signature checks remain. Decoding alone is not admission. Exact canonical
round-trip rejects alternate alphabet, whitespace, invalid/missing/excess
padding, nonzero pad bits and data URL prefixes.

## Executed locally

Node `v24.19.0`, real original `openStore` and `createArtifactService`, new empty
temporary directories and synthetic inert bytes. No HTTP server, proxy, model,
external service, installed replacement dependency or production data is used.

```
node --test test/artifacts-base64-boundary.test.mjs
node --test --test-name-pattern='^(uploads enforce|base64 binary)' test/artifacts.test.mjs
node --check server/artifacts.mjs
node --check test/artifacts-base64-boundary.test.mjs
```

The unchanged new test file against original production source: **2 pass, 4
fail**, exit 1. Three valid binary lengths (5 MiB minus 2, minus 1 and exactly
5 MiB) and the decoded-overflow case hit the original regular expression stack
failure. Against corrected source: **6/6**, exit 0, 556.824367 ms. The selected
two original encoding/binary cases also pass. Other original tests were not
selected and are not claimed as passes.

Coverage includes all three canonical padding endings at the maximum, exact
downloaded bytes and SHA-256, empty and short canonical text, malformed alphabet,
padding, pad bits, whitespace and URL prefixes, plus both encoded-size and
decoded-size overflow with the original 413 code and no persisted artifact.

The PR115 author's 48/49 HTTP result is prior evidence, not a corrected HTTP
pass. Integrated signed-ingress maximum-upload validation and production
deployment remain separate gates. This change does not alter authorization,
recipient/model disclosure, request-body limits or any receipt recovery path.
