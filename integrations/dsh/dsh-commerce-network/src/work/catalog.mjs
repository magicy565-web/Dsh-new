// Pure view-model for the recruiting page and the maintainer studio. It reads the same records the service
// writes and shares the publish rules with it, so a form can never promise what the ledger would refuse.
import { INPUT_KINDS, OUTPUT_KINDS, PRICING_KINDS, changesPricing, publishIssues, unprovenSkills } from '../../worker-catalog.js';
import { errorText } from '../api.mjs';
import { OTHER_RUNTIME, RUNTIMES, SAMPLE_FLOOR, SKILL_LABELS } from './model.mjs';

export { INPUT_KINDS, OUTPUT_KINDS, PRICING_KINDS, publishIssues };

export const ALL_RUNTIMES = Object.freeze([...RUNTIMES, OTHER_RUNTIME]);
export const runtimeName = id => ALL_RUNTIMES.find(r => r.id === id)?.name || id;
export const INPUT_LABELS = Object.freeze({ product: '产品资料', document: '文档', url: '网址', text: '文字说明' });
export const OUTPUT_LABELS = Object.freeze({ text: '文字报告', link: '链接清单', draft: '草稿' });
export const PRICING_LABELS = Object.freeze({ free: '免费', subscription: '按月订阅', per_acceptance: '按验收付款' });
export const STATUS_LABELS = Object.freeze({ draft: '草稿', published: '已发布', paused: '暂停接单', retired: '已下架' });
export const ISSUE_LABELS = Object.freeze({
  name: '名称', tagline: '一句话介绍', category: '分类', maintainerName: '维护者署名', instructions: '工作包指令（至少 10 个字）',
  runsOn: '支持的 Agent', skills: '能力', outputs: '交付形式', starters: '至少 1 个预置任务', pricing: '价格（付费方案需大于 0）',
});
export const PRICE_NOTE = '这只是维护者的报价提案。DSH 尚未接入支付与托管，招募、验收都不会产生扣款。';

const yuan = minor => { const value = minor / 100; return Number.isInteger(value) ? String(value) : value.toFixed(2); };
export function priceLabel(pricing) {
  if (!pricing || pricing.kind === 'free') return '免费';
  return `¥${yuan(pricing.amountMinor)} / ${pricing.kind === 'subscription' ? '月' : '次验收'}`;
}
/** Parse a yuan field into minor units; anything that is not a finite non-negative amount becomes 0. */
export function minorFromYuan(value) {
  const amount = Number.parseFloat(String(value).replace(/[¥,\s]/g, ''));
  return Number.isFinite(amount) && amount >= 0 ? Math.min(Math.round(amount * 100), 100_000_000) : 0;
}
export const yuanFromMinor = minor => (minor > 0 ? yuan(minor) : '');

/** The recruiting page lists what a maintainer has published; drafts and retired templates stay out of it. */
export const marketTemplates = templates => templates
  .filter(t => t.published && (t.status === 'published' || t.status === 'paused'))
  .sort((a, b) => Number(b.status === 'published') - Number(a.status === 'published') || Number(b.builtin) - Number(a.builtin) || a.published.name.localeCompare(b.published.name, 'zh-Hans-CN'));
export const categoriesOf = templates => [...new Set(templates.map(t => t.published.category).filter(Boolean))];
export function searchTemplates(templates, { query = '', category = '' } = {}) {
  const needle = query.trim().toLowerCase();
  return templates.filter(t => {
    const p = t.published;
    if (category && p.category !== category) return false;
    if (!needle) return true;
    return [p.name, p.tagline, p.category, p.maintainerName, ...p.skills.map(s => SKILL_LABELS[s] || s)].join('\n').toLowerCase().includes(needle);
  });
}

/** Counts come from DSH work orders only. The rate stays hidden until there are enough accepted or returned tasks. */
export function templateEvidence(template) {
  const { accepted, rejected, hires } = template.stats, sample = accepted + rejected;
  return { accepted, rejected, hires, sample, rate: sample >= SAMPLE_FLOOR ? Math.round((accepted / sample) * 100) : null };
}

export const hireOf = (agents, templateId) => agents.find(a => a.status !== 'revoked' && a.workerTemplate?.templateId === templateId) || null;
/** ready: hire now. hired: already in this project. blocked: say why instead of hiding the action. */
export function hireState(template, { projectId, agents }) {
  const hired = hireOf(agents, template.id);
  if (hired) return { kind: 'hired', agent: hired };
  if (!projectId) return { kind: 'blocked', reason: '当前会话暂无项目，请先在协作画布创建项目。' };
  if (template.status === 'paused') return { kind: 'blocked', reason: '维护者暂停接单。已招募的继续可用。' };
  if (template.status !== 'published') return { kind: 'blocked', reason: '这个 Worker 不再接受新招募。' };
  return { kind: 'ready' };
}
export const runtimeChoices = spec => ALL_RUNTIMES.map(r => ({ ...r, supported: spec.runsOn.includes(r.id) }));
export const requestersOf = parties => (parties || []).filter(p => p.type === 'factory' || p.type === 'distributor');

