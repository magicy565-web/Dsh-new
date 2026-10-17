> 上游设计/交接记录；其中的旧分支、完成状态和历史验证不代表本次验收。当前结论见 [统一插件验收](OMP-ALL-PLUGINS-INTEGRATION-20261017.md)。

# Business Brain product slice

This branch completes the first evidence-first Business Brain vertical slice without introducing a second task engine.

## Runtime boundary

The existing Pi/OMP-backed Workspace conversation remains the execution surface. Business Brain is a bounded decision layer:

`source observation → signal → diagnosis → homepage recommendation → existing Goal/Conversation → existing Run/Worker`

The Brain does not execute external actions, create a second queue, own Worker lifecycle, or grant approvals.

## First business observations

The source adapter projects only existing Workspace state:

- recent inquiry pipeline;
- inquiry aging with a fixed seven-day stale threshold;
- product sales-material completeness.

The adapter returns counts and bounded observations, not buyer identities, notes, credentials, raw documents, or inferred sales outcomes.

## Cold start

A fresh Brain binding can diagnose authorized metric sources before a persisted Brain context exists. Once context is saved, the same original Host revalidates exact source references and the existing Goal chain remains authoritative.

## Homepage

Business Brain Home is mobile-first and intentionally small:

- at most three dynamic action cards;
- cards contain the problem, why it matters, evidence count, and one primary action;
- the home composer sends directly into the existing main Workspace conversation;
- card actions never execute external business operations directly;
- the home brief refreshes every 30 seconds instead of following the app's two-second bootstrap refresh.

## Production Host boundary

Production Brain remains fail-closed. The original Workspace Host must supply the reviewed library-read policy, reviewed Goal definitions, enterprise identity/session, and approved receiver for the current Session. This is a Session-scoped Host concern, not a static environment-file grant. No permissive placeholder authorization is introduced.

## Second slice completed

The home now has a real deterministic decision preview:

`signal → diagnosis → competing hypotheses → options → verification window`.

A recommendation without an existing Goal can be turned into the existing Workspace Goal record with an idempotent request key. This action only creates a draft Goal; it does not start an external Worker, approve a connector action, or mutate Shopify.

The source adapter now uses completed daily observation windows and stable data-derived observation timestamps. This prevents unchanged sources from appearing changed simply because the homepage refreshed.

The primary Business Brain adapter can also compose explicitly namespaced read-only adapters such as the existing `commerce-cohort:` supplier sales observation adapter.

## Still not claimed as complete

The current slice does not claim that the repository has passed Node 24 build/tests, a live production Session, a live Worker execution, or a real outcome-review observation. Those remain acceptance gates rather than being represented by fixtures or synthetic success.
