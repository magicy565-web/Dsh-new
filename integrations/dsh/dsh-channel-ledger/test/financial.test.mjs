import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../../dsh-quote-guard/test/fixture.mjs";
import { accepted } from "../../dsh-quote-guard/test/accepted-fixture.mjs";
import { createTradeRecords } from "../../dsh-mini-erp/trade-records.js";
import { sha } from "@workspace-agent/dsh-commerce-contracts";
test("collections and commission receipts require actual order/evidence and reject duplicates, excess and revoked terms", async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const mandate = {
    id: "m1",
    revision: 2,
    status: "active",
    marketCode: "US",
    productIds: ["context1"],
    terms: {
      validUntil: "2030-01-01T00:00:00Z",
      commissionBps: 500,
      productPins: [
        { contextId: "context1", productId: f.product.id, revision: 1 },
      ],
    },
    customerAssignments: [{ buyerId: "buyer1", status: "assigned" }],
  };
  const network = {
    state: () => ({
      workspaceId: f.w,
      projectId: "p1",
      revision: 1,
      commerceNetwork: { salesAuthorizations: [mandate] },
    }),
  };
  f.setNetwork(network);
  f.r = f.rfq.ownerWrite(f.session, {
    action: "assign_project",
    id: f.r.id,
    expectedRevision: f.r.revision,
    requestId: "assign",
    projectId: "p1",
  }).current;
  f.proposal.rfqRevision = f.r.revision;
  f.importBody.projectId = "p1";
  let q = await accepted(f);
  const order = f.erp.write(
    f.w,
    {
      action: "reserve",
      requestId: "trade-order",
      productId: "allocation1",
      buyerId: "buyer1",
      quantity: 10,
      expectedRevision: 1,
      expectedCatalogRevision: 1,
    },
    "fixture",
    {
      productId: f.product.id,
      skuId: "sku1",
      revision: 1,
      quantity: 10,
      unitPriceMinor: 1234,
      currency: "USD",
    },
  ).current;
  f.erp.write(f.w, {
    action: "confirm",
    requestId: "confirm-order",
    orderId: order.id,
  });
  f.quotes.linkOrder(f.owner, {
    requestId: "link-order",
    expectedRevision: q.revision,
    quoteId: q.quoteId,
    version: 1,
    orderId: order.id,
  });
  const bytes = Buffer.from(
      "Synthetic original payment receipt; no real payment",
    ),
    digest = sha(bytes),
    evidence = {
      attachmentId: `sha256:${digest}`,
      sha256: digest,
      bytes: bytes.length,
      provider: "fixture",
      externalEventId: "payment1",
      occurredAt: "2026-10-28T08:05:00Z",
    };
  const records = createTradeRecords(f.erp, {
    registry: f.registry,
    quotes: f.quotes,
    commerce: () => network,
    attachments: () => ({
      async *readFileStream() {
        yield bytes;
      },
    }),
  });
  const body = {
    requestId: "collection",
    expectedRevision: 0,
    projectId: "p1",
    kind: "collection",
    amountMinor: 1000,
    currency: "USD",
    orderId: order.id,
    evidence,
  };
  await records.recordFinancial(f.owner, body);
  assert.equal((await records.recordFinancial(f.owner, body)).replayed, true);
  await assert.rejects(
    () => records.recordFinancial(f.owner, { ...body, requestId: "duplicate" }),
    { code: "DUPLICATE_EVIDENCE" },
  );
  await assert.rejects(
    () =>
      records.recordFinancial(f.owner, {
        ...body,
        requestId: "excess",
        amountMinor: 13000,
        evidence: { ...evidence, externalEventId: "excess" },
      }),
    { code: "COLLECTION_LIMIT" },
  );
  const commission = {
    ...body,
    requestId: "commission",
    kind: "commission_paid",
    mandateId: "m1",
    mandateRevision: 2,
    amountMinor: 60,
    evidence: { ...evidence, externalEventId: "commission1" },
  };
  await assert.rejects(() => records.recordFinancial(f.owner, commission), {
    code: "COMMISSION_LIMIT",
  });
  commission.amountMinor = 50;
  await records.recordFinancial(f.owner, commission);
  assert.equal(
    (await records.recordFinancial(f.owner, commission)).replayed,
    true,
  );
  assert.equal(
    records.financial(f.owner, "p1").filter((r) => r.kind === "commission_paid")
      .length,
    1,
  );
  mandate.status = "revoked";
  await assert.rejects(
    () =>
      records.recordFinancial(f.owner, {
        ...commission,
        requestId: "revoked",
        evidence: { ...evidence, externalEventId: "commission2" },
      }),
    { code: "MANDATE_UNAVAILABLE" },
  );
  await assert.rejects(() => records.recordFinancial(f.tool, body), {
    code: "OWNER_REQUIRED",
  });
});
