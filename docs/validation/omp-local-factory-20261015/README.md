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
