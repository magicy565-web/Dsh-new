const NUMERIC = new Set([
  'eligible', 'converted', 'progressed', 'pending', 'unknown', 'inquiries',
  'unknownResults', 'pendingResults', 'stale', 'staleThresholdDays', 'total', 'active', 'complete', 'incomplete',
  'archived', 'missingImages', 'missingSkus', 'missingDocuments', 'missingSupply',
  'productsReady', 'productsMissingEvidence', 'grossOrders', 'retainedOrders'
]);

const int = value => Number.isSafeInteger(value) && value >= 0;
const number = value => typeof value === 'number' && Number.isFinite(value);
const text = (value, max = 240) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const evidence = source => source?.evidenceId ? [source.evidenceId] : [];
const observedAt = source => typeof source?.observedAt === 'string' ? source.observedAt : null;

function push(out, source, id, type, priority, summary, current, gaps = []) {
  out.push({
    id,
    type,
    priority,
    summary,
    current,
    gaps,
    evidenceIds: evidence(source),
    observedAt: observedAt(source),
    businessGoalVerified: false,
    executable: false
  });
}

/**
 * Convert source observations into business-level signals.
 *
 * This layer is deliberately descriptive. It never invents a conversion rate,
 * causal explanation, forecast, spend, or external action.
 */
