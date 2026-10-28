import {
  createAccess,
  dependency,
  ownerHttp,
  register,
  schema,
  identifier,
  keys,
  fail,
} from "@workspace-agent/dsh-commerce-contracts";
export const inject = ["tools", "workspaceRegistry"];
export function createChannelLedger({ registry, commerce, quotes, trade }) {
  const access = createAccess(registry);
  function read(scope, { projectId }) {
    scope.check();
    const c = dependency(commerce, "Commerce Network").state(
      scope.sessionId,
      projectId,
    );
    if (c.projectId !== projectId || c.workspaceId !== scope.workspaceId)
      fail("PROJECT_SCOPE");
    const qService = dependency(quotes, "Mini ERP quotes"),
      records = dependency(trade, "Mini ERP trade records");
    const orderMap = new Map(
        qService.orderRefs(scope, projectId).map((o) => [o.id, o]),
      ),
      orders = [...orderMap.values()],
      events = records.financial(scope, projectId);
    const quoteRows = [];
    let afterId;
    do {
      const p = qService.read(scope, { projectId, limit: 100, afterId });
      quoteRows.push(...p.items);
      afterId = p.hasMore ? p.nextCursor : null;
    } while (afterId);
    const currencies = [
      ...new Set([
        c.budget.currency,
        ...orders.map((o) => o.currency),
        ...quoteRows.map((q) => q.currency),
      ]),
    ];
    const metrics = currencies.map((currency) => {
      const sum = (values) => {
        const value = values.reduce((a, n) => a + BigInt(n), 0n);
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail("AMOUNT_OVERFLOW");
        return Number(value);
      };
      const actual = events.filter((e) => e.currency === currency),
        collections = actual.filter((e) => e.kind === "collection"),
        payments = actual.filter((e) => e.kind === "commission_paid");
      const workers = c.commerceNetwork.workOrders.filter(
        (w) => w.currency === currency,
      );
      let accrued = 0n,
        unresolved = false;
      for (const order of orders.filter(
        (o) => o.status === "confirmed" && o.currency === currency,
      )) {
        const mandates = c.commerceNetwork.salesAuthorizations.filter(
          (m) =>
            m.status === "active" &&
            m.terms &&
            Date.parse(m.terms.validUntil) > Date.now() &&
            m.customerAssignments?.some(
              (a) => a.buyerId === order.buyerId && a.status === "assigned",
            ),
        );
        if (mandates.length !== 1) {
          unresolved = true;
          continue;
        }
        const collected = sum(
          collections
            .filter((e) => e.orderId === order.id)
            .map((e) => e.amountMinor),
        );
        accrued +=
          (BigInt(collected) * BigInt(mandates[0].terms.commissionBps)) /
          10000n;
      }
      return {
        currency,
        plannedBudgetMinor:
          currency === c.budget.currency ? c.budget.maximumMinor : 0,
        workerReportedCostMinor: sum(
          workers
            .filter((w) => Number.isSafeInteger(w.actualMinor))
            .map((w) => w.actualMinor),
        ),
        approvedCostMinor: sum(
          workers
            .filter((w) => w.status === "accepted")
            .map((w) => w.actualMinor ?? 0),
        ),
        quotedValueMinor: sum(
          quoteRows
            .filter(
              (q) =>
                q.currency === currency &&
                !["withdrawn", "expired"].includes(q.status),
            )
            .map((q) => q.totalMinor),
        ),
        confirmedOrderValueMinor: sum(
          orders
            .filter((o) => o.status === "confirmed" && o.currency === currency)
            .map((o) => o.totalMinor),
        ),
        collectedRevenueMinor: collections.length
          ? sum(collections.map((e) => e.amountMinor))
          : null,
        commissionAccruedMinor:
          unresolved || !collections.length ? null : sum([accrued]),
        commissionPaidMinor: payments.length
          ? sum(payments.map((e) => e.amountMinor))
          : null,
        settlementStatus: "not_connected",
        reconciliation: actual.length
          ? "owner-recorded-evidence"
          : "unreconciled",
        attributionStatus: unresolved
          ? "requires_owner_resolution"
          : "reviewed",
      };
    });
    scope.check();
    return {
      projectId,
      metrics,
      evidenceRefs: events.map((e) => ({
        id: e.id,
        kind: e.kind,
        sha256: e.evidence.sha256,
        orderId: e.orderId,
      })),
      roi: null,
    };
  }
  return {
    read,
    toolRead(input, execution) {
      keys(input, ["projectId"]);
      return read(access.tool(execution), input);
    },
    http(method, action, body) {
      keys(body, ["sessionId", "projectId"]);
      if (method !== "GET" || action !== "read") fail("NOT_FOUND");
      return read(access.owner(body.sessionId), body);
    },
    close() {
      access.close();
    },
  };
}
export function apply(ctx) {
  const service = createChannelLedger({
    registry: ctx.workspaceRegistry,
    commerce: () => ctx.get("commerceNetwork"),
    quotes: () => ctx.get("miniErpQuotes"),
    trade: () => ctx.get("miniErpTrade"),
  });
  ctx.effect(() => () => service.close(), "channel ledger lifetime");
  ctx.effect(
    () => ctx.reflect.provide("channelLedger", service),
    "channel ledger service",
  );
  register(
    ctx,
    "channel_ledger_read",
    "Read distinct budgets, reported costs, accepted costs, quote value, confirmed orders, evidenced collections and commissions. Unknown money is null, never fabricated revenue or ROI.",
    { ...schema({ projectId: identifier }), required: ["projectId"] },
    (a, e) => service.toolRead(a, e),
  );
  ctx.inject(["webServer", "connection"], (web) =>
    web.effect(
      () =>
        web.webServer.register({
          kind: "prefix",
          path: "/channel-ledger-api",
          handler: ownerHttp("/channel-ledger-api", service, {
            authorize: (r) => web.connection.requestRejection(r),
          }),
        }),
      "channel ledger HTTP",
    ),
  );
}
export default { inject, apply };
