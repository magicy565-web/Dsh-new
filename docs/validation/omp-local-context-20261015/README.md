# Native OMP local context repair — 2026-10-15

Source checkpoint: `e69f904e6b2b6463f2a11b0298891577ceab895e`, based on
`cc732f2be93fd0667bb1b553d7f4762c25b2f8ee`.

The previous real continuation saved its English email, but the final model
request exceeded the 12,000-byte HTTP-body cap. This follow-up fixes repeated
context overhead **without a new paid request**. It does not relabel that previous
stopped turn as successful or claim a new live-model result.

## Implementation and boundaries

The local profile uses the pinned OMP18.10.4 native `context` extension hook and
`pruneSupersededToolResults` helper. On an outbound copy only:

- A newer successful read may replace an older read of the same selected input.
  Paired tool-call/result IDs, the selected ID/name/SHA, non-private source flag
  and selected-source kind must match. The latest source text is retained.
- Exact copies of the host-appended input manifest are removed from older user
  messages. The latest manifest and every user-authored character remain,
  including a deliberate earlier lookalike of that suffix.
- Successful paired tool calls omit the SDK intent-tracing `i` metadata from
  outbound replay. Actual executor parameters, including complete generated
  document bodies, remain. New local requests use the SDK's native
  `tools.intentTracing:false`, which avoids injecting the same descriptive schema
  metadata into every tool definition. Tool names/parameter-shape receipts remain.

All user goals, assistant prose, document bodies and original message records are
retained. The SDK's separate default persistent stale-read/useless-result pruning
is disabled for this local profile (`compaction.supersedeReads:false`,
`compaction.dropUseless:false`), so reduction stays on the per-request copy and
does not rewrite original JSONL messages. No summary model, extra provider call,
new Agent Loop, custom session database, background process or approval form.

Current source authorization/SHA checks run before and after the native context
hook, and again at original model/tool admission. Original prior-source restoration
still validates the local profile/selection binding and current bytes. A changed
source is refused before any HTTP send. The context projection cannot grant
source access or replace those guards.

`server/workspace-omp-local-deepseek.mjs` and its transport limits are unchanged:
8 actual sends per task, 12,000 final serialized request bytes, 512 output tokens,
thinking disabled, no automatic retries after uncertainty, and complete matching
raw/SDK usage before another send. Oversized unique inputs still stop; this is
duplicate reduction, not unbounded context or semantic summarization. Independent
long histories can still reach the fixed cap.

## Reproducible no-paid evidence

`test/workspace-omp-local-context.test.mjs` executes the real pinned SDK,
SessionManager, provider, HTTP/SSE serialization, local native ReadTool/WriteTool,
and the actual guarded fetch boundary. Only finite HTTP responses are mocked;
there is no real-provider fallback or real credential inheritance.

The control restores original unprojected messages through a **test-only native
context hook**, and enables original intent tracing. It saves two results, then
hits `SHORT_INPUT_LIMIT` in turn3: six actual mock sends. The repaired scenario
cold-reopens one original Session ID for three different natural-language goals:
missing-facts document, English inquiry email, and a follow-up with supplied
quantity200 and delivery pending. All three save and finish with `stop`, eight
actual mock sends total; maximum observed final request **11,863 bytes**. Each
task remains below the unchanged eight-send limit. Turn2 deliberately starts
with `write`, proving revalidated prior-source reuse without a forced reread.

Wire assertions retain every earlier goal, assistant reply and full saved body.
Journal assertions retain the original user messages, write bodies and original
read content, while files and provenance hashes match actual native tool receipts.
Changed source bytes refuse the next resume before a model call. Additional hook
checks preserve a user-authored manifest lookalike and unique document body,
protect wrong-hash/private read results from superseding other content, and
require current authorization. Projection leaves original input message objects
unchanged.