export function extractBusinessSignals(sources, { now = Date.now() } = {}) {
  const out = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    if (source?.reference?.kind !== 'metric') continue;
    const v = source.values || {};
    const type = text(v.metricType, 120);


    if (type === 'inquiry-aging-v1') {
      const stale = int(v.stale) ? v.stale : 0;
      const pending = int(v.pending) ? v.pending : 0;
      const threshold = int(v.staleThresholdDays) && v.staleThresholdDays > 0 ? v.staleThresholdDays : 7;
      if (stale > 0) {
        push(out, source, `${source.evidenceId}:followup`, 'followup-aging', 96,
          `${stale} 条询盘已超过 ${threshold} 天没有得到回复。`,
          { stale, pending, eligible: int(v.eligible) ? v.eligible : 0, progressed: int(v.progressed) ? v.progressed : 0, staleThresholdDays: threshold },
          ['STALE_INQUIRIES']);
      } else if (pending > 0) {
        push(out, source, `${source.evidenceId}:pending`, 'inquiry-aging', 84,
          `${pending} 条询盘仍在等待回复。`,
          { pending, eligible: int(v.eligible) ? v.eligible : 0, progressed: int(v.progressed) ? v.progressed : 0, stale: 0, staleThresholdDays: threshold },
          ['PENDING_INQUIRIES']);
      }
      continue;
    }

    if (type === 'inquiry-pipeline-v1') {
      const pending = int(v.pending) ? v.pending : 0;
      const unknown = int(v.unknown) ? v.unknown : 0;
      const eligible = int(v.eligible) ? v.eligible : 0;
      const progressed = int(v.progressed) ? v.progressed : 0;
      if (unknown > 0) {
        push(out, source, `${source.evidenceId}:unknown`, 'inquiry-outcome', 95,
          `${unknown} 条询盘没有明确结果记录，不能把它们判断为丢单。`,
          { eligible, progressed, pending, unknown },
          ['UNKNOWN_INQUIRY_OUTCOMES']);
      }
      if (pending > 0) {
        push(out, source, `${source.evidenceId}:pending`, 'inquiry-pipeline', 91,
          `${pending} 条近期询盘仍未完成跟进。`,
          { eligible, progressed, pending, unknown },
          ['PENDING_PIPELINE_ITEMS']);
      }
      continue;
    }

    if (type === 'product-completeness-v1') {
      const incomplete = int(v.incomplete) ? v.incomplete : 0;
      const total = int(v.total) ? v.total : 0;
      if (incomplete > 0) {
        const parts = [];
        if (int(v.missingImages) && v.missingImages > 0) parts.push(`${v.missingImages} 个缺图片`);
        if (int(v.missingSkus) && v.missingSkus > 0) parts.push(`${v.missingSkus} 个缺 SKU`);
        if (int(v.missingDocuments) && v.missingDocuments > 0) parts.push(`${v.missingDocuments} 个缺资料`);
        if (int(v.missingSupply) && v.missingSupply > 0) parts.push(`${v.missingSupply} 个缺供货信息`);
        push(out, source, `${source.evidenceId}:product-evidence`, 'product-evidence', 88,
          `有 ${incomplete} 个产品资料不完整${parts.length ? '：' + parts.join('、') : ''}。`,
          {
            total,
            active: int(v.active) ? v.active : 0,
            complete: int(v.complete) ? v.complete : 0,
            incomplete,
            archived: int(v.archived) ? v.archived : 0,
            missingImages: int(v.missingImages) ? v.missingImages : 0,
            missingSkus: int(v.missingSkus) ? v.missingSkus : 0,
            missingDocuments: int(v.missingDocuments) ? v.missingDocuments : 0,
            missingSupply: int(v.missingSupply) ? v.missingSupply : 0
          },
          ['PRODUCT_MATERIAL_GAPS']);
      }
      continue;
    }

    if (type === 'commerce-product-cohort-v1') {
      const grossOrders = int(v.grossOrders) ? v.grossOrders : 0;
      const retainedOrders = int(v.retainedOrders) ? v.retainedOrders : 0;
      const unknown = int(v.unknown) ? v.unknown : 0;
      if (unknown > 0) {
        push(out, source, `${source.evidenceId}:unknown`, 'commerce-outcome', 94,
          `有 ${unknown} 个电商结果仍无法核对。`,
          { grossOrders, retainedOrders, unknown },
          ['UNKNOWN_COMMERCE_OUTCOMES']);
      } else if (grossOrders > 0 || retainedOrders > 0) {
        push(out, source, `${source.evidenceId}:observed`, 'commerce-outcome', 70,
          `已观察到 ${retainedOrders} 个保留订单（总订单 ${grossOrders}）。`,
          { grossOrders, retainedOrders, unknown: 0 },
          []);
      }
      continue;
    }

    // Backward-compatible support for earlier metric sources.
    const current = {};
    for (const [key, value] of Object.entries(v)) {
      if (NUMERIC.has(key) && number(value)) current[key] = value;
    }
    if (current.inquiries > 0 && !(current.unknownResults > 0 || current.pendingResults > 0)) {
      push(out, source, `${source.evidenceId}:inquiries`, 'inquiry-volume', 70,
        `当前样本包含 ${current.inquiries} 条询盘。`, current);
    }
    if (current.unknownResults > 0) {
      push(out, source, `${source.evidenceId}:unknown`, 'inquiry-outcome', 95,
        `当前样本中有 ${current.unknownResults} 条结果未知。`, current, ['UNKNOWN_OUTCOMES']);
    }
    if (current.pendingResults > 0) {
      push(out, source, `${source.evidenceId}:pending`, 'inquiry-pipeline', 91,
        `当前样本中有 ${current.pendingResults} 条结果待处理。`, current, ['PENDING_OUTCOMES']);
    }
    if (typeof v.lastFollowupAt === 'string' && typeof v.followupDueAt === 'string') {
      const last = Date.parse(v.lastFollowupAt), due = Date.parse(v.followupDueAt);
      if (Number.isFinite(last) && Number.isFinite(due) && last < due && due <= (typeof now === 'function' ? now() : now)) {
        push(out, source, `${source.evidenceId}:followup`, 'followup-aging', 90,
          '存在需要核对的跟进时点。', { ...current, lastFollowupAt: v.lastFollowupAt, followupDueAt: v.followupDueAt }, ['FOLLOWUP_TIMING']);
      }
    }
  }

  const nowValue = typeof now === 'function' ? now() : now;
  const clock = Number.isFinite(nowValue) ? nowValue : Date.now();
  return out
    .filter(item => !item.observedAt || !Number.isFinite(Date.parse(item.observedAt)) || Date.parse(item.observedAt) <= clock + 60000)
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

export function rankBusinessSignals(signals, limit = 3) {
  return [...(Array.isArray(signals) ? signals : [])]
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || String(a.id).localeCompare(String(b.id)))
    .slice(0, Math.max(0, limit));
}
