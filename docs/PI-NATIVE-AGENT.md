# Pi native Agent execution work

Backend branch base: PR60 `06e5c51daa66a76c0f736126dab26ee1a551dae0`. Existing backend fixes are selectively retained from PR62 backend source `c99dd31d0715077cc4f93c38d723f45718116f29`; no PR62 UI, screenshots or dependencies are included. Main is unchanged.

Pinned official packages: pi-agent-core / pi-ai / pi-durable / chord 1.1.0, upstream source `abe508e1b89912adde45528136c3221eb69acdd7`. The installed Agent supports prompt, native tool loop, awaited event subscribers, beforeToolCall/afterToolCall, prepareRequest, finishTurn, abort and waitForIdle. The Durable Harness supports registered custom tasks, persisted memos, original ToolTask intent and replay safety, JSONL fsync, explicit scheduling and abort ownership.

Current gap: Agent is constructed for canonical context only. Harness executes generation/tools, while Workspace also schedules structured JSON done/nextStep loops. This work will move conversational/tool continuation into an actual Agent.prompt invocation hosted by a native Durable task. Original tools retain their native ToolTask checkpoints; original Workspace retains admission, budget reservations, identity, exact approvals, audit and task authority. Native task IDs will be distinguished from submission IDs. Existing durable submissions remain recoverable through their original execution path.

Cross-platform Muse/Dot claim, lease, acknowledgment and ingress protocols are preserved. Private Library access/exfiltration limits remain. Real Pi package execution, controllable faux model transport and real-model E2E will be reported separately. No credentials, runtime stores, live/paid calls, deployment, main merge or force push are authorized.

This first checkpoint records reuse and scope only. New native Agent implementation and validation are not yet complete.