The actual previously stalled real JSONL was also copied **outside Git** and
replayed through the existing local entry, original SDK/provider and one finite
mock HTTP answer. It restored the same original Session ID, included both saved
drafts and old goals, and ended normally at **10,839 request bytes**. Actual real
provider requests: **0**. The original live JSONL SHA remained unchanged. Runtime
replay artifacts stay under `/workspace/local-context-offline-repair-20261015/`;
no original transcript, report body, credential or runtime log is committed.
This is a wire/continuation contract check, not proof of fresh autonomous live
model reasoning.

Reproduce the focused regression:

```sh
node --test test/workspace-omp-local-context.test.mjs
```

Final related regression: **84 tests passed**, zero failures/skips. TypeScript and
Vite build passed with the existing non-blocking bundle-size warning. The group
includes local files/continuation, HTTP limits/uncertain usage/no retries, parameter
contracts, existing Session reads/startup and original OMP/business paths.
Tests/build run with a whitelist environment excluding model/business secrets.

```sh
node --test test/workspace-omp-local.test.mjs \
  test/workspace-omp-local-wire.test.mjs test/workspace-omp-local-context.test.mjs \
  test/workspace-factory-field-contract.test.mjs test/deepseek-acceptance-policy.test.mjs \
  test/deepseek-readonly-wire.test.mjs test/pi-procurement-package.test.mjs \
  test/workspace-omp-session-readonly.test.mjs test/workspace-omp-session-startup.test.mjs \
  test/workspace-omp-launch.test.mjs test/pi-workspace-business.test.mjs test/workspace-omp.test.mjs
npm run build
```

## Next real acceptance (not performed here)

1. Integrate this source checkpoint into the entry branch separately. This task
   did **not** merge `8ae9d9d55f6fa4b92e4f1e0ee93d5513b9e062da`
   (`codex/local-native-entry-20261015`), main, or deploy anything. Entry changes
   are intentionally outside this task's commits.
2. Before a real run, confirm no later/unknown paid activity or parallel payer,
   current official price/model contract, and time before Beijing07:00
   (2026-10-15 23:00 UTC). The known cumulative conservative estimate remains
   **CNY0.038716**, remaining authorization estimate **CNY4.961284**, not an
   account balance. The unchanged per-task worst-case reserve is CNY2.680768.
3. Use the original live JSONL and selected paths, first with `--check`, then at
   most one bounded real continuation under the existing authorization. Start
   with a brief confirmation/question goal so the stalled end boundary is tested.
   Require the same Session ID, normal `stop`, complete usage and an actual HTTP
   count within eight. On an error or unknown usage stop and do not auto-rerun.
   Keep both earlier output SHAs unchanged; record any new estimated spend.

Complete non-secret original-entry preflight (no key value or persistent config):

```sh
PI_PROVIDER=deepseek PI_MODEL=deepseek-flash WORKSPACE_OMP_PROVIDER_COST_JSON='{"input":0.3,"output":1.2,"cacheRead":0.006,"cacheWrite":0.3}' WORKSPACE_OMP_LIVE_BUDGET_VERIFIED=1 node scripts/workspace-omp-local.mjs --session /workspace/local-deepseek-acceptance-round2-20261015/conversation.jsonl --input /workspace/local-deepseek-acceptance-round2-20261015/product.md --output-dir /workspace/local-deepseek-acceptance-round2-20261015/output --task '请只简短确认之前两份合成草稿已保存且未发送，不创建新文件。' --check
```

The exact preflight above was executed: key/cost/reviewed-budget present, original
Session resumed true, configured-unverified, zero model requests.

`--check` tests configuration/paths and makes zero model requests; it does not
itself exercise context projection. The mocked replay above does. Removing
`--check` initiates a paid run; **that was not done in this follow-up**. Same live
Session ID: `01a140cf-08d4-7000-8a17-1788259c7f4d`.

No new paid call, credential, external sending, main merge or deployment. The
environment-disconnection notice was checked against real command results;
source checkpoint was committed/pushed and the running regression was observed
to finish successfully, rather than treating its running status as a pass.
