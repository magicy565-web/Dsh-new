// Muse AI Worker 市场：数据形状与演示目录。
// 形状对齐 workspace-agent 分支里的 MarketListing / MarketScheme / WorkerDesk
// （src/dsh/worker-market-client.ts、src/chat/workerDeskContract.ts），
// 但这里只保留当前 harness 真正能兑现的字段：没有评分写入、没有 Provider 上架、
// 没有 noVNC 画面时一律返回「未接入」，不生成虚构状态。

export const MARKET_STATE_VERSION = 1;

/** light / standard / fast → 工作电脑台数（与分支 SCALE_COMPUTERS 一致）。 */
export const SCALE_COMPUTERS = Object.freeze({ light: 1, standard: 2, fast: 4 });
export const SCALES = Object.freeze(['light', 'standard', 'fast']);
export const SCALE_LABEL = Object.freeze({ light: '轻量', standard: '标准', fast: '加快' });

export const PRICING_LABEL = Object.freeze({ per_task: '按次', monthly: '包月', per_computer_hour: '按电脑时' });

export const VERIFY_LABEL = Object.freeze({
  unverified: '未验证',
  email_verified: '邮箱已验证',
  id_lite: '已验证归属者',
  org_verified: '企业已验证',
});

export const BUDGET_MIN = 1;
export const BUDGET_MAX = 10_000_000;

/** 发布状态的唯一顺序（草稿不对外；上架由平台人工完成）。 */
export const WORKER_STATUSES = Object.freeze(['draft', 'pending_review', 'published', 'rejected', 'suspended']);

const owner = (displayName, avatarDesignId, verificationLevel, bio) => ({
  displayName, avatarDesignId, verificationLevel, bio, verificationProvider: 'stub',
});

const worker = (input) => Object.freeze({
  revision: 1,
  status: 'published',
  rating: Object.freeze({ average: null, count: 0, label: '还没有评价' }),
  portfolio: Object.freeze([]),
  reviews: Object.freeze([]),
  contract: 'grokbot-callback-v1',
  ...input,
  owner: Object.freeze(input.owner),
  services: Object.freeze(input.services.map(item => Object.freeze(item))),
  confirmActions: Object.freeze(input.confirmActions.map(item => Object.freeze(item))),
  capabilities: Object.freeze((input.capabilities ?? []).map(item => Object.freeze(item))),
});

/**
 * 演示目录（只在组合行显式 `config.demo: true` 时写入存储）。
 * 所有条目都标注了验证占位、能力风险和「不做的事」；评分一律为空。
 */
