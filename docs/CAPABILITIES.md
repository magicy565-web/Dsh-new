# Guarded local capabilities

`server/capabilities.mjs` provides persisted instruction skills, connector configuration, explicit approvals, and local goal schedules. It does not install packages, execute shell commands, start MCP servers, call models, send messages, or register operating-system cron jobs. Production connector adapters are deliberately absent. A configured adapter is reviewed server code, not a URL or command supplied through the API.

## Integration and persistence

```js
import { createCapabilityService, CapabilityError } from './server/capabilities.mjs';

const capabilities = await createCapabilityService({
  store,
  clock: () => Date.now(),
  dispatchGoal: async ({ goalId, requestId, scheduleId, dueAt, expectedGoalDefinitionHash }) => {
    // Recheck expectedGoalDefinitionHash inside the SAME goal admission transaction,
    // then enqueue the existing goal and retain requestId for idempotency.
    return { status: 'queued' }; // Or blocked / skipped, never model completion.
  },
  adapters: {},
  environment: process.env,
  adapterTimeoutMs: 60_000,
  dispatchTimeoutMs: 10_000,
  executionContext: { kind: 'deepseek-api', model: null, permissionFingerprint: null },
});
```

The store must provide `read()` returning a copy and `update(syncCallback)` committing serialized, atomic transactions before resolving. The service adds `state.capabilities` when absent, with `version: 1` and `skills`, `connectors`, `approvals`, `schedules`, `scheduleRuns`, and `connectorRuns` arrays. Existing arrays are preserved. Invalid collection structure rejects initialization instead of resetting data. Store schema v2 also initializes this domain. There is no external database or hidden credential file.

Call `await capabilities.close()` before closing the store. Closing rejects new mutations, interrupts adapters and goal dispatch waits, records uncertain outcomes, and awaits accepted persistence. Adapters should honor their AbortSignal; even an adapter that ignores cancellation cannot hold this service open indefinitely or overwrite the recorded outcome later. An ignored cancellation may still finish an external action. No retry is automatic. Process-restart recovery marks in-progress executions interrupted and disables affected schedules.

`CapabilityError` has safe `status`, `code`, and `message` fields. Never return raw adapter exception messages through an HTTP handler.

## Instruction skills

- `listSkills()`, `getSkill(id)`, `createSkill(input)`, `updateSkill(id, input)`, `deleteSkill(id)`
- Inputs: `name`, `description`, `instructions`, `enabled`. Creation defaults to disabled; instructions are limited to 24,000 characters
- `getPromptSkills()` returns up to 20 enabled `{id, name, instructions, revision}` records for host-owned context formatting. The host must apply its aggregate context budget and identify these as user-saved instructions subordinate to runtime permissions

`assertSafeMemory(content)` is a synchronous host hook for memory creation/update. It rejects declared credential values (including common encodings), credential assignments, recognized key tokens, and private-key material. It never enumerates the environment or stores the checked text. The host must also check its model-provider key and any other separately owned credentials. Pattern checks are conservative safeguards, not a general secret classifier.

A skill is instruction text, not executable code. Enabling it grants no filesystem, network, credential, tool, or installation permission. The service never interpolates it into a command.

## Connector registry and execution

- `listConnectors()`, `getConnector(id)`, `createConnector(input)`, `updateConnector(id, input)`, `deleteConnector(id)`
- Inputs: `name`, `description`, `adapter`, `capabilities`, `credentialRefs`, `enabled`. New connectors must be disabled; enabling a saved configuration does not run it
- `listConnectorRuns()` reads execution receipts. A run's `succeeded` status means the configured adapter returned successfully; it is not an independent verification of the remote system

An adapter supplied at server creation has this interface:

