import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ErpStore } from "../../dsh-mini-erp/store.js";
import { createQuoteService } from "../../dsh-mini-erp/quotes.js";
import { RfqStore } from "../../dsh-rfq-desk/store.js";
import { createRfqService } from "../../dsh-rfq-desk/service.js";
import { createAccess, sha } from "@workspace-agent/dsh-commerce-contracts";
import { disclosureFields } from "@workspace-agent/domain-quote";
export function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "commerce-business-"));
  let now = Date.parse("2026-10-28T08:00:00Z");
  const w = randomUUID(),
    other = randomUUID(),
    session = "session-fixture";
  const rows = [
    { id: w, sessionIds: [session] },
    { id: other, sessionIds: ["session-other"] },
  ];
  const registry = {
    list: () => rows,
    get: (id) => rows.find((r) => r.id === id),
  };
  const product = {
    id: "prd_fixture",
    revision: 1,
    status: "active",
    name: "Synthetic test product",
    description: "Not a real product",
    skus: [
      {
        id: "sku1",
        code: "TEST",
        unit: "piece",
        moq: 10,
        pricingMode: "tiered",
        priceTiers: [{ minQuantity: 10, currency: "USD", unitPrice: "12.34" }],
        leadTimeDays: 7,
      },
    ],
  };
  const products = [product],
    library = { withProducts: async (fn) => fn(products) };
  const erp = new ErpStore(join(directory, "erp.sqlite"), { clock: () => now });
  erp.write(w, {
    action: "add_buyer",
    requestId: "buyer",
    id: "buyer1",
    name: "Synthetic buyer",
    email: "buyer@example.test",
  });
  erp.write(
    w,
    {
      action: "link_sku",
      requestId: "link",
      id: "allocation1",
      catalogProductId: product.id,
      skuId: "sku1",
      catalogRevision: 1,
      stockTotal: 1000,
    },
    "fixture",
    {
      productId: product.id,
      skuId: "sku1",
      revision: 1,
      name: product.name,
      currency: "USD",
      unitPriceMinor: 1234,
    },
  );
  const access = createAccess(registry),
    owner = access.owner(session),
    tool = access.tool({
      agent: { session: { id: session } },
      callId: "call1",
    });
  let network = null;
  const rfqStore = new RfqStore(join(directory, "rfq.sqlite"));
  let quotes;
  const rfq = createRfqService({
    store: rfqStore,
    registry,
    erp: () => quotes,
    commerce: () => network,
    clock: () => now,
  });
  quotes = createQuoteService(erp, {
    registry,
    library: () => library,
    rfq: () => rfq,
    clock: () => now,
  });
  const raw =
    "quantity 10 unit piece destination US incoterm FOB namedPlace Shanghai currency USD";
  const importBody = {
    action: "import",
    requestId: "import",
    expectedRevision: 0,
    authorizationEvidence: "Synthetic test fixture only",
    rawText: raw,
    source: {
      channel: "import",
      accountRef: "test",
      externalMessageId: "message1",
      receivedAt: new Date(now).toISOString(),
      rawEvidenceSha256: sha(raw),
    },
  };
  const imported = rfq.ownerWrite(session, importBody).current;
  const req = {
    quantity: 10,
    unit: "piece",
    destination: "US",
    incoterm: "FOB",
    namedPlace: "Shanghai",
    currency: "USD",
  };
  const fieldEvidence = Object.fromEntries(
    Object.entries(req).map(([k, v]) => {
      const term = String(v),
        start = raw.indexOf(term);
      return [k, { quote: term, start, end: start + term.length }];
    }),
  );
  const extracted = rfq.toolWrite(
    "propose_extraction",
    {
      id: imported.id,
      requestId: "extract",
      expectedRevision: 1,
      extraction: {
        requirements: req,
        fieldEvidence,
        sourceSha256: sha(raw),
        model: "test-fixture",
        provider: "none",
      },
    },
    { agent: { session: { id: session } }, callId: "extract" },
  ).current;
  let r = rfq.ownerWrite(session, {
    action: "review",
    id: imported.id,
    requestId: "review1",
    expectedRevision: 2,
    candidateId: extracted.candidates[0].id,
    status: "qualified",
    buyerRef: "buyer1",
    identityEvidence: "Synthetic identity evidence",
    contactPermission: {
      status: "allowed",
      recipient: "buyer@example.test",
      evidence: "Synthetic permission, no email sent",
      validUntil: "2026-11-01T00:00:00Z",
    },
  }).current;
  r = rfq.ownerWrite(session, {
    action: "review",
    id: r.id,
    requestId: "review2",
    expectedRevision: r.revision,
    candidateId: r.candidates[0].id,
    status: "ready_for_quote",
  }).current;
  const policy = {
    productId: product.id,
    productRevision: 1,
    skuId: "sku1",
    currency: "USD",
    minimumUnitPriceMinor: 1000,
    floorEvidence: "Synthetic approved sale floor; not margin",
    sourceReviewEvidence: "Synthetic source reviewed",
    incoterm: "FOB",
    namedPlace: "Shanghai",
    leadTimeDays: 7,
    validUntil: "2026-11-01T00:00:00Z",
    disclosureFields,
  };
  const proposal = {
    requestId: "propose",
    expectedRevision: 0,
    rfqRef: r.id,
    rfqRevision: r.revision,
    productId: "allocation1",
    productRevision: 1,
    validUntil: "2026-10-31T00:00:00Z",
  };
  return {
    setNetwork: (c) => {
      network = c;
    },
    directory,
    w,
    other,
    session,
    rows,
    registry,
    owner,
    tool,
    access,
    erp,
    quotes,
    rfq,
    rfqStore,
    product,
    products,
    library,
    raw,
    importBody,
    r,
    policy,
    proposal,
    setNow: (v) => {
      now = v;
    },
    async setup() {
      await quotes.policy(owner, {
        requestId: "policy",
        expectedRevision: 0,
        productId: "allocation1",
        policy,
      });
      return (await quotes.propose(tool, proposal)).current;
    },
    async approve(q) {
      const channel = { accountRef: "test" };
      const p = await quotes.review(owner, { quoteId: q.quoteId }, channel);
      return (
        await quotes.approve(
          owner,
          {
            requestId: randomUUID(),
            quoteId: q.quoteId,
            version: q.version,
            expectedRevision: q.revision,
            reviewDigest: p.reviewDigest,
          },
          channel,
        )
      ).current;
    },
    close() {
      rfq.close();
      quotes.close();
      erp.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