/** What changes for an existing hire when a newer published version exists. Scope never widens on its own. */
export function upgradeOffer(agent, template) {
  const pin = agent.workerTemplate;
  if (!pin || !template || template.status === 'retired' || !template.published) return null;
  if (pin.version != null && template.published.version <= pin.version) return null;
  const target = template.published;
  const pinnedSkills = pin.version == null ? template.draft.skills : template.versions.find(v => v.version === pin.version)?.skills ?? pin.grantedSkills;
  const { status: _paymentState, ...held } = pin.billing || { kind: 'free', amountMinor: 0, currency: 'CNY' };
  return {
    target, added: target.skills.filter(s => !pinnedSkills.includes(s)), removed: pin.grantedSkills.filter(s => !target.skills.includes(s)),
    priceChanged: changesPricing({ pricing: held }, { pricing: target.pricing }), runtimeOk: target.runsOn.includes(agent.providerType),
    keep: pin.grantedSkills.filter(s => target.skills.includes(s)),
  };
}

export const mineOf = templates => templates.filter(t => !t.builtin).sort((a, b) => Number(a.status === 'retired') - Number(b.status === 'retired') || String(b.updatedAt).localeCompare(String(a.updatedAt)));
export function newDraft(maintainerName = '') {
  return { name: '', tagline: '', category: '', maintainerName, runsOn: ['other'], skills: [], inputs: [], outputs: ['text'], instructions: '', starters: [], pricing: { kind: 'free', amountMinor: 0, currency: 'CNY' }, declared: { responseTime: '' } };
}
export const blankStarter = () => ({ id: '', title: '', brief: '', skills: [] });
/** Removing a skill also removes it from every starter task, so a draft can never name a skill it does not offer. */
export function toggleSkill(draft, skill) {
  const on = draft.skills.includes(skill), skills = on ? draft.skills.filter(s => s !== skill) : [...draft.skills, skill];
  return { ...draft, skills, starters: draft.starters.map(s => ({ ...s, skills: on ? s.skills.filter(x => x !== skill) : s.skills })) };
}
export const toggleIn = (list, value) => (list.includes(value) ? list.filter(x => x !== value) : [...list, value]);
export function draftPayload(draft, id) {
  return { ...(id ? { id } : {}), ...draft, starters: draft.starters.map(({ id: starterId, ...rest }) => (starterId ? { id: starterId, ...rest } : rest)) };
}
/** True when the working copy differs from what the server holds, ignoring unset starter ids. */
export const isDirty = (draft, saved) => JSON.stringify(draftPayload(draft)) !== JSON.stringify(draftPayload(saved));

export function publishPlan(template) {
  const issues = publishIssues(template.draft), previous = template.published;
  const unproven = unprovenSkills(template.draft, previous, template.provenSkills);
  return {
    issues, unproven, nextVersion: (previous?.version ?? 0) + 1,
    added: previous ? template.draft.skills.filter(s => !previous.skills.includes(s)) : [],
    priceChanged: previous ? changesPricing(previous, template.draft) : false,
    canPublish: template.status !== 'retired' && template.hasUnpublishedChanges && issues.length === 0 && unproven.length === 0,
  };
}
/** Transitions the service accepts; "retired" is final, so the studio asks twice before offering it. */
export const STATUS_ACTIONS = Object.freeze({
  draft: [{ to: 'retired', label: '放弃这个草稿', final: true }],
  published: [{ to: 'paused', label: '暂停接单' }, { to: 'retired', label: '下架', final: true }],
  paused: [{ to: 'published', label: '恢复接单' }, { to: 'retired', label: '下架', final: true }],
  retired: [],
});

export const COMMAND_ERRORS = Object.freeze({
  TEMPLATE_INCOMPLETE: '还有必填项没有完成。',
  TRIAL_REQUIRED: '还缺一次被你验收的真实试运行。先把草稿招募到项目里跑一个任务并验收。',
  NO_CHANGES: '没有需要发布的改动。',
  ALREADY_HIRED: '这个 Worker 已经招募到当前项目了。',
  RUNTIME_UNSUPPORTED: '这个 Worker 不支持所选的 Agent。',
  TEMPLATE_UNAVAILABLE: '这个 Worker 暂不接受新招募。',
  TEMPLATE_RETIRED: '这个 Worker 已下架，不能再修改。',
  TEMPLATE_UNPUBLISHED: '请先发布一个版本。',
  BUILTIN_IMMUTABLE: 'DSH 内置 Worker 不能修改。',
  TRIAL_NOT_ALLOWED: '内置 Worker 已经发布，不需要试运行。',
  AGENT_BUSY: '这个 Worker 还有任务在执行，等它结束后再升级。',
  SKILL_IN_USE: '有未完成的任务还需要被移除的能力，请先处理这些任务。',
  PRICING_CHANGED: '报价有调整，请先确认。',
  VERSION_NOT_NEWER: '已经是最新版本。',
  CAPABILITY_DENIED: '所选能力超出了范围。',
  REQUESTER_REQUIRED: '请选择发起任务的工厂或分销商。',
  STARTER_NOT_FOUND: '这个预置任务已不在当前版本中。',
  OWNER_ACTION_REQUIRED: '这个操作需要你本人在界面中确认。',
  PROJECT_NOT_FOUND: '当前项目已不存在，请刷新。',
  LIMIT: '已达到本工作区的数量上限。',
});
export const commandError = error => COMMAND_ERRORS[error?.code] || errorText(error);