export const DEMO_WORKERS = Object.freeze([
  worker({
    id: 'inquiry-assistant', name: '询盘助手', category: '销售',
    summary: '把新询盘整理成可回复的草稿，不直接外发。',
    services: [{ title: '整理询盘', detail: '当天回复一版可编辑的回复草稿，不直接外发。' }],
    workingStyle: '接单后先回 accepted，草稿只放进 drafts。',
    doesNot: '不代替买方对外发送。',
    owner: owner('云上买手', 'orbit', 'email_verified', '做外贸询盘八年，只处理可公开核对的资料。'),
    pricing: { type: 'per_task', priceLabel: '¥320 / 次' },
    defaultScale: 'light', requiresComputer: true,
    confirmActions: [{ id: 'allow-draft', label: '允许起草，不外发' }],
    capabilities: [{ id: 'web-research', label: '公开网页检索', risk: 'low' }],
    featured: true, publishedAt: '2026-10-20',
  }),
  worker({
    id: 'research-analyst', name: '资料研究员', category: '研究',
    summary: '把公开资料收成一页摘要，留下出处。',
    services: [{ title: '一页摘要', detail: '一页摘要，附来源链接与不确定项。' }],
    workingStyle: '先确认研究范围，再产出摘要；来源不足会停下来提问。',
    doesNot: '不登录对方系统，不复刻受限内容。',
    owner: owner('纸面研究社', 'ledger', 'id_lite', '把公开资料整理成一页纸。'),
    pricing: { type: 'monthly', priceLabel: '¥1,280 / 月' },
    defaultScale: 'light', requiresComputer: true,
    confirmActions: [{ id: 'publish', label: '对外发布' }],
    capabilities: [{ id: 'web-research', label: '公开网页检索', risk: 'low' }],
    featured: true, publishedAt: '2026-10-19',
  }),
  worker({
    id: 'followup-writer', name: '跟进信助手', category: '销售',
    summary: '按已有往来起草下一封跟进，标出需要你确认的句子。',
    services: [{ title: '起草跟进', detail: '一版可编辑跟进草稿，标出需要确认的句子。' }],
    workingStyle: '先读往来，再起草；不确认的句子单独标出。',
    doesNot: '不自动发送，不接管邮箱账号。',
    owner: owner('信使', 'harbor', 'unverified', ''),
    pricing: { type: 'per_task', priceLabel: '¥180 / 次' },
    defaultScale: 'standard', requiresComputer: true,
    confirmActions: [{ id: 'allow-draft', label: '允许起草，不外发' }],
    capabilities: [],
    featured: false, publishedAt: '2026-10-18',
  }),
  worker({
    id: 'listing-auditor', name: '商品页合规体检', category: '交付',
    summary: '检查标题、规格与合规声明，输出问题清单与来源。',
    services: [{ title: '合规体检', detail: '问题清单 + 修改建议 + 来源链接。' }],
    workingStyle: '先取公开页面，再逐条核对，最后给问题清单。',
    doesNot: '不直接改店铺，不替代法务意见。',
    owner: owner('合规小栈', 'orbit', 'org_verified', '电商合规检查，只给建议不改店。'),
    pricing: { type: 'per_task', priceLabel: '¥1,600 / 次' },
    defaultScale: 'standard', requiresComputer: true,
    confirmActions: [{ id: 'publish', label: '对外发布' }],
    capabilities: [{ id: 'web-research', label: '公开网页检索', risk: 'low' }],
    featured: false, publishedAt: '2026-10-17',
  }),
  worker({
    id: 'directory-cleaner', name: '展会名录清洗', category: '交付',
    summary: '去重、补全官网与国别，标注不确定字段。',
    services: [{ title: '名录清洗', detail: '去重后的表格，不确定字段单独标注。' }],
    workingStyle: '先对字段，再清洗；不确定的一律标出而不是猜。',
    doesNot: '不美化数据，不虚构联系方式。',
    owner: owner('名录工坊', 'ledger', 'email_verified', '数据清洗，不虚构联系方式。'),
    pricing: { type: 'per_task', priceLabel: '¥540 / 次' },
    defaultScale: 'light', requiresComputer: true,
    confirmActions: [{ id: 'publish', label: '对外发布' }],
    capabilities: [],
    featured: false, publishedAt: '2026-10-16',
  }),
  worker({
    id: 'rfq-structurer', name: 'RFQ 询盘结构化', category: '内网',
    summary: '把询盘邮件整理成结构化表格，仅内网运行。',
    services: [{ title: '结构化询盘', detail: '表格 + 缺项提示，不出内网。' }],
    workingStyle: '内网执行，结果只写回本企业资料库。',
    doesNot: '不出内网，不共享给第三方执行器。',
    owner: owner('内网小组', 'harbor', 'id_lite', '只在企业内网里跑的执行器。'),
    pricing: { type: 'per_computer_hour', priceLabel: '¥15 / 电脑时' },
    defaultScale: 'light', requiresComputer: true,
    confirmActions: [{ id: 'allow-draft', label: '允许起草，不外发' }],
    capabilities: [{ id: 'intranet', label: '仅内网运行', risk: 'low' }],
    featured: false, publishedAt: '2026-10-15',
  }),
  worker({
    id: 'export-squad', name: '出海验证三人组', category: '获客',
    summary: '总控 + 渠道 + 电商三位岗位，先出分工计划再授权。',
    services: [{ title: '分工计划', detail: '分工计划、预算与验收条件，审批后才运行。' }],
    workingStyle: '先计划后执行，每一步都要你确认。',
    doesNot: '不自动运行，不承诺经营结果。',
    owner: owner('远山增长', 'orbit', 'org_verified', '把出海验证拆成三个岗位。'),
    pricing: { type: 'per_computer_hour', priceLabel: '¥26 / 电脑时' },
    defaultScale: 'fast', requiresComputer: true,
    confirmActions: [{ id: 'pay', label: '付款' }, { id: 'publish', label: '对外发布' }],
    capabilities: [{ id: 'multi-role', label: '多岗位协作', risk: 'medium' }],
    featured: true, publishedAt: '2026-10-14',
  }),
  worker({
    id: 'market-brief', name: '市场机会简报', category: '研究',
    summary: '在公开资料上生成一页简报，附来源。',
    services: [{ title: '机会简报', detail: '一页简报，附来源链接。' }],
    workingStyle: '先给结论草稿，再补来源。',
    doesNot: '不承诺经营结果，不虚构来源。',
    owner: owner('简报君', 'ledger', 'email_verified', '只写能附来源的结论。'),
    pricing: { type: 'monthly', priceLabel: '20 Credits 上限' },
    defaultScale: 'light', requiresComputer: false,
    confirmActions: [{ id: 'publish', label: '对外发布' }],
    capabilities: [],
    featured: false, publishedAt: '2026-10-13',
  }),
]);

