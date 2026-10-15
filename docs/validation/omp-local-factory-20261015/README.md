# Local factory acceptance — 2026-10-15

Source base: `55f8faae8e29fe033dde9dd61312f3aca3ed60e6`.

Implemented on an independent development branch. No production credential,
member/principal, permission, approval system, database framework or agent loop
was created. No main merge, deployment or Shopify/MCP/Muse change.

The actual official OMP 18.10.4 Session/provider path called its registered local
file tools, delegating file interpretation and report staging to original OMP
ReadTool/WriteTool under verified Bun 1.3.14. All source data and model responses
were explicit synthetic fixtures, with no real-provider fallback. The local child
receives no WS binding or ambient user credentials and starts no HTTP Host.

The end-to-end fixture reads the selected product snapshot, calls the existing
RFQ and matching-preparation tools, preserves missing fields as pending, saves a
new report, and verifies the exact output SHA and source SHA footer. Repeating
the task cannot overwrite that report. Native-tool boundary checks reject
unselected paths, traversal/URIs, pre-read writes, existing files, symlink
outputs, replaced output directories, changed source bytes, symlink sources or
parents, credential-like input, unsupported types and the original Workspace
state database. A forged remote business tool cannot create a business task or
pretend a report was saved. Missing model/cost/budget stops before inference.
The actual `npm run factory:local ... --check` path was also tested without a
model key; it produces no report and makes zero model requests.

45 distinct related tests passed, with no skips/failures:

```sh
node --test test/workspace-omp-local.test.mjs \
  test/pi-procurement-package.test.mjs test/workspace-omp-session-readonly.test.mjs \
  test/workspace-omp-session-startup.test.mjs test/workspace-omp-launch.test.mjs \
  test/pi-workspace-business.test.mjs test/workspace-omp.test.mjs
```

The final five-test local suite was rerun after strengthening input FD checks,
internal-path rejection, the actual npm preflight, and scoped cancellation cleanup.
It overlaps the 45-test group and is not an additional five distinct tests.
`npm run build` passed TypeScript and Vite. Tests/build use a whitelist subprocess
environment; no real user model/business keys are inherited by test children.
Source, tests and these summaries are committed; generated synthetic reports,
raw model output and runtime logs are not committed.

Additional paid model requests: **0**. This verifies original SDK/tool/file
execution with explicit model substitutes, not real model reasoning or actual
enterprise data. The local path has not been exercised against a live paid
model, real user materials, scanned-PDF OCR, Shopify or an external MCP connection.
The separately completed earlier DeepSeek model smoke test is independent
connectivity evidence and does not validate this later local execution path.

See [startup and boundaries](../../WORKSPACE-OMP-LOCAL.md) for the one-command
entry, file limits, required existing model/cost/budget configuration and how the
optional original Workspace service remains authoritative for shared business
records, approvals and remote Workers.


## Concurrent-write follow-up

Base: `01cf485a6fe08c335afdd7d6b608d38b9bd556aa`. The old quota checked only
completed saves before asynchronous native writes; five calls could pass together.
The local write tool now reserves a slot synchronously before native I/O and
releases the reservation in `finally`. Completed saves plus pending writes never
exceed four. Path/FD, source, exclusive-create and no-overwrite checks remain.

A real original OMP SDK run uses one finite synthetic model response containing
five write tool calls. Four reports are saved with verified source/result SHA;
the fifth has a tool-error receipt `LOCAL_OUTPUT_REFUSED`. The native boundary
fixture also launches five direct `Promise.allSettled` writes and checks exactly
four successes. Earlier failed writes to existing/symlink targets release their
reservations, so four later writes remain available. This adds no scheduler or
framework; the original SDK still owns model and tool execution.

The follow-up regression group has 47 distinct passing tests, zero failures and
skips; the local suite contains seven of them. Build passed. DeepSeek provider,
explicit Flash model, four USD price fields, and the existing reviewed-budget
flag are documented in the local startup guide. The zero-request preflight now
returns those non-secret selections and presence booleans. An actual safe check
on temporary synthetic material used the already-injected key without printing
it, the repository's existing reviewed price snapshot, and the unchanged budget
flag: key present true, cost present true, remaining-budget-reviewed false,
`model-unconfigured`, model requests 0. No persistent configuration changed and
no account/balance request was made. Separate keyless tests cover missing and
fully supplied configuration; neither triggers a model request.

