# Offline repair of the local conversation payload ceiling

The real first-turn failure remains a failure. This repair has **zero real provider requests and zero additional spend**. Historical conservative API cost remains CNY **0.051610**, no unconfirmed fee; remaining authorization estimate remains CNY **4.948390**, not an account balance.

Base product source: `b8866e95f2c655603c7b55529b579f91c9626fa1` (implementation `c68c6effb3547d470d111137c81ea28f26bb1f09`). The development branch also retains the unchanged documentation of the real failed run. Only the local conversation payload ceiling changes in production code.

## Exact cause

`boundedDeepseekFetch` rejects a serialized request exceeding its configured limit, both before and after the final OpenAI-format normalization. The local multi-turn transport inherited a **12,000-byte smoke-test ceiling**. That is a project restriction, not an OMP or DeepSeek context limit. It counts system instructions, every replayed message, tool schemas, JSON escapes, and framing, not just the new user goal.

An isolated replay uses the exact pre-failure native Session snapshot, the actual failed user goal, and the actual `read`/`write` arguments from the failed journal. The unmodified fixed source reproduces: read succeeds, write saves the same SHA, the third request is blocked before mocked HTTP, `SHORT_INPUT_LIMIT`. Its serialized body at the rejecting check is **12,214 bytes**. A fully normalized candidate would still be **12,145 bytes**, so merely moving the check would not fix the failure.

| Part at the rejecting check | JSON bytes | Independent native tokenizer estimate |
| --- | ---: | ---: |
| System message objects | 675 | 131 |
| User message objects | 1,182 | 331 |
| Assistant message objects, including write arguments | 3,755 | 1,068 |
| Tool result objects | 2,300 | 779 |
| Message array including separators | 7,930 | 2,301 |
| Tool schemas | 4,136 | 916 |
| Other request fields and top-level framing | 148 | — |
| Complete rejected body | **12,214** | **3,250** |

The estimates come from the pinned upstream `Tokenizer.countTokens(..., 'strict')` fallback encoding, not DeepSeek's tokenizer. Independently counted pieces do not necessarily add to the whole. They are diagnostics, **not actual usage, a billing bound, or a new token admission rule**. The rejected third request has no provider-reported tokens because it was never transmitted. The real preceding requests have confirmed input/output usage of 2,929/38 and 2,990/94 respectively, recorded in the prior real-run evidence.

## Repair and complete limits

`LOCAL_DEEPSEEK_LIMITS.maxRequestBytes` becomes **128 KiB (131,072 bytes)**. The separate short one-shot acceptance policy remains at 12,000 bytes. The local transport still checks the normalized serialized request before network access. The 128KiB cap is finite; it is not a promise of unlimited conversation history.

The existing upstream OMP `context` hook and `pruneSupersededToolResults` remain in charge of redundant read-result reduction. The existing hook removes exact duplicate host manifests and unused intent fields, preserves every user-authored goal, assistant prose, saved body, latest source body, and call/result occurrence pairing, and leaves the native JSONL intact. No extra history truncation, model summary, automatic retry, or replacement agent loop is introduced. Automatic model-backed compaction stays disabled: this repair does not add paid summary requests or silently replace unique source/tool bodies with a summary.

All other limits and guards remain:

- At most **64 wire messages**, **5 admitted local tools**, **8 actual provider requests per task**, and **512 output tokens per request**; thinking disabled, redirects refused, original SDK retries disabled.
- After every complete response, raw SSE and SDK-normalized usage must agree; observed input must be at most **32,000 tokens** to admit continuation. This is a **post-usage continuation ceiling**, not a claim that a byte limit proves a pre-send 32k-token bound. The existing local model metadata remains 32k.
- Official Flash physical text context is documented as **1M**. Any one unconfirmed request reserves **1,100,000 input tokens + 512 output tokens**, deliberately above either decimal or binary interpretation of 1M. No new send is admitted while the preceding charge is unknown. Missing, inconsistent, oversized, or failed usage stops the task; a provider limit contract violation leaves cost unknown rather than claiming zero.
- Peak conservative rates remain input **CNY 2/million** (including all cached input) and output **CNY 8/million**, checked against the official source before the preceding real run on 2026-10-16: <https://api-docs.deepseek.com/zh-cn/quick_start/pricing/>. No new pricing lookup or credential access is needed for this offline test.

