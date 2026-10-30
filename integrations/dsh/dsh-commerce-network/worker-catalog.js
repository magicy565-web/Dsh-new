// Local Worker template catalog. Dependency-free on purpose: the service validates with it and the browser
// bundle reuses the same publish rules, so the form and the ledger can never disagree.
//
// A template is a workspace-level recipe (instructions + skills + starter tasks). A published version is an
// immutable snapshot. Hiring pins a version and creates an ordinary agentService, so approval, leases, delivery
// and acceptance stay exactly as they are. Prices are proposals only: no payment partner is connected.

export const RUNTIME_IDS = Object.freeze(['grokbot', 'muse', 'other']);
export const INPUT_KINDS = Object.freeze(['product', 'document', 'url', 'text']);
export const OUTPUT_KINDS = Object.freeze(['text', 'link', 'draft']);
export const PRICING_KINDS = Object.freeze(['free', 'subscription', 'per_acceptance']);
export const BUILTIN_PREFIX = 'builtin.';
export const TEMPLATE_STATUSES = Object.freeze(['draft', 'published', 'paused', 'retired']);
export const PUBLISH_FIELDS = Object.freeze(['name', 'tagline', 'category', 'maintainerName', 'runsOn', 'skills', 'inputs', 'outputs', 'instructions', 'starters', 'pricing', 'declared']);
const BUILTIN_PUBLISHED_AT = '2026-10-30T00:00:00.000Z';

const sorted = value => {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
  return value;
};
export const snapshotOf = source => Object.fromEntries(PUBLISH_FIELDS.map(key => [key, structuredClone(source[key])]));
export const sameSnapshot = (a, b) => JSON.stringify(sorted(snapshotOf(a))) === JSON.stringify(sorted(snapshotOf(b)));
export const widensScope = (previous, next) => next.skills.some(skill => !previous.skills.includes(skill));
export const changesPricing = (previous, next) => JSON.stringify(sorted(previous.pricing)) !== JSON.stringify(sorted(next.pricing));

/** Fields a maintainer must complete before a version can be published. Returns field ids; the UI labels them. */
export function publishIssues(draft) {
  const issues = [];
  for (const field of ['name', 'tagline', 'category', 'maintainerName']) if (!String(draft[field] ?? '').trim()) issues.push(field);
  if (String(draft.instructions ?? '').trim().length < 10) issues.push('instructions');
  for (const field of ['runsOn', 'skills', 'outputs', 'starters']) if (!draft[field]?.length) issues.push(field);
  if (draft.pricing?.kind !== 'free' && !(draft.pricing?.amountMinor > 0)) issues.push('pricing');
  return issues;
}

/** Skills that a real, owner-accepted work order has already exercised for this template's Workers. */
export function provenSkills(state, templateId) {
  const hired = new Set(state.agents.filter(a => a.workerTemplate?.templateId === templateId).map(a => a.id));
  return new Set(state.workOrders.filter(o => hired.has(o.agentServiceId) && o.status === 'accepted').flatMap(o => o.allowedActions ?? []));
}

/** Skills that must still be exercised by an accepted task before this draft may be published. */
export function unprovenSkills(draft, previousSnapshot, proven) {
  const proofSet = new Set(proven);
  if (!previousSnapshot) return proofSet.size ? [] : [...draft.skills];
  return draft.skills.filter(skill => !previousSnapshot.skills.includes(skill) && !proofSet.has(skill));
}

function builtin(id, snapshot) {
  const draft = { ...snapshot, maintainerName: 'DSH 自营', pricing: { kind: 'free', amountMinor: 0, currency: 'CNY' }, declared: { responseTime: '' } };
  return Object.freeze({
    id: `${BUILTIN_PREFIX}${id}`, builtin: true, status: 'published', maintainerVerification: 'unverified', revision: 1,
    createdAt: BUILTIN_PUBLISHED_AT, updatedAt: BUILTIN_PUBLISHED_AT, ...draft,
    versions: [{ version: 1, changelog: 'DSH 自营首发。', publishedAt: BUILTIN_PUBLISHED_AT, widensScope: false, changesPricing: false, snapshot: structuredClone(draft) }],
  });
}

