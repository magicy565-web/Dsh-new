/** Read-only, versioned projections; no transaction state is persisted here. */
export function appendTrade(graph, state) {
  const facts = state.trade;
  if (
    facts?.contractVersion !== "commerce-trade-v1" ||
    facts.projectId !== graph.projectId ||
    facts.workspaceId !== state.workspaceId
  )
    return graph;
  const saved = new Map(
    (
      state.canvasLayouts?.find((l) => l.projectId === graph.projectId)
        ?.nodes || []
    ).map((n) => [n.id, n.position]),
  );
  const ids = new Set(graph.nodes.map((n) => n.id));
  const add = (kind, record, x, y, title) => {
    const id = `${kind}:${record.id}`;
    if (ids.has(id) || record.projectId !== graph.projectId) return;
    ids.add(id);
    graph.nodes.push({
      id,
      kind,
      refId: record.id,
      title,
      subtitle:
        kind === "quote"
          ? `v${record.version} · ${record.status}`
          : record.status || "客户主档引用",
      status: record.status || "unverified",
      position: saved.get(id) || { x, y },
      info: {
        authority: kind === "rfq" ? "RFQ Desk" : "Mini ERP",
        revision: record.revision ?? null,
        priceHidden: true,
      },
      evidenceIds: [
        record.source?.rawEvidenceSha256,
        record.sourceSnapshotSha256,
        record.approvalReceiptId,
      ].filter(Boolean),
      tradeRecord: record,
    });
  };
  const link = (source, target, kind) => {
    if (ids.has(source) && ids.has(target))
      graph.edges.push({
        id: `trade:${source}:${target}`,
        source,
        target,
        kind,
      });
  };
  facts.buyers.forEach((r, i) => add("buyer", r, 1800, 120 + i * 230, r.name));
  facts.rfqs.forEach((r, i) =>
    add("rfq", r, 2150, 120 + i * 230, `询盘 ${r.id.slice(-8)}`),
  );
  facts.quotes.forEach((r, i) =>
    add("quote", r, 2500, 120 + i * 230, `报价 ${r.id.slice(-8)}`),
  );
  facts.orders.forEach((r, i) =>
    add("erp_order", r, 2850, 120 + i * 230, `订单 ${r.id.slice(-8)}`),
  );
  facts.samples.forEach((r, i) =>
    add("sample", r, 2850, 400 + i * 230, `样品 ${r.id.slice(-8)}`),
  );
  for (const r of facts.rfqs) {
    link(`buyer:${r.buyerRef}`, `rfq:${r.id}`, "submitted_rfq");
    const product = state.products?.find(
      (p) =>
        p.sourceRef?.id === r.productRef?.id &&
        p.sourceRef?.revision === r.productRef?.revision,
    );
    if (product)
      link(`product:${product.id}`, `rfq:${r.id}`, "requested_product");
  }
  for (const q of facts.quotes)
    link(`rfq:${q.rfqRef}`, `quote:${q.id}`, "quoted_for");
  for (const o of facts.orders)
    link(`quote:${o.quoteId}`, `erp_order:${o.id}`, "independent_order");
  for (const s of facts.samples)
    link(`quote:${s.quoteId}`, `sample:${s.id}`, "sample_request");
  return graph;
}