Increasing serialized bytes does **not** increase the rigorous cost bound: an unconfirmed request was already reserved against the full published context, not a bytes-to-tokens estimate.

```
one maximum confirmed response = (32,000*2 + 512*8)/1e6 = CNY 0.068096
one unconfirmed request reserve = (1,100,000*2 + 512*8)/1e6 = CNY 2.204096
8 fully confirmed responses <= CNY 0.544768
7 maximum confirmed + 1 unconfirmed <= CNY 2.680768 < per-task reserve CNY 2.70
one successful turn + a second failed turn <= CNY 3.225536 < remaining CNY 4.948390
```

That two-turn bound assumes stopping the group after any failure, exactly as authorized. Future runs still require a reviewed remaining budget and current prices; this does not create a persistent account-budget system or authorize more paid calls.

## Focused verification

All child tests received a whitelisted environment without the injected real API key. The private replay also overrides global fetch to fail, and passes only finite mock SSE through the original OMP provider transport. There is no real-network fallback. Private replay artifacts are removed from their temporary output directories; no synthetic English introduction is presented as a real model result.

1. **Unmodified baseline replay:** exact failed goal and real tool calls; 2 mocked HTTP requests, same saved-file SHA, third attempt rejected at 12,214 bytes, same failure reason.
2. **Patched replay of the same sequence:** save and final confirmation normally stop, then a different English-introduction goal in the same native Session saves and normally stops. Five mocked HTTP requests; final wire sizes **10,927 / 11,253 / 12,145 / 12,413 / 13,288 bytes**. Existing goals, prose, source bodies, successful write bodies, and call/result pairs are checked at each mocked send.
3. **Direct resume of the actual failed journal copy:** retains its three original user turns and old aborted entries. A new confirmation goal normally stops without rewriting the saved draft; the following different goal saves and normally stops. Three mocked HTTP requests; largest final wire request **13,378 bytes**. Old aborted entries remain aborted, and the original real journal and all old output hashes remain unchanged.
4. Three policy-only regression tests pass: exact 128KiB boundary and pre-send rejection above it; seven maximum complete usages plus an eighth unknown response remain within CNY 2.680768 and cannot retry; input usage beyond 32,000 prevents another request.
5. Existing focused native context and reused-ID pairing tests: **2 passed**. Local DeepSeek configuration preflight: **1 passed**. Four selected original OMP wire scenarios pass: happy path (3 mock requests), request exhaustion (8), oversize first request (0), oversize after read (1). No full backend suite or build was run.

Sanitized numeric summaries are in `checks.json`. The original real Session SHA remains `3d7797ddbdabb698405a6d8dbf2bc8119f8f0eb798f530d70082ac5ae2410582`; its saved `gap-review.md` SHA remains `7b74995cc4bd71c2ee1206984c464f3411f05933b61e8e07573feb77a79a74ec`. Neither the real transcript nor its output body is committed.

Reproduce privately with the existing evidence directory and pinned Bun, using only a whitelisted environment:

```sh
env -i PATH=/usr/bin:/bin HOME=/tmp LOCAL_REPLAY_EXPECT=passed \
  /ABS/pinned/bun test/fixtures/workspace-omp-local-failed-session-replay.mjs \
  /ABS/private-acceptance-evidence /ABS/this-source-worktree
# Add LOCAL_REPLAY_FROM=failed to resume the actual failed leaf instead.
```

The evidence directory must contain the original private `receipt.json` and `session-before.jsonl`, with the referenced real Session and selected synthetic input still available. The fixture copies native history and material into a temporary directory and rebases only initial cwd/selection metadata. It does not edit the live Session, real receipts, or old output files.

## Remaining real acceptance

The original failure stays recorded as failed. Offline replay proves the byte rejection is fixed and the original Session/tool path can complete both transitions with finite mock responses. A separately authorized real two-turn run remains necessary to verify actual model tool choices, normal stop, complete provider usage, and artifact hashes with the patched product. It should resume the compatible failed Session with a new confirmation goal and then a new short goal, using new output basenames; it should not re-execute the original write against an existing filename. No such paid run is executed or authorized by this repair.
