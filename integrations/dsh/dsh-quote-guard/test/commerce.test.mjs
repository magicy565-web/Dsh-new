import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fixture } from "./fixture.mjs";
import { createAccess, sha } from "@workspace-agent/dsh-commerce-contracts";
import { createQuoteGuard } from "../service.js";
const code = (v, c) => assert.equal(v.code, c);
function setup(t) {
  const f = fixture();
  t.after(() => f.close());
  return f;
}
test("source uniqueness, changed source rejection and encrypted raw storage", (t) => {
  const f = setup(t);
  assert.equal(
    f.rfq.ownerWrite(f.session, { ...f.importBody, requestId: "again" }).current
      .id,
    f.r.id,
  );
  assert.equal(f.rfq.read(f.owner, {}).items.length, 1);
  assert.throws(
    () =>
      f.rfq.ownerWrite(f.session, {
        ...f.importBody,
        requestId: "different",
        rawText: "changed",
        source: { ...f.importBody.source, rawEvidenceSha256: sha("changed") },
      }),
    { code: "SOURCE_CONFLICT" },
  );
  assert.equal(
    readFileSync(f.directory + "/rfq.sqlite").includes(Buffer.from(f.raw)),
    false,
  );
  assert.equal(
    readFileSync(f.directory + "/rfq.sqlite-wal").includes(Buffer.from(f.raw)),
    false,
  );
});
test("RFQ cannot choose workspace, approve extraction, or forge exact field evidence", (t) => {
  const f = setup(t);
  const e = { agent: { session: { id: f.session } }, callId: "inject" };
  assert.throws(() => f.rfq.toolRead({ workspaceId: f.other }, e), {
    code: "INPUT",
  });
  assert.throws(() => f.rfq.toolWrite("review", { id: f.r.id }, e), {
    code: "OWNER_REQUIRED",
  });
  assert.throws(
    () =>
      f.rfq.toolRead(
        { id: f.r.id },
        { agent: { session: { id: "session-other" } }, callId: "read" },
      ),
    { code: "NOT_FOUND" },
  );
  assert.throws(
    () =>
      f.rfq.toolWrite(
        "propose_extraction",
        {
          id: f.r.id,
          requestId: "badspan",
          expectedRevision: 4,
          extraction: {
            requirements: { quantity: 10 },
            fieldEvidence: { quantity: { quote: "10", start: 0, end: 2 } },
            sourceSha256: sha(f.raw),
            model: "bad",
            provider: "test",
          },
        },
        e,
      ),
    { code: "FIELD_EVIDENCE_INVALID" },
  );
});
test("deterministic quote totals and immutable snapshots; policy is owner-only", async (t) => {
  const f = setup(t);
  await assert.rejects(
    () =>
      f.quotes.policy(f.tool, {
        requestId: "bad",
        expectedRevision: 0,
        productId: "allocation1",
        policy: f.policy,
      }),
    { code: "OWNER_REQUIRED" },
  );
  const q = await f.setup();
  assert.equal(q.unitPriceMinor, 1234);
  assert.equal(q.totalMinor, 12340);
  assert.equal(q.profitStatus, "unknown");
  assert.equal(q.status, "review_required");
  assert.equal(f.erp.db.prepare("PRAGMA user_version").get().user_version, 4);
  assert.equal(
    f.erp.read(f.w, { entity: "buyer", id: "buyer1" }).name,
    "Synthetic buyer",
  );
  const next = await f.quotes.propose(f.tool, {
    ...f.proposal,
    requestId: "version2",
    quoteId: q.quoteId,
    expectedRevision: q.revision,
    validUntil: "2026-10-30T00:00:00Z",
  });
  assert.equal(next.current.version, 2);
  assert.equal(
    f.quotes.read(f.owner, { quoteId: q.quoteId, version: 1 }).validUntil,
    q.validUntil,
  );
});
test("missing policy, unsupported currency, MOQ and source drift fail closed", async (t) => {
  const f = setup(t);
  code(
    await f.quotes.preview(
      f.tool,
      (({ requestId, expectedRevision, ...p }) => p)(f.proposal),
    ),
    "QUOTE_BLOCKED_MISSING_EVIDENCE",
  );
  await f.setup();
  f.product.skus[0].moq = 20;
  code(
    await f.quotes.preview(
      f.tool,
      (({ requestId, expectedRevision, ...p }) => p)(f.proposal),
    ),
    "QUOTE_BLOCKED_MISSING_EVIDENCE",
  );
  f.product.skus[0].moq = 10;
  f.product.revision = 2;
  code(
    await f.quotes.preview(
      f.tool,
      (({ requestId, expectedRevision, ...p }) => p)(f.proposal),
    ),
    "SOURCE_CHANGED",
  );
});
test("owner digest binds exact current price, source and policy; model cannot approve", async (t) => {
  const f = setup(t),
    q = await f.setup();
  const p = await f.quotes.review(f.owner, { quoteId: q.quoteId });
  await assert.rejects(
    () =>
      f.quotes.approve(f.tool, {
        requestId: "tool-approve",
        expectedRevision: q.revision,
        quoteId: q.quoteId,
        version: 1,
        reviewDigest: p.reviewDigest,
      }),
    { code: "OWNER_REQUIRED" },
  );
  f.product.skus[0].priceTiers[0].unitPrice = "11.00";
  await assert.rejects(
    () =>
      f.quotes.approve(f.owner, {
        requestId: "approve",
        expectedRevision: q.revision,
        quoteId: q.quoteId,
        version: 1,
        reviewDigest: p.reviewDigest,
      }),
    { code: "APPROVAL_STALE" },
  );
  assert.equal(
    f.quotes.read(f.owner, { quoteId: q.quoteId }).status,
    "review_required",
  );
});
test("quote input does not accept model price or arbitrary disclosure", async (t) => {
  const f = setup(t);
  await f.setup();
  await assert.rejects(
    () => f.quotes.propose(f.tool, { ...f.proposal, unitPriceMinor: 1 }),
    { code: "INPUT" },
  );
  await assert.rejects(
    () =>
      f.quotes.policy(f.owner, {
        requestId: "badpolicy",
        expectedRevision: 1,
        productId: "allocation1",
        policy: {
          ...f.policy,
          disclosureFields: [...f.policy.disclosureFields, "internalCost"],
        },
      }),
    { code: "DISCLOSURE_DENIED" },
  );
});
test("approval CAS prevents two reviews racing; replay preserves original receipt", async (t) => {
  const f = setup(t),
    q = await f.setup(),
    p = await f.quotes.review(f.owner, { quoteId: q.quoteId });
  const b = {
    requestId: "approval",
    expectedRevision: q.revision,
    quoteId: q.quoteId,
    version: 1,
    reviewDigest: p.reviewDigest,
  };
  const a = await f.quotes.approve(f.owner, b);
  assert.equal((await f.quotes.approve(f.owner, b)).replayed, true);
  await assert.rejects(
    () => f.quotes.approve(f.owner, { ...b, requestId: "other" }),
    { code: "REVISION_CONFLICT" },
  );
  await assert.rejects(
    () => f.quotes.approve(f.owner, { ...b, reviewDigest: "changed" }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  assert.equal(a.current.status, "approved");
});
test("outbox timeout remains unknown, same request replays and new ID cannot resend", async (t) => {
  const f = setup(t),
    q = await f.approve(await f.setup());
  let calls = 0;
  const transport = {
    accountRef: "test",
    send: async () => {
      calls++;
      throw Error("timeout");
    },
  };
  const b = {
    requestId: "send",
    expectedRevision: q.revision,
    quoteId: q.quoteId,
    version: q.version,
    approvalReceiptId: q.approval.id,
  };
  const result = await f.quotes.send(f.owner, b, transport);
  assert.equal(result.delivery.status, "unknown");
  assert.equal(result.current.status, "sending");
  await f.quotes.send(f.owner, b, transport);
  assert.equal(calls, 1);
  await assert.rejects(() =>
    f.quotes.send(
      f.owner,
      { ...b, requestId: "another", expectedRevision: result.current.revision },
      transport,
    ),
  );
  assert.equal(calls, 1);
  assert.equal(f.erp.read(f.w, { entity: "order" }).items.length, 0);
});
test("confirmed provider evidence marks sent and never creates or confirms order", async (t) => {
  const f = setup(t),
    q = await f.approve(await f.setup());
  const transport = {
    accountRef: "test",
    send: async (intent) => {
      assert.ok(!intent.text.includes("floorEvidence"));
      return {
        status: "sent",
        provider: "test",
        providerMessageId: "actual-fixture-http-id",
        at: "2026-10-28T08:00:01Z",
      };
    },
  };
  const r = await f.quotes.send(
    f.owner,
    {
      requestId: "send",
      expectedRevision: q.revision,
      quoteId: q.quoteId,
      version: 1,
      approvalReceiptId: q.approval.id,
    },
    transport,
  );
  assert.equal(r.current.status, "sent");
  assert.equal(r.delivery.result.providerMessageId, "actual-fixture-http-id");
  assert.equal(f.erp.read(f.w, { entity: "order" }).items.length, 0);
});
test("permission revocation between approve and send prevents the call", async (t) => {
  const f = setup(t),
    q = await f.approve(await f.setup());
  f.rfq.ownerWrite(f.session, {
    action: "revoke_contact",
    id: f.r.id,
    requestId: "opt-out",
    expectedRevision: f.r.revision,
    evidence: "Synthetic opt-out",
  });
  let calls = 0;
  await assert.rejects(
    () =>
      f.quotes.send(
        f.owner,
        {
          requestId: "send",
          expectedRevision: q.revision,
          quoteId: q.quoteId,
          version: 1,
          approvalReceiptId: q.approval.id,
        },
        {
          accountRef: "test",
          send: async () => {
            calls++;
          },
        },
      ),
    { code: "RFQ_NOT_AUTHORIZED" },
  );
  assert.equal(calls, 0);
});
test("workspace change during asynchronous catalog lookup denies stale scope", async (t) => {
  const f = setup(t);
  f.library.withProducts = async (fn) => {
    f.rows[0].sessionIds = [];
    f.rows[1].sessionIds.push(f.session);
    return fn(f.products);
  };
  await assert.rejects(
    () =>
      f.quotes.preview(
        f.tool,
        (({ requestId, expectedRevision, ...p }) => p)(f.proposal),
      ),
    { code: "SCOPE_CHANGED" },
  );
});
test("uninstalled ledger reports dependency missing; retained raw is unavailable after expiry", (t) => {
  const f = setup(t),
    guard = createQuoteGuard({ registry: f.registry, erp: () => null });
  assert.throws(
    () =>
      guard.toolPreview(
        {},
        { agent: { session: { id: f.session } }, callId: "a" },
      ),
    { code: "DEPENDENCY_MISSING" },
  );
  f.setNow(Date.parse("2027-01-01T00:00:00Z"));
  const r = f.rfq.read(f.owner, { id: f.r.id, includeRaw: true });
  assert.equal(r.rawText, undefined);
  assert.equal(r.sourceAvailability, "retention_expired");
  assert.equal(r.candidates[0].fieldEvidence.quantity.quote, undefined);
});
test("retry from a new native tool-call ID uses the original session-scoped request", async (t) => {
  const f = setup(t),
    q = await f.setup(),
    again = f.access.tool({
      agent: { session: { id: f.session } },
      callId: "a-different-native-call",
    });
  const replay = await f.quotes.propose(again, f.proposal);
  assert.equal(replay.replayed, true);
  assert.equal(replay.current.quoteId, q.quoteId);
  assert.equal(f.quotes.read(f.owner, {}).items.length, 1);
});
test("unknown outbox and exact retry identity survive reopening the authoritative SQLite ledger", async (t) => {
  const { ErpStore } = await import("../../dsh-mini-erp/store.js"),
    { createQuoteService } = await import("../../dsh-mini-erp/quotes.js");
  const f = setup(t),
    q = await f.approve(await f.setup());
  const command = {
    requestId: "persistent-send",
    expectedRevision: q.revision,
    quoteId: q.quoteId,
    version: 1,
    approvalReceiptId: q.approval.id,
  };
  let calls = 0;
  const transport = {
    accountRef: "test",
    send: async () => {
      calls++;
      throw Error("timeout");
    },
  };
  await f.quotes.send(f.owner, command, transport);
  f.quotes.close();
  const reopened = new ErpStore(f.directory + "/erp.sqlite"),
    service = createQuoteService(reopened, {
      registry: f.registry,
      library: () => f.library,
      rfq: () => f.rfq,
    });
  try {
    assert.equal(
      service.read(f.owner, { quoteId: q.quoteId }).outbox.status,
      "unknown",
    );
    assert.equal(
      (await service.send(f.owner, command, transport)).replayed,
      true,
    );
    assert.equal(calls, 1);
  } finally {
    service.close();
    reopened.close();
  }
});
test("a different sender/account cannot reuse an approved quote", async (t) => {
  const f = setup(t),
    q = await f.approve(await f.setup());
  let calls = 0;
  const input = {
    requestId: "sender-changed",
    expectedRevision: q.revision,
    quoteId: q.quoteId,
    version: 1,
    approvalReceiptId: q.approval.id,
  };
  await assert.rejects(
    () =>
      f.quotes.send(f.owner, input, {
        accountRef: "another-account",
        send: async () => {
          calls++;
        },
      }),
    { code: "CHANNEL_CHANGED" },
  );
  await assert.rejects(
    () =>
      f.quotes.send(f.owner, input, {
        accountRef: "test",
        from: "changed@example.test",
        send: async () => {
          calls++;
        },
      }),
    { code: "CHANNEL_CHANGED" },
  );
  assert.equal(calls, 0);
  assert.equal(f.quotes.read(f.owner, { quoteId: q.quoteId }).outbox, null);
});
test("native Connection revocation while catalog is loading prevents policy commit", async (t) => {
  const f = setup(t);
  let revoked = false;
  const native = f.access.owner(f.session, () => {
    if (revoked) {
      const e = new Error("Connection revoked");
      e.code = "UNAUTHORIZED";
      throw e;
    }
  });
  f.library.withProducts = async (fn) => {
    await Promise.resolve();
    revoked = true;
    return fn(f.products);
  };
  await assert.rejects(
    () =>
      f.quotes.policy(native, {
        requestId: "revoked-policy",
        expectedRevision: 0,
        productId: "allocation1",
        policy: f.policy,
      }),
    { code: "UNAUTHORIZED" },
  );
  assert.equal(
    f.erp.db.prepare("SELECT count(*) AS n FROM quote_policies").get().n,
    0,
  );
});
test("retention reads do not mutate facts; maintenance removes expired source bodies", (t) => {
  const f = setup(t);
  f.setNow(Date.parse("2027-01-01T00:00:00Z"));
  const before = f.rfqStore.get(f.w, f.r.id);
  assert.ok(before.rawText);
  const visible = f.rfq.read(f.owner, { id: f.r.id, includeRaw: true });
  assert.equal(visible.rawText, undefined);
  assert.equal(visible.revision, before.revision);
  f.rfq.purgeExpired();
  const purged = f.rfqStore.get(f.w, f.r.id);
  assert.equal(purged.rawText, null);
  assert.equal(purged.status, "closed");
  assert.equal(purged.revision, before.revision + 1);
  assert.equal(purged.candidates[0].fieldEvidence.quantity.quote, undefined);
});
