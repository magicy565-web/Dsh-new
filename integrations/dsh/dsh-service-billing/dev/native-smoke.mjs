import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import Commerce from "../../dsh-commerce-network/index.js";
import Billing from "../index.js";
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
    title: "Synthetic independent billing",
    requestId: randomUUID(),
    expectedRevision: 0,
    parties: [
      { id: "seller", type: "distributor", displayName: "Synthetic Seller" },
      { id: "operator", type: "provider", displayName: "Synthetic Operator" },
    ],
  });
  const proposal = await execute("commerce_network_propose_business_mandate", {
    projectId: plan.projectId,
    requestId: randomUUID(),
    expectedRevision: plan.revision,
    id: "mandate",
    title: "Synthetic subscription",
    principalPartyId: "seller",
    operatorPartyId: "operator",
    marketCode: "US",
    scope: "Synthetic test only",
    businessTerms: {
      version: 1,
      mode: "channel_subscription",
      currency: "USD",
      startDate: "2026-01-01",
      endDate: "2099-12-31",
      fixedFeeMinor: null,
      monthlyFeeMinor: 2900,
      aiCredits: {
        payer: "operator",
        policy: "Included test usage; no automatic charge",
      },
      commission: null,
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
    kind: "monthly_fee",
    periodStart: "2026-01-01",
  });
  assert.equal(bill.current.amountMinor, 2900);
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
        amountMinor: 2900,
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
