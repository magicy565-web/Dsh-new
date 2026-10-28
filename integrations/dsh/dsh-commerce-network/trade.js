import {
  createAccess,
  keys,
  fail,
  id,
  integer,
  iso,
  text,
} from "@workspace-agent/dsh-commerce-contracts";
export function createTradeProjection({
  registry,
  rfq,
  quotes,
  trade,
  network,
}) {
  const access = createAccess(registry);
  function read(scope, projectId, { validateProject = true } = {}) {
    scope.check();
    id(projectId, "projectId");
    if (validateProject) {
      const state = network().state(scope.sessionId, projectId);
      if (
        state.workspaceId !== scope.workspaceId ||
        state.projectId !== projectId
      )
        fail("PROJECT_SCOPE");
    }
    const result = {
      contractVersion: "commerce-trade-v1",
      projectId,
      workspaceId: scope.workspaceId,
      rfqs: [],
      quotes: [],
      buyers: [],
      orders: [],
      samples: [],
      dependencies: {},
      truncated: false,
    };
    const collect = (read) => {
      const rows = [];
      let afterId;
      do {
        const page = read({ projectId, afterId, limit: 100 });
        rows.push(...page.items);
        afterId = page.hasMore ? page.nextCursor : null;
        if (rows.length >= 1000 && afterId) {
          result.truncated = true;
          break;
        }
      } while (afterId);
      return rows;
    };
    const r = rfq(),
      q = quotes(),
      t = trade();
    result.dependencies = {
      rfq: r ? "available" : "DEPENDENCY_MISSING",
      quotes: q ? "available" : "DEPENDENCY_MISSING",
      samples: t ? "available" : "DEPENDENCY_MISSING",
    };
    if (r)
      result.rfqs = collect((input) => r.read(scope, input)).map((v) => ({
        id: v.id,
        revision: v.revision,
        projectId: v.projectId,
        status: v.status,
        buyerRef: v.buyerRef,
        productRef: v.productRef,
        missingFields: v.missingFields,
        source: {
          channel: v.source.channel,
          externalMessageId: v.source.externalMessageId,
          receivedAt: v.source.receivedAt,
          rawEvidenceSha256: v.source.rawEvidenceSha256,
        },
        sourceAvailability: v.sourceAvailability,
      }));
    if (q) {
      result.quotes = collect((input) => q.read(scope, input)).map((v) => ({
        id: v.quoteId,
        version: v.version,
        revision: v.revision,
        projectId: v.projectId,
        status:
          !["sending", "accepted", "withdrawn"].includes(v.status) &&
          Date.parse(v.validUntil) <= Date.now()
            ? "expired"
            : v.status,
        rfqRef: v.rfqRef,
        buyerId: v.buyerId,
        productRef: v.productRef,
        validUntil: v.validUntil,
        approvalReceiptId: v.approval?.id ?? null,
        sourceSnapshotSha256: v.sourceSnapshotSha256,
      }));
      for (const buyerId of new Set(
        [
          ...result.rfqs.map((r) => r.buyerRef),
          ...result.quotes.map((q) => q.buyerId),
        ].filter(Boolean),
      )) {
        try {
          const b = q.buyer(scope, buyerId);
          result.buyers.push({
            id: b.id,
            revision: b.revision,
            name: b.name,
            projectId,
          });
        } catch (e) {
          if (e.code !== "NOT_FOUND") throw e;
        }
      }
      result.orders = [
        ...new Map(
          q.orderRefs(scope, projectId).map((o) => [o.id, o]),
        ).values(),
      ].map((o) => ({
        id: o.id,
        quoteId: o.quoteId,
        status: o.status,
        projectId,
        paymentStatus: o.paymentStatus,
      }));
    }
    if (t)
      result.samples = collect((input) => t.list(scope, input)).map((s) => ({
        id: s.id,
        quoteId: s.quoteId,
        projectId: s.projectId,
        revision: s.revision,
        status: s.status,
        carrier: s.carrier ?? null,
        trackingId: s.trackingId ?? null,
        paymentStatus: s.paymentStatus,
      }));
    scope.check();
    return result;
  }
  return {
    read: (sessionId, projectId, options) =>
      read(access.owner(sessionId), projectId, options),
    toolRead: (input, execution) => {
      keys(input, ["projectId"]);
      return read(access.tool(execution), input.projectId);
    },
    close: () => access.close(),
  };
}
