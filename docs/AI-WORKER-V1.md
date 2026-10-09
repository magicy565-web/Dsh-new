# AI Worker · Enterprise Growth Service Desk V1

**Status:** source-level feature branch, not live partner integration or production acceptance.
**Baseline:** Workspace Agent 0.5.0-rc.2 single-enterprise Node + React, not a multi-tenant SaaS.
**Product owner rule:** enterprise owners purchase/verifiably delegate a **business deliverable**, not tokens, chat turns or a specific agent personality.

## 1. Business contract

\`Enterprise Workspace → Service Catalog → Work Order → Admin Approval → Reviewed Worker Adapter → External Execution → Evidence and Artifact Review → Acceptance / Dispute → Enterprise Action\`.

- **Buyer:** company operator specifies product, target market, the desired work result, budget cap and deadline; admin approves external work.
- **Marketplace:** initial curated platform-approved service catalog, no self-service agent registration or executable uploads from the browser.
- **Orchestrator:** matches one service to a registered worker; the first version does not create a new DAG engine or attempt cross-worker automatic budget transfer.
- **Worker:** external organization or personal agent delivering the output according to a bounded task contract. It is *not* a Workspace member and never receives general Workspace/session credentials.
- **Acceptance:** signed provenance and independent fact validation are production roadmap, while this V1 clearly labels worker reports unverified and requires an admin acceptance action.

Do not disguise "list of agents" as services. Each service has buyer-facing deliverables and testable acceptance criteria.

### Curated service catalog

| Service ID | Entry | Delivery | Scope |
| --- | --- | --- | --- |
| \`buyer-discovery\` | 海外经销商开发 | Prospect list, sources and fit reasons | Public-only |
| \`channel-validation\` | 海外销售渠道验证 | Channel ranking, competitor evidence, validation experiment | Public-only |
| \`sales-assets\` | 海外销售素材包 | Editable English sales content and landing-page copy | Public-only |
| \`rfq-recovery\` | 历史询盘捞回 | Inquiry recovery, requalification and approved follow-up suggestions | **Not delegatable in V1**: private isolation prerequisite |

The sample credits are an *internal policy budget envelope*, NOT production prices, billing, a seller payout or payment authorization.

## 2. Worker plugin contract (host-only)

A host deployer binds reviewed workers by \`createApp({ workerAdapters })\`. The HTTP UI does **not** install remote URLs or arbitrary code and cannot provide token values.

The adapter registration shape:

\`\`\`ts
type ReviewedWorkerAdapter = {
  services: string[];
  displayName: string;
  ready: boolean; // reviewed connectivity, not a guessed green light
  budgetEnforced: boolean; // true only with a VERIFIED HARD CAP from partner / settlement
  submit(task: {
    orderId: string;
    idempotencyKey: string;
    serviceId: string;
    inputs: { product: string; market: string; objective: string };
    acceptance: string[];
    deadlineAt: string;
    maxCredits: number;
    dataScope: 'public';
  }): Promise<{ jobId: string }>;
  get(jobId: string): Promise<{
    jobId: string;
    status: 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';
    costCredits?: number;
    deliverables?: Array<{
      name: string; type: 'report' | 'table' | 'draft' | 'file';
      summary: string; sha256?: string; url?: string;
    }>;
    evidence?: Array<{ title: string; url?: string; detail?: string }>;
  }>;
  cancel(jobId: string): Promise<{ status: 'cancelled' | 'cancel_requested' }>;
  reconcile?(orderId: string): ReturnType<ReviewedWorkerAdapter['get']>; // illustrative; adapt to actual API
};
\`\`\`

Implementations may be vendor SDKs, A2A clients or a partner webhook/poll gateway. A2A is the closest interoperable transport for delegated remote *agents* and its Task / Artifact lifecycle; MCP is strongest for tool / resource integration, and MCP Tasks extends long-running tools. **Do not assume Muse, Dot or Grokbot offer supported hosted A2A/MCP worker APIs**; eligibility must be verified per provider before giving them "connected" badges.

**Only the adapter boundary converts transport wire formats into this canonical contract.** Never let third-party messages update enterprise budgets, permissions, task scope or goal instructions by themselves.

## 2a. A2A adapter implemented (not yet deployed)

\`server/worker-a2a-adapter.mjs\` maps an authenticated **official A2A JavaScript SDK client** to the approved Worker desk contract. It calls \`client.sendMessage\`, \`client.getTask\`, and \`client.cancelTask\`; *it does not rebuild A2A transports or Agent Card discovery*. There is no SDK dependency in the base application: the approved host must install it and construct an authenticated client as a separate, audited integration step.

Example integration skeleton (non-runnable until partner, signed/allowlisted Agent Card, credential and hard cap are verified):

\`\`\`js
import { ClientFactory } from '@a2a-js/sdk/client';
import { createA2AWorkerAdapter } from './server/worker-a2a-adapter.mjs';
import { createApp } from './server/index.mjs';

// trustedCard must be retrieved and authenticated by an approved deployment
// process; never populate it from a browser-provided URL.
const client = await new ClientFactory().createFromAgentCard(trustedCard);
const adapters = {
  reviewedDistributorResearch: createA2AWorkerAdapter({
    client, displayName: 'Verified Research Partner',
    services: ['buyer-discovery'],
    verifiedPartner: true, // requires actual operator verification
    verifiedHardBudget: true, // requires audited provider-side cap
  }),
};
const app = await createApp({ workerAdapters: adapters });
// Existing secure enterprise auth/ingress, provider and deployment configuration
// remain required. In production start the app as a separate reviewed host.
\`\`\`

The outgoing A2A \`message.parts[0].text\` is a JSON serialized **bounded public task contract** with stable \`orderId\`, exact \`maxCredits\`, \`deadlineAt\`, acceptance and scope. Partner agents **must respond with a durable A2A Task**, not only a text message. A matching completed Task may include an artifact data Part:

\`\`\`json
{
  "schema": "workspace.worker.delivery.v1",
  "orderId": "<same approved work order ID>",
  "costCredits": 4,
  "deliverables": [{ "name": "Buyer CSV", "type": "table", "summary": "Sourced B2B buyers" }],
  "evidence": [{ "title": "Company website", "url": "https://example.org/company", "detail": "Public source" }]
}
\`\`\`

An incorrect \`orderId\`, text-only response or unsourced output is **not an accepted delivery**. Native A2A cancellation statuses are translated to \`cancel_requested\` versus confirmed \`cancelled\`.

The A2A adapter has source-level fixture tests in \`test/worker-a2a-adapter.test.mjs\`; no real partner API/SDK client or paid work was exercised here. It is **not the complete commercial connector**: secure client authorization, verifiable egress allowlist, signed remote identity, hard-cap settlement, evidence authenticity and sandboxed file download require independent integration acceptance.

## 3. API introduced

| Method | Route | Behavior |
| --- | --- | --- |
| GET | \`/api/worker-services\` | Curated services, actual reviewed adapter availability |
| GET | \`/api/worker-orders\` | Single Workspace's durable orders |
| GET | \`/api/worker-orders/:id\` | Read exact order |
| POST | \`/api/worker-orders\` | Create idempotent consent-bound draft; operator or admin |
| POST | \`/api/worker-orders/:id/approve\` | Admin: confirm budget, partner, scope |
| POST | \`/api/worker-orders/:id/dispatch\` | Admin: issue exact task and store receipt |
| POST | \`/api/worker-orders/:id/refresh\` | Admin: check actual partner status; no simulated progress |
| POST | \`/api/worker-orders/:id/accept\` | Admin: manual delivery acceptance |
| POST | \`/api/worker-orders/:id/cancel\` | Admin: durable cancellation request, external acknowledgment required |

All mutation routes inherit existing same-host signed ingress / session, CSRF, audit and single-writer protections. Production deployment must preserve those boundaries. Legacy stores tolerate optional \`workerOrders\` until the first order is created.

Order statuses:
\`draft → approved → dispatching → running → review_required → accepted\`.
Exceptions: \`dispatch_uncertain\`, \`input_required\`, \`cancel_requested\`, \`cancelled\`, \`failed\`, \`result_incomplete\`, \`budget_dispute\`.
A lost submit response never authorizes resubmission. A cancel request never represents external cancellation without acknowledgment. Completed remote output is never automatically declared accepted.

### Typical request (create only: safe local draft)

\`\`\`json
{
  "serviceId": "buyer-discovery",
  "product": "Printed rayon fabric",
  "market": "United States",
  "objective": "Identify 20 US wholesalers/distributors with sourced reasons",
  "budgetCredits": 20,
  "deadlineAt": "2026-10-20T18:00:00.000Z",
  "requestId": "a31b12c9-64b1-4456-8192-f91347d3f126",
  "publicDataConfirmed": true
}
\`\`\`

The optional \`workerId\` must be a registered eligible adapter. A draft without a worker is valid; approval remains blocked. No order submission to external third parties is possible when no reviewed executor is enrolled.

## 4. What exists and what does not

### Implemented on this branch

- Outcome-first, mobile-compatible React Worker service desk with live API orders, measurable actual counts, task scope/consent, review and cancellation.
- Server-only reviewed plugin registry and positive \`budgetEnforced\` enrollment requirement; existing capability / goal / artifact infrastructure is preserved, not forked or replaced.
- Durable work-order records, idempotency, status polling, collision/replay protection on dispatch, explicit data sharing consent and budget dispute state.
- Evidence and deliverables rendered as **unverified Worker-submitted claims**; only human acceptance moves an order to \`accepted\`.
- Private inquiry recovery clearly disabled instead of sending proprietary RFQs to a public agent.
- Node unit tests committed for core lifecycle, A2A Task transformation, and HTTP persistence; CI/local execution status must be reported separately.

### Missing production gates

1. Authenticated and verified real external Worker connection: an A2A SDK adapter factory is coded, but no live partner SDK, identity verification, network endpoint or task was commissioned; other transports remain proposed.
2. A verified and enforceable account-wide credit or currency ceiling, reservations/settlement reconciliation, pricing conversion and payouts. The boolean adapter admission flag is **not** itself a verified billing cap.
3. Vendor signature/auth validation, sanitized artifact ingestion with MIME/malware/file provenance validation and independent sourcing evaluation.
4. Fine-grained private-data consent, encryption and time-limited read scope, DLP / PII guardrails and regional compliance for the RFQ service.
5. Dashboard business attribution (reply rates, qualified conversations, quotes, opportunity value), separate from claims of revenue generated by models.
6. Deployment, SSO/TLS, fully authorized live integration, browser/mobile visual regression, independent security review.

## 5. Next real business scenario: US distributor discovery

Definition of success: factory selects products and target, receives 20–50 uniquely sourced candidate businesses, can audit each candidate's relevance and add them as *proposed* outreach opportunities; then (separate authorized action) generates email drafts and CRM records. The partner must not automatically send mail or change prices without a new explicit scoped approval.

Proposed work tree:
\`Define ICP → Search evidence → Deduplicate → Score fit → Validate URLs → Deliver CSV/Markdown + sources → Review → Add to pipeline → Approve outreach\`.

Reuse existing DSH/Muse worker DAG, lease-fencing, budget accounting and approval connector if available and reviewed; this new service desk is the **business contract and presentation layer**, not a duplicate workflow engine.

## 6. Test / launch commands

\`\`\`sh
npm ci
node --test test/worker-desk.test.mjs
npm run typecheck
npm run build
npm run test:all
\`\`\`

This branch has not been independently deployed or exercised against a real remote third-party Worker. A successful fixture is not proof of sales outcomes, real API compatibility or financial hard cap.
