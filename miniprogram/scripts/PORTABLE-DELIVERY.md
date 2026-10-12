# Portable source and WeChat import checkpoints

These separate Python 3 tools support a recovered checkout whose historical
archive/evidence blobs are unavailable. They do not change
`package-fixed-combination.py` or `verify-fixed-delivery.py`, whose full-tree
requirements still apply.

## What is and is not delivered

- Select an immutable full 40-character Git SHA-1. Both manifests name that exact
  `sourceCommit` and `sourceTree`; GitHub's fixed commit remains canonical.
- Include every tracked source/config/test/document path except these explicit
  historical prefixes: `deliverables/`, `docs/screenshots/`, `docs/validation/`,
  `miniprogram/deliverables/`, `miniprogram/evidence/`,
  `miniprogram/integration-checkpoints/`, `tui/validation/`, and `release/`.
- Explicit required-inclusion override:
  `docs/validation/managed-commerce-sources.json`. This is a current automated
  test input and must remain in the source ZIP.
- Every omitted path, mode, Git blob ID and prefix-based reason is recorded in
  both manifests. Missing local files never determine exclusion policy.
- Every included working file must exist and match the selected Git blob and
  mode exactly. Untracked files are never collected. Local edits must first be
  reviewed and committed; omitted historical blobs need not exist locally.
- `exactGitTree=false`. The package cannot reconstruct omitted file contents or
  original history. Tree metadata verification is not full-tree reconstruction.
- The import ZIP contains only the compiled client layout derived from tracked
  `miniprogram/src/`, plus the generated project/package configurations. Copied
  assets must match selected source bytes. No server, dependencies or test files
  are copied into the import ZIP.
- Client defaults must remain `touristappid`, `urlCheck=true`, blank `baseUrl`.
  This does not prove real WeChat/device/account, Shopify, or deployment readiness.

The tools reject symlinks, non-regular files, unsafe modes, traversal, duplicate
or case-colliding paths, unexpected client outputs, common private/runtime paths
and recognizable credential material. Secret-pattern checks are defense in
depth, not a substitute for reviewing tracked source; do not commit credentials
or private runtime data in the first place. `.env.example` is allowed.

## Produce a package after source freeze

Prerequisites: Python 3 standard library, local Git commit/tree metadata, all
included source files, Node 24+ and an existing pinned dependency install to
build the project. Packaging itself does not access the network or run a build.

From the repository root, clean-build the selected committed source before
packaging. Use new disposable build/output directories; do not overwrite
another checkpoint or deliver an unreviewed working-tree change.

```sh
SOURCE_COMMIT=$(git rev-parse HEAD)
npm run build
npm run build:mini
python3 miniprogram/scripts/package-portable-checkpoint.py \
  --repository "$PWD" \
  --commit "$SOURCE_COMMIT" \
  --compiled "$PWD/release/miniprogram" \
  --output /tmp/workspace-portable-checkpoint
```

`build:mini` does not remove old outputs itself. Start with a clean
`release/miniprogram` and `.mini-build` directory; otherwise stale files may
correctly cause packaging to fail. Do not use old historical ZIPs as this client.

The new output directory contains:

- `Workspace-Agent-Portable-Source-<12-char-sha>.zip`
- `Workspace-Agent-Portable-WeChat-Import-<12-char-sha>.zip`
- `EXPECTED-GIT-TREE.json`, `SOURCE-MANIFEST.json`, `BUILD-MANIFEST.json`
- `PORTABLE-VERSION.json` and `SHA256SUMS.txt`

The source ZIP includes `Workspace-Agent/`, its manifest, the raw original
commit object and a delivery README. The import ZIP has `project.config.json`
at its root. All archive bytes/modes are deterministic for identical inputs.
Keep the full source commit and client ZIP SHA-256 in a separately trusted
handoff record. A client checksum obtained only from an untrusted replacement
package cannot authenticate that package.

## Verify before importing or extracting

Supply the source commit verified separately against GitHub and the client ZIP
checksum recorded at packaging. The expected-tree file is cryptographically
checked against the original commit and pinned SHA, not blindly trusted.

```sh
python3 miniprogram/scripts/verify-portable-checkpoint.py \
  --source /tmp/workspace-portable-checkpoint/Workspace-Agent-Portable-Source-<sha>.zip \
  --client /tmp/workspace-portable-checkpoint/Workspace-Agent-Portable-WeChat-Import-<sha>.zip \
  --expected-tree /tmp/workspace-portable-checkpoint/EXPECTED-GIT-TREE.json \
  --commit <full-source-commit> \
  --client-sha256 <trusted-client-zip-sha256> \
  --destination /tmp/workspace-portable-verified \
  --record /tmp/workspace-portable-verification.json
```

Omit `--destination` for verification without extraction. Destination and report
paths must be new. All archive entries and metadata are validated before any
extraction. Source files appear under `source/Workspace-Agent/`; import files
appear under `client/`. The verifier does not create a `.git` directory.

It checks exact included paths/blobs/modes, every exclusion record and reason,
SHA-256/length/mode records, both source identities, safety metadata, safe client
configuration, copied assets, and the trusted client ZIP hash. It rejects
unlisted/missing/tampered entries. Resource limits are 20,000 entries, 64 MiB per
file and 512 MiB total expanded content per ZIP.

The report deliberately says `exactGitTreeReconstructed=false` and
`compiledEquivalenceVerified=false`. Matching a supplied compiled ZIP to its
hash does not prove that JavaScript was compiled from that source. Establish
that separately by building the extracted source in a clean environment using
its lockfile, then comparing the client bytes, for example:

```sh
cd /tmp/workspace-portable-verified/source/Workspace-Agent
npm ci --ignore-scripts
npm run build
npm run build:mini
diff -rq --exclude=BUILD-MANIFEST.json --exclude=IMPORT-README.txt \
  release/miniprogram /tmp/workspace-portable-verified/client
```

A successful comparison checks generated bytes; real platform acceptance still
requires the owner's existing account configuration and authorized live checks.

## Offline regression tests

```sh
python3 -m unittest discover -s miniprogram/test -p 'test_portable_delivery.py' -v
```

Fixtures use temporary Git repositories, remove historical file contents and
Git blob objects, and exercise both CLI entry points. No account, API,
credential, deployment, browser or network access is used.