Additional paid requests remain **0**. No main merge, deployment, new credential,
permission change, real user material, Shopify or MCP action.


## Actual provider HTTP follow-up

Base: `ca5d9945a090da00bc9199061799266761b43971`. Inspection of pinned
OMP 18.10.4 showed that `maxRetries:0` and logical model-call limits alone
cannot prove a bound on actual HTTP sends: the official transport and provider
have internal retry/replay paths. The local profile now reuses the readonly
acceptance request wrapper, retaining original `createWorkspaceOmpSession`,
`sdk.streamSimple`, provider and SDK SSE decoder. Shared abort plus a pending
request gate blocks any additional send after an uncertain result. Empty-response
replay is disabled explicitly. There is no replacement model loop, new budget
service, user form, JSON approval or persistent monetary ledger.

Limits apply at the actual fetch boundary: pinned official Flash endpoint,
redirect refusal, 8 actual sends, final JSON at most 12,000 bytes, text only,
five local tools, thinking disabled, at most 512 output tokens. The next send
requires complete, consistent raw SSE and normalized SDK usage, no tool error,
and at most 32,000 reported input tokens. 32k is a post-response continuation
condition, not a pre-tokenization bound inferred from bytes or SDK metadata.

`test/workspace-omp-local-wire.test.mjs` drives actual original provider HTTP/SSE
execution with finite mocked fetch responses and isolated native file tools. It
does not use the synthetic model shortcut or inherit real credentials. Its 16
wire cases include successful read/write, cached usage, HTTP 500, connection and
stream errors, truncation, absent/partial/inconsistent/oversized usage, empty
response, output contract violation, oversized initial/growing context, failed
tool and exhausted calls. Actual fetch counters prove one send on uncertain
results, zero on an oversized initial request, one before an oversized read
result, and eight on exhaustion. The mock also asserts the exact outgoing
endpoint, bytes, output/thinking normalization and redirects. A separate math
test verifies the monetary reservation. Fixture evidence is labeled
`official-omp-local-files-mocked-http`, `paidModelVerified:false`; synthetic
wire results never count as live model success.

The initial long-context fixture used a single 18k-character line; upstream
ReadTool correctly truncated that line, so it did not exceed the HTTP limit.
The fixture now uses ordinary multiline material that survives native read
truncation. The corrected case proves the second send is refused after the
first actual read call. No production workaround or alternate read tool was
introduced.

Under the existing 2026-10-15 reviewed Chinese official peak-price snapshot
(input miss CNY2/million, output CNY8/million), eight fully confirmed responses
cost at most **CNY0.544768**. A failed/unknown response cannot be priced as zero:
reserve 1,100,000 input tokens (covers the published 1M text context under either
decimal/binary interpretation) plus 512 output tokens for the single unconfirmed
send. Seven confirmed prefixes plus this reserve bound the task at
**CNY2.680768**, below the fixed single-task CNY2.70 admission reserve and the
known remaining CNY4.999838 authorization. There is no FX conversion or account
balance lookup. The code rejects reported violations of the physical/output
contract with `chargeUpperCny:null`, stops, and does not claim a finite cost.
These bounds depend on the published model contract and reviewed price snapshot;
they are not proof of actual account charges, a live repricing or a cross-task
wallet limit. Re-fetching the pricing page during this follow-up timed out.

Reproduce without paid requests:

```sh
node --test test/workspace-omp-local.test.mjs test/workspace-omp-local-wire.test.mjs \
  test/deepseek-acceptance-policy.test.mjs test/deepseek-readonly-wire.test.mjs \
  test/pi-procurement-package.test.mjs test/workspace-omp-session-readonly.test.mjs \
  test/workspace-omp-session-startup.test.mjs test/workspace-omp-launch.test.mjs \
  test/pi-workspace-business.test.mjs test/workspace-omp.test.mjs
npm run build
```

Final regression: **77 tests passed**, zero failures/skips. `npm run build`
passed TypeScript/Vite with the existing non-blocking bundle-size warning. The
existing DeepSeek key presence was rechecked as **true** without displaying its
value; no account or model request was made.

Only source/tests/sanitized evidence are committed. Raw runtime logs and generated
reports stay outside the repository. Additional paid requests **0**; no main
merge, deployment, real user material, external sending or credential changes.


## Single real attempt and native conversation follow-up

