import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../../dsh-quote-guard/test/fixture.mjs";
import { createTradeRecords } from "../../dsh-mini-erp/trade-records.js";
import { sha } from "@workspace-agent/dsh-commerce-contracts";
import { accepted } from "../../dsh-quote-guard/test/accepted-fixture.mjs";
test("accepted quote keeps order command independent; samples require fee, stock and actual attached event bytes", async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const q = await accepted(f);
  assert.equal(q.status, "accepted");
  assert.equal(f.erp.read(f.w, { entity: "order" }).items.length, 0);
  const bytes = Buffer.from("Synthetic original receipt bytes"),
    digest = sha(bytes);
  const records = createTradeRecords(f.erp, {
    registry: f.registry,
    quotes: f.quotes,
    attachments: () => ({
      async *readFileStream() {
        yield bytes;
      },
    }),
    commerce: () => null,
  });
  const evidence = {
    attachmentId: `sha256:${digest}`,
    sha256: digest,
    bytes: bytes.length,
    provider: "synthetic",
    externalEventId: "fee1",
    occurredAt: "2026-10-28T08:00:00Z",
  };
  let s = (
    await records.write(f.tool, {
      action: "propose",
      requestId: "sample",
      expectedRevision: 0,
      quoteId: q.quoteId,
      quoteVersion: 1,
      quantity: 10,
      address: "Synthetic address only",
    })
  ).current;
  assert.equal(s.status, "draft");
  assert.equal(s.feeMinor, null);
  await assert.rejects(
    () =>
      records.write(f.tool, {
        action: "approve",
        requestId: "not-owner",
        id: s.id,
        expectedRevision: s.revision,
        evidence,
        feeMinor: 0,
        currency: "USD",
      }),
    { code: "OWNER_REQUIRED" },
  );
  await assert.rejects(
    () =>
      records.write(f.owner, {
        action: "ship",
        requestId: "early",
        id: s.id,
        expectedRevision: s.revision,
        evidence,
        carrier: "test",
        trackingId: "1",
        orderId: "missing",
      }),
    { code: "SAMPLE_EVIDENCE_REQUIRED" },
  );
  s = (
    await records.write(f.owner, {
      action: "approve",
      requestId: "fee",
      id: s.id,
      expectedRevision: s.revision,
      evidence,
      feeMinor: 0,
      currency: "USD",
    })
  ).current;
  await assert.rejects(
    () =>
      records.write(f.owner, {
        action: "ship",
        requestId: "bad-proof",
        id: s.id,
        expectedRevision: s.revision,
        evidence: { ...evidence, sha256: "0".repeat(64) },
        carrier: "test",
        trackingId: "1",
        orderId: "missing",
      }),
    { code: "EVIDENCE_CHANGED" },
  );
  const reservation = f.erp.write(
    f.w,
    {
      action: "reserve",
      requestId: "sample-stock",
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
    requestId: "sample-stock-confirm",
    orderId: reservation.id,
  });
  const command = {
    action: "ship",
    requestId: "ship",
    id: s.id,
    expectedRevision: s.revision,
    evidence: { ...evidence, externalEventId: "carrier1" },
    carrier: "Synthetic carrier",
    trackingId: "synthetic-tracking",
    orderId: reservation.id,
  };
  s = (await records.write(f.owner, command)).current;
  assert.equal(s.status, "shipped");
  assert.equal(s.paymentStatus, "unreconciled");
  assert.equal((await records.write(f.owner, command)).replayed, true);
  assert.throws(() => records.get(f.access.owner("session-other"), s.id), {
    code: "NOT_FOUND",
  });
  s = (
    await records.write(f.owner, {
      action: "deliver",
      requestId: "delivered",
      id: s.id,
      expectedRevision: s.revision,
      evidence: { ...evidence, externalEventId: "carrier2" },
    })
  ).current;
  assert.equal(s.status, "delivered");
  s = (
    await records.write(f.owner, {
      action: "feedback",
      requestId: "feedback",
      id: s.id,
      expectedRevision: s.revision,
      evidence: { ...evidence, externalEventId: "reply2" },
      feedback: "Synthetic positive feedback",
    })
  ).current;
  assert.equal(s.status, "feedback_received");
});
