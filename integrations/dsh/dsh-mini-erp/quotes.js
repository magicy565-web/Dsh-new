import { randomUUID } from "node:crypto";
import { QuoteStore } from "./quote-store.js";
import { resolveSku } from "./catalog.js";
import {
  checkScope,
  keys,
  id,
  text,
  integer,
  iso,
  sha,
  canonical,
  fail,
  dependency,
} from "@workspace-agent/dsh-commerce-contracts";
import {
  calculate,
  validatePolicy,
  transition,
  effectiveQuoteStatus,
} from "@workspace-agent/domain-quote";
export function createQuoteService(
  erp,
  { registry, library, rfq, clock = Date.now },
) {
  const store = new QuoteStore(erp);
  let closed = false;
  const money = (n) =>
    `${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`;
  const check = (s, owner = false) => {
    if (closed) fail("UNAVAILABLE");
    checkScope(s, registry, owner);
  };
  const buyer = (s, buyerId) => {
    check(s);
    return erp.buyer(s.workspaceId, id(buyerId));
  };
  const channelIdentity = (transport) =>
    transport
      ? { accountRef: transport.accountRef, from: transport.from ?? null }
      : null;
  const withProducts = (fn) =>
    dependency(library, "Workspace Library").withProducts(fn);
  function envelope(scope, input, products) {
    check(scope);
    const r = dependency(rfq, "RFQ Desk").quoteContext(scope, id(input.rfqRef));
    if (r.revision !== input.rfqRevision) fail("RFQ_CHANGED");
    const b = buyer(scope, r.buyerRef),
      link = erp.link(scope.workspaceId, id(input.productId));
    if (!link)
      fail(
        "QUOTE_BLOCKED_MISSING_EVIDENCE",
        "Link the SKU to this workspace first",
      );
    if (
      r.productRef &&
      (r.productRef.id !== link.product_id ||
        r.productRef.revision !== input.productRevision ||
        (r.productRef.skuId && r.productRef.skuId !== link.sku_id))
    )
      fail("SOURCE_CHANGED");
    const c = resolveSku(
        products,
        link.product_id,
        link.sku_id,
        r.requirements.quantity,
      ),
      p = store.policy(scope.workspaceId, input.productId);
    const calculated = calculate({
      catalog: c,
      policy: p,
      quantity: r.requirements.quantity,
      productRevision: input.productRevision,
      currency: r.requirements.currency,
      now: clock(),
    });
    if (
      r.requirements.incoterm !== p.incoterm ||
      r.requirements.namedPlace !== p.namedPlace ||
      r.requirements.unit !== c.sku.unit
    )
      fail(
        "QUOTE_BLOCKED_MISSING_EVIDENCE",
        "RFQ trade terms or unit differ from the reviewed policy",
      );
    const validUntil = iso(input.validUntil);
    if (
      Date.parse(validUntil) <= clock() ||
      Date.parse(validUntil) > Date.parse(p.validUntil)
    )
      fail("QUOTE_EXPIRED");
    if (b.email !== r.contactPermission.recipient) fail("RECIPIENT_CHANGED");
    const subject = `Quotation ${c.sku.code || c.skuId}`;
    if (/[\r\n]/.test(subject) || subject.length > 998)
      fail("DISCLOSURE_DENIED", "Invalid message subject");
    // Only explicitly allowed commercial fields reach the buyer. No free-form model price/body.
    const disclosure = {
      productName: c.name,
      sku: c.sku.code || c.skuId,
      quantity: calculated.quantity,
      unit: c.sku.unit,
      currency: calculated.currency,
      unitPriceMinor: calculated.unitPriceMinor,
      totalMinor: calculated.totalMinor,
      incoterm: p.incoterm,
      namedPlace: p.namedPlace,
      leadTimeDays: p.leadTimeDays,
      validUntil,
    };
    const body = [
      `Product: ${disclosure.productName}`,
      `SKU: ${disclosure.sku}`,
      `Quantity: ${disclosure.quantity} ${disclosure.unit}`,
      `Unit price: ${money(disclosure.unitPriceMinor)} ${disclosure.currency}`,
      `Goods subtotal: ${money(disclosure.totalMinor)} ${disclosure.currency}`,
      `Terms: ${disclosure.incoterm} ${disclosure.namedPlace}`,
      `Lead time: ${disclosure.leadTimeDays} days`,
      `Valid until: ${validUntil}`,
      "Freight, tax and other charges are not included in this goods subtotal. This quotation is not an order confirmation, payment receipt or signed contract.",
    ].join("\n");
    return {
      ...calculated,
      projectId: r.projectId,
      rfqRef: r.id,
      rfqRevision: r.revision,
      rfqSourceSha256: r.source.rawEvidenceSha256,
      buyerId: b.id,
      buyerRevision: b.revision,
      productId: input.productId,
      productRef: { id: c.productId, revision: c.revision, skuId: c.skuId },
      destination: r.requirements.destination,
      validUntil,
      recipient: b.email,
      subject,
      body,
      bodySha256: sha(body),
      disclosure,
      proposalInput: {
        rfqRef: r.id,
        rfqRevision: r.revision,
        productId: input.productId,
        productRevision: input.productRevision,
        validUntil,
      },
    };
  }
  function fresh(scope, q, products) {
    if (q.version !== q.currentVersion) fail("QUOTE_SUPERSEDED");
    if (Date.parse(q.validUntil) <= clock()) fail("QUOTE_EXPIRED");
    const e = envelope(scope, q.proposalInput, products);
    if (
      e.sourceSnapshotSha256 !== q.sourceSnapshotSha256 ||
      e.bodySha256 !== q.bodySha256 ||
      e.buyerRevision !== q.buyerRevision ||
      e.recipient !== q.recipient
    )
      fail("APPROVAL_STALE");
    return e;
  }
  function reviewValue(scope, q, products, transport) {
    fresh(scope, q, products);
    return {
      quote: q,
      channel: channelIdentity(transport),
      policy: store.policy(scope.workspaceId, q.productId),
      reviewDigest: sha({
        quote: q,
        policy: store.policy(scope.workspaceId, q.productId),
        channel: channelIdentity(transport),
      }),
      expectedRevision: q.revision,
    };
  }
  const proposalKeys = [
    "requestId",
    "expectedRevision",
    "quoteId",
    "rfqRef",
    "rfqRevision",
    "productId",
    "productRevision",
    "validUntil",
  ];
  const common = ["requestId", "expectedRevision", "quoteId", "version"];
  const service = {
    buyer,
    read(scope, input = {}) {
      check(scope);
      keys(input, ["quoteId", "version", "projectId", "afterId", "limit"]);
      if (input.quoteId) {
        const q = store.get(scope.workspaceId, input.quoteId, input.version);
        if (input.projectId && q.projectId !== input.projectId)
          fail("NOT_FOUND");
        return {
          ...q,
          effectiveStatus: effectiveQuoteStatus(q, clock()),
          outbox: store.outbox(scope.workspaceId, q.quoteId, q.version),
          events: store.db
            .prepare(
              "SELECT action,actor,at,body FROM quote_events WHERE workspace=? AND quote_id=? ORDER BY seq",
            )
            .all(scope.workspaceId, q.quoteId)
            .map((e) => ({ ...e, body: JSON.parse(e.body) })),
        };
      }
      const page = store.list(
        scope.workspaceId,
        input.projectId,
        input.afterId ?? "",
        integer(input.limit ?? 50, "limit", 1, 100),
      );
      return {
        ...page,
        items: page.items.map((q) => ({
          ...q,
          effectiveStatus: effectiveQuoteStatus(q, clock()),
        })),
      };
    },
    async preview(scope, input) {
      keys(input, [
        "rfqRef",
        "rfqRevision",
        "productId",
        "productRevision",
        "validUntil",
      ]);
      check(scope);
      return withProducts((products) => {
        check(scope);
        try {
          return {
            status: "quotable",
            candidate: envelope(scope, input, products),
          };
        } catch (e) {
          if (e.code)
            return { status: "blocked", code: e.code, reason: e.message };
          throw e;
        }
      });
    },
    async propose(scope, input) {
      keys(input, proposalKeys);
      check(scope);
      const command = { ...input, action: "propose" };
      const prior = store.prior(scope, command);
      if (prior) return prior;
      return withProducts((products) => {
        check(scope);
        return store.command(scope, command, () =>
          store.add(scope, input, envelope(scope, input, products)),
        );
      });
    },
    async policy(scope, input) {
      check(scope, true);
      keys(input, ["requestId", "expectedRevision", "productId", "policy"]);
      const command = { ...input, action: "policy" };
      const prior = store.prior(scope, command);
      if (prior) return prior;
      return withProducts((products) =>
        store.command(scope, command, () => {
          check(scope, true);
          const previous = store.policy(scope.workspaceId, id(input.productId));
          if ((previous?.revision ?? 0) !== input.expectedRevision)
            fail("REVISION_CONFLICT");
          const p = { ...input.policy, revision: input.expectedRevision + 1 };
          validatePolicy(p);
          const link = erp.link(scope.workspaceId, input.productId);
          if (
            !link ||
            link.product_id !== p.productId ||
            link.sku_id !== p.skuId
          )
            fail("SOURCE_CHANGED");
          const c = resolveSku(products, p.productId, p.skuId);
          if (c.revision !== p.productRevision) fail("SOURCE_CHANGED");
          store.db
            .prepare(
              "INSERT INTO quote_policies VALUES(?,?,?,?) ON CONFLICT(workspace,product_id) DO UPDATE SET revision=excluded.revision,body=excluded.body",
            )
            .run(scope.workspaceId, input.productId, p.revision, canonical(p));
          store.event(scope, {}, "policy_reviewed", {
            productId: input.productId,
            policy: p,
          });
          return { policy: p };
        }),
      );
    },
    async review(scope, input, transport = null) {
      check(scope, true);
      keys(input, ["quoteId"]);
      return withProducts((products) => {
        check(scope, true);
        return reviewValue(
          scope,
          store.get(scope.workspaceId, id(input.quoteId)),
          products,
          transport,
        );
      });
    },
    async approve(scope, input, transport = null) {
      check(scope, true);
      keys(input, [...common, "reviewDigest"]);
      return withProducts((products) =>
        store.command(scope, { ...input, action: "approve" }, () => {
          check(scope, true);
          const q = store.cas(scope, input),
            preview = reviewValue(scope, q, products, transport);
          if (input.reviewDigest !== preview.reviewDigest)
            fail("REVIEW_CHANGED");
          transition(q.status, "approved");
          return store.status(scope, q, "approved", {
            approval: {
              id: `approval_${randomUUID()}`,
              digest: input.reviewDigest,
              actor: scope.actor,
              channel: channelIdentity(transport),
              approvedAt: new Date(clock()).toISOString(),
              bodySha256: q.bodySha256,
              recipient: q.recipient,
              sourceSnapshotSha256: q.sourceSnapshotSha256,
            },
          });
        }),
      );
    },
    withdraw(scope, input) {
      check(scope, true);
      keys(input, common);
      return store.command(scope, { ...input, action: "withdraw" }, () => {
        const q = store.cas(scope, input);
        transition(q.status, "withdrawn");
        return store.status(scope, q, "withdrawn");
      });
    },
    async send(scope, input, transport) {
      check(scope, true);
      keys(input, [...common, "approvalReceiptId"]);
      if (!transport?.send || !transport?.accountRef)
        fail("UNCONFIGURED", "No authorized mail transport configured", 503);
      // Intent is committed before any I/O. This unique quote/version is never automatically resent.
      const command = { ...input, action: "send" };
      const intent = await withProducts((products) =>
        store.command(scope, command, () => {
          check(scope, true);
          const q = store.cas(scope, input);
          fresh(scope, q, products);
          if (
            canonical(q.approval?.channel) !==
            canonical(channelIdentity(transport))
          )
            fail(
              "CHANNEL_CHANGED",
              "Review a new quote version for the current sender and account",
            );
          if (
            q.status !== "approved" ||
            q.approval?.id !== input.approvalReceiptId ||
            q.approval.bodySha256 !== q.bodySha256
          )
            fail("APPROVAL_REQUIRED");
          if (store.outbox(scope.workspaceId, q.quoteId, q.version))
            fail(
              "DELIVERY_ALREADY_ATTEMPTED",
              "Reconcile the existing delivery; never use another send ID",
            );
          const body = {
            recipient: q.recipient,
            subject: q.subject,
            text: q.body,
            bodySha256: q.bodySha256,
            accountRef: transport.accountRef,
            quoteId: q.quoteId,
            version: q.version,
            requestId: input.requestId,
          };
          store.db
            .prepare(
              "INSERT INTO quote_delivery_outbox VALUES(?,?,?,?,?,?,NULL)",
            )
            .run(
              scope.workspaceId,
              input.requestId,
              q.quoteId,
              q.version,
              "sending",
              canonical(body),
            );
          transition(q.status, "sending");
          return store.status(scope, q, "sending");
        }),
      );
      if (intent.replayed)
        return {
          ...intent,
          delivery: store.outbox(
            scope.workspaceId,
            input.quoteId,
            input.version,
          ),
        };
      const delivery = store.outbox(
        scope.workspaceId,
        input.quoteId,
        input.version,
      );
      let provider;
      try {
        check(scope, true);
        provider = await transport.send(delivery.body, {
          signal: scope.signal,
        });
      } catch {
        provider = { status: "unknown" };
      }
      // Record a provider outcome even if the user disconnects while the provider sends.
      recordOutcome(scope, delivery, provider);
      check(scope, true);
      return {
        current: store.get(scope.workspaceId, input.quoteId),
        delivery: store.outbox(scope.workspaceId, input.quoteId, input.version),
      };
    },
    async reconcile(scope, input, transport) {
      check(scope, true);
      keys(input, [...common, "providerMessageId"]);
      const command = { ...input, action: "reconcile" },
        prior = store.prior(scope, command);
      if (prior) return prior;
      const q = store.cas(scope, input),
        outbox = store.outbox(scope.workspaceId, q.quoteId, input.version);
      if (!outbox) fail("NOT_FOUND");
      if (!transport?.lookup) fail("UNCONFIGURED");
      const outcome =
        outbox.status === "sent"
          ? outbox.result
          : await transport.lookup(
              outbox.body,
              input.providerMessageId
                ? {
                    providerMessageId: text(
                      input.providerMessageId,
                      "providerMessageId",
                      300,
                    ),
                  }
                : outbox.result,
            );
      check(scope, true);
      return store.command(scope, command, () => {
        store.cas(scope, input);
        recordOutcome(scope, outbox, outcome, true);
        return store.get(scope.workspaceId, q.quoteId);
      });
    },
    linkOrder(scope, input) {
      check(scope, true);
      keys(input, [...common, "orderId"]);
      return store.command(scope, { ...input, action: "link_order" }, () => {
        const q = store.cas(scope, input);
        if (q.status !== "accepted") fail("QUOTE_NOT_ACCEPTED");
        const order = erp.order(scope.workspaceId, id(input.orderId), clock());
        if (
          order.productId !== q.productId ||
          order.buyerId !== q.buyerId ||
          order.quantity !== q.quantity ||
          order.currency !== q.currency ||
          order.totalMinor !== q.totalMinor
        )
          fail("ORDER_MISMATCH");
        if (
          !order.catalogRef ||
          canonical(order.catalogRef) !== canonical(q.productRef)
        )
          fail(
            "ORDER_SOURCE_MISMATCH",
            "The order must retain the exact SKU and source revision from this quote",
          );
        const previous = store.db
          .prepare(
            "SELECT quote_id,version FROM quote_events WHERE workspace=? AND action='order_linked' AND json_extract(body,'$.orderId')=?",
          )
          .all(scope.workspaceId, order.id);
        if (
          previous.some(
            (row) => row.quote_id !== q.quoteId || row.version !== q.version,
          )
        )
          fail(
            "ORDER_ALREADY_LINKED",
            "One ERP order cannot be attributed to different quote versions",
          );
        if (previous.length) return q;
        store.event(scope, q, "order_linked", { orderId: order.id });
        store.db
          .prepare(
            "UPDATE quotes SET revision=revision+1 WHERE workspace=? AND id=?",
          )
          .run(scope.workspaceId, q.quoteId);
        return store.get(scope.workspaceId, q.quoteId);
      });
    },
    orderRefs(scope, projectId) {
      check(scope);
      const rows = store.db
        .prepare(
          "SELECT e.body,e.quote_id,e.version,v.body AS quote_body FROM quote_events e JOIN quotes q ON q.workspace=e.workspace AND q.id=e.quote_id JOIN quote_versions v ON v.workspace=e.workspace AND v.quote_id=e.quote_id AND v.version=e.version WHERE e.workspace=? AND q.project=? AND e.action='order_linked' ORDER BY e.seq",
        )
        .all(scope.workspaceId, projectId)
        .map((r) => {
          const q = JSON.parse(r.quote_body);
          return {
            ...erp.order(
              scope.workspaceId,
              JSON.parse(r.body).orderId,
              clock(),
            ),
            quoteId: r.quote_id,
            quoteRef: {
              id: r.quote_id,
              version: r.version,
              productRef: q.productRef,
              destination: q.destination ?? null,
            },
          };
        });
      const orders = new Map();
      for (const order of rows) {
        const previous = orders.get(order.id);
        if (!previous) orders.set(order.id, order);
        else if (canonical(previous.quoteRef) !== canonical(order.quoteRef))
          orders.set(order.id, {
            ...order,
            quoteId: null,
            quoteRef: null,
            attributionStatus: "ambiguous_quote_links",
          });
      }
      return [...orders.values()];
    },
    accept(scope, input) {
      check(scope, true);
      keys(input, [
        ...common,
        "replyRfqId",
        "replyRevision",
        "evidenceQuote",
        "evidenceStart",
        "evidenceEnd",
      ]);
      return store.command(scope, { ...input, action: "accept" }, () => {
        const q = store.cas(scope, input);
        if (Date.parse(q.validUntil) <= clock()) fail("QUOTE_EXPIRED");
        const reply = dependency(rfq, "RFQ Desk").read(scope, {
          id: input.replyRfqId,
          includeRaw: true,
        });
        const sent = store.outbox(scope.workspaceId, q.quoteId, q.version);
        if (
          reply.id === q.rfqRef ||
          !sent?.result?.at ||
          Date.parse(reply.source.receivedAt) < Date.parse(sent.result.at)
        )
          fail(
            "REPLY_EVIDENCE_REQUIRED",
            "A distinct reply received after this send is required",
          );
        if (
          reply.revision !== input.replyRevision ||
          reply.buyerRef !== q.buyerId ||
          reply.projectId !== q.projectId ||
          !reply.review ||
          !reply.rawText
        )
          fail("REPLY_EVIDENCE_REQUIRED");
        integer(input.evidenceStart, "evidenceStart", 0, reply.rawText.length);
        integer(
          input.evidenceEnd,
          "evidenceEnd",
          input.evidenceStart + 1,
          reply.rawText.length,
        );
        text(input.evidenceQuote, "evidenceQuote");
        if (
          reply.rawText.slice(input.evidenceStart, input.evidenceEnd) !==
          input.evidenceQuote
        )
          fail("REPLY_EVIDENCE_REQUIRED");
        transition(q.status, "accepted");
        return store.status(scope, q, "accepted", {
          replyRfqId: reply.id,
          replySourceSha256: reply.source.rawEvidenceSha256,
          evidenceSha256: sha(input.evidenceQuote),
          ownerInterpretedAcceptance: true,
          orderCreated: false,
        });
      });
    },
    close() {
      closed = true;
    },
  };
  function recordOutcome(scope, delivery, result, inTransaction = false) {
    const valid =
      result?.status === "sent" &&
      typeof result.providerMessageId === "string" &&
      result.providerMessageId.length <= 300 &&
      result.providerMessageId &&
      result.provider === delivery.body.accountRef &&
      typeof result.at === "string" &&
      Number.isFinite(Date.parse(result.at));
    const status = valid
      ? "sent"
      : result?.status === "failed" && result.definitive === true
        ? "failed"
        : "unknown";
    const safe = valid
      ? {
          status,
          providerMessageId: result.providerMessageId,
          provider: result.provider,
          at: iso(result.at),
          responseSha256: sha(result),
        }
      : { status };
    const commit = () => {
      const current = store.outbox(
        scope.workspaceId,
        delivery.quote_id,
        delivery.version,
      );
      if (current.status === "sent") return;
      store.db
        .prepare(
          "UPDATE quote_delivery_outbox SET status=?,result=? WHERE workspace=? AND request_id=?",
        )
        .run(status, canonical(safe), scope.workspaceId, delivery.request_id);
      const q = store.get(
        scope.workspaceId,
        delivery.quote_id,
        delivery.version,
      );
      if (valid) {
        transition(q.status, "sent");
        store.status(scope, q, "sent", { delivery: safe });
      } else {
        if (status === "failed" && q.status === "sending")
          store.status(scope, q, "approved", { deliveryFailed: true });
        store.event(scope, q, "delivery_" + status, {
          requestId: delivery.request_id,
        });
      }
    };
    return inTransaction ? commit() : store.transaction(commit);
  }
  return service;
}
