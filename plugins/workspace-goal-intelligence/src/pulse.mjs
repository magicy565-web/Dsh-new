const text = (value, max = 180) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const ids = value => Array.isArray(value) ? value.filter(v => typeof v === 'string' && v.trim()).slice(0, 6) : [];

function card(key, priority, title, reason, action, evidenceIds = [], goalId = null, decisionDraft = null) {
  return {
    id: key,
    priority,
    title,
    reason,
    evidenceIds: ids(evidenceIds),
    action: { ...action, ...(goalId ? { goalId } : {}) },
    ...(decisionDraft ? { decisionDraft } : {}),
    executable: false,
    businessGoalVerified: false
  };
}

/**
 * Realtime homepage pulse is a deterministic projection over the latest
 * authorized Brain context and source observations. It is not a model,
 * forecast, score of business success, or causal diagnosis.
 */
export function buildBusinessPulse({ context = null, diagnosis = null, decisionCards = [], decisionDrafts = [] } = {}) {
  const cards = [];
  const savedContext = context?.context;
  const goalIds = ids(savedContext?.payload?.goalIds);
  const unknowns = ids(savedContext?.payload?.unknowns);
  const sources = Array.isArray(context?.sources) ? context.sources : [];
  const signals = Array.isArray(diagnosis?.signals) ? diagnosis.signals : [];
  if(!savedContext&&!signals.length&&!decisionCards.length&&!decisionDrafts.length)return [card('context:missing',100,'建立经营上下文','当前没有经过授权的经营事实；先选择资料。',{kind:'open-business-context'})];
  const goalId = goalIds[0] || null;
  const actionFor = goalId
    ? { kind: 'open-original-goal' }
    : { kind: 'open-business-context' };

  for (const signal of signals) {
    const evidence = signal.evidenceId ? [signal.evidenceId] : [];
    const current = signal.current || {};

    if (signal.kind === 'inquiry-aging' && current.stale > 0) {
      cards.push(card(
        `inquiry:stale:${signal.evidenceId}`,
        signal.priority || 96,
        `有 ${current.stale} 条询盘超过 ${current.staleThresholdDays} 天未回复`,
        `近 ${Math.max(1, Math.round((new Date(signal.window.end).getTime() - new Date(signal.window.start).getTime()) / 86400000))} 天的有效询盘中，${current.stale} 条仍处于等待回复状态。这是跟进时效观察，不等于已经丢单。`,
        actionFor,
        evidence,
        goalId
      ));
      continue;
    }

    if (signal.kind === 'inquiry-pipeline' && current.pending > 0) {
      cards.push(card(
        `inquiry:pending:${signal.evidenceId}`,
        signal.priority || 91,
        `有 ${current.pending} 条近期询盘待跟进`,
        `当前窗口共有 ${current.eligible} 条进入跟进范围的询盘，其中 ${current.pending} 条还没有完成回复。`,
        actionFor,
        evidence,
        goalId
      ));
      continue;
    }

    if (signal.kind === 'inquiry-pipeline' && current.unknown > 0) {
      cards.push(card(
        `inquiry:unknown:${signal.evidenceId}`,
        signal.priority || 95,
        `有 ${current.unknown} 条询盘没有明确结果`,
        '结果字段不完整，暂时不能把这些记录判断为丢单；先补齐结果证据。',
        actionFor,
        evidence,
        goalId
      ));
      continue;
    }

    if (signal.kind === 'product-completeness' && current.incomplete > 0) {
      const missing = [];
      if (current.missingImages > 0) missing.push(`${current.missingImages} 个缺图片`);
      if (current.missingSkus > 0) missing.push(`${current.missingSkus} 个缺 SKU`);
      if (current.missingDocuments > 0) missing.push(`${current.missingDocuments} 个缺资料`);
      if (current.missingSupply > 0) missing.push(`${current.missingSupply} 个缺供货信息`);
      cards.push(card(
        `product:incomplete:${signal.evidenceId}`,
        signal.priority || 88,
        `${current.incomplete} 个产品的销售资料不完整`,
        missing.length ? missing.join('、') + '。先补齐资料，再进入外部销售动作。' : '产品基础资料尚未完整。先补齐资料，再进入外部销售动作。',
        actionFor,
        evidence,
        goalId
      ));
      continue;
    }

    if (current.unknown > 0) {
      cards.push(card(
        `metric:unknown:${signal.evidenceId}`,
        signal.priority || 93,
        '补齐经营结果',
        `当前样本中有 ${current.unknown} 条结果未知，暂不能把它们判断为丢单。`,
        actionFor,
        evidence,
        goalId
      ));
    }

    if (signal.gaps?.includes('NO_COMPARABLE_BASELINE')) {
      cards.push(card(
        `metric:baseline:${signal.evidenceId}`,
        78,
        '建立可比基线',
        '当前有询盘数据，但缺少不重叠的历史样本，暂不能判断经营变化趋势。',
        actionFor,
        evidence,
        goalId
      ));
    } else if (typeof signal.descriptiveRateDelta === 'number' && signal.descriptiveRateDelta < 0) {
      const pct = Math.round(Math.abs(signal.descriptiveRateDelta) * 10000) / 100;
      cards.push(card(
        `metric:decline:${signal.evidenceId}`,
        87,
        '核对转化变化',
        `当前样本转化率较基线低约 ${pct} 个百分点；这只是描述性变化，尚未说明原因。`,
        actionFor,
        evidence,
        goalId
      ));
    } else if (typeof signal.descriptiveRateDelta === 'number' && signal.descriptiveRateDelta > 0) {
      cards.push(card(
        `metric:improve:${signal.evidenceId}`,
        72,
        '确认改善是否持续',
        '当前样本转化率高于基线，但仍需要后续同口径观察才能判断是否稳定。',
        actionFor,
        evidence,
        goalId
      ));
    }
  }

  if (unknowns.length) {
    cards.push(card(
      'context:unknowns',
      82,
      '补齐关键经营信息',
      `仍有 ${Math.min(unknowns.length, 3)} 项关键事实未确认：${unknowns.slice(0, 3).join('、')}。`,
      { kind: 'open-business-context' }
    ));
  }

  if (!savedContext && signals.length) {
    cards.push(card(
      'context:missing',
      68,
      '保存经营基线',
      '当前已经有可用的业务观察，但还没有保存企业经营上下文。先把事实和授权来源固定下来，后续 Goal 才能连续使用。',
      { kind: 'open-business-context' },
      signals.slice(0, 1).flatMap(signal => signal.evidenceId ? [signal.evidenceId] : [])
    ));
  } else if (savedContext && !goalIds.length) {
    cards.push(card(
      'goal:missing',
      67,
      '明确当前目标',
      '已有企业经营上下文，但没有绑定经过原 Host 审核的 Goal。',
      { kind: 'open-business-context' }
    ));
  }

  if (!signals.length && savedContext && sources.length) {
    const productSource = sources.find(source => source.reference?.kind === 'product');
    cards.push(card(
      'metric:missing',
      60,
      '补充经营指标',
      productSource ? '已有产品经营上下文，但当前没有可用于经营判断的受支持指标；先补齐数据，不猜测结果。' : '当前没有可用于经营判断的受支持指标；先补齐数据，不猜测结果。',
      { kind: 'open-business-context' },
      productSource ? [productSource.evidenceId] : []
    ));
  }

  for (const decision of Array.isArray(decisionCards) ? decisionCards : []) {
    if (decision.hasOutcomeReview) continue;
    cards.push(card(
      `decision:${decision.decisionId}`,
      70,
      `复盘：${text(decision.title, 70)}`,
      '已有经营决策尚未完成结果复盘；先核对实际结果，再决定是否继续。',
      { kind: 'open-original-goal', goalId: decision.goalId, decisionId: decision.decisionId },
      decision.evidence?.map(x => x.evidenceId) || [],
      decision.goalId,
      decision.decisionDraft || null
    ));
  }

  const drafts = Array.isArray(decisionDrafts) ? decisionDrafts : [];
  for (const item of cards) {
    if (item.decisionDraft) continue;
    const draft = drafts.find(candidate => Array.isArray(candidate?.sourceRefs)
      && candidate.sourceRefs.some(reference => item.evidenceIds.includes(`${reference.kind}:${reference.id}`)));
    if (draft) item.decisionDraft = draft;
  }

  const seen = new Set();
  return cards
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    .filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, 3);
}
