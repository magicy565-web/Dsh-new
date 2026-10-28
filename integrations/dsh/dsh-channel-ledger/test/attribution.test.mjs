import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../../dsh-quote-guard/test/fixture.mjs";
import { accepted } from "../../dsh-quote-guard/test/accepted-fixture.mjs";
import { createTradeRecords } from "../../dsh-mini-erp/trade-records.js";
import { createChannelLedger } from "../index.js";
import { sha } from "@workspace-agent/dsh-commerce-contracts";
async function prepared(t, { catalogRevision = 1, link = true } = {}) {
  const f = fixture();
  t.after(() => f.close());
  const mandate = {
    id: "mandate1",
    revision: 1,
    status: "active",
    marketCode: "US",
    productIds: ["context1"],
    terms: {
      version: 1,
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
      budget: { currency: "USD", maximumMinor: 0 },
      commerceNetwork: { salesAuthorizations: [mandate], workOrders: [] },
    }),
  };
  f.setNetwork(network);
  const rfq = f.rfq.ownerWrite(f.session, {
    action: "assign_project",
    id: f.r.id,
    expectedRevision: f.r.revision,
    requestId: "assign",
    projectId: "p1",
  }).current;
  f.proposal.rfqRevision = rfq.revision;
  f.importBody.projectId = "p1";
  let quote = await accepted(f);
  const order = f.erp.write(
    f.w,
    {
      action: "reserve",
      requestId: "reserve",
      productId: "allocation1",
      buyerId: "buyer1",
      quantity: 10,
      expectedRevision: 1,
      expectedCatalogRevision: catalogRevision,
    },
    "fixture",
    {
      productId: f.product.id,
      skuId: "sku1",
      revision: catalogRevision,
      quantity: 10,
      unitPriceMinor: 1234,
      currency: "USD",
    },
  ).current;
  assert.deepEqual(order.catalogRef, {
    id: f.product.id,
    skuId: "sku1",
    revision: catalogRevision,
  });
  f.erp.write(f.w, {
    action: "confirm",
    requestId: "confirm",
    orderId: order.id,
  });
  const linkInput = {
    requestId: "link",
    expectedRevision: quote.revision,
    quoteId: quote.quoteId,
    version: quote.version,
    orderId: order.id,
  };
  if (link) quote = f.quotes.linkOrder(f.owner, linkInput).current;
  const bytes = Buffer.from("Synthetic bank evidence, not a real transfer"),
    evidence = {
      attachmentId: `sha256:${sha(bytes)}`,
      sha256: sha(bytes),
      bytes: bytes.length,
      provider: "fixture",
      externalEventId: "collection1",
      occurredAt: "2026-10-28T08:04:00Z",
    };
  const records = createTradeRecords(f.erp, {
    registry: f.registry,
    quotes: f.quotes,
    commerce: () => network,
    clock: () => Date.parse("2026-10-28T08:05:00Z"),
    attachments: () => ({
      async *readFileStream() {
        yield bytes;
      },
    }),
  });
  const ledger = createChannelLedger({
    registry: f.registry,
    commerce: () => network,
    quotes: () => f.quotes,
    trade: () => records,
    clock: () => Date.parse("2026-10-28T08:05:00Z"),
  });
  t.after(() => {
    records.close();
    ledger.close();
  });
  const collection = {
    requestId: "collect",
    expectedRevision: 0,
    projectId: "p1",
    kind: "collection",
    amountMinor: 1000,
    currency: "USD",
    orderId: order.id,
    evidence,
  };
  const payment = {
    ...collection,
    requestId: "pay",
    kind: "commission_paid",
    amountMinor: 50,
    mandateId: mandate.id,
    mandateRevision: 1,
    evidence: { ...evidence, externalEventId: "payment1" },
  };
  return {
    f,
    mandate,
    network,
    quote,
    order,
    records,
    ledger,
    collection,
    payment,
    linkInput,
  };
}
test("commission read and payment both require the exact product version and destination market", async (t) => {
  const x = await prepared(t);
  await x.records.recordFinancial(x.f.owner, x.collection);
  const metric = () => x.ledger.read(x.f.owner, { projectId: "p1" }).metrics[0];
  assert.equal(metric().commissionAccruedMinor, 50);
  const original = structuredClone(x.mandate);
  for (const change of [
    (m) => {
      m.marketCode = "CA";
    },
    (m) => {
      m.terms.productPins[0].revision = 2;
    },
    (m) => {
      m.terms.productPins[0].productId = "another-product";
    },
    (m) => {
      m.productIds = ["unrelated-context"];
    },
  ]) {
    Object.assign(x.mandate, structuredClone(original));
    change(x.mandate);
    assert.equal(metric().commissionAccruedMinor, null);
    assert.equal(metric().attributionStatus, "requires_owner_resolution");
    await assert.rejects(
      () => x.records.recordFinancial(x.f.owner, x.payment),
      { code: "MANDATE_SCOPE_MISMATCH" },
    );
  }
  Object.assign(x.mandate, structuredClone(original));
  await x.records.recordFinancial(x.f.owner, x.payment);
  assert.equal(metric().commissionPaidMinor, 50);
});
test("a same-price order created from another catalogue revision cannot be linked to the accepted quote", async (t) => {
  const x = await prepared(t, { catalogRevision: 2, link: false });
  assert.throws(() => x.f.quotes.linkOrder(x.f.owner, x.linkInput), {
    code: "ORDER_SOURCE_MISMATCH",
  });
  assert.equal(x.f.quotes.orderRefs(x.f.owner, "p1").length, 0);
});
test("one order retains one immutable quote version and refuses a second accepted-version attribution", async (t) => {
  const x = await prepared(t);
  const refs = () => x.f.quotes.orderRefs(x.f.owner, "p1");
  const before = x.quote.revision;
  const again = x.f.quotes.linkOrder(x.f.owner, {
    ...x.linkInput,
    requestId: "link-again",
    expectedRevision: before,
  });
  assert.equal(again.current.revision, before);
  assert.equal(refs().length, 1);
  Object.assign(x.f.proposal, {
    quoteId: x.quote.quoteId,
    requestId: "second-version",
    expectedRevision: before,
  });
  const next = await accepted(x.f, { prefix: "v2:" });
  assert.equal(next.version, 2);
  assert.equal(refs()[0].quoteRef.version, 1);
  assert.equal(refs()[0].quoteRef.destination, "US");
  assert.throws(
    () =>
      x.f.quotes.linkOrder(x.f.owner, {
        ...x.linkInput,
        requestId: "relink",
        version: 2,
        expectedRevision: next.revision,
      }),
    { code: "ORDER_ALREADY_LINKED" },
  );
  // A pre-fix ledger could already contain ambiguous links. Keep the order visible
  // but do not choose one quote silently or accrue commissions for it.
  x.f.erp.db
    .prepare(
      "INSERT INTO quote_events(workspace,quote_id,version,action,actor,at,body) VALUES(?,?,2,'order_linked','legacy-fixture','2026-10-28T08:00:00Z',?)",
    )
    .run(x.f.w, x.quote.quoteId, JSON.stringify({ orderId: x.order.id }));
  assert.equal(refs()[0].quoteRef, null);
  await x.records.recordFinancial(x.f.owner, x.collection);
  assert.equal(
    x.ledger.read(x.f.owner, { projectId: "p1" }).metrics[0]
      .commissionAccruedMinor,
    null,
  );
  await assert.rejects(() => x.records.recordFinancial(x.f.owner, x.payment), {
    code: "MANDATE_SCOPE_MISMATCH",
  });
});
test("list and detail expose the same quote expiry without changing stored state", async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const quote = await f.setup();
  f.setNow(Date.parse("2026-11-02T00:00:00Z"));
  const detail = f.quotes.read(f.owner, { quoteId: quote.quoteId }),
    list = f.quotes.read(f.owner, {}).items[0];
  assert.equal(detail.status, "review_required");
  assert.equal(detail.effectiveStatus, "expired");
  assert.equal(list.effectiveStatus, detail.effectiveStatus);
  assert.equal(detail.revision, quote.revision);
});
