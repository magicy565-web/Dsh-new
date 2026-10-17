# Brain document-reference integration: focused Host regression verified

## Baseline and scope

- Exact PR99 branch head rechecked through GitHub: `dbccbf9bc92221f7302410a192c1085e5956b00c`.
- Branch: `codex/omp-all-plugins-integration-20261017`.
- Only already reviewed `factoryMaterials.documents` pins enter the existing Brain source catalog.
- Reuses existing `SOURCE_SCHEMA` kind `artifact`. The reference ID is the Library document ID.
- Source values contain exactly `documentId`, `documentRevision`, `documentVersion`, `artifactId`, `artifactVersion`, and `artifactSha256`.
- Brain reference `sha256` hashes that metadata projection. `artifactSha256` is the original approved asset pin, not a new verification of physical file bytes.
- No document titles, body, parsed text, structured facts, credentials, or runtime data are projected.

## Existing authority and final checks

`library-model-read.mjs` exposes existing exact document pins only to the trusted in-process Host. With no selected documents, the previous Brain scope and scope hash are unchanged.

`goal-brain-host.mjs` resolves each selected document through the original `factoryDocumentForSession` in catalog, source-read, and current/commit paths. This retains the original live operator/admin Session, exact model recipient, workspace/subject, expiry, active document revision/version, and asset pin checks. A matching original Store snapshot supplies `updatedAt` and confirms the same document metadata at commit.

The original generic Brain capture, Artifact commit admission, and final OMP delivery revalidation remain unchanged. No profile, policy, memory store, source schema, Goal execution, or model destination is added. Existing adapter sources remain on their previous route when their artifact ID is not a selected document ID.

## Test design and actual execution

New `test/goal-brain-document-reference.test.mjs` uses the real `createLibraryModelRead` authority with synthetic Library records and the existing test-only SQLite Artifact facade. It covers:

1. Same-business Context save → Decision save/read → existing reviewed Goal, exact six-field metadata, no document byte reads, no Goal mutation or executable authority.
2. Unselected/disabled scope; unchanged scope hash without document selection.
3. Exact IDs, revision, field mask, and metadata digest.
4. Ordinary document revision/version/archive and asset version/SHA changes.
5. Live Session revocation, role change, expiry, mismatched model/destination, and viewer refusal.
6. Ordinary update or revocation rechecked at the original Artifact commit admission.
7. Existing configured adapter artifact sources retain their route, with or without document selection.
8. Same-asset aliases are refused rather than substituting another document.
9. A divergent commit snapshot is refused even when the original Library accessor still returns its pinned document.

### Isolated server-side execution, 2026-10-17

The complete exact-baseline source bundle was verified and tested in a fresh temporary directory, separate from the running service. Real Node 24.19.0 and the original lockfile's `@earendil-works/pi-ai` 1.1.0 were used. `npm ci` exited 0; original `package.json` and `package-lock.json` hashes were unchanged before and after installation.

The original Host and original Library permission class ran against synthetic Store/Library/Goal records and the existing test-only SQLite Artifact facade. All 19 new tests (nine top-level tests plus ten subtests) and all 24 existing focused regression tests executed: **43 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo; exit 0; 510.975 ms**.

The command below uses `$TESTROOT` for the fresh extracted bundle directory; the temporary directory name is omitted. The script executes exactly the seven listed test files under an empty environment and isolated HOME:

```sh
env -i \
  PATH=/opt/workspace-acceptance-20261017/node-v24.19.0-linux-x64/bin:/usr/bin:/bin \
  HOME="$TESTROOT/verification-home" NO_COLOR=1 \
  bash "$TESTROOT/run-focused-tests.sh"

# Exact Node test selection inside the script:
node --test \
  test/goal-brain-document-reference.test.mjs \
  test/business-brain-product-completeness.test.mjs \
  test/business-brain-observations.test.mjs \
  test/goal-brain-product-source.test.mjs \
  test/business-brain-pulse.test.mjs \
  test/business-signals.test.mjs \
  test/decision-planner.test.mjs
```

Evidence hashes (evidence bodies and runtime data are not committed):

- Tested source archive SHA256: `a7efb8ea8967089a98d81a35694ca1c331af9bc16a48bc1e90edb60433928410`.
- `SOURCE_MANIFEST.json` SHA256: `d44848012e90b12801c8f22b1cc90e05acabc7ee30a61d4e18474b7b3075585c`.
- `focused-tests.log` SHA256: `439b949ec7a65c25814d19aa92505364c1ebf86e5c20aae0be23993b8445abe6`.
- `verify-source.mjs` before and after execution: exit 0, 1,237 files verified against exact dbccbf9 plus the four declared changes.
- Tested `server/library-model-read.mjs` SHA256: `5992fbd3f5826175d7e3a153b4de04ab152159bf75762296b1d897571200bf8d`.
- Tested `server/goal-brain-host.mjs` SHA256: `dc58a87b9f94deace6653821ab18d99fcc9f68bea52130a6a2d0c5f7d1151b74`.
- Tested `test/goal-brain-document-reference.test.mjs` SHA256: `07ed37d148ab677531545381bb14188d30bb61874840d1efdaf0786762a346d3`.

Only this acceptance note was updated after the isolated run. The implementation and test files remain byte-identical to the verified bundle. Earlier local syntax checks and patch dry-run also passed. The earlier local new-test attempt stopped at import because exact dependencies were unavailable and official npm requests returned `EAI_AGAIN`; that failed attempt was never counted as a test pass, and no old package or dependency stub was substituted.

This verifies focused Node/Host behavior and the original permission class with synthetic records. It does **not** establish native OMP/SDK end-to-end acceptance, a real-model run, real enterprise document processing, or production deployment. No historical receipt-restoration security review, full test suite, model call, enterprise runtime-data read, or deployment was performed for this change.

## Retained boundaries

- Existing Brain limit: at most 24 total source references. No silent truncation or schema widening.
- The original asset-to-document authority selects the first approved document for an identical asset pin. If another selected document aliases that asset, an ID mismatch is rejected; this change does not substitute the first document or add alias support.
- This is an authorized reference-metadata projection. It does not establish physical file availability, byte integrity, document validity, or factual/certification truth.
