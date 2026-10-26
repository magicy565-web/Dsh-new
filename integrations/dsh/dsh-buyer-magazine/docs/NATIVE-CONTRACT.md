# Version 0.2.0 composition update

The independent preset composes the generator, official filesystem Skill provider, web/file tools and official present under the native Agent scope. Sourcing is not required. Both Studio and module compatibility inputs use one compiler. Validation reports bounded allowlisted field paths in issues; no raw source text or unknown input key is echoed. The low-level file/present contract below remains in force.

# Native file generation and official presentation contract

Reviewed against installed official DSH `0.2.1-rc.2`, Node `v24.22.1`.
This candidate supersedes the previous candidate's mistaken ref-only restriction.
The user requires a plugin without an independent frontend; official workspace
file delivery and native HTML preview are compatible with that request.

## Owned code

`compiler.js` exposes only pure compilation, validation metadata and size limits.
`src/core.js` preserves the source-backed Studio schema/render gates.
`src/native-files.js` adds one bounded current-Session file operation.
`src/tools.js` declares validate/generate, and `index.js` registers through native
ToolRuntime with fixed safe `HarnessError` messages. No generic file service,
state store, custom route/client, AttachmentStore or orchestration loop is added.

The seven retained upstream files are five implementation/assets plus original
LICENSE/THIRD_PARTY.md. Presentation/CSS and notices retain their original
bytes; schema/render/JS contain documented price-status, price-context and request-source patches. The provenance
manifest retains original source hashes and adds separate shipped patch hashes.
See PRICE-CONTEXT-PATCH.md, REQUEST-SOURCE-PATCH.md and PRICE-STATUS-PATCH.md. No environment,
credential, old collector/queue/Pi/OMP engineering or example runtime data is copied.

## Native write sequence

1. Require `exec.agent`, its explicit Session `header.cwd`, and caller signal.
   Compile bounded complete issue JSON before any mutation.
2. Resolve `workingDirectory.ensure(agent, signal)`, the Session root and the
   compiler-generated basename with `ctx.fs`. Require canonical containment.
3. Resolve the current `sandboxPolicy` for that same Session, without any override.
   Read-only denies generation. Policy root must match the Session root. Even
   danger-full-access does not let this plugin leave its generated-file boundary.
4. Reject final symlink/directory/special entries using lstat. Recheck cwd, policy,
   canonical target identity and containment after awaited policy callbacks.
5. Existing target: bounded read, exact size, full SHA-256 and stable version must
   match; otherwise conflict. Matching content is reused without touching mtime.
6. Absent target: emit authoritative `fs/observed` absence; call the native
   `fs/write-intent` waterfall with create-only fallback. Any non-create intent is
   refused, not overridden. Write with `createIfAbsent`, signal and current policy.
   Emit `fs/observed` with the returned `outcome.version`; verify output bytes.
7. Return only generated artifact metadata with `presentation: pending-official-present`.

No user argument supplies Session ID, path, output directory, sandbox mode or
privilege widening. This uses public native seams; it does not impersonate a user,
call another tool definition directly or bypass native tool guards.

## Separate official present

Skill calls `present({files:[{path:generated.path,description:'Draft ...'}]})` through
the host's normal native tool invocation. Official present checks current Agent,
open turn and regular file, then appends `deliverables/presented` only after its
successful final result. Plugin generation does not append that event or invoke
present secretly. Scoped tool restrictions, guards and approval policies remain
authoritative; missing/denied presentation leaves an ordinary generated file.

Paths intentionally identify only the generated HTML inside the Session workspace.
Do not use attachment storage paths, home/token/config files, guessed URLs or
whole-Session exports. Official cards/HTML preview are reused, not reimplemented.

## Failure and idempotency contract

Invalid issue, missing Agent, early permission/boundary denial and pre-write
cancellation make zero plugin writes. A successful publication followed by
cancellation, failed verification or throwing observation may leave the generated
file; errors do not claim rollback or zero writes. Retry only the same input after
checking status. Matching content is reused; unrelated bytes are never overwritten.

There is no new durable transaction/receipt layer. Official present can append
again on a repeated successful call; no exactly-once guarantee is claimed. The
presented file's current bytes can change later. The official FS's acknowledged
ancestor-symlink TOCTOU boundary remains; this is not kernel-grade isolation.

## Official source evidence

Paths relative to existing runtime `node_modules/@deepseek-ai/`:

| Contract | Source |
|---|---|
| Current Session directory | `dsh-working-directory/lib/types/index.d.ts:59–83` |
| Canonical contains and lstat | `dsh-fs/lib/types/index.d.ts:124–155` |
| Atomic write with intent/signal/policy | `dsh-fs/lib/types/index.d.ts:209–221` |
| Create-only no-replace publication; version outcome | `dsh-fs-local/lib/index.js:498–553,864–881` |
| Native create/write-intent/observed precedent | `dsh-tool-str-replace-editor/lib/index.js:138–160` |
| Current Session sandbox policy | `dsh-sandbox-policy/lib/types/index.d.ts:79–88` |
| Scope visibility and permission pipeline | `dsh-tools/lib/types/index.d.ts:690–715,747–765` |
| Official present and successful-result event | `dsh-tool-present/lib/types/index.js:60–98` |
| Existing file cards and sidebar open | `dsh-client-ui-deliverables/lib/client.js:1697–1717` |
| HTML/HTM static and interactive iframe preview | `dsh-client-ui-sidebar-documentpreview/lib/client.js:4425–4506` |

## Actual verification

Candidate.4 passed 61 offline Node-only tests and 28 optional jsdom emitted-artifact
DOM checks (25 DOM sessions; zero external request attempts or JS runtime errors).
These are not browser, visual or production Host acceptance.

Final integrated candidate.4 official SDK fixture passed 12 dispatches using real
ToolRuntime, SandboxedFileSystem, WorkingDirectory, SandboxPolicy, observation policy
and official present. It wrote one 76,425-byte synthetic HTML and verified exact
bytes. Reuse preserved mtime/inode. Tests covered missing Agent, invalid JSON,
read-only, unrelated-file collision, symlink escape, scope restriction and guard.
Only official present appended the one observed delivery event.
The separate explicit Skill discovery fixture also passed all eight groups.

This uses one **detached synthetic Session**, structural carrier plus official
scope, and minimal **test-only turnBoundary projection**, not a production Agent
or production turn controller. A synthetic turn-start log event is not a model
turn. No AgentLoop/model/browser/server/network is started. Test files live only
under an owned temp root and are removed. No real Session/customer data is read.

First SDK fixture run failed because direct LocalFileSystem construction omitted
its normally schema-defaulted diffBasisMaxBytes. Supplying the public config field
fixed that fixture; rerun passed and failed-run temp data was removed. No permission
denial or uncertain execution occurred.

Pending: actual Host/profile install and scope composition, browser visual and
interactive acceptance, real enterprise evidence/rights review, and the original
Skill's complete design process. Default bundle disable is a review choice; it
does not disable the generate implementation or imply missing official HTML support.
