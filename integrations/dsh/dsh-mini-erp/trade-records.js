import { randomUUID } from "node:crypto";
import {
  checkScope,
  keys,
  id,
  text,
  integer,
  iso,
  hash,
  sha,
  canonical,
  dependency,
  fail,
} from "@workspace-agent/dsh-commerce-contracts";
export function createTradeRecords(
  erp,
  { registry, quotes, attachments, commerce, clock = Date.now },
) {
  let closed = false;
  const check = (s, owner = false) => {
    if (closed) fail("UNAVAILABLE");
    checkScope(s, registry, owner);
  };
  const transact = (fn) => {
    erp.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      erp.db.exec("COMMIT");
      return r;
    } catch (e) {
      erp.db.exec("ROLLBACK");
      throw e;
    }
  };
  const get = (s, sampleId) => {
    check(s);
    const r = erp.db
      .prepare("SELECT body FROM sample_requests WHERE workspace=? AND id=?")
      .get(s.workspaceId, id(sampleId));
    if (!r) fail("NOT_FOUND");
    return JSON.parse(r.body);
  };
  async function evidence(s, ref) {
    check(s, true);
    keys(ref, [
      "attachmentId",
      "sha256",
      "bytes",
      "provider",
      "externalEventId",
      "occurredAt",
    ]);
    hash(ref.sha256);
    integer(ref.bytes, "bytes", 1, 262144);
    text(ref.provider, "provider", 200);
    text(ref.externalEventId, "externalEventId", 300);
    iso(ref.occurredAt);
    if (ref.attachmentId !== `sha256:${ref.sha256}`) fail("EVIDENCE_CHANGED");
    let n = 0;
    const chunks = [];
    for await (const b of dependency(
      attachments,
      "Native Attachments",
    ).readFileStream(
      { attachmentId: ref.attachmentId, bytes: ref.bytes },
      s.signal,
    )) {
      n += b.length;
      if (n > ref.bytes) fail("EVIDENCE_CHANGED");
      chunks.push(b);
    }
    check(s, true);
    if (n !== ref.bytes || sha(Buffer.concat(chunks)) !== ref.sha256)
      fail("EVIDENCE_CHANGED");
    return {
      ...ref,
      byteIntegrity: "verified",
      interpretation: "owner-recorded-not-independent-provider-verification",
      reviewedBy: s.actor,
    };
  }
  function project(s, projectId) {
    const c = dependency(commerce, "Commerce Network").state(
      s.sessionId,
      id(projectId),
    );
    if (c.workspaceId !== s.workspaceId || c.projectId !== projectId)
      fail("PROJECT_SCOPE");
    return c;
  }
  const api = {
    async uploadEvidence(s, input) {
      check(s, true);
      keys(input, ["fileName", "dataBase64"]);
      text(input.fileName, "fileName", 200);
      text(input.dataBase64, "dataBase64", 350000);
      const data = Buffer.from(input.dataBase64, "base64");
      if (
        !data.length ||
        data.length > 262144 ||
        data.toString("base64") !== input.dataBase64
      )
        fail("EVIDENCE_INVALID");
      const ref = await dependency(attachments, "Native Attachments").saveFile({
        data,
        name: input.fileName,
      });
      check(s, true);
      if (
        ref.attachmentId !== `sha256:${sha(data)}` ||
        ref.bytes !== data.length
      )
        fail("EVIDENCE_CHANGED");
      return {
        attachmentId: ref.attachmentId,
        sha256: sha(data),
        bytes: data.length,
      };
    },
    list(s, { projectId, afterId = "", limit = 50 } = {}) {
      check(s);
      integer(limit, "limit", 1, 100);
      const rows = erp.db
        .prepare(
          "SELECT id,body FROM sample_requests WHERE workspace=? AND (? IS NULL OR json_extract(body,'$.projectId')=?) AND id>? ORDER BY id LIMIT ?",
        )
        .all(
          s.workspaceId,
          projectId ?? null,
          projectId ?? null,
          afterId,
          limit + 1,
        );
      return {
        items: rows.slice(0, limit).map((r) => JSON.parse(r.body)),
        hasMore: rows.length > limit,
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      };
    },
    get,
    async write(s, input) {
      check(s);
      keys(input, [
        "action",
        "requestId",
        "expectedRevision",
        "id",
        "quoteId",
        "quoteVersion",
        "quantity",
        "address",
        "feeMinor",
        "currency",
        "evidence",
        "carrier",
        "trackingId",
        "feedback",
        "orderId",
      ]);
      id(input.requestId);
      integer(input.expectedRevision, "expectedRevision");
      if (s.kind !== "owner" && input.action !== "propose")
        fail("OWNER_REQUIRED");
      const prior = () =>
        erp.db
          .prepare(
            "SELECT * FROM sample_commands WHERE workspace=? AND actor=? AND request=?",
          )
          .get(s.workspaceId, s.actor, input.requestId);
      function replay(row) {
        if (row.digest !== sha(input)) fail("IDEMPOTENCY_CONFLICT");
        return { current: get(s, row.sample_id), replayed: true };
      }
      if (prior()) return replay(prior());
      const verified = input.evidence
        ? await evidence(s, input.evidence)
        : null;
      check(s);
      return transact(() => {
        if (prior()) return replay(prior());
        let r;
        if (input.action === "propose") {
          if (input.expectedRevision !== 0) fail("REVISION_CONFLICT");
          const q = quotes.read(s, {
            quoteId: input.quoteId,
            version: input.quoteVersion,
          });
          if (
            q.status !== "accepted" ||
            !q.outbox ||
            q.outbox.status !== "sent"
          )
            fail(
              "FIRST_TRADE_REQUIRED",
              "A sent, evidenced, accepted quotation is required",
            );
          r = {
            id: `sample_${randomUUID()}`,
            quoteId: q.quoteId,
            quoteVersion: q.version,
            projectId: q.projectId,
            buyerId: q.buyerId,
            productId: q.productId,
            quantity: integer(input.quantity, "quantity", 1, 1000),
            address: text(input.address, "address", 2000),
            status: "draft",
            revision: 1,
            feeMinor: null,
            currency: q.currency,
            events: [],
            paymentStatus: "unreconciled",
            inventoryStatus: "not_adjusted",
          };
        } else {
          r = get(s, input.id);
          if (r.revision !== input.expectedRevision) fail("REVISION_CONFLICT");
          check(s, true);
          if (input.action === "approve") {
            if (r.status !== "draft" || !verified)
              fail("SAMPLE_EVIDENCE_REQUIRED");
            if (input.currency !== r.currency) fail("CURRENCY_UNSUPPORTED");
            r.feeMinor = integer(input.feeMinor, "feeMinor");
            r.status = "approved";
          } else if (input.action === "ship") {
            if (r.status !== "approved" || !verified)
              fail("SAMPLE_EVIDENCE_REQUIRED");
            const order = erp.order(s.workspaceId, id(input.orderId), clock());
            if (
              order.status !== "confirmed" ||
              order.buyerId !== r.buyerId ||
              order.productId !== r.productId ||
              order.quantity !== r.quantity
            )
              fail(
                "INVENTORY_EVIDENCE_REQUIRED",
                "Independently confirmed matching sample allocation order required",
              );
            r.orderId = order.id;
            r.inventoryStatus = "independent_order_confirmed";
            r.carrier = text(input.carrier, "carrier", 200);
            r.trackingId = text(input.trackingId, "trackingId", 300);
            r.status = "shipped";
          } else if (input.action === "deliver") {
            if (r.status !== "shipped" || !verified)
              fail("SAMPLE_EVIDENCE_REQUIRED");
            r.status = "delivered";
          } else if (input.action === "feedback") {
            if (r.status !== "delivered" || !verified)
              fail("SAMPLE_EVIDENCE_REQUIRED");
            r.feedback = text(input.feedback, "feedback", 4000);
            r.status = "feedback_received";
          } else if (input.action === "cancel") {
            if (!["draft", "approved"].includes(r.status)) fail("SAMPLE_STATE");
            r.status = "cancelled";
          } else fail("ACTION_DENIED");
          r.revision++;
        }
        if (
          verified &&
          r.events.some(
            (e) =>
              e.evidence?.provider === verified.provider &&
              e.evidence?.externalEventId === verified.externalEventId,
          )
        )
          fail("DUPLICATE_EVIDENCE");
        r.events.push({
          action: input.action,
          actor: s.actor,
          at: new Date(clock()).toISOString(),
          evidence: verified,
        });
        check(s);
        erp.db
          .prepare(
            "INSERT INTO sample_requests VALUES(?,?,?,?) ON CONFLICT(workspace,id) DO UPDATE SET revision=excluded.revision,body=excluded.body",
          )
          .run(s.workspaceId, r.id, r.revision, canonical(r));
        erp.db
          .prepare("INSERT INTO sample_commands VALUES(?,?,?,?,?)")
          .run(s.workspaceId, s.actor, input.requestId, sha(input), r.id);
        erp.db
          .prepare(
            "INSERT INTO sample_events(workspace,sample_id,actor,action,at,body) VALUES(?,?,?,?,?,?)",
          )
          .run(
            s.workspaceId,
            r.id,
            s.actor,
            input.action,
            new Date(clock()).toISOString(),
            canonical({ evidence: verified, revision: r.revision }),
          );
        return { current: r, replayed: false };
      });
    },
    async recordFinancial(s, input) {
      check(s, true);
      keys(input, [
        "requestId",
        "expectedRevision",
        "projectId",
        "kind",
        "amountMinor",
        "currency",
        "orderId",
        "mandateId",
        "mandateRevision",
        "evidence",
      ]);
      id(input.requestId);
      const oldRequest = erp.db
        .prepare(
          "SELECT body FROM channel_evidence WHERE workspace=? AND json_extract(body,'$.requestId')=?",
        )
        .get(s.workspaceId, input.requestId);
      if (oldRequest) {
        const old = JSON.parse(oldRequest.body);
        if (old.inputDigest !== sha(input)) fail("IDEMPOTENCY_CONFLICT");
        return { current: old, replayed: true };
      }
      if (input.expectedRevision !== 0) fail("REVISION_CONFLICT");
      if (!["collection", "commission_paid"].includes(input.kind))
        fail("ACTION_DENIED");
      integer(input.amountMinor, "amountMinor", 1, Number.MAX_SAFE_INTEGER);
      if (!["USD", "EUR", "GBP", "CNY"].includes(input.currency))
        fail("CURRENCY_UNSUPPORTED");
      const c = project(s, input.projectId),
        order = erp.order(s.workspaceId, id(input.orderId), clock());
      if (order.status !== "confirmed" || order.currency !== input.currency)
        fail("ORDER_EVIDENCE_REQUIRED");
      if (!quotes.orderRefs(s, input.projectId).some((o) => o.id === order.id))
        fail("ORDER_PROJECT_MISMATCH");
      const verified = await evidence(s, input.evidence);
      check(s, true);
      const current = project(s, input.projectId);
      if (current.revision !== c.revision) fail("REVISION_CONFLICT");
      const recordId = `fin_${sha([input.kind, verified.provider, verified.externalEventId])}`,
        body = {
          ...input,
          inputDigest: sha(input),
          id: recordId,
          evidence: verified,
          actor: s.actor,
          recordedAt: new Date(clock()).toISOString(),
          verification: "owner-reconciled-evidence",
        };
      return transact(() => {
        const prior = erp.db
          .prepare(
            "SELECT body FROM channel_evidence WHERE workspace=? AND id=?",
          )
          .get(s.workspaceId, recordId);
        if (prior) {
          const p = JSON.parse(prior.body);
          if (
            sha({ ...p, recordedAt: undefined }) !==
            sha({ ...body, recordedAt: undefined })
          )
            fail("DUPLICATE_EVIDENCE");
          return { current: p, replayed: true };
        }
        const used = erp.db
          .prepare(
            "SELECT body FROM channel_evidence WHERE workspace=? AND json_extract(body,'$.requestId')=?",
          )
          .get(s.workspaceId, input.requestId);
        if (used) fail("IDEMPOTENCY_CONFLICT");
        if (input.kind === "commission_paid") {
          const m = current.commerceNetwork.salesAuthorizations.find(
            (m) => m.id === input.mandateId,
          );
          if (
            !m ||
            m.status !== "active" ||
            m.revision !== input.mandateRevision ||
            !m.terms ||
            Date.parse(m.terms.validUntil) <= clock()
          )
            fail("MANDATE_UNAVAILABLE");
          const assignment = m.customerAssignments?.find(
            (a) => a.buyerId === order.buyerId && a.status === "assigned",
          );
          if (!assignment) fail("OWNERSHIP_UNRESOLVED");
          const collected = api
            .financial(s, input.projectId)
            .filter((e) => e.kind === "collection" && e.orderId === order.id)
            .reduce((a, e) => a + e.amountMinor, 0);
          const ceiling = Number(
            (BigInt(collected) * BigInt(m.terms.commissionBps)) / 10000n,
          );
          const paid = api
            .financial(s, input.projectId)
            .filter(
              (e) => e.kind === "commission_paid" && e.orderId === order.id,
            )
            .reduce((a, e) => a + e.amountMinor, 0);
          if (input.amountMinor + paid > ceiling) fail("COMMISSION_LIMIT");
        }

        if (input.kind === "collection") {
          const sum = api
            .financial(s, input.projectId)
            .filter((e) => e.kind === "collection" && e.orderId === order.id)
            .reduce((a, e) => a + e.amountMinor, 0);
          if (input.amountMinor + sum > order.totalMinor)
            fail(
              "COLLECTION_LIMIT",
              "This goods-only ledger cannot reconcile more than the order subtotal",
            );
        }
        erp.db
          .prepare("INSERT INTO channel_evidence VALUES(?,?,?,?,?,?,?)")
          .run(
            s.workspaceId,
            recordId,
            input.projectId,
            input.kind,
            input.currency,
            input.amountMinor,
            canonical(body),
          );
        return { current: body, replayed: false };
      });
    },
    financial(s, projectId) {
      check(s);
      return erp.db
        .prepare(
          "SELECT body FROM channel_evidence WHERE workspace=? AND project=? ORDER BY id",
        )
        .all(s.workspaceId, projectId)
        .map((r) => JSON.parse(r.body));
    },
    close() {
      closed = true;
    },
  };
  return api;
}