export const BUILTIN_TEMPLATES = Object.freeze([
  builtin('market-research', {
    name: '海外市场调研员', tagline: '用公开网页资料整理目标市场、竞品与价格带，每条结论附来源', category: '市场调研',
    runsOn: ['grokbot', 'muse', 'other'], skills: ['public_web_research', 'read_granted_product_context'], inputs: ['product', 'url', 'text'], outputs: ['text', 'link'],
    instructions: '你是「海外市场调研员」。只使用公开网页资料，以及业主在本次任务中授权的产品资料。\n输出三部分：一页摘要、要点清单、来源链接清单。每个结论都要标明来源；找不到公开依据时写「未找到公开依据」，不要推测。\n不联系任何人，不发送消息，不付款，不索取或保存任何凭证。',
    starters: [
      { id: 'starter_market_overview', title: '目标市场速览', brief: '针对已授权的产品，调研目标市场的公开零售价格带、主要竞品和常见采购渠道，输出一页摘要，并逐条附上来源链接。', skills: ['public_web_research', 'read_granted_product_context'] },
      { id: 'starter_competitor_prices', title: '竞品价格对照', brief: '列出 5 个公开可查的同类竞品，对照它们的标价、起订量与卖点，说明本产品的定价空间。每个数据都要附来源。', skills: ['public_web_research', 'read_granted_product_context'] },
    ],
  }),
  builtin('rfq-digest', {
    name: '询盘汇总员', tagline: '把零散询盘整理成一页清单：谁问了什么、缺什么信息、建议先回谁', category: '询盘处理',
    runsOn: ['grokbot', 'muse', 'other'], skills: ['summarize_rfq', 'classify_opted_in_replies'], inputs: ['document', 'text'], outputs: ['text'],
    instructions: '你是「询盘汇总员」。只处理业主在本次任务中授权的询盘与已同意联系的回复。\n每条询盘整理为：来源、产品、数量、目的地、缺失信息、建议优先级及理由。回复按「有意向 / 需要补充 / 无意向」分类，并标明依据的原文。\n只做整理，不回复、不发送、不联系任何人。',
    starters: [
      { id: 'starter_rfq_week', title: '本周询盘汇总', brief: '汇总已授权资料中本周收到的询盘，按优先级排序，列出每条缺失的信息。', skills: ['summarize_rfq'] },
      { id: 'starter_reply_classify', title: '回复分类', brief: '把已同意联系的客户回复分为「有意向 / 需要补充 / 无意向」，并引用原文作为依据。', skills: ['classify_opted_in_replies'] },
    ],
  }),
  builtin('outreach-drafter', {
    name: '外联文案起草员', tagline: '按已授权的产品资料起草开发信与跟进邮件，只出草稿，不发送', category: '外联文案',
    runsOn: ['grokbot', 'muse', 'other'], skills: ['draft_outreach', 'read_granted_product_context'], inputs: ['product', 'text'], outputs: ['draft'],
    instructions: '你是「外联文案起草员」。根据业主授权的产品资料起草外联文案，语气克制、具体，不夸大。\n每份草稿包含：主题行、正文、一句可选的跟进语。不得编造认证、客户或数据；资料里没有的信息用【待补充】标出。\n只交付草稿文本，不发送任何消息，不联系任何人。',
    starters: [
      { id: 'starter_first_email', title: '首封开发信草稿', brief: '为已授权的产品起草一封面向海外进口商的首封开发信，附两个备选主题行。', skills: ['draft_outreach', 'read_granted_product_context'] },
      { id: 'starter_follow_up', title: '跟进邮件草稿', brief: '起草一封首封开发信一周后的跟进邮件，保持简短，并只引用已授权资料里的事实。', skills: ['draft_outreach', 'read_granted_product_context'] },
    ],
  }),
]);

