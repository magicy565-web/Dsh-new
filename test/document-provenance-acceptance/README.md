# Document provenance acceptance — 2026-10-18

Fixed source: `da04f977535b724d2ea22077f80670f1962b4f39`. Node **24**.
All inputs are marked synthetic. The generated PDF/CSV exercise transport;
the loopback HTTP server supplies finite Docling-shaped responses. They do
not prove OCR, table recognition, real Docling compatibility or model quality.

Run the three **existing-contract** boundaries from the checkout:

```sh
node test/document-provenance-acceptance/run.mjs
```

An existing-contract assertion or missing project dependency produces a nonzero
result, with no skip/stub substitution. The default runner excludes unapproved
policy candidates. In this environment the upload suite remains import-blocked;
the runnable contract boundaries pass. This is not complete upload acceptance.

Run individual boundaries:

```sh
node --test test/document-provenance-acceptance/adapter-host.test.mjs
node --test test/document-provenance-acceptance/cross-document-regression.test.mjs
node --test test/document-provenance-acceptance/upload-library.test.mjs
```

The first two need only Node's built-ins plus actual repository modules.
The historically named `cross-document-regression.test.mjs` now characterizes
the actual contract: A's classification target and B's evidence remain distinct,
and multiple source fragments for one field are preserved. Its old assertion
that they must be equal was an unapproved policy, not a production regression.
`adapter-host` uses the real Host, source proof/body screening, transport and
Store, with an explicitly synthetic identity/Library-authority callback.
It does **not** stand in for actual `createLibraryModelRead` acceptance.

`upload-library` requires the root's unchanged lock-installed dependencies.
It uses the existing signed-Session test helper and actual application HTTP,
Artifact/Library services and permission class. Its provider is the existing
finite fixture; it never submits a model task or launches Bun/OMP. The source
reader is a test-only composition of the existing Host parse/check methods.
The explicit synthetic `canSave` is an intake-intent prerequisite; this is not
an original business Run/SDK/AgentSession end-to-end test. Four test bodies are
prepared; all remained unexecuted here because dependency imports failed.
The first test now also prepares a real saved-report/query assertion that B's
evidence index, quote and asset remain B's. That added assertion is unexecuted
too; the source trace in the report is static evidence, not a disk test pass.

The former stricter assertion is retained **only as an unapproved product policy
candidate**, outside this directory's explicit default `run.mjs` selection:

```sh
node --test test/document-provenance-acceptance/policy-candidates/document-same-source.mjs
```

It exits 1 on the baseline because current code permits cross-source evidence.
That result does not establish a contract violation, unauthorized disclosure or
an incorrect Library write. There is no recommendation to enforce this rule.
The original red command at commit `45780e1b312118187955543697c0b98a2bcd353a`
was `node --test test/document-provenance-acceptance/cross-document-regression.test.mjs`;
its 0-pass/1-fail record is preserved in the report as policy-proposal history.

For an isolated locked installation without touching the working tree:

```sh
# Run from repository root. Replace REVIEW_ROOT with a fresh /tmp directory.
REVIEW_ROOT=$(mktemp -d /tmp/document-provenance-review.XXXXXX)
mkdir -p "$REVIEW_ROOT/source" "$REVIEW_ROOT/home"
git archive da04f977535b724d2ea22077f80670f1962b4f39 | tar -x -C "$REVIEW_ROOT/source"
mkdir -p "$REVIEW_ROOT/source/test/document-provenance-acceptance"
cp test/document-provenance-acceptance/*.mjs "$REVIEW_ROOT/source/test/document-provenance-acceptance/"
env -i PATH="$PATH" HOME="$REVIEW_ROOT/home" \
  npm_config_cache="$REVIEW_ROOT/npm-cache" \
  npm_config_userconfig="$REVIEW_ROOT/empty.npmrc" \
  npm_config_globalconfig="$REVIEW_ROOT/global.npmrc" \
  npm ci --prefix "$REVIEW_ROOT/source" --ignore-scripts --no-audit --no-fund \
  --fetch-retries=0 --fetch-timeout=20000
env -i PATH="$PATH" HOME="$REVIEW_ROOT/home" NO_COLOR=1 \
  node "$REVIEW_ROOT/source/test/document-provenance-acceptance/run.mjs"
```

Run the last command only after a successful install when seeking full-chain
evidence. An install failure remains a blocker, never dependency acceptance.
No root package/lock, production source or shared loader changes are required.

See `docs/DOCUMENT-PROVENANCE-ACCEPTANCE-20261018.md` for actual results,
the corrected contract/policy distinction, preserved original failure record,
and the limits of the evidence.
