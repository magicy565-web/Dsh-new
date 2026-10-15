# Local natural-language entry and native context integration

This checkpoint combines the natural-language CLI entry at
`8ae9d9d55f6fa4b92e4f1e0ee93d5513b9e062da` with the upstream context
fix at `b1b87632a0d7ebc34a84a623658e060671cac480` (source commit
`e69f904e6b2b6463f2a11b0298891577ceab895e`). The tested code merge is
`1be1bb02ffbd29ff6d9dd88166815f90de8d1510`, tree
`aa34a9736bd6323ecefde543156da546975dc09c`.

The single conflict in `server/workspace-omp-session.mjs` was resolved by
retaining the Shopify tool admission and extension while adding the upstream
local-only context hook. The context module and its tests are byte-identical
to the upstream source. The CLI entry, local-file authorization and restored
read provenance, transport, billing policy, and Shopify market-scope module
are byte-identical to the entry base. The original SDK still owns the Session,
tool loop, journal and context event.

The new hook projects a copy of request context: it uses the pinned native
pruner for superseded verified selected-file reads, removes repeated exact
host manifest suffixes, and omits intent metadata. Goals, prose and saved
bodies remain. Original journal messages remain intact. Persistent read
pruning and intent tracing are disabled only for the local-file profile.
No request cap, output-token cap, error stop, or billing gate was relaxed.

## Offline verification

The integrated original-SDK finite mock-HTTP fixture completed three turns
in the same native Session, saved three drafts and made eight mock requests.
The largest transmitted request was **11,863 bytes**, below the unchanged
12,000-byte limit. Its failing control saved two drafts and stopped with
`SHORT_INPUT_LIMIT`. The fixture checks retained goals and document bodies,
unchanged journal reads, restored read provenance for a write-first second
turn, and changed-selection rejection before a request. Projection guards
also check private/wrong-hash protection and current authorization.

The complete canonical backend set contains 183 files: 1,232 tests,
1,222 passed, 10 skipped, zero failed or cancelled. The main DOM suite passed
20/20 and the conversation DOM suites passed 17/17. The main build (including
TypeScript) and mini-program build both exited successfully. The existing
main bundle-size warning remains.

See [checks.json](./checks.json) for exact commands, source hashes and raw-log hashes. Tests run with an allowlisted
environment and isolated temporary HOME. No model or business credentials
are inherited, and no `.env` is present. Generated test data is synthetic;
raw logs, private Session files and original runtime data are not committed.

The independently executed documented `npm run factory:local -- ... --check`
passed with both the default Session path and an explicit path. Both reported
`model-unconfigured`, zero model requests, ready selected local files, and no
created Session or lock. This is a credential-free startup preflight; it
neither verifies configured credentials nor proves complete real-session
compatibility.

## Acceptance handoff and limits

This round makes **zero real paid model, Shopify, business MCP or Muse calls**.
It does not run or copy the original real Session, create credentials, publish
products, modify main, or deploy. The original task alone performs the next
real acceptance against the fixed branch SHA.

The upstream 10,839-byte replay of a copied blocked real Session is historical
mock-HTTP evidence in the upstream validation folder. It was not rerun in
this integration, and it is not post-fix real-provider evidence. The earlier
entry-only pending-context limitations describe that older checkpoint; the
context source is now included here, with only the offline results above.

There is no post-fix real-model acceptance result here. Unique conversation
history can still exceed 12KB; these three synthetic turns do not establish
unbounded conversation. Existing UNKNOWN task history and prior partial
real-turn results are not upgraded by this source integration or by `--check`.