```js
const adapters = {
  reviewedDocs: {
    capabilities: ['read_document'],
    credentialEnvNames: ['REVIEWED_DOCS_TOKEN'],
    async execute({ connectorId, action, resource, payload, credentials, signal, idempotencyKey }) {
      // Implement this operation in reviewed server code. Honor signal and dedupe
      // idempotencyKey whenever the downstream system supports it.
      return { result: 'JSON result' };
    },
  },
};
```

Registration uses `credentialRefs: { token: 'REVIEWED_DOCS_TOKEN' }`. Both the connector and the adapter must explicitly declare the action. Every environment reference must be in that adapter's server-configured `credentialEnvNames`. The service reads only those reviewed environment names, never scans all environment values or searches user files. Raw key/password/token fields and non-name credential references are rejected. Raw credentials resolve only after approval consumption, remain in memory for the invocation, and are not persisted. Known credential echoes, URI-encoded/base64 echoes, and sensitive result keys are redacted before results reach storage or callers. Other raw adapter errors are suppressed.

`adapterConfigured` and `credentialConfigured` describe local setup only. `connectionVerified` is always false. A missing adapter, disabled connector, mismatched declaration, or missing credential returns an honest blocked outcome and does not consume approval. No adapter is inferred from an integration name, and a connector never launches MCP or arbitrary processes by itself.

### Exact approval flow

```js
const request = { action: 'read_document', resource: 'document:123', payload: { section: 'summary' } };
const scope = capabilities.connectorApprovalRequest(connectorId, request);
const { approval } = await capabilities.requestApproval(scope);
// Show the complete action, resource and payload to the local operator first.
await capabilities.decideApproval(approval.id, { decision: 'approved', confirmed: true });
const { execution } = await capabilities.executeConnector(connectorId, { ...request, approvalId: approval.id });
```

The host must obtain an actual operator decision before calling `decideApproval`; model text and adapter results cannot authorize themselves. The local API is for a single trusted operator, not a multi-tenant permission service. Keep the application loopback-only and retain its host/origin protections.

The canonical scope is action `connector.execute`, resource `connector:<id>`, and payload `{connectorRevision, adapter, action, resource, payload}`. A SHA-256 digest binds exact normalized JSON, independent of object key order. Any connector edit invalidates earlier scopes. Approval creation is pending, not permission. Decisions require `{decision: 'approved' | 'denied', confirmed: true}`. Expiration defaults to 300 seconds and must be 1–3,600 seconds. Consumption rechecks decision, expiration, action, resource, stored payload digest, and current payload digest in the same store transaction that records execution admission. Consumption precedes the adapter call. A single approval cannot be reused, including concurrent calls, failures, timeouts, or process restarts. An unchanged-action retry still requires another approval.

`requestApproval`, `decideApproval`, `getApproval`, and `listApprovals` are the approval APIs. Only `connector.execute` and `schedule.enable` are accepted action families. Payloads are bounded to 64 KB and 24 nesting levels; unsupported JSON and prototype-unsafe keys are rejected.

## Local schedules

- `listSchedules()`, `getSchedule(id)`, `createSchedule(input)`, `updateSchedule(id, input)`, `deleteSchedule(id)`
- Inputs: `title`, `goalId`, `kind: 'at' | 'every'`, `scheduledAt`, and `everySeconds` for recurring schedules
- `scheduledAt` is an RFC 3339 instant with an explicit timezone. New or explicitly changed instants must be future. An `every` schedule can omit it and starts one interval after creation
- `everySeconds` must be 60–31,536,000. Daily/weekly/calendar/cron expressions and timezone-based recurrence are intentionally unsupported here; do not reinterpret them as fixed-duration intervals
- Schedules reference existing local goals. They cannot create arbitrary external actions, reset completed goals, or bypass the host's goal budget and status checks

Every new schedule is disabled. To enable:

```js
const scope = capabilities.scheduleApprovalRequest(scheduleId);
const { approval } = await capabilities.requestApproval(scope);
// Display scope, future recurring behavior, goal and budget for operator review.
await capabilities.decideApproval(approval.id, { decision: 'approved', confirmed: true });
await capabilities.enableSchedule(scheduleId, { approvalId: approval.id });
```

