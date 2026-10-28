// These are operating labels, not executable stages or transaction evidence.
export const BUSINESS_STAGES = Object.freeze({
  intake: "接受委托",
  product_readiness: "产品准备",
  channel_development: "渠道开发",
  inquiry_followup: "询盘跟进",
  quote_collaboration: "报价协作",
  deal_review: "成交依据核对",
  service_review: "服务复盘与对账",
});
export const PROGRESS_STATUSES = Object.freeze({
  active: "推进中",
  blocked: "有阻碍",
  paused: "已暂停",
});
export function linkedWorkIds(mandate) {
  return [
    ...new Set([
      ...(mandate.workOrderIds || []),
      ...(mandate.progress?.workOrderIds || []),
    ]),
  ];
}

// Same projection is consumed by the native read tool, list and canvas.
export function businessProgressView(mandate, state) {
  const p = mandate.progress;
  const linked = linkedWorkIds(mandate);
  const work = state.workOrders.filter(
    (o) => o.projectId === mandate.projectId && linked.includes(o.id),
  );
  return {
    stage: p?.stage || "intake",
    status: p?.status || "active",
    recorded: Boolean(p),
    needsReview: Boolean(
      p &&
        (p.termsVersion !== mandate.businessTerms.version ||
          p.approvalReceiptId !== mandate.approvalReceiptId),
    ),
    decisions: work
      .filter((o) =>
        ["proposed", "delivered", "failed", "stop_requested"].includes(
          o.status,
        ),
      )
      .map((o) => ({ id: o.id, title: o.title, status: o.status })),
    deliveries: state.deliverables
      .filter(
        (d) => d.projectId === mandate.projectId && linked.includes(d.orderId),
      )
      .map((d) => {
        const o = work.find((o) => o.id === d.orderId);
        return {
          id: d.id,
          title: d.title,
          orderId: d.orderId,
          sha256: d.sha256,
          accepted:
            o?.status === "accepted" &&
            o.deliverableId === d.id &&
            o.deliverableSha256 === d.sha256,
        };
      }),
  };
}
