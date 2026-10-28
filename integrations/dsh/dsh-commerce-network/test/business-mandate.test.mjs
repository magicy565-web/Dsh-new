import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommerceStore } from "../store.js";
import { createCommerceService } from "../service.js";
import {
  validateBusinessTerms,
  businessTermStatus,
  mandateCoversOrder,
} from "../../../../packages/domain-commerce-network/src/index.mjs";
import { buildCommerceGraph } from "../src/projection/network.mjs";
const now = Date.parse("2026-10-28T12:00:00Z");
const terms = (mode) => ({
  version: 1,
  mode,
  currency: "USD",
  startDate: "2026-10-28",
  endDate: "2027-10-28",
  fixedFeeMinor: mode === "factory_sales" ? 10000 : null,
  monthlyFeeMinor: mode === "channel_subscription" ? 2900 : null,
  aiCredits: {
    payer: mode === "sourcing_commission" ? "operator" : "principal",
    policy:
      "Synthetic agreement: explicit usage budget; no charge in this test",
  },
  commission:
    mode === "channel_subscription"
      ? null
      : {
          rateBps: 500,
          basis: "net_collected_goods",
          trigger: "verified_collection",
          refundRule: "proportional_reversal",
        },
  agreementEvidence: "Synthetic test agreement, not a real contract",
});
const payload = (mode) => ({
  id: mode,
  title: mode,
  principalPartyId: mode === "channel_subscription" ? "distributor" : "factory",
  operatorPartyId: "provider",
  marketCode: "US",
  scope: "Synthetic business flow",
  productIds: ["product"],
  routeIds: ["route"],
  workOrderIds: ["work"],
  businessTerms: terms(mode),
});
async function fixture(filename = ":memory:") {
  const workspaceId = randomUUID(),
    sessionId = randomUUID(),
    other = randomUUID(),
    registry = {
      list: () => [
        { id: workspaceId, sessionIds: [sessionId] },
        { id: other, sessionIds: ["other"] },
      ],
      get: (id) => registry.list().find((r) => r.id === id),
    };
  const store = new CommerceStore(filename),
    service = createCommerceService({ store, registry, clock: () => now });
  let projectId;
  const state = () => service.state(sessionId, projectId),
    execution = () => ({
      agent: { session: { id: sessionId } },
      callId: randomUUID(),
      signal: new AbortController().signal,
    });
  const envelope = (command, payload, extra = {}) => ({
    projectId,
    command,
    payload,
    requestId: randomUUID(),
    expectedRevision: state().revision,
    ...extra,
  });
  const command = (name, payload, extra) =>
    service.command(sessionId, envelope(name, payload, extra));
  const tool = (name, payload, extra) =>
    service.toolCommand(envelope(name, payload, extra), execution());
  const plan = await tool("apply_plan", {
    title: "MVP acceptance",
    parties: [
      { id: "factory", type: "factory", displayName: "Synthetic Factory" },
      {
        id: "distributor",
        type: "distributor",
        displayName: "Synthetic Seller",
      },
      { id: "provider", type: "provider", displayName: "Synthetic Operator" },
    ],
    products: [{ id: "product", name: "Synthetic Product" }],
    routes: [
      {
        id: "route",
        name: "US channel",
        market: "US",
        channel: "wholesale",
        productIds: ["product"],
      },
    ],
    agents: [
      {
        id: "agent",
        providerPartyId: "provider",
        displayName: "Synthetic Worker",
        skills: ["public_web_research"],
      },
    ],
    workOrders: [
      {
        id: "work",
        requesterPartyId: "factory",
        agentServiceId: "agent",
        title: "Synthetic research",
        brief: "Do not contact anyone",
        allowedActions: ["public_web_research"],
        allowedResourceRefs: [],
        maximumMinor: 0,
        currency: "USD",
        ttlSeconds: 3600,
      },
    ],
  });
  projectId = plan.projectId;
  return {
    store,
    service,
    state,
    command,
    tool,
    envelope,
    registry,
    sessionId,
    workspaceId,
    projectId,
    execution,
  };
}
const record = (f, id) =>
  f.state().commerceNetwork.salesAuthorizations.find((m) => m.id === id);