The scope binds the schedule revision, title, goal ID, goal title/description, step limit, total output-token budget, current global model, immutable server execution context, rule, next instant, and interval. Missing legacy output budgets normalize to `(maxSteps ?? 3) * 1600`. The consumed enable approval records standing consent for that exact goal definition and schedule. Any schedule edit disables it and needs new consent. Goal-definition, budget, model, or runtime/profile-context changes block dispatch until reviewed again. The approval's expiry controls when enable may occur; an enabled recurring schedule remains active until disabled, edited, blocked, deleted, or the service stops. `disableSchedule(id)` immediately prevents future admission, while already admitted work may finish. Deletion does not cancel already enqueued goals or remove historical receipts.

The service creates no timer. The host may drive `tick()` with a local process timer; nothing runs while the server is stopped. An idle tick performs no write. With no `dispatchGoal`, tick returns `DISPATCH_UNAVAILABLE` and does not claim work. For each due occurrence, a synchronous transaction records a claim and advances or retires the schedule before calling the dispatcher. Concurrent ticks cannot claim the same occurrence twice. Recurring schedules enqueue only the latest missed occurrence, not an unbounded backlog, then advance to a future instant. The dispatcher receives `{goalId, requestId, scheduleId, dueAt, expectedGoalDefinitionHash}`. The goal runtime must recheck the expected hash inside the same transaction that admits the run; checking only at schedule claim leaves a race with a concurrent goal edit. The hashed definition is `{title, description, maxSteps, maxOutputTokens, model}`, with `model` from current workspace settings. The immutable server `executionContext` is separately bound to consent and rechecked at tick, including after restart. Its deterministic request ID derives from schedule ID and due instant and must be retained for durable goal deduplication.

The dispatcher must return `{status: 'queued' | 'blocked' | 'skipped'}` or the runtime's `{goal: {id, status}}` result. Only runtime goal status `queued` or `running` counts as admission. A blocked/completed/missing goal is never automatically reset. A refused, failed, timed-out, or interrupted dispatch disables the affected schedule. It is not retried automatically. One-shot occurrences cannot silently replay; choose a new future instant and approve again.

`listScheduleRuns()` returns the receipts. `queued` acknowledges local enqueue only, not model start, model completion, or an external action. Claims and goal persistence are separate writes. A crash after claiming but before enqueue may lose that occurrence; uncertain claims remain visible and are not retried. This deliberate at-most-once admission policy avoids claiming exactly-once delivery across two stores. The operator must inspect the goal before creating another approved attempt.

## Relationship to native Harness

The implementation was checked against the real source at `muse-development/deepseek-harness-enterprise`, including `packages/mcp/mcp-client`, `packages/goal/goal`, and `packages/schedule/schedule`. It follows native principles of explicit opt-in adapters, declared capabilities, durable goal dispatch, minimum-minute intervals, latest-missed recurrence, and honest receipts. It does not pretend that registering a connector starts a native MCP connection, that enqueue completes a goal, or that this smaller scheduler provides Harness's full calendar recurrence model. Native Harness tool authority remains in the separately reviewed profile. This module does not edit or weaken that profile.

## Verification

Run `node --test test/capabilities.test.mjs`. Tests use temporary stores, inert injected adapters, fake time, and local enqueue callbacks. They cover restart persistence, defaults, raw-credential rejection and output redaction, missing adapters, denied/pending/expired/mismatched/stale/tampered/reused approvals, concurrent execution, bounded timeout/shutdown, schedule-budget changes, disabled scheduling, skipped/failed dispatch, latest-missed recurrence, duplicate ticks, one-shot retirement, idle-write avoidance, and uncertain-restart recovery. They make no real provider, connector, credential, spending, external-message, or cron calls.
