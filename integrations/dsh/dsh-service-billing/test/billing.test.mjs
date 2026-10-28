import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fixture } from "./fixture.mjs";
import { ServiceBillingStore } from "../store.js";
import { createServiceBilling } from "../service.js";
import { serviceBillTerms } from "../../../../packages/domain-commerce-network/src/index.mjs";
const code = (c) => (e) => e.code === c;
test("standalone billing derives fixed fee, keeps AI and commission separate, rejects duplicate fee and Agent issue", async () => {
  const f = await fixture();
  try {
    const m = await f.mandate();
    const b = await f.draft(m);
    assert.equal(b.amountMinor, 10000);
    assert.equal(b.status, "draft");
    assert.equal(b.outstandingMinor, null);
    assert.equal(b.legalTaxInvoice, false);
    assert.equal(b.transport, "not_connected");
    await assert.rejects(
      async () => f.draft(m),
      code("BILLING_DUPLICATE_PERIOD"),
    );
    await assert.rejects(
      async () =>
        f.write(
          "issue",
          { id: b.id, expectedRevision: b.revision },
          f.access.tool(f.execution()),
        ),
      code("OWNER_REQUIRED"),
    );
    const issued = await f.issue(b);
    assert.equal(issued.outstandingMinor, 10000);
    assert.equal(f.state().budget.accruedMinor, 0);
    const sourcing = await f.mandate("sourcing_commission");
    await assert.rejects(
      async () => f.draft(sourcing),
      code("BILLING_MODE_DENIED"),
    );
    await assert.rejects(
      async () =>
        f.write("draft", {
          projectId: f.projectId,
          mandateId: m.id,
          expectedMandateRevision: m.revision,
          kind: "fixed_fee",
          amountMinor: 9999,
        }),
      code("INPUT"),
    );
  } finally {
    f.close();
  }
});
test("monthly service anniversaries clamp month end without drift; partial, future and duplicate periods fail", async () => {
  const f = await fixture();
  try {
    const m = await f.mandate("channel_subscription");
    const b = await f.draft(m);
    assert.equal(b.periodStart, "2026-02-28");
    assert.equal(b.periodEndExclusive, "2026-03-31");
    assert.equal(b.amountMinor, 2900);
    for (const start of ["2026-03-28", "2026-02-30", "2028-01-31"])
      assert.throws(() => serviceBillTerms(m, "monthly_fee", start, f.now));
    await assert.rejects(
      async () => f.draft(m),
      code("BILLING_DUPLICATE_PERIOD"),
    );
    const shortened = {
      ...m,
      businessTerms: { ...m.businessTerms, endDate: "2026-03-15" },
    };
    assert.throws(
      () => serviceBillTerms(shortened, "monthly_fee", "2026-02-28", f.now),
      /BILLING_PARTIAL_PERIOD/,
    );
    const march = serviceBillTerms(m, "monthly_fee", "2026-03-31", f.now);
    assert.equal(march.periodEndExclusive, "2026-04-30");
  } finally {
    f.close();
  }
});
test("draft review binds original mandate approval and issued statements retain historical terms after mandate changes", async () => {
  const f = await fixture();
  try {
    const m = await f.mandate(),
      b = await f.draft(m);
    const amend = {
      mandateId: m.id,
      title: m.title,
      principalPartyId: m.principalPartyId,
      operatorPartyId: m.operatorPartyId,
      marketCode: m.marketCode,
      scope: m.scope,
      productIds: m.productIds,
      businessTerms: { ...m.businessTerms, version: 2, fixedFeeMinor: 12000 },
    };
    await f.command("amend_business_mandate", amend);
    await assert.rejects(async () => f.issue(b), code("BILLING_TERMS_CHANGED"));
    await f.write("void", {
      id: b.id,
      expectedRevision: b.revision,
      reason: "Superseded before issue",
    });
    await f.command("approve_mandate", { mandateId: m.id });
    const next = f
        .state()
        .commerceNetwork.salesAuthorizations.find((r) => r.id === m.id),
      issued = await f.issue(await f.draft(next));
    await f.command("revoke_mandate", { mandateId: m.id });
    assert.equal(f.service.get(f.owner, issued.id).businessTerms.version, 2);
    const collected = (
      await f.write("collection", {
        id: issued.id,
        expectedRevision: issued.revision,
        amountMinor: 12000,
        currency: "USD",
        evidence: await f.evidence(),
      })
    ).current;
    assert.equal(collected.paymentStatus, "paid");
    await assert.rejects(
      async () =>
        f.write("void", {
          id: collected.id,
          expectedRevision: collected.revision,
          reason: "Do not delete cash history",
        }),
      code("BILLING_STATE"),
    );
  } finally {
    f.close();
  }
});
test("cash reconciliation enforces currency, overpayment, same collection refunds, exact bytes and transaction uniqueness", async () => {
  const f = await fixture();
  try {
    let b = await f.issue(await f.draft(await f.mandate()));
    const evidence = await f.evidence();
    await assert.rejects(
      async () =>
        f.write("collection", {
          id: b.id,
          expectedRevision: b.revision,
          amountMinor: 1,
          currency: "EUR",
          evidence,
        }),
      code("BILLING_CURRENCY_MISMATCH"),
    );
    await assert.rejects(
      async () =>
        f.write("collection", {
          id: b.id,
          expectedRevision: b.revision,
          amountMinor: 10001,
          currency: "USD",
          evidence,
        }),
      code("BILLING_OVERPAYMENT"),
    );
    await assert.rejects(
      async () =>
        f.write("collection", {
          id: b.id,
          expectedRevision: b.revision,
          amountMinor: 1,
          currency: "USD",
          evidence: { ...evidence, bytes: evidence.bytes + 1 },
        }),
      code("EVIDENCE_CHANGED"),
    );
    b = (
      await f.write("collection", {
        id: b.id,
        expectedRevision: b.revision,
        amountMinor: 6000,
        currency: "USD",
        evidence,
      })
    ).current;
    assert.equal(b.paymentStatus, "partially_paid");
    const collectionId = b.events.find((e) => e.kind === "collection").id;
    await assert.rejects(
      async () =>
        f.write("collection", {
          id: b.id,
          expectedRevision: b.revision,
          amountMinor: 1,
          currency: "USD",
          evidence,
        }),
      code("DUPLICATE_EVIDENCE"),
    );
    await assert.rejects(
      async () =>
        f.write("refund", {
          id: b.id,
          expectedRevision: b.revision,
          amountMinor: 6001,
          currency: "USD",
          collectionId,
          evidence: await f.evidence(),
        }),
      code("BILLING_OVERREFUND"),
    );
    b = (
      await f.write("refund", {
        id: b.id,
        expectedRevision: b.revision,
        amountMinor: 2000,
        currency: "USD",
        collectionId,
        evidence: await f.evidence(),
      })
    ).current;
    assert.equal(b.netCollectedMinor, 4000);
    assert.equal(b.outstandingMinor, 6000);
    assert.equal(b.events.filter((e) => e.kind === "collection").length, 1);
    await assert.rejects(
      async () =>
        f.write("collection", {
          id: b.id,
          expectedRevision: 1,
          amountMinor: 1,
          currency: "USD",
          evidence: await f.evidence(),
        }),
      code("REVISION_CONFLICT"),
    );
  } finally {
    f.close();
  }
});
test("lost response replay survives restart and does not reread evidence or create another receipt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "billing-")),
    f = await fixture({ filename: join(dir, "billing.sqlite") });
  let restored;
  try {
    let b = await f.issue(await f.draft(await f.mandate()));
    const request = {
      action: "collection",
      requestId: randomUUID(),
      id: b.id,
      expectedRevision: b.revision,
      amountMinor: 100,
      currency: "USD",
      evidence: await f.evidence(),
    };
    await f.service.write(f.owner, request);
    const reads = f.reads;
    assert.equal((await f.service.write(f.owner, request)).replayed, true);
    assert.equal(f.reads, reads);
    await assert.rejects(
      async () => f.service.write(f.owner, { ...request, amountMinor: 200 }),
      code("IDEMPOTENCY_CONFLICT"),
    );
    f.service.close();
    f.store.close();
    const store = new ServiceBillingStore(join(dir, "billing.sqlite"));
    restored = {
      store,
      service: createServiceBilling(store, {
        registry: f.registry,
        commerce: () => f.commerce,
        attachments: () => f.attachments,
        clock: () => f.now,
      }),
    };
    const replay = await restored.service.write(f.owner, request);
    assert.equal(replay.replayed, true);
    assert.equal(replay.current.collectedMinor, 100);
    assert.equal(
      replay.current.events.filter((e) => e.kind === "collection").length,
      1,
    );
  } finally {
    if (restored) {
      restored.service.close();
      restored.store.close();
      f.commerce.close();
      f.access.close();
    } else f.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("session revocation during evidence read rolls back; workspace and independent native actors cannot bypass restrictions", async () => {
  const f = await fixture();
  try {
    const b = await f.issue(await f.draft(await f.mandate()));
    assert.throws(
      () => f.service.get(f.access.owner("foreign"), b.id),
      code("NOT_FOUND"),
    );
    f.setIntercept(() => {
      f.rows[0].sessionIds = ["second"];
    });
    await assert.rejects(
      async () =>
        f.write("collection", {
          id: b.id,
          expectedRevision: b.revision,
          amountMinor: 100,
          currency: "USD",
          evidence: await f.evidence(),
        }),
      code("SESSION_REQUIRED"),
    );
    const other = f.access.owner("second");
    assert.equal(f.service.get(other, b.id).collectedMinor, 0);
  } finally {
    f.close();
  }
});
test("concurrent identical requests serialize after attachment read; external transactions deduplicate across statements and actors", async () => {
  const f = await fixture();
  try {
    const m = await f.mandate("channel_subscription"),
      a = await f.issue(await f.draft(m));
    const next = (
        await f.write("draft", {
          projectId: f.projectId,
          mandateId: m.id,
          expectedMandateRevision: m.revision,
          kind: "monthly_fee",
          periodStart: "2026-03-31",
        })
      ).current,
      b = await f.issue(next);
    const evidence = await f.evidence(),
      request = {
        action: "collection",
        requestId: randomUUID(),
        id: a.id,
        expectedRevision: a.revision,
        amountMinor: 100,
        currency: "USD",
        evidence,
      };
    const results = await Promise.all([
      f.service.write(f.owner, request),
      f.service.write(f.owner, request),
    ]);
    assert.equal(results.filter((r) => r.replayed).length, 1);
    await assert.rejects(
      async () =>
        f.write(
          "collection",
          {
            id: b.id,
            expectedRevision: b.revision,
            amountMinor: 100,
            currency: "USD",
            evidence,
          },
          f.access.owner("second"),
        ),
      code("DUPLICATE_EVIDENCE"),
    );
    assert.equal(f.service.get(f.owner, b.id).collectedMinor, 0);
  } finally {
    f.close();
  }
});
