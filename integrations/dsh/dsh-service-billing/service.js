import { createBillingEvidence } from "./evidence.js";
import { randomUUID } from "node:crypto";
import {
  createAccess,
  checkScope,
  keys,
  id,
  text,
  integer,
  canonical,
  sha,
  dependency,
  fail,
} from "@workspace-agent/dsh-commerce-contracts";
import { serviceBillTerms } from "@workspace-agent/domain-commerce-network";
export function createServiceBilling(
  store,
  { registry, commerce, attachments, clock = Date.now },
) {
  const access = createAccess(registry);
  let closed = false;
  const check = (s, owner = false) => {
    if (closed) fail("UNAVAILABLE");
    checkScope(s, registry, owner);
  };
  const evidence = createBillingEvidence({ attachments, check });
  const project = (s, projectId) => {
    check(s);
    const state = dependency(commerce, "Commerce Network").state(
      s.sessionId,
      id(projectId),
    );
    if (state.workspaceId !== s.workspaceId || state.projectId !== projectId)
      fail("PROJECT_SCOPE");
    return state;
  };
  const currentMandate = (s, p, m) => {
    const mandate = project(s, p).commerceNetwork.salesAuthorizations.find(
      (r) => r.id === id(m),
    );
    if (!mandate?.businessTerms)
      fail("BILLING_MANDATE_REQUIRED", "请选择本项目的业务委托。");
    return mandate;
  };
  const events = (s, billId) =>
    store.db
      .prepare(
        "SELECT body FROM service_bill_events WHERE workspace=? AND bill_id=? ORDER BY seq",
      )
      .all(s.workspaceId, billId)
      .map((r) => JSON.parse(r.body));
  function get(s, billId) {
    check(s);
    const row = store.db
      .prepare("SELECT body FROM service_bills WHERE workspace=? AND id=?")
      .get(s.workspaceId, id(billId));
    if (!row) fail("NOT_FOUND", "服务账单不存在。", 404);
    const r = JSON.parse(row.body);
    project(s, r.projectId);
    const history = events(s, billId);
    const collected = history
        .filter((e) => e.kind === "collection")
        .reduce((n, e) => n + e.amountMinor, 0),
      refunded = history
        .filter((e) => e.kind === "refund")
        .reduce((n, e) => n + e.amountMinor, 0),
      net = collected - refunded;
    return {
      ...r,
      events: history,
      collectedMinor: collected,
      refundedMinor: refunded,
      netCollectedMinor: net,
      outstandingMinor: r.status === "issued" ? r.amountMinor - net : null,
      paymentStatus:
        r.status !== "issued"
          ? "not_due"
          : net === r.amountMinor
            ? "paid"
            : net > 0
              ? "partially_paid"
              : "unpaid",
      transport: "not_connected",
    };
  }
  const replay = (s, input) => {
    const r = store.db
      .prepare(
        "SELECT digest,bill_id FROM service_bill_requests WHERE workspace=? AND actor=? AND request=?",
      )
      .get(s.workspaceId, s.actor, input.requestId);
    if (!r) return null;
    if (r.digest !== sha(input)) fail("IDEMPOTENCY_CONFLICT");
    return { current: get(s, r.bill_id), replayed: true };
  };
  const append = (s, billId, kind, data = {}) => {
    const e = {
      id: `sbe_${randomUUID()}`,
      kind,
      actor: s.actor,
      at: new Date(clock()).toISOString(),
      ...data,
    };
    store.db
      .prepare(
        "INSERT INTO service_bill_events(workspace,bill_id,kind,provider,external_id,body) VALUES(?,?,?,?,?,?)",
      )
      .run(
        s.workspaceId,
        billId,
        kind,
        e.evidence?.provider ?? null,
        e.evidence?.externalEventId ?? null,
        canonical(e),
      );
    return e;
  };
  const assertCurrent = (s, r) => {
    const m = currentMandate(s, r.projectId, r.mandateId);
    if (
      m.status !== "active" ||
      m.revision !== r.mandateRevision ||
      m.approvalReceiptId !== r.mandateApprovalReceiptId ||
      sha(m.businessTerms) !== sha(r.businessTerms)
    )
      fail(
        "BILLING_TERMS_CHANGED",
        "委托条款已变化。请作废草稿，按当前条款重新生成。",
      );
    return m;
  };
  const api = {
    get,
    list(s, input) {
      check(s);
      keys(input, ["projectId", "mandateId", "afterId", "limit"]);
      project(s, input.projectId);
      if (input.mandateId) currentMandate(s, input.projectId, input.mandateId);
      const limit = input.limit ?? 100;
      integer(limit, "limit", 1, 100);
      const rows = store.db
        .prepare(
          "SELECT id FROM service_bills WHERE workspace=? AND project=? AND (? IS NULL OR mandate=?) AND id>? ORDER BY id LIMIT ?",
        )
        .all(
          s.workspaceId,
          input.projectId,
          input.mandateId ?? null,
          input.mandateId ?? null,
          input.afterId ?? "",
          limit + 1,
        );
      return {
        items: rows.slice(0, limit).map((r) => get(s, r.id)),
        hasMore: rows.length > limit,
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
        transport: "not_connected",
      };
    },
    async write(s, input) {
      check(s, input.action !== "draft");
      keys(input, [
        "action",
        "requestId",
        "projectId",
        "mandateId",
        "expectedMandateRevision",
        "kind",
        "periodStart",
        "id",
        "expectedRevision",
        "amountMinor",
        "currency",
        "evidence",
        "collectionId",
        "reason",
      ]);
      id(input.requestId);
      const old = replay(s, input);
      if (old) return old;
      const allowed = {
        draft: [
          "projectId",
          "mandateId",
          "expectedMandateRevision",
          "kind",
          "periodStart",
        ],
        issue: ["id", "expectedRevision"],
        void: ["id", "expectedRevision", "reason"],
        collection: [
          "id",
          "expectedRevision",
          "amountMinor",
          "currency",
          "evidence",
        ],
        refund: [
          "id",
          "expectedRevision",
          "amountMinor",
          "currency",
          "evidence",
          "collectionId",
        ],
      };
      if (!allowed[input.action]) fail("ACTION_DENIED");
      keys(input, ["action", "requestId", ...allowed[input.action]]);
      let verified = null;
      if (["collection", "refund"].includes(input.action)) {
        get(s, input.id);
        verified = await evidence.verify(s, input.evidence);
        if (Date.parse(verified.occurredAt) > clock())
          fail("BILLING_FUTURE_EVIDENCE", "收退款时间不能晚于当前时间。");
      }
      check(s, input.action !== "draft");
      store.db.exec("BEGIN IMMEDIATE");
      try {
        const repeated = replay(s, input);
        if (repeated) {
          store.db.exec("COMMIT");
          return repeated;
        }
        let bill;
        if (input.action === "draft") {
          const m = currentMandate(s, input.projectId, input.mandateId);
          if (input.expectedMandateRevision !== m.revision)
            fail("REVISION_CONFLICT", "委托已更新，请重新核对。");
          let calculated;
          try {
            calculated = serviceBillTerms(
              m,
              input.kind,
              input.periodStart,
              clock(),
            );
          } catch (e) {
            if (/^(BILLING_|BUSINESS_)/.test(e.message))
              fail(e.message, "当前委托模式、费用或账期不支持生成此服务账单。");
            throw e;
          }
          const existing = store.db
            .prepare(
              "SELECT id FROM service_bills WHERE workspace=? AND mandate=? AND kind=? AND status!='void' AND (?='fixed_fee' OR (period_start<? AND period_end>?))",
            )
            .get(
              s.workspaceId,
              m.id,
              calculated.kind,
              calculated.kind,
              calculated.periodEndExclusive,
              calculated.periodStart,
            );
          if (existing)
            fail(
              "BILLING_DUPLICATE_PERIOD",
              "该委托已经存在本次固定费或重叠账期，不能重复收费。",
            );
          bill = {
            id: `bill_${randomUUID()}`,
            projectId: input.projectId,
            mandateId: m.id,
            mandateRevision: m.revision,
            mandateApprovalReceiptId: m.approvalReceiptId,
            businessTerms: structuredClone(m.businessTerms),
            mandateTitle: m.title,
            principalPartyId: m.principalPartyId,
            operatorPartyId: m.operatorPartyId,
            ...calculated,
            status: "draft",
            revision: 1,
            createdAt: new Date(clock()).toISOString(),
            createdBy: s.actor,
            documentType: "internal_service_statement",
            legalTaxInvoice: false,
          };
        } else {
          const v = get(s, input.id);
          const {
            events,
            collectedMinor,
            refundedMinor,
            netCollectedMinor,
            outstandingMinor,
            paymentStatus,
            transport,
            ...stored
          } = v;
          bill = stored;
          if (input.expectedRevision !== bill.revision)
            fail("REVISION_CONFLICT", "账单已更新，请重新核对。");
          if (input.action === "issue") {
            if (bill.status !== "draft") fail("BILLING_STATE");
            assertCurrent(s, bill);
            bill.status = "issued";
            bill.issuedAt = new Date(clock()).toISOString();
            bill.issuedBy = s.actor;
          } else if (input.action === "void") {
            if (
              bill.status === "void" ||
              events.some((e) => ["collection", "refund"].includes(e.kind))
            )
              fail("BILLING_STATE", "已有收退款记录的账单不能作废。");
            text(input.reason, "reason", 2000);
            bill.status = "void";
            bill.voidReason = input.reason;
          } else {
            if (bill.status !== "issued") fail("BILLING_STATE");
            integer(input.amountMinor, "amountMinor", 1, 100000000);
            if (input.currency !== bill.currency)
              fail("BILLING_CURRENCY_MISMATCH");
            const duplicate = store.db
              .prepare(
                "SELECT 1 FROM service_bill_events WHERE workspace=? AND provider=? AND external_id=?",
              )
              .get(s.workspaceId, verified.provider, verified.externalEventId);
            if (duplicate)
              fail(
                "DUPLICATE_EVIDENCE",
                "这笔外部交易已经登记，不能重复使用。",
              );
            if (Date.parse(verified.occurredAt) < Date.parse(bill.issuedAt))
              fail(
                "BILLING_EVIDENCE_TIME",
                "当前版本只支持确认账单之后发生的收退款。",
              );
            if (
              input.action === "collection" &&
              input.amountMinor > outstandingMinor
            )
              fail("BILLING_OVERPAYMENT", "登记金额不能超过未收余额。");
            if (input.action === "refund") {
              const c = events.find(
                (e) =>
                  e.id === id(input.collectionId) && e.kind === "collection",
              );
              const prior = events
                .filter(
                  (e) =>
                    e.kind === "refund" &&
                    e.collectionId === input.collectionId,
                )
                .reduce((n, e) => n + e.amountMinor, 0);
              if (
                !c ||
                Date.parse(verified.occurredAt) <
                  Date.parse(c.evidence.occurredAt) ||
                input.amountMinor > c.amountMinor - prior
              )
                fail(
                  "BILLING_OVERREFUND",
                  "退款必须对应本账单收款，且不超过该笔尚未退回的金额。",
                );
            }
            // Checked cumulative values remain bounded even after repeated refund/recollection.
            if (
              !Number.isSafeInteger(
                (input.action === "collection"
                  ? collectedMinor
                  : refundedMinor) + input.amountMinor,
              )
            )
              fail("AMOUNT_OVERFLOW");
          }
          bill.revision++;
        }
        check(s, input.action !== "draft");
        store.db
          .prepare(
            "INSERT INTO service_bills VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace,id) DO UPDATE SET status=excluded.status,revision=excluded.revision,body=excluded.body",
          )
          .run(
            s.workspaceId,
            bill.id,
            bill.projectId,
            bill.mandateId,
            bill.kind,
            bill.periodStart,
            bill.periodEndExclusive,
            bill.status,
            bill.revision,
            canonical(bill),
          );
        append(s, bill.id, input.action, {
          revision: bill.revision,
          ...(verified
            ? {
                amountMinor: input.amountMinor,
                currency: input.currency,
                evidence: verified,
                ...(input.collectionId
                  ? { collectionId: input.collectionId }
                  : {}),
              }
            : {}),
          ...(input.reason ? { reason: input.reason } : {}),
        });
        store.db
          .prepare("INSERT INTO service_bill_requests VALUES(?,?,?,?,?)")
          .run(s.workspaceId, s.actor, input.requestId, sha(input), bill.id);
        const result = { current: get(s, bill.id), replayed: false };
        store.db.exec("COMMIT");
        return result;
      } catch (e) {
        store.db.exec("ROLLBACK");
        throw e;
      }
    },
    toolRead(input, execution) {
      return api.list(access.tool(execution), input);
    },
    toolDraft(input, execution) {
      keys(input, [
        "requestId",
        "projectId",
        "mandateId",
        "expectedMandateRevision",
        "kind",
        "periodStart",
      ]);
      return api.write(access.tool(execution), { ...input, action: "draft" });
    },
    http(method, action, body, guard) {
      const { sessionId, ...input } = body;
      const s = access.owner(sessionId, guard?.sync);
      if (method === "GET" && action === "list") {
        if (input.limit !== undefined) input.limit = Number(input.limit);
        return api.list(s, input);
      }
      if (method === "POST" && action === "write") return api.write(s, input);
      if (method === "POST" && action === "upload-evidence")
        return evidence.upload(s, input);
      fail("NOT_FOUND");
    },
    close() {
      closed = true;
      access.close();
    },
  };
  return api;
}
