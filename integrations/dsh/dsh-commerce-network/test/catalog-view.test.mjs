import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILTIN_TEMPLATES } from '../worker-catalog.js';
import {
  categoriesOf, commandError, draftPayload, hireState, isDirty, marketTemplates, minorFromYuan, newDraft, priceLabel, publishPlan,
  searchTemplates, templateEvidence, toggleSkill, upgradeOffer, yuanFromMinor,
} from '../src/work/catalog.mjs';

const view = (builtin, extra = {}) => ({
  id: builtin.id, builtin: true, status: 'published', maintainerVerification: 'unverified', draft: builtin, published: { version: 1, ...builtin },
  versions: [{ version: 1, skills: builtin.skills, pricing: builtin.pricing }], hasUnpublishedChanges: false, provenSkills: [], stats: { hires: 0, activeHires: 0, projects: 0, accepted: 0, rejected: 0 }, ...extra,
});
const templates = BUILTIN_TEMPLATES.map(t => view({ ...t.versions[0].snapshot, id: t.id }));

test('prices are proposals in yuan and never invent a figure', () => {
  assert.equal(priceLabel({ kind: 'free', amountMinor: 0 }), '免费');
  assert.equal(priceLabel({ kind: 'subscription', amountMinor: 29900 }), '¥299 / 月');
  assert.equal(priceLabel({ kind: 'per_acceptance', amountMinor: 5050 }), '¥50.50 / 次验收');
  assert.equal(priceLabel(undefined), '免费');
  assert.equal(minorFromYuan('¥299'), 29900);
  assert.equal(minorFromYuan('12.345'), 1235);
  assert.equal(minorFromYuan('abc'), 0);
  assert.equal(minorFromYuan('-5'), 0);
  assert.equal(yuanFromMinor(0), '');
  assert.equal(yuanFromMinor(29900), '299');
});

test('the market lists published and paused Workers only, hireable ones first', () => {
  const rows = marketTemplates([
    { ...templates[0], id: 'draft', status: 'draft', published: null }, { ...templates[1], id: 'paused', status: 'paused' },
    { ...templates[2], id: 'retired', status: 'retired' }, templates[0],
  ]);
  assert.deepEqual(rows.map(t => t.id), [templates[0].id, 'paused']);
});

test('search matches names, taglines, skills and maintainers; categories come from the data', () => {
  const rows = marketTemplates(templates);
  assert.deepEqual(searchTemplates(rows, { query: '询盘' }).map(t => t.published.name), ['询盘汇总员']);
  assert.equal(searchTemplates(rows, { query: 'DSH' }).length, 3, 'maintainer name is searchable');
  assert.deepEqual(searchTemplates(rows, { category: '外联文案' }).map(t => t.published.name), ['外联文案起草员']);
  assert.equal(searchTemplates(rows, { query: '不存在' }).length, 0);
  assert.deepEqual(categoriesOf(rows).sort(), ['外联文案', '市场调研', '询盘处理'].sort());
});

test('evidence stays hidden below five accepted or returned tasks', () => {
  assert.equal(templateEvidence({ stats: { accepted: 3, rejected: 1, hires: 2 } }).rate, null);
  assert.equal(templateEvidence({ stats: { accepted: 4, rejected: 1, hires: 2 } }).rate, 80);
});

test('hire state explains why an action is unavailable instead of hiding it', () => {
  const t = templates[0];
  assert.equal(hireState(t, { projectId: 'p', agents: [] }).kind, 'ready');
  assert.match(hireState(t, { projectId: null, agents: [] }).reason, /暂无项目/);
  assert.match(hireState({ ...t, status: 'paused' }, { projectId: 'p', agents: [] }).reason, /暂停接单/);
  const hired = { id: 'a', status: 'pending', workerTemplate: { templateId: t.id } };
  assert.equal(hireState({ ...t, status: 'paused' }, { projectId: 'p', agents: [hired] }).kind, 'hired', 'an existing hire is shown even when new hires are paused');
  assert.equal(hireState(t, { projectId: 'p', agents: [{ ...hired, status: 'revoked' }] }).kind, 'ready', 'a revoked hire can be replaced');
});

