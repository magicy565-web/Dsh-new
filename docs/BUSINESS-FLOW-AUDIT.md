# Business-flow audit and implementation checkpoint

Scope: one enterprise, shared workspace, one backend writer. This audit traced the
actual user interaction and provider input/output path rather than treating test
counts, registries or API presence as evidence of a complete agent product.

## Confirmed gaps in the prior candidate

1. `server/runtime.mjs:contextMessages` included global enabled skills and memory,
   but no artifact bytes or selected connector capabilities. `createRuntime` had
   no artifact or capability service. File/connector management APIs existed
   independently of conversation execution.
2. The chat composer could not select task inputs. Saving an assistant response
   created a `category: saved` memory instead of an actual versioned artifact.
3. Goal responses supported only `{done,content,nextStep}`. There was no durable
   visible plan, proposed application action, wait-for-approval run state, actual
   connector receipt injected into continuation, or generated output publication.
4. Native SDK approval replies were unsupported. Registering a Workspace
   connector or approving it in the management UI did not grant a native tool.
   The existing native continuation filter also omitted application references
   and receipts whenever they were not in the final user turn.
5. Repeating schedules repeatedly resumed one lifetime-bounded goal. After its
   first final output, the next occurrence encountered `GOAL_TERMINAL`; this did
   not implement repeated delivery of a recurring task.

## Implemented direction

- Explicit conversation/task selection pins file versions, skill revisions,
  eligible memory and allowed connector actions. The run stores a bounded input
  snapshot; files are actually read and integrity checked. New conversations
  start with no optional context selected. Legacy records remain distinguishable.
- The application interprets a bounded structured response as a proposal. It
  never treats model-generated text as consent. Approvals bind the originating
  run, conversation, proposal, execution fingerprint, connector revision, action,
  resource and payload. Actual execution remains a separate user action.
- The same run resumes after approved execution, with its saved adapter receipt,
  budgets, visible plan and optional final text artifact. Connector failures and
  uncertain outcomes are retained and never automatically replayed.
- A shipped `workspace-library` adapter performs actual local text-file
  read/create/update operations. It needs no credential or network and remains
  disabled until configured by an administrator. Writes append immutable file
  versions and require exact action approval.
- Generated text files use the real artifact service and source associations.
  Stable step identities prevent duplicate publication. Atomic admission checks
  fence a canceled or replaced run after bytes are staged but before metadata
  publication. Outputs are drafts until the user reviews them.
- Recurring task template mode is explicit and bounded; legacy schedules do not
  silently acquire fresh budgets. See the current capability documentation and
  tests for the implemented mode and admission rules.

## Functional boundary

This is an application-owned execution bridge. It does not install an MCP server,
configure credentials, change the native permission profile, answer native SDK
approval requests, run arbitrary model-generated code, or create an external
worker. Native profile tools retain their independent permission boundary.

Only TXT, Markdown, CSV and JSON are accepted as selected model-readable files.
PDF/image bytes may be stored/downloaded but are not parsed as model input. A
plain text provider remains a text provider; the host performs only the explicitly
selected and approved connector operation. Production remote adapters still need
their own reviewed implementation and deployment configuration.

The tests use local scripted model outputs. Files, HTTP routing, input selection,
approval consumption, runtime state, local connector execution and restart
persistence are real application code. They establish local functional closure,
not live provider correctness, native tool policy acceptance, visual fidelity,
production ingress or a financial hard cap.

## Current verification sources

- `test/business-flows.test.mjs`: end-to-end local HTTP business flows
- `test/run-output.test.mjs`: output provenance, idempotency, cancellation and
  real local library adapter behavior
- `test/task-context.test.mjs`: selected context and stale-input checks
- `test/workspace-bridge.test.mjs`: proposal parsing, scopes and run continuation
- `test/ui.dom.test.mjs`: built React with real HTTP and interaction regressions
- `evidence/local-verification.json`: generated only after the complete offline gate passes; no historical evidence file is committed to this repository

The authoritative handoff summary is `00_READ_FIRST_WORK_HANDOFF.md`. Its passed,
failed and unrun stages take precedence over historical evidence files.
