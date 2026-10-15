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
