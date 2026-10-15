# Occurrence-safe local tool pairing — 2026-10-15

Patch base: `b1b87632a0d7ebc34a84a623658e060671cac480`.
Independent branch: `codex/omp-context-pairing-20261015`.

## Reproduced boundary

The audit hypothesis was reproduced offline before changing source. Two user
turns read different selected inputs with the same provider `toolCallId`.
The existing native-context wrapper used a whole-history successful-result Map
keyed by ID; the native pruning helper also used a later-wins call Map. As a
result the first input was incorrectly replaced by the native "superseded by a
newer read" notice. Red regression exit1 reported:

```json
{"differentSourceWasPruned":true,"nativePrunedResults":1,"realProviderRequests":0}
```

This was a real execution of the pinned OMP context/pruner with an explicit
synthetic transcript, not a paid model run or an assumed conclusion.

## Minimal pairing repair

`pairLocalToolHistory` indexes completed **occurrences** in chronological order.
Each assistant message defines a batch of pending calls. A matching result
consumes its pending call, including an error result. A later batch may legitimately
reuse the same provider ID. Duplicate IDs within a batch are ambiguous and produce
no pair; unmatched or wrong-tool results cannot borrow a previous call's authority.

The context hook uses those actual call/result object pairs. Only validated read
pairs are sent to the unchanged native `pruneSupersededToolResults` helper in
scratch entries with unique temporary IDs. After native pruning, only the
replacement read content is copied back to the outbound context copy. Original
provider IDs, user/assistant prose, write bodies and Session journal IDs remain
unchanged by this projection. Temporary IDs are never written into the outgoing
messages or native transcript. Existing provider ID normalization still operates.

Prior-source restoration shares the same occurrence pairing. Current selected
ID/name/SHA, non-private/source-kind checks and current-file authorization stay
in force. A failed read consumes its occurrence: a subsequent successful-looking
receipt with the old ID but no new call is rejected before source authorization.

No entry script, Agent Loop, execution framework or transport limits changed.
12,000 bytes, 8 actual sends, 512 output tokens, thinking disabled and stopping on
unknown usage remain in force. No paid call, credential read/configuration,
runtime-data upload, main merge or deployment was performed.

## No-paid regression

`test/workspace-omp-context-pairing.test.mjs` drives the pinned native context
helper and then the actual original local Session/provider/HTTP/SSE/native file
tool path using finite mock responses and isolated synthetic files.

Coverage includes:

- Different inputs with the same ID retain both unique fact sets.
- A third read of the first input supersedes only its own older read; input2
  remains intact. Native outbound tool-call/result IDs are preserved.
- Duplicate IDs inside one batch stay unpaired and protected from pruning.
- Three cold-reopened native Session turns receive repeated provider IDs. The
  native journal's **three read IDs actually collide across those turns**. The
  SDK does normalize another same-turn duplicate, showing that its normalization
  does not establish global uniqueness across cold starts.
- Actual serialized mock HTTP messages retain both source fact sets. A later
  repeat of input1 has exactly one copy of input1's facts while input2 remains.
- Seven actual mock HTTP sends, one stable native Session ID, a real native
  saved artifact with both source SHAs, and unchanged existing journal IDs.
- A stale unpaired success following a failed call cannot restore source access.

The finite response schedule is contract evidence, not autonomous live reasoning.
Real provider requests are **0**. All source files/outputs/transcripts are temporary
synthetic fixtures and are removed; raw execution logs are not committed.

```sh
node --test test/workspace-omp-context-pairing.test.mjs \
  test/workspace-omp-local-context.test.mjs test/workspace-omp-local.test.mjs
```

The independent patch is intended for the integration task already taking the
prior context and entry commits. It does not repeat that integration or modify
the entry branch. Known cumulative conservative spend remains CNY0.038716;
remaining authorization estimate CNY4.961284 is not an account balance.

Final related regression: **85 tests passed**, zero failures/skips. TypeScript/Vite
build passed with the existing non-blocking bundle-size warning. The model/business
key environment was excluded from test/build subprocesses. No paid request occurred.