test('an upgrade offer lists new skills but never grants them', () => {
  const t = view({ ...BUILTIN_TEMPLATES[0].versions[0].snapshot, skills: ['public_web_research', 'summarize_rfq'] }, {
    id: 'm', builtin: false, versions: [{ version: 1, skills: ['public_web_research'], pricing: { kind: 'free', amountMinor: 0, currency: 'CNY' } }, { version: 2, skills: ['public_web_research', 'summarize_rfq'], pricing: { kind: 'free', amountMinor: 0, currency: 'CNY' } }],
  });
  t.published = { ...t.published, version: 2 };
  const agent = { providerType: 'other', workerTemplate: { templateId: 'm', version: 1, grantedSkills: ['public_web_research'], billing: { kind: 'free', amountMinor: 0, currency: 'CNY', status: 'not_connected' } } };
  const offer = upgradeOffer(agent, t);
  assert.deepEqual({ added: offer.added, keep: offer.keep, removed: offer.removed, priceChanged: offer.priceChanged }, { added: ['summarize_rfq'], keep: ['public_web_research'], removed: [], priceChanged: false });
  assert.equal(upgradeOffer({ ...agent, workerTemplate: { ...agent.workerTemplate, version: 2 } }, t), null, 'already current');
  assert.equal(upgradeOffer(agent, { ...t, status: 'retired' }), null);
  const repriced = upgradeOffer(agent, { ...t, published: { ...t.published, pricing: { kind: 'subscription', amountMinor: 100, currency: 'CNY' } } });
  assert.equal(repriced.priceChanged, true);
  assert.equal(upgradeOffer({ ...agent, providerType: 'muse' }, { ...t, published: { ...t.published, runsOn: ['other'] } }).runtimeOk, false);
});

test('removing a skill also removes it from every starter task', () => {
  const draft = { ...newDraft('x'), skills: ['a', 'b'], starters: [{ id: 's', title: 't', brief: 'b', skills: ['a', 'b'] }] };
  assert.deepEqual(toggleSkill(draft, 'a').starters[0].skills, ['b']);
  assert.deepEqual(toggleSkill(draft, 'c').skills, ['a', 'b', 'c']);
});

test('draft payload strips unset starter ids and dirty tracking ignores them', () => {
  const draft = { ...newDraft('x'), name: 'n', starters: [{ id: '', title: 't', brief: 'b', skills: ['a'] }] };
  assert.equal('id' in draftPayload(draft).starters[0], false);
  assert.equal(draftPayload(draft, 'worker_1').id, 'worker_1');
  assert.equal(isDirty(draft, draft), false);
  assert.equal(isDirty({ ...draft, name: 'other' }, draft), true);
});

test('publish plan gates on required fields, real acceptance and unpublished changes', () => {
  const base = { ...newDraft('M'), name: 'N', tagline: 'T', category: 'C', instructions: 'Do the job carefully.', skills: ['public_web_research'], starters: [{ id: 's', title: 't', brief: 'b', skills: ['public_web_research'] }] };
  const unpublished = { status: 'draft', draft: base, published: null, hasUnpublishedChanges: true, provenSkills: [] };
  const first = publishPlan(unpublished);
  assert.deepEqual({ canPublish: first.canPublish, unproven: first.unproven, next: first.nextVersion }, { canPublish: false, unproven: ['public_web_research'], next: 1 });
  assert.equal(publishPlan({ ...unpublished, provenSkills: ['public_web_research'] }).canPublish, true);
  assert.equal(publishPlan({ ...unpublished, provenSkills: ['public_web_research'], draft: { ...base, name: '' } }).canPublish, false);
  const widened = publishPlan({ status: 'published', draft: { ...base, skills: ['public_web_research', 'summarize_rfq'] }, published: { version: 1, skills: ['public_web_research'], pricing: base.pricing }, hasUnpublishedChanges: true, provenSkills: ['public_web_research'] });
  assert.deepEqual({ added: widened.added, unproven: widened.unproven, canPublish: widened.canPublish, next: widened.nextVersion }, { added: ['summarize_rfq'], unproven: ['summarize_rfq'], canPublish: false, next: 2 });
  assert.equal(publishPlan({ ...unpublished, status: 'retired', provenSkills: ['public_web_research'] }).canPublish, false);
});

test('known ledger errors read as plain Chinese; unknown ones fall back to the shared text', () => {
  assert.match(commandError({ code: 'TRIAL_REQUIRED' }), /真实试运行/);
  assert.match(commandError({ code: 'ALREADY_HIRED' }), /已经招募/);
  assert.match(commandError({ status: 409, code: 'REVISION_CONFLICT' }), /数据已被更新/);
  assert.equal(commandError({ message: 'plain' }), 'plain');
});