The user authorized exactly one real local acceptance run after the HTTP-boundary
work, within remaining CNY4.999838. The official Chinese and English pricing pages
were successfully rechecked before sending: Flash 1M context, CNY2/million input
miss and CNY8/million output peak. The existing CNY2.680768 failure-inclusive
reserve remained below that allowance. The team had only this active agent and
no other Node/Bun model processes. An exclusive process lock plus an exclusive
persisted start marker guarded this one run. No second paid run was performed.

The executed base was `f2eb0630372cf9b0a09a62d59005d6fcc5ad4072`, with only a
pre-run tool-name/error-boolean observer added to its returned receipt. The
synthetic public product file described an unbranded 500ml cup and an RFQ of 100
units for Germany, with capacity/delivery/prices/certification unknown. Input and
runtime receipts are outside Git under
`/workspace/local-deepseek-acceptance-20261015/`; they were not committed.

**Result: real provider connected, local save workflow failed.** Official Flash
made **2 actual HTTP requests**, both with complete validated usage, in **6237ms**.
The model chose `workspace_factory_capabilities` and `read` successfully, then
`workspace_factory_rfq_requirements` and `workspace_factory_match_prepare` both
returned tool errors. The next logical provider entry was stopped before a third
HTTP send with `LOCAL_TOOL_ERROR_STOP_DO_NOT_RETRY`. **No output file or output
SHA exists.** No model substitute, business Host or WS binding was used.

The two confirmed usage responses produced a conservative **CNY0.009334** total.
Known cumulative authorization consumption is **CNY0.009496**, leaving
**CNY4.990504**; these are estimates, not an account-balance query. There was no
uncertain usage. The pre-existing failure return did not retain token subtotals
or concrete tool arguments/error bodies, so those cannot be reconstructed or
fabricated. Later source changes add confirmed token totals and safe error codes
to future receipts; they do not retroactively add evidence to this attempt.

Offline inspection found a concrete contract mismatch: RFQ/factory tools
advertised unrestricted Record/Unknown fields while execution rejected all but
fixed scalar fields. Their schemas now advertise exactly the accepted fields
and types, without weakening execution authorization. Mock HTTP tests cover a
valid factory chain and a rejected null RFQ, including stopping before another
send. This repairs the mismatch, but the discarded live arguments mean it cannot
be claimed as the proven sole cause or a verified live repair.

The user's subsequent requirement was a changeable one-sentence goal with
continuation. `factory:local --session FILE.jsonl --task 'natural-language goal'`
now creates/opens the **original OMP SessionManager** file, retaining the same ID
and transcript. It can answer/ask about gaps without saving, or write only when
requested. Reuse the same explicit file and replace `--task` for the next user
turn; there is no fixed tool sequence, fixed report, replacement model loop, new
session DB or frontend. This is an SDK command entry with persisted continuation,
not an interactive TUI. [A complete non-secret command](../../WORKSPACE-OMP-LOCAL.md)
is provided for this environment.

Only deliberate `--session` opts into retaining transcript/selected data. Temporary
auth storage and input snapshots are still removed. Native custom entries bind
the local profile to selected source paths/hashes, output directory and model;
changed selection, foreign profile, symlink, concurrent lock or previous unknown
billing refuses continuation before inference. In-progress billing markers are
flushed through the original SDK before a prompt and finalized after it, so a
crash cannot silently turn an unconfirmed request into zero cost. Each explicit
new turn retains the original per-task HTTP restrictions; there is no persistent
wallet accounting.

No-paid tests exercise two different natural-language goals: first read and ask
for missing delivery/quantity without writing; then continue the same original
history with quantity200 and request an introduction in `intro.md`. A separate
question-only turn uses no tools. These are finite-substitute **contract tests**,
not evidence that a real model autonomously achieved these new flows. The real
paid attempt above remains the only live result and remains failed at tool stage.

Final source validation: **81 tests passed**, zero failures/skips; TypeScript/Vite
build passed with the existing non-blocking bundle-size warning. The local suite
contains nine tests; the wire suite has eighteen mock HTTP scenarios plus its
reservation-math check. No second paid run was used for any source repair or
conversation-continuation test.

The exact documented full command was also executed with `--check`: configured
unverified, key/cost/reviewed-budget present, zero model requests, no session file
created. Without `--task`, persistent mode asks for the user's goal instead of
starting the old default report template.