/** 初始（非演示）市场：空目录，一切从真实注册开始。 */
export function emptyMarket() {
  return { version: MARKET_STATE_VERSION, workers: [], activations: [], computers: [], requests: [] };
}

/** 把存储里的市场段整理成可读形状；缺失字段一律回落到空集合。 */
export function normalizeMarket(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    version: Number.isInteger(source.version) ? source.version : MARKET_STATE_VERSION,
    workers: Array.isArray(source.workers) ? source.workers : [],
    activations: Array.isArray(source.activations) ? source.activations : [],
    computers: Array.isArray(source.computers) ? source.computers : [],
    requests: Array.isArray(source.requests) ? source.requests : [],
  };
}

/** 列表投影：不返回归属者 bio、方案页正文或任何未公开字段。 */
export function publicListing(item) {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    summary: item.summary,
    pricing: item.pricing,
    priceLabel: item.pricing?.priceLabel ?? '面议',
    defaultScale: item.defaultScale,
    requiresComputer: item.requiresComputer !== false,
    confirmActions: item.confirmActions,
    featured: item.featured === true,
    publishedAt: item.publishedAt ?? null,
    rating: item.rating,
    owner: item.owner ? {
      displayName: item.owner.displayName,
      avatarDesignId: item.owner.avatarDesignId,
      verificationLevel: item.owner.verificationLevel,
    } : null,
  };
}

/** 方案页投影：五个区块 + 价格/规模/能力/确认动作，供客户端直接渲染。 */
export function publicScheme(item) {
  return {
    workerId: item.id,
    status: item.status,
    revision: item.revision,
    editable: false,
    name: item.name,
    category: item.category,
    summary: item.summary,
    services: item.services,
    doesNot: item.doesNot,
    workingStyle: item.workingStyle,
    contract: item.contract,
    owner: item.owner ? {
      id: item.id, kind: 'person', displayName: item.owner.displayName,
      avatarDesignId: item.owner.avatarDesignId, bio: item.owner.bio ?? '',
      verificationLevel: item.owner.verificationLevel,
      verificationProvider: item.owner.verificationProvider ?? 'stub',
      status: 'active',
    } : null,
    portfolio: item.portfolio,
    reviews: item.reviews,
    reviewSummary: item.rating,
    pricing: item.pricing,
    defaultScale: item.defaultScale,
    requiresComputer: item.requiresComputer !== false,
    confirmActions: item.confirmActions,
    capabilities: item.capabilities,
    ctaLabel: '开通',
  };
}

export function publicActivation(item) {
  return {
    id: item.id, offerId: item.offerId, name: item.name, scale: item.scale,
    budgetCap: item.budgetCap, computers: item.computers,
    confirmActionIds: item.confirmActionIds, createdAt: item.createdAt,
  };
}

export function publicComputer(item) {
  return {
    id: item.id, hireId: item.hireId, workerName: item.workerName,
    label: item.label, status: item.status, task: item.task ?? null,
  };
}

/** 开通参数校验；返回 null 表示通过，否则返回 { code, message, status }。 */
export function validateActivation(item, body) {
  if (!SCALES.includes(body.scale)) {
    return { code: 'HARNESS_MARKET_SCALE_INVALID', message: 'scale 必须是 light / standard / fast。', status: 400 };
  }
  if (!Number.isInteger(body.budgetCap) || body.budgetCap < BUDGET_MIN || body.budgetCap > BUDGET_MAX) {
    return { code: 'HARNESS_MARKET_BUDGET_INVALID', message: `预算上限必须是 ${BUDGET_MIN}–${BUDGET_MAX} 的整数（业务帽，不结算）。`, status: 400 };
  }
  const allowed = new Set((item.confirmActions ?? []).map(action => action.id));
  const ids = body.confirmActionIds ?? [];
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !allowed.has(id))) {
    return { code: 'HARNESS_MARKET_CONFIRM_INVALID', message: 'confirmActionIds 必须是该 Worker 声明的确认动作子集。', status: 400 };
  }
  return null;
}

/** 一次开通派生出的电脑实例：runtime=off 时停在 booting，不伪造 running。 */
export function computersFor(activationId, workerName, count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${activationId}-pc-${index + 1}`,
    hireId: activationId,
    workerName,
    label: `电脑 ${index + 1}`,
    status: 'booting',
    task: null,
  }));
}
