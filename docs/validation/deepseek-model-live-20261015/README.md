# Original OMP model connectivity acceptance (2026-10-15)

Base source: `ad8018596fdbb6e8d8fbda0f56efb24e7129c80a` from
`codex/deepseek-readonly-acceptance-20261015`.

A real paid model-only call passed through the original
`createWorkspaceOmpSession` and its registered provider, official OMP 18.10.4,
verified official Bun 1.3.14, and the official `deepseek-flash` receiver.
The model returned HTTP 200, complete nonzero provider usage, a terminal stop,
and the correct answer to a minimal public arithmetic question. Exactly one
network request was sent; there was no retry, tool call, synthetic response,
private enterprise data, alternate model loop, or direct-call replacement.

`DEEPSEEK_API_KEY` presence was true. The existing secure injection and SDK
Bearer/proxy path were used without inspecting or printing the injected value,
headers or configuring credentials. The model key was never part of the prompt.
Existing `WS_AGENT_URL` and `WS_AGENT_TOKEN` presence were both false, so business
binding and original read-only business tools remain unverified. No binding,
identity, sample record, service token or business accomplishment was fabricated.

The one-shot script caps output at 128 tokens, forbids tools, caps serialized
request bytes at 4,000, disables thinking, and admits only one network request.
Before sending, the conservative reserve used 32,000 input tokens and 128 output
tokens: CNY 0.065024, under the task's CNY 0.20 cap and the user-confirmed total
remaining allowance of CNY 5. Prices were checked against the
[official Chinese pricing page](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)
on 2026-10-15, using peak uncached input CNY 2/million and output CNY 8/million.
Observed usage and timing were reported privately in the task result; raw model
output, request/response bodies, runtime logs and credentials are excluded here.
Actual account debit and account balance were not independently queried.

`measuredUsage` now rejects a positive total with all zero component counters as
uncertain rather than recording a free request. Its seven policy tests passed;
script syntax and the real runtime preflight also passed. The live call is the
connectivity evidence; keyless policy tests do not represent paid model evidence.

```sh
node scripts/acceptance-deepseek-model.mjs --check
# This sends a paid request; execute only with explicit current authorization:
node scripts/acceptance-deepseek-model.mjs --execute-paid-request
```

The script uses an owned temporary home and removes its original OMP session
files after completion. Nothing was deployed, merged to main, sent to third
parties as a business action, or granted broader access.
