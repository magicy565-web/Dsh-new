# Real provider acceptance

A configured key is not proof of connectivity, correct behavior or deployability.
The ordinary test suite uses scripted responses and performs no paid model calls.

`node scripts/acceptance-provider.mjs` fails closed by default. Only after the
operator has supplied an authorized server-side provider key and explicitly
approved the test budget may the operator set WORKSPACE_ACCEPTANCE_APPROVED=1 and
run it with `--provider fastaitoken --execute-paid-requests --output /private/new-report.json`. FASTAITOKEN_MODEL must name the model explicitly approved for testing. For a separately approved official DeepSeek check use `--provider deepseek-api`.

For the selected relay, also set WORKSPACE_ACCEPTANCE_TOTAL_CAP_CNY=5 and
WORKSPACE_ACCEPTANCE_HARD_CAP_VERIFIED=1 only after that quota has actually been
configured and verified. These flags record the operator prerequisite; they do not
create, inspect or independently prove a relay spending limit.

The runner uses a new isolated temporary workspace, the real HTTP API and the
normal fixed, documented provider endpoint. It caps the entire run at five requests,
512 output tokens per request, 32,000 total input characters and a four-minute observation/admission deadline plus graceful shutdown.
The input-character/token limit is not a monetary price guarantee. Confirm the
current model price and the account's spending limit before executing; cancellation
can still incur provider charges. Failed acceptance is never retried automatically.
No connector, browser, external message, native tool or schedule is used.

Checks: first-turn response, duplicate-request idempotency, conversation context,
one-step structured goal/human-review boundary, durable artifact and restart
continuation, and in-flight cancellation. Cancellation can legitimately finish too
quickly to observe; such a run fails the cancellation gate and does not auto-retry.
The JSON evidence contains test outcomes, usage when reported, timestamps, limits
and the exact server/frontend source fingerprint; it omits message contents and
credentials. Temporary state is removed after the run.

A fixture test validates the runner itself and is labeled scripted-model-fixture.
It is not real-provider evidence. A successful direct-API report does not validate
native Harness tools, remote Worker execution, enterprise ingress, actual deployed
infrastructure or browser appearance. Those have separate launch gates.

Official provider API/model contracts checked on 2026-10-04:
https://docs.fastaitoken.com/docs/getting-started and
https://docs.fastaitoken.com/docs/api-manual

FastAIToken lists max_tokens among parameters still under development and does
not explicitly establish JSON response_format support in this manual. The
request cap is locally enforced; requested token limits must be verified against
the selected relay model and an account-side spending cap. Goal mode fails if
structured output is unsupported; it does not silently loosen validation.

Optional direct provider:
https://api-docs.deepseek.com/ and
https://api-docs.deepseek.com/api/create-chat-completion/

## Gate status

Real provider execution: not run; requires explicit authorization and secure
configuration. No historical pasted secret is reused. The runner is delivered as
an acceptance tool, not a claim that this gate passed.

## Live test authorization

The selected relay/model is FastAIToken / gpt-6-sol. A repository publication is
not authorization for paid calls. Before any live test, obtain an explicit total
budget covering retries and native internal model/tool loops, securely configure
a fresh credential, verify current pricing and establish an enforceable provider-
side cumulative hard cap. Never reuse a historical disclosed credential.

## Billing-mode and cumulative-cap prerequisite

Official [pricing documentation](https://docs.fastaitoken.com/docs/pricing) states
that a default key prioritizes per-call billing when available. Only the console
option “仅按量计费” forces token billing. A token-rate calculation therefore cannot
bound cost until the selected key's mode is known. Exact gpt-6-sol group/rates
require the authenticated [account pricing console](https://www.fastaitoken.com/account/pricing);
those account facts have not been verified here. Account currency and the conversion
of any non-CNY cap also remain unverified.

The API manual marks max_tokens as under development while the pricing guidance
recommends it. This does not establish an enforced per-request upper bound for
the selected model. Advertised quotas alone do not establish atomic in-flight
reservation, retry charges, native internal-call accounting or currency semantics.
Do not run a paid test until the selected key/account setup demonstrably contains
all charges within the explicitly approved total budget, including prior tests and retries in
this same round. If that cannot be established, the live test remains blocked.

Both acceptance CLIs now additionally require explicit operator declarations:

- WORKSPACE_ACCEPTANCE_KEY_BILLING_MODE=token-only or prefer-per-call, matching
  the actual selected key's mode
- WORKSPACE_ACCEPTANCE_MODEL_GROUP naming the verified selected model group
- WORKSPACE_ACCEPTANCE_ACCOUNT_CURRENCY using the actual three-letter currency
- WORKSPACE_ACCEPTANCE_BILLING_REVIEWED=1 after reviewing that model/group's price
- WORKSPACE_ACCEPTANCE_HARD_CAP_SEMANTICS_VERIFIED=1 after establishing coverage
  for in-flight requests, all retries, native internal calls and currency conversion

The earlier approval/total-cap/hard-cap flags remain required. These values record
operator review; the application does not provision or independently verify a
relay quota. Reports label them operator declarations and continue to label
provider max_tokens enforcement unverified. No prices or actual account values are
supplied in examples, no historic credential is reused, and no live test has run.

## Native session-lifecycle runner

The opt-in `npm run test:provider-native-live` entry point uses a fresh native
provider per application lifetime, the exact selected relay/model, fixed requested
SDK output limit, and explicit reviewed permission, relay, bridge and contained-
storage patches. It requires a NEW caller-selected isolated data directory whose
absolute path matches the pre-reviewed storage overlay; it never rewrites a
profile to make paths fit. In addition to native-profile review, it requires
WORKSPACE_ACCEPTANCE_NATIVE_TEXT_ONLY_PROFILE_VERIFIED=1 only after the operator
has verified that this isolated base-backed acceptance profile disables actionful
tools, workers and autonomous producers before boot. A prompt telling a model not
to use tools is not enforcement. The shipped sdk-minimal name does not imply a
tool-free profile: its native definition includes shell tools. Read the CLI usage
and review the exact final profile before arranging the test.

The native runner establishes only the conditions it actually observes: native
session mapping and event receipts, duplicate admission, persisted context after
owned-process restart, local artifact persistence and cancellation/shutdown.
It does not equate these checks with arbitrary native tool compatibility or profile
permission acceptance. Those remain separately reviewed live-profile evidence.
Scripted-Harness runner tests are labeled fixture evidence. A successful future
live text/session report cannot alone satisfy the native tool/profile launch gate.
