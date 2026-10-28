import { createHash } from "node:crypto";
import {
  BUSINESS_STAGES,
  PROGRESS_STATUSES,
  businessTermStatus,
} from "@workspace-agent/domain-commerce-network";

/** Called only inside the existing Owner command transaction. No execution or billing side effects. */
export function recordBusinessProgress(
  mandate,
  input,
  { state, actor, now, eventId, fail },
) {
  const bad = (message) => fail("BUSINESS_PROGRESS_INVALID", message);
  const allowed = [
    "mandateId",
    "expectedProgressRevision",
    "stage",
    "status",
    "responsiblePartyId",
    "nextAction",
    "blocker",
    "reason",
    "workOrderIds",
    "outcomeIds",
  ];
  if (
    !input ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Object.keys(input).some((k) => !allowed.includes(k))
  )
    bad("业务进展包含不支持的字段。");
  if (!mandate || mandate.businessTerms?.mode !== "factory_sales")
    fail(
      "BUSINESS_PROGRESS_UNAVAILABLE",
      "请选择当前项目内的工厂代运营委托。",
      404,
    );
  if (
    businessTermStatus(mandate, now) !== "active" ||
    !mandate.approvalReceiptId
  )
    fail(
      "BUSINESS_PROGRESS_UNAVAILABLE",
      "委托须已审核且在有效期内；历史进展仍可查看。",
      409,
    );
  if (
    !Number.isSafeInteger(input.expectedProgressRevision) ||
    input.expectedProgressRevision !== (mandate.progress?.revision || 0)
  )
    fail("REVISION_CONFLICT", "业务进展已更新，请重新核对。", 409);
  if (
    !Object.hasOwn(BUSINESS_STAGES, input.stage) ||
    !Object.hasOwn(PROGRESS_STATUSES, input.status)
  )
    bad("请选择支持的业务阶段和推进状态。");
  const text = (v, label, max, required = true) => {
    if (typeof v !== "string" || v.length > max || (required && !v.trim()))
      bad(`请填写${label}，最多 ${max} 字。`);
    return v.trim();
  };
  const nextAction = text(input.nextAction, "下一步", 1200);
  const reason = text(input.reason, "更新依据", 2000);
  const blocker = text(input.blocker, "阻碍", 1200, input.status === "blocked");
  if (
    !state.parties.some(
      (p) =>
        p.id === input.responsiblePartyId && p.projectId === mandate.projectId,
    )
  )
    bad("负责主体必须属于当前项目。");
  const refs = (ids, name) => {
    if (
      !Array.isArray(ids) ||
      ids.length > 30 ||
      ids.some((id) => typeof id !== "string") ||
      new Set(ids).size !== ids.length
    )
      bad(`${name}最多 30 项且不可重复。`);
    return [...ids];
  };
  const workOrderIds = refs(input.workOrderIds, "关联工单");
  if (
    workOrderIds.some(
      (id) =>
        !state.workOrders.some(
          (o) => o.id === id && o.projectId === mandate.projectId,
        ),
    )
  )
    bad("只能关联当前项目的实际工单。");
  const linked = new Set([...(mandate.workOrderIds || []), ...workOrderIds]);
  const outcomeIds = refs(input.outcomeIds, "成果");
  const outcomes = outcomeIds.map((id) => {
    const d = state.deliverables.find(
      (d) =>
        d.id === id &&
        d.projectId === mandate.projectId &&
        linked.has(d.orderId),
    );
    const o =
      d &&
      state.workOrders.find(
        (o) => o.id === d.orderId && o.projectId === mandate.projectId,
      );
    if (
      !d ||
      !o ||
      o.status !== "accepted" ||
      o.deliverableId !== d.id ||
      o.deliverableSha256 !== d.sha256 ||
      !o.acceptanceReceiptId ||
      typeof d.content !== "string" ||
      createHash("sha256").update(d.content).digest("hex") !== d.sha256
    )
      bad("业务成果必须来自关联工单中已经验收的交付。");
    return {
      id: d.id,
      orderId: d.orderId,
      title: d.title,
      sha256: d.sha256,
      acceptanceReceiptId: o.acceptanceReceiptId,
    };
  });
  const history = mandate.progressHistory || [];
  if (history.length >= 200)
    fail(
      "BUSINESS_PROGRESS_LIMIT",
      "该委托已达到 200 条进展记录上限，历史记录保留。",
      409,
    );
  const value = {
    revision: (mandate.progress?.revision || 0) + 1,
    eventId,
    stage: input.stage,
    status: input.status,
    responsiblePartyId: input.responsiblePartyId,
    nextAction,
    blocker,
    reason,
    workOrderIds,
    outcomes,
    termsVersion: mandate.businessTerms.version,
    approvalReceiptId: mandate.approvalReceiptId,
    actor,
    recordedAt: new Date(now).toISOString(),
  };
  // Append exact historical snapshots, including accepted outcome hashes. Do not bump the contract revision.
  mandate.progress = value;
  mandate.progressHistory = [...history, structuredClone(value)];
  return value;
}