test("three commercial modes activate independently without reserving budget, granting Worker access or legacy commissions", async () => {
  const f = await fixture();
  try {
    const baseline = structuredClone(f.state().budget);
    for (const mode of [
      "factory_sales",
      "channel_subscription",
      "sourcing_commission",
    ]) {
      await f.tool("propose_business_mandate", payload(mode));
      assert.equal(record(f, mode).status, "proposed");
      await f.command("approve_mandate", { mandateId: mode });
      assert.equal(record(f, mode).effectiveStatus, "active");
      assert.equal(record(f, mode).billingStatus, "not_connected");
      assert.equal(mandateCoversOrder(record(f, mode), {}), false);
    }
    assert.deepEqual(f.state().budget, baseline);
    assert.equal(f.state().commerceNetwork.grants.length, 0);
    assert.equal(f.state().commerceNetwork.workOrders[0].status, "proposed");
    const graph = buildCommerceGraph(f.state(), f.projectId);
    assert.equal(
      graph.nodes.filter((n) => n.kind === "business_mandate").length,
      3,
    );
    assert.ok(
      graph.edges.some(
        (e) =>
          e.source === "business_mandate:factory_sales" &&
          e.target === "service_order:work",
      ),
    );
    await f.service.layout(f.sessionId, {
      projectId: f.projectId,
      requestId: randomUUID(),
      expectedLayoutRevision: 0,
      nodes: [
        { id: "business_mandate:factory_sales", position: { x: 10, y: 20 } },
      ],
    });
  } finally {
    f.service.close();
  }
});
test("amendment preserves approved history, requires reapproval, and cannot use the legacy amendment path", async () => {
  const f = await fixture();
  try {
    await f.command("propose_mandate", {
      id: "legacy",
      factoryPartyId: "factory",
      distributorPartyId: "distributor",
      productIds: ["product"],
      marketCode: "US",
      scope: "Retain old scope",
    });
    const legacy = structuredClone(record(f, "legacy"));
    await f.command("propose_business_mandate", payload("factory_sales"));
    await f.command("approve_mandate", { mandateId: "factory_sales" });
    const { id, ...next } = payload("factory_sales");
    next.mandateId = id;
    next.businessTerms.version = 2;
    next.businessTerms.fixedFeeMinor = 20000;
    await f.command("amend_business_mandate", next);
    const updated = record(f, id);
    assert.equal(updated.status, "proposed");
    assert.equal(updated.approvalReceiptId, undefined);
    assert.equal(updated.history[0].businessTerms.fixedFeeMinor, 10000);
    assert.equal(updated.history[0].status, "active");
    assert.deepEqual(record(f, "legacy"), legacy);
    await assert.rejects(() =>
      f.command("amend_mandate", { mandateId: id, terms: {} }),
    );
    await f.command("approve_mandate", { mandateId: id });
    await f.command("revoke_mandate", { mandateId: id });
    await assert.rejects(() =>
      f.command("amend_business_mandate", {
        ...next,
        businessTerms: { ...next.businessTerms, version: 3 },
      }),
    );
    assert.equal(f.state().commerceNetwork.workOrders[0].status, "proposed");
  } finally {
    f.service.close();
  }
});
test("owner-only review and amendment, same-project references, stale revision, draft completeness and changed product are enforced", async () => {
  const f = await fixture();
  try {
    const draft = payload("factory_sales");
    draft.businessTerms.fixedFeeMinor = null;
    await f.tool("propose_business_mandate", draft);
    await assert.rejects(
      () => f.command("approve_mandate", { mandateId: draft.id }),
      (e) => e.code === "BUSINESS_TERMS_INCOMPLETE",
    );
    await assert.rejects(
      () => f.tool("approve_mandate", { mandateId: draft.id }),
      (e) => e.code === "OWNER_ACTION_REQUIRED",
    );
    await assert.rejects(
      () => f.tool("amend_business_mandate", {}),
      (e) => e.code === "OWNER_ACTION_REQUIRED",
    );
    for (const overrides of [
      { productIds: ["foreign"] },
      { routeIds: ["foreign"] },
      { workOrderIds: ["foreign"] },
      { operatorPartyId: "factory" },
      { principalPartyId: "distributor" },
    ])
      await assert.rejects(() =>
        f.command("propose_business_mandate", {
          ...payload("factory_sales"),
          id: randomUUID(),
          ...overrides,
        }),
      );
    await assert.rejects(
      () =>
        f.command("propose_business_mandate", payload("channel_subscription"), {
          expectedRevision: 0,
        }),
      (e) => e.code === "REVISION_CONFLICT",
    );
    const other = await f.service.command("other", {
      command: "create_project",
      payload: { title: "Other workspace" },
      requestId: randomUUID(),
      expectedRevision: 0,
    });
    await assert.rejects(() =>
      f.service.command("other", {
        projectId: other.projectId,
        command: "propose_business_mandate",
        payload: payload("channel_subscription"),
        requestId: randomUUID(),
        expectedRevision: other.revision,
      }),
    );
    await f.command("propose_business_mandate", payload("sourcing_commission"));
    await f.command("upsert_product", {
      id: "product",
      name: "Changed product",
    });
    await assert.rejects(
      () => f.command("approve_mandate", { mandateId: "sourcing_commission" }),
      (e) => e.code === "BUSINESS_PRODUCT_CHANGED",
    );
  } finally {
    f.service.close();
  }
});
test("exact request replay remains single after restart and rejects changed content", async () => {
  const dir = mkdtempSync(join(tmpdir(), "business-mvp-")),
    filename = join(dir, "test.sqlite");
  const f = await fixture(filename);
  let restored;
  try {
    const request = f.envelope(
      "propose_business_mandate",
      payload("channel_subscription"),
    );
    const first = await f.service.command(f.sessionId, request);
    const replay = await f.service.command(f.sessionId, request);
    assert.equal(replay.receipt.replayed, true);
    assert.equal(replay.revision, first.revision);
    await assert.rejects(
      () =>
        f.service.command(f.sessionId, {
          ...request,
          payload: { ...request.payload, title: "different" },
        }),
      (e) => e.code === "REQUEST_ID_CONFLICT",
    );
    f.service.close();
    restored = createCommerceService({
      store: new CommerceStore(filename),
      registry: f.registry,
      clock: () => now,
    });
    const after = await restored.command(f.sessionId, request);
    assert.equal(after.receipt.replayed, true);
    assert.equal(after.commerceNetwork.salesAuthorizations.length, 1);
  } finally {
    (restored || f.service).close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("commercial terms reject mixed charges, invalid dates, implicit amounts and unsupported commission policy", () => {
  for (const [mode, patch] of [
    ["sourcing_commission", { fixedFeeMinor: 1 }],
    ["sourcing_commission", { aiCredits: { payer: "principal", policy: "x" } }],
    ["channel_subscription", { commission: terms("factory_sales").commission }],
    ["factory_sales", { monthlyFeeMinor: 1 }],
    ["factory_sales", { startDate: "2026-02-30" }],
    ["factory_sales", { fixedFeeMinor: 0.1 }],
    ["factory_sales", { endDate: "2026-10-27" }],
  ])
    assert.throws(() =>
      validateBusinessTerms(
        { ...terms(mode), ...patch },
        { complete: true, now },
      ),
    );
  const zero = { ...terms("factory_sales"), fixedFeeMinor: 0 };
  assert.equal(
    validateBusinessTerms(zero, { complete: true, now }).fixedFeeMinor,
    0,
  );
  assert.throws(() =>
    validateBusinessTerms(
      { ...zero, fixedFeeMinor: null },
      { complete: true, now },
    ),
  );
  assert.throws(() =>
    validateBusinessTerms({
      ...zero,
      commission: { ...zero.commission, rateBps: 10001 },
    }),
  );
  assert.throws(() => validateBusinessTerms({ ...zero, chargeNow: true }));
  assert.equal(
    businessTermStatus(
      { status: "active", businessTerms: { ...zero, startDate: "2026-10-29" } },
      now,
    ),
    "scheduled",
  );
  assert.equal(
    businessTermStatus(
      { status: "active", businessTerms: { ...zero, endDate: "2026-10-28" } },
      now,
    ),
    "active",
  );
  assert.equal(
    businessTermStatus(
      { status: "active", businessTerms: { ...zero, endDate: "2026-10-27" } },
      now,
    ),
    "expired",
  );
});