export function createWorkerCatalog({ fail, assertKeys, text, integer, array, identifier, actions, generated }) {
  const unique = (list, allowed, field, min, max) => {
    const values = [...new Set(array(list ?? [], field, max))];
    if (values.length < min || values.some(value => !allowed.includes(value))) fail('INPUT', `Invalid ${field}.`);
    return values;
  };
  function pricingFrom(value) {
    const pricing = value ?? { kind: 'free' };
    assertKeys(pricing, ['kind', 'amountMinor', 'currency']);
    if (!PRICING_KINDS.includes(pricing.kind)) fail('INPUT', 'Invalid pricing kind.');
    if (pricing.kind === 'free') return { kind: 'free', amountMinor: 0, currency: 'CNY' };
    if (pricing.currency != null && pricing.currency !== 'CNY') fail('INPUT', 'Pricing proposals are recorded in CNY only.');
    return { kind: pricing.kind, amountMinor: integer(pricing.amountMinor ?? 0, 'amountMinor', 0, 100_000_000), currency: 'CNY' };
  }
  /** Validate a maintainer's working draft. A draft may be incomplete; completeness is checked at publish. */
  function draftFrom(payload) {
    assertKeys(payload, ['id', ...PUBLISH_FIELDS]);
    const skills = unique(payload.skills, actions, 'skills', 0, actions.length);
    const starters = array(payload.starters ?? [], 'starters', 4).map(starter => {
      assertKeys(starter, ['id', 'title', 'brief', 'skills']);
      return {
        id: starter.id ? identifier(starter.id, 'starter id') : generated('starter'),
        title: text(starter.title, 'starter title', 40), brief: text(starter.brief, 'starter brief', 2000),
        skills: unique(starter.skills ?? skills, skills, 'starter skills', 1, skills.length),
      };
    });
    if (new Set(starters.map(s => s.id)).size !== starters.length) fail('INPUT', 'Starter IDs must be unique.');
    assertKeys(payload.declared ?? {}, ['responseTime']);
    return {
      name: text(payload.name, 'name', 40), tagline: text(payload.tagline ?? '', 'tagline', 80, false), category: text(payload.category ?? '', 'category', 20, false),
      maintainerName: text(payload.maintainerName ?? '', 'maintainerName', 40, false),
      runsOn: unique(payload.runsOn, RUNTIME_IDS, 'runsOn', 0, RUNTIME_IDS.length), skills,
      inputs: unique(payload.inputs, INPUT_KINDS, 'inputs', 0, INPUT_KINDS.length), outputs: unique(payload.outputs, OUTPUT_KINDS, 'outputs', 0, OUTPUT_KINDS.length),
      instructions: text(payload.instructions ?? '', 'instructions', 8000, false), starters, pricing: pricingFrom(payload.pricing),
      declared: { responseTime: text(payload.declared?.responseTime ?? '', 'responseTime', 40, false) },
    };
  }
  const all = state => [...BUILTIN_TEMPLATES, ...state.workerTemplates];
  const find = (state, id) => all(state).find(t => t.id === id);
  const latest = template => template.versions.at(-1) ?? null;
  /** The projection shape: the working draft, the immutable published version, and honest counts from DSH records. */
  function describe(state, template) {
    const hired = state.agents.filter(a => a.workerTemplate?.templateId === template.id);
    const ids = new Set(hired.map(a => a.id));
    const orders = state.workOrders.filter(o => ids.has(o.agentServiceId));
    const current = latest(template);
    return {
      id: template.id, builtin: !!template.builtin, status: template.status, createdAt: template.createdAt, updatedAt: template.updatedAt,
      maintainerVerification: template.maintainerVerification,
      draft: snapshotOf(template),
      published: current ? { version: current.version, publishedAt: current.publishedAt, changelog: current.changelog, widensScope: current.widensScope, changesPricing: current.changesPricing, ...structuredClone(current.snapshot) } : null,
      versions: template.versions.map(({ snapshot, ...rest }) => ({ ...rest, skills: snapshot.skills, pricing: snapshot.pricing })),
      hasUnpublishedChanges: current ? !sameSnapshot(template, current.snapshot) : true,
      provenSkills: [...provenSkills(state, template.id)],
      stats: {
        hires: hired.length, activeHires: hired.filter(a => a.status !== 'revoked').length, projects: new Set(hired.map(a => a.projectId)).size,
        accepted: orders.filter(o => o.status === 'accepted').length, rejected: orders.filter(o => o.status === 'rejected').length,
      },
      billingStatus: 'not_connected',
    };
  }
  return { all, find, latest, describe, draftFrom };
}
