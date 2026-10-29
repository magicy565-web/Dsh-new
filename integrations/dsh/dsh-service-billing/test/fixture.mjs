import { randomUUID } from "node:crypto";
import { CommerceStore } from "../../dsh-commerce-network/store.js";
import { createCommerceService } from "../../dsh-commerce-network/service.js";
import { ServiceBillingStore } from "../store.js";
import { createServiceBilling } from "../service.js";
import { createAccess, sha } from "@workspace-agent/dsh-commerce-contracts";
export async function fixture({ filename = ":memory:" } = {}) {
  let now = Date.parse("2026-11-30T12:00:00Z");
  const rows = [
      { id: randomUUID(), sessionIds: ["session", "second"] },
      { id: randomUUID(), sessionIds: ["foreign"] },
    ],
    registry = { list: () => rows, get: (id) => rows.find((r) => r.id === id) },
    cstore = new CommerceStore(":memory:"),
    commerce = createCommerceService({
      store: cstore,
      registry,
      clock: () => now,
    });
  let projectId;
  const execution = () => ({
    agent: { session: { id: "session" } },
    callId: randomUUID(),
    signal: new AbortController().signal,
  });
  const state = () => commerce.state("session", projectId),
    command = (command, payload) =>
      commerce.command("session", {
        projectId,
        command,
        payload,
        expectedRevision: state().revision,
        requestId: randomUUID(),
      });
  const plan = await commerce.toolCommand(
    {
      command: "apply_plan",
      requestId: randomUUID(),
      expectedRevision: 0,
      payload: {
        title: "Synthetic billing fixture",
        parties: [
          { id: "factory", type: "factory", displayName: "Synthetic Factory" },
          {
            id: "seller",
            type: "distributor",
            displayName: "Synthetic Seller",
          },
          {
            id: "operator",
            type: "provider",
            displayName: "Synthetic Operator",
          },
        ],
        products: [{ id: "product", name: "Synthetic Product" }],
      },
    },
    execution(),
  );
  projectId = plan.projectId;
  async function mandate(mode = "factory_sales", id = mode) {
    await command("propose_business_mandate", {
      id,
      title: "Synthetic service contract",
      principalPartyId: mode === "channel_subscription" ? "seller" : "factory",
      operatorPartyId: "operator",
      marketCode: "US",
      scope: "Synthetic testing only",
      productIds: ["product"],
      businessTerms: {
        version: 1,
        mode,
        currency: "USD",
        startDate: "2026-01-31",
        endDate: "2027-12-31",
        fixedFeeMinor: mode === "factory_sales" ? 10000 : null,
        monthlyFeeMinor: mode === "channel_subscription" ? 2900 : null,
        aiCredits: {
          payer: mode === "sourcing_commission" ? "operator" : "principal",
          policy: "Synthetic explicit policy",
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
        agreementEvidence: "Synthetic contract",
      },
    });
    await command("approve_mandate", { mandateId: id });
    return state().commerceNetwork.salesAuthorizations.find((m) => m.id === id);
  }
  const files = new Map();
  let reads = 0,
    intercept = null;
  const attachments = {
    async saveFile({ data, name = "synthetic-evidence.txt" }) {
      const key = `sha256:${sha(data)}`;
      files.set(key, Buffer.from(data));
      return { attachmentId: key, name, bytes: data.length };
    },
    async *readFileStream(ref) {
      if (typeof ref.name !== "string")
        throw new Error("Native file references require a name");
      reads++;
      if (intercept) intercept();
      yield files.get(ref.attachmentId) || Buffer.from("missing");
    },
  };
  const access = createAccess(registry),
    owner = access.owner("session"),
    store = new ServiceBillingStore(filename),
    service = createServiceBilling(store, {
      registry,
      commerce: () => commerce,
      attachments: () => attachments,
      clock: () => now,
    });
  const write = (action, input = {}, scope = owner) =>
    service.write(scope, { action, requestId: randomUUID(), ...input });
  const draft = async (m) =>
    (
      await write("draft", {
        projectId,
        mandateId: m.id,
        expectedMandateRevision: m.revision,
        kind:
          m.businessTerms.mode === "channel_subscription"
            ? "monthly_fee"
            : "fixed_fee",
        ...(m.businessTerms.mode === "channel_subscription"
          ? { periodStart: "2026-02-28" }
          : {}),
      })
    ).current;
  const issue = async (b) =>
    (await write("issue", { id: b.id, expectedRevision: b.revision })).current;
  const evidence = async (externalEventId = randomUUID()) => {
    const data = Buffer.from("Synthetic bank evidence " + externalEventId),
      ref = await attachments.saveFile({ data });
    return {
      ...ref,
      sha256: sha(data),
      provider: "synthetic-bank:account-1",
      externalEventId,
      occurredAt: new Date(now).toISOString(),
    };
  };
  return {
    store,
    service,
    access,
    owner,
    rows,
    registry,
    commerce,
    attachments,
    execution,
    command,
    state,
    mandate,
    draft,
    issue,
    write,
    evidence,
    projectId,
    setNow: (v) => (now = v),
    get now() {
      return now;
    },
    get reads() {
      return reads;
    },
    setIntercept: (fn) => (intercept = fn),
    close() {
      service.close();
      store.close();
      commerce.close();
      access.close();
    },
  };
}
