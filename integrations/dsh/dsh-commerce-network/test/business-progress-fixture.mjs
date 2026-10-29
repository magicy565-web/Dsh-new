import { randomUUID } from "node:crypto";
import { CommerceStore } from "../store.js";
import { createCommerceService } from "../service.js";
export const now = Date.parse("2026-10-29T03:00:00Z");
export async function progressFixture(filename = ":memory:") {
  const workspaceId = randomUUID(),
    otherId = randomUUID();
  const registry = {
    list: () => [
      { id: workspaceId, sessionIds: ["session"] },
      { id: otherId, sessionIds: ["other"] },
    ],
    get: (id) => registry.list().find((w) => w.id === id),
  };
  const store = new CommerceStore(filename),
    service = createCommerceService({ store, registry, clock: () => now });
  let projectId;
  const state = () => service.state("session", projectId);
  const envelope = (command, payload, extra = {}) => ({
    projectId,
    command,
    payload,
    expectedRevision: state().revision,
    requestId: randomUUID(),
    ...extra,
  });
  const command = (name, payload, extra) =>
    service.command("session", envelope(name, payload, extra));
  const tool = (name, payload) =>
    service.toolCommand(envelope(name, payload), {
      agent: { session: { id: "session" } },
      callId: randomUUID(),
    });
  const plan = await tool("apply_plan", {
    title: "SYNTHETIC operating pilot",
    parties: [
      { id: "factory", type: "factory", displayName: "Synthetic factory" },
      { id: "operator", type: "provider", displayName: "Synthetic operator" },
    ],
    products: [{ id: "product", name: "Synthetic product" }],
    agents: [
      {
        id: "agent",
        providerPartyId: "operator",
        displayName: "Synthetic worker",
        skills: ["public_web_research"],
      },
    ],
    workOrders: [
      {
        id: "work",
        title: "Synthetic research",
        requesterPartyId: "factory",
        agentServiceId: "agent",
        brief: "Synthetic only",
        allowedActions: ["public_web_research"],
        allowedResourceRefs: [],
        maximumMinor: 0,
        currency: "USD",
        ttlSeconds: 3600,
      },
    ],
  });
  projectId = plan.projectId;
  const mandate = {
    id: "mandate",
    title: "Synthetic factory mandate",
    principalPartyId: "factory",
    operatorPartyId: "operator",
    marketCode: "US",
    scope: "Synthetic pilot",
    productIds: ["product"],
    routeIds: [],
    workOrderIds: [],
    businessTerms: {
      version: 1,
      mode: "factory_sales",
      currency: "USD",
      startDate: "2026-10-28",
      endDate: "2027-10-28",
      fixedFeeMinor: 10000,
      monthlyFeeMinor: null,
      aiCredits: { payer: "principal", policy: "Synthetic budget" },
      commission: {
        rateBps: 500,
        basis: "net_collected_goods",
        trigger: "verified_collection",
        refundRule: "proportional_reversal",
      },
      agreementEvidence: "Synthetic agreement only",
    },
  };
  await command("propose_business_mandate", mandate);
  await command("approve_mandate", { mandateId: "mandate" });
  const record = () =>
    state().commerceNetwork.salesAuthorizations.find((m) => m.id === "mandate");
  const input = (patch = {}) => ({
    mandateId: "mandate",
    expectedProgressRevision: record().progress?.revision || 0,
    stage: "channel_development",
    status: "active",
    responsiblePartyId: "operator",
    nextAction: "Review the proposed research",
    blocker: "",
    reason: "Synthetic owner assessment",
    workOrderIds: ["work"],
    outcomeIds: [],
    ...patch,
  });
  return {
    store,
    service,
    registry,
    workspaceId,
    projectId,
    state,
    command,
    tool,
    envelope,
    record,
    input,
    mandate,
  };
}
