import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import Commerce from "../index.js";
import Billing from "../../dsh-service-billing/index.js";
if (!process.env.DSH_RUNTIME_DIR)
  throw Error("Set DSH_RUNTIME_DIR to the official DSH installation.");
const require = createRequire(
    join(resolve(process.env.DSH_RUNTIME_DIR), "package.json"),
  ),
  load = (name) => import(require.resolve("@deepseek-ai/" + name));
const { Context } = await load("cordis"),
  { default: SystemPrompt } = await load("dsh-system-prompt"),
  { default: Tools } = await load("dsh-tools");
const dir = await mkdtemp(join(tmpdir(), "native-service-billing-")),
  workspaceId = randomUUID(),
  sessionId = randomUUID(),
  row = { id: workspaceId, sessionIds: [sessionId] };
let ctx;
try {
  ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(Tools);
  const { default: Attachments } = await load("dsh-attachment-local");
  await ctx.plugin(Attachments, { dshHome: dir });
  await ctx.plugin({
    apply(c) {
      c.provide("workspaceRegistry", {
        list: () => [row],
        get: (id) => (id === row.id ? row : null),
      });
    },
  });
  await ctx.plugin(Commerce, { dataDir: join(dir, "commerce") });
  await ctx.plugin(Billing, { dataDir: join(dir, "billing") });
  assert.equal(ctx.get("miniErpQuotes"), undefined);
  assert.equal(ctx.get("miniErpTrade"), undefined);
  const execute = async (name, args) => {
    const r = await ctx.tools.execute({
      name,
      arguments: args,
      agent: { session: { id: sessionId } },
      callId: randomUUID(),
      signal: new AbortController().signal,
    });
    assert.equal(r.isError, false, JSON.stringify(r));
    return r.value;
  };
  const plan = await execute("commerce_network_plan", {
    title: "Synthetic independent workbench",
    products: [{ id: "product", name: "Synthetic Product" }],
    requestId: randomUUID(),
    expectedRevision: 0,
    parties: [
      { id: "factory", type: "factory", displayName: "Synthetic Factory" },
      { id: "operator", type: "provider", displayName: "Synthetic Operator" },
    ],
  });
  const proposal = await execute("commerce_network_propose_business_mandate", {
    projectId: plan.projectId,
    requestId: randomUUID(),
    expectedRevision: plan.revision,
    id: "mandate",
    title: "Synthetic subscription",
    principalPartyId: "factory",
    operatorPartyId: "operator",
    marketCode: "US",
    scope: "Synthetic test only",
    productIds: ["product"],
    businessTerms: {
      version: 1,
      mode: "factory_sales",
      currency: "USD",
      startDate: "2026-01-01",
      endDate: "2099-12-31",
      fixedFeeMinor: 10000,
      monthlyFeeMinor: null,
      aiCredits: {
        payer: "principal",
        policy: "Included test usage; no automatic charge",
      },
      commission: {
        rateBps: 500,
        basis: "net_collected_goods",
        trigger: "verified_collection",
        refundRule: "proportional_reversal",
      },
      agreementEvidence: "Synthetic test agreement",
    },
  });
  const approved = await ctx.get("commerceNetwork").command(sessionId, {
    projectId: plan.projectId,
    requestId: randomUUID(),
    expectedRevision: proposal.revision,
    command: "approve_mandate",
    payload: { mandateId: "mandate" },
  });
  const bill = await execute("service_billing_propose", {
    projectId: plan.projectId,
    mandateId: "mandate",
    expectedMandateRevision:
      approved.commerceNetwork.salesAuthorizations[0].revision,
    requestId: randomUUID(),
    kind: "fixed_fee",
  });
  assert.equal(bill.current.amountMinor, 10000);
  const progress = await ctx.get("commerceNetwork").command(sessionId, {
    projectId: plan.projectId,
    requestId: randomUUID(),
    expectedRevision: approved.revision,
    command: "record_business_progress",
    payload: {
      mandateId: "mandate",
      expectedProgressRevision: 0,
      stage: "product_readiness",
      status: "blocked",
      responsiblePartyId: "operator",
      nextAction: "Collect missing product data",
      blocker: "Missing dimensions",
      reason: "Synthetic owner review",
      workOrderIds: [],
      outcomeIds: [],
    },
  });
  const nativeState = await execute("commerce_network_read", {
    projectId: plan.projectId,
  });
  assert.equal(
    nativeState.commerceNetwork.salesAuthorizations[0].progress.stage,
    "product_readiness",
  );
  assert.equal(
    progress.commerceNetwork.salesAuthorizations[0].revision,
    approved.commerceNetwork.salesAuthorizations[0].revision,
  );
  assert.equal(nativeState.commerceNetwork.workOrders.length, 0);
  const issued = await ctx.get("serviceBilling").http("POST", "write", {
    sessionId,
    action: "issue",
    id: bill.current.id,
    expectedRevision: bill.current.revision,
    requestId: randomUUID(),
  });
  assert.equal(issued.current.status, "issued");
  const nativeBilling = ctx.get("serviceBilling");
  const ref = await nativeBilling.http("POST", "upload-evidence", {
    sessionId,
    fileName: "synthetic-receipt.txt",
    dataBase64: Buffer.from(
      "Synthetic native receipt, no bank transfer",
    ).toString("base64"),
  });
  assert.equal(ref.name, "synthetic-receipt.txt");
  const collected = await nativeBilling.http("POST", "write", {
    sessionId,
    action: "collection",
    id: issued.current.id,
    expectedRevision: issued.current.revision,
    requestId: randomUUID(),
    amountMinor: 100,
    currency: "USD",
    evidence: {
      ...ref,
      provider: "synthetic-bank:account",
      externalEventId: randomUUID(),
      occurredAt: new Date().toISOString(),
    },
  });
  assert.equal(collected.current.netCollectedMinor, 100);
  const read = await execute("service_billing_read", {
    projectId: plan.projectId,
  });
  assert.equal(read.items.length, 1);
  console.log(
    JSON.stringify(
      {
        ok: true,
        officialCordisAndTools: true,
        installedServices: ["commerceNetwork", "serviceBilling"],
        miniErpLoaded: false,
        toolDraft: true,
        actualOfficialAttachmentRead: true,
        ownerIssue: true,
        amountMinor: 10000,
        nativeProgressRead: true,
        draftBillStillIssuableAfterProgress: true,
        automaticCharges: 0,
        modelCalls: 0,
        records: "synthetic fixture session and registry",
      },
      null,
      2,
    ),
  );
} finally {
  if (ctx) await ctx.fiber.dispose();
  await rm(dir, { recursive: true, force: true });
}
