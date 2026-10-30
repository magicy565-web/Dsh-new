import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CommerceStore } from '../store.js';
import { createCommerceService } from '../service.js';
import { BUILTIN_TEMPLATES, publishIssues, sameSnapshot, snapshotOf, widensScope } from '../worker-catalog.js';

// Synthetic records only. The harness mirrors service.test.mjs without importing a file that registers its own tests.
function harness() {
  const workspaceId = randomUUID(), sessionId = `session-${randomUUID()}`;
  const rows = [{ id: workspaceId, sessionIds: [sessionId] }];
  const registry = { list: () => rows, get: id => rows.find(w => w.id === id) };
  const service = createCommerceService({ store: new CommerceStore(':memory:'), registry });
  let projectId = null;
  const state = () => service.state(sessionId, projectId || undefined);
  const command = (name, payload, options = {}) => service.command(sessionId, { projectId, requestId: randomUUID(), expectedRevision: state().revision, command: name, payload, ...options });
  const tool = (name, payload) => service.toolCommand({ projectId, requestId: randomUUID(), expectedRevision: state().revision, command: name, payload }, { agent: { session: { id: sessionId } }, callId: `call_${randomUUID()}`, signal: new AbortController().signal });
  async function setup() {
    const plan = await tool('apply_plan', {
      title: 'Isolated catalog test', goal: 'Synthetic records only',
      parties: [{ id: 'factory_fixture', type: 'factory', displayName: 'Fixture Factory' }],
    });
    projectId = plan.projectId;
  }
  const templates = () => state().commerceNetwork.workerTemplates;
  const mine = () => templates().find(t => !t.builtin);
  const agents = () => state().commerceNetwork.agentServices;
  async function connect(agentServiceId) {
    const issued = await command('issue_agent_credential', { agentServiceId });
    await service.worker(issued.credential.token, 'connect', { requestId: randomUUID() });
    return issued.credential.token;
  }
  async function acceptTask(token, orderId) {
    const preview = await service.review(sessionId, projectId, orderId);
    await command('approve_order', { orderId, reviewDigest: preview.reviewDigest }, { expectedRevision: preview.networkRevision });
    await tool('dispatch_order', { orderId });
    const claimed = await service.worker(token, 'claim', { requestId: randomUUID(), orderId });
    await service.worker(token, 'heartbeat', { requestId: randomUUID(), orderId, leaseId: claimed.order.leaseId });
    await service.worker(token, 'deliver', { requestId: randomUUID(), orderId, leaseId: claimed.order.leaseId, title: 'Delivery', content: 'Synthetic delivery for a test.', actualMinor: 0, sourceUrls: [] });
    await command('accept_delivery', { orderId });
    return claimed;
  }
  return { service, state, command, tool, setup, templates, mine, agents, connect, acceptTask, get projectId() { return projectId; } };
}

const draft = {
  name: 'Test Worker', tagline: 'Test tagline', category: 'Test', maintainerName: 'Test Maintainer', runsOn: ['other', 'grokbot'],
  skills: ['public_web_research', 'summarize_rfq'], inputs: ['text'], outputs: ['text'],
  instructions: 'Do the task and cite sources. Never send messages.',
  starters: [
    { id: 'st_a', title: 'Research', brief: 'Research the authorized product.', skills: ['public_web_research'] },
    { id: 'st_b', title: 'Digest', brief: 'Digest the authorized RFQs.', skills: ['summarize_rfq'] },
  ],
  pricing: { kind: 'subscription', amountMinor: 29900, currency: 'CNY' }, declared: { responseTime: '1 business day' },
};
const rejects = (promise, code) => assert.rejects(promise, error => { assert.equal(error.code, code); return true; });

test('built-in templates are published, immutable and only name skills the Worker protocol supports', async () => {
  const f = harness(); await f.setup();
  const builtins = f.templates().filter(t => t.builtin);
  assert.equal(builtins.length, BUILTIN_TEMPLATES.length);
  for (const t of builtins) {
    assert.equal(t.status, 'published'); assert.equal(t.published.version, 1); assert.equal(t.billingStatus, 'not_connected');
    assert.equal(t.published.pricing.kind, 'free');
    await f.command('hire_worker', { templateId: t.id, runtime: 'other' });
  }
  assert.equal(f.agents().length, BUILTIN_TEMPLATES.length, 'every built-in skill is accepted by the existing agent registry');
  await rejects(f.command('upsert_worker_template', { ...draft, id: builtins[0].id }), 'BUILTIN_IMMUTABLE');
  await rejects(f.command('set_worker_template_status', { templateId: builtins[0].id, status: 'paused' }), 'BUILTIN_IMMUTABLE');
});

test('hiring creates an ordinary agent service and never grants more than the template and the owner allow', async () => {
  const f = harness(); await f.setup();
  const rfq = 'builtin.rfq-digest';
  await rejects(f.command('hire_worker', { templateId: rfq, runtime: 'nobody' }), 'RUNTIME_UNSUPPORTED');
  await rejects(f.command('hire_worker', { templateId: rfq, runtime: 'muse', grantedSkills: ['draft_outreach'] }), 'CAPABILITY_DENIED');
  await rejects(f.command('hire_worker', { templateId: rfq, runtime: 'muse', trial: true }), 'TRIAL_NOT_ALLOWED');
  await rejects(f.command('hire_worker', { templateId: rfq, runtime: 'muse', starterId: 'starter_rfq_week' }), 'REQUESTER_REQUIRED');
  await rejects(f.command('hire_worker', { templateId: rfq, runtime: 'muse', grantedSkills: ['classify_opted_in_replies'], starterId: 'starter_rfq_week', requesterPartyId: 'factory_fixture' }), 'CAPABILITY_DENIED');
  assert.equal(f.agents().length, 0, 'a rejected hire leaves no partial records');

  const result = await f.command('hire_worker', { templateId: rfq, runtime: 'muse', grantedSkills: ['summarize_rfq'], starterId: 'starter_rfq_week', requesterPartyId: 'factory_fixture' });
  const [hired] = result.commerceNetwork.agentServices;
  assert.deepEqual({ type: hired.providerType, skills: hired.skills, status: hired.status, executionEnabled: hired.executionEnabled }, { type: 'muse', skills: ['summarize_rfq'], status: 'pending', executionEnabled: false });
  assert.deepEqual(hired.workerTemplate.billing, { kind: 'free', amountMinor: 0, currency: 'CNY', status: 'not_connected' });
  assert.equal(result.commerceNetwork.parties.find(p => p.id === hired.providerPartyId).verification, 'unverified', 'a maintainer name is never treated as verified');
  const [drafted] = result.commerceNetwork.workOrders;
  assert.deepEqual({ status: drafted.status, actions: drafted.allowedActions, maximumMinor: drafted.maximumMinor, starter: drafted.starterId }, { status: 'proposed', actions: ['summarize_rfq'], maximumMinor: 0, starter: 'starter_rfq_week' });
  await rejects(f.command('hire_worker', { templateId: rfq, runtime: 'muse' }), 'ALREADY_HIRED');
  assert.equal(f.templates().find(t => t.id === rfq).stats.activeHires, 1);
});

test('only the authenticated owner can edit, publish, hire or upgrade; the native assistant cannot', async () => {
  const f = harness(); await f.setup();
  for (const [name, payload] of [['upsert_worker_template', draft], ['publish_worker_template', { templateId: 'x', changelog: 'x' }], ['set_worker_template_status', { templateId: 'x', status: 'paused' }], ['hire_worker', { templateId: 'builtin.rfq-digest', runtime: 'muse' }], ['upgrade_worker_hire', { agentServiceId: 'x', version: 2 }]]) {
    await rejects(f.tool(name, payload), 'OWNER_ACTION_REQUIRED');
  }
});

test('first publish needs a real accepted task; new skills need their own; upgrades never widen implicitly', async () => {
  const f = harness(); await f.setup();
  await f.command('upsert_worker_template', { ...draft, tagline: '' });
  const templateId = f.mine().id;
  assert.equal(f.mine().status, 'draft'); assert.equal(f.mine().published, null);
  await rejects(f.command('publish_worker_template', { templateId, changelog: 'First' }), 'TEMPLATE_INCOMPLETE');
  await f.command('upsert_worker_template', { ...draft, id: templateId });
  await rejects(f.command('publish_worker_template', { templateId, changelog: 'First' }), 'TRIAL_REQUIRED');
  await rejects(f.command('hire_worker', { templateId, runtime: 'other' }), 'TEMPLATE_UNAVAILABLE');

  // Trial: hire the draft itself, run one task per skill, and accept both deliveries.
  const trial = await f.command('hire_worker', { templateId, runtime: 'other', trial: true, starterId: 'st_a', requesterPartyId: 'factory_fixture' });
  const trialAgent = trial.commerceNetwork.agentServices[0];
  assert.equal(trialAgent.workerTemplate.trial, true); assert.equal(trialAgent.workerTemplate.version, null);
  const token = await f.connect(trialAgent.id);
  const claimed = await f.acceptTask(token, trial.commerceNetwork.workOrders[0].id);
  assert.deepEqual(claimed.order.workerPackage, { templateId, version: null, name: 'Test Worker', instructions: draft.instructions }, 'the package travels with the claimed task');
  await f.command('propose_order', { requesterPartyId: 'factory_fixture', agentServiceId: trialAgent.id, title: 'Digest', brief: 'Digest the RFQs.', allowedActions: ['summarize_rfq'], allowedResourceRefs: [], maximumMinor: 0 });
  await f.acceptTask(token, f.state().commerceNetwork.workOrders.find(o => o.status === 'proposed').id);
  assert.deepEqual({ accepted: f.mine().stats.accepted, hires: f.mine().stats.hires }, { accepted: 2, hires: 1 });

  // v1 offers only one skill, and cannot be published twice without changes.
  await f.command('upsert_worker_template', { ...draft, id: templateId, skills: ['public_web_research'], starters: [draft.starters[0]] });
  await f.command('publish_worker_template', { templateId, changelog: 'First release' });
  assert.equal(f.mine().status, 'published'); assert.equal(f.mine().published.version, 1); assert.equal(f.mine().hasUnpublishedChanges, false);
  await rejects(f.command('publish_worker_template', { templateId, changelog: 'Again' }), 'NO_CHANGES');

  // A skill nobody has exercised yet cannot be added.
  await f.command('upsert_worker_template', { ...draft, id: templateId, skills: ['public_web_research', 'draft_outreach'], starters: [draft.starters[0]] });
  await rejects(f.command('publish_worker_template', { templateId, changelog: 'Outreach' }), 'TRIAL_REQUIRED');

  // Real hire pinned to v1 with one granted skill; the trial agent is retired first.
  await f.command('revoke_agent', { agentServiceId: trialAgent.id });
  await f.command('hire_worker', { templateId, runtime: 'other' });
  const hired = f.agents().find(a => a.status === 'pending');
  assert.deepEqual({ version: hired.workerTemplate.version, trial: hired.workerTemplate.trial, skills: hired.skills }, { version: 1, trial: false, skills: ['public_web_research'] });

  // v2 adds a proven skill and changes the price.
  await f.command('upsert_worker_template', { ...draft, id: templateId, pricing: { kind: 'subscription', amountMinor: 39900, currency: 'CNY' } });
  await f.command('publish_worker_template', { templateId, changelog: 'Adds RFQ digest' });
  const v2 = f.mine().versions[1];
  assert.deepEqual({ version: v2.version, widensScope: v2.widensScope, changesPricing: v2.changesPricing }, { version: 2, widensScope: true, changesPricing: true });
  assert.equal(f.agents().find(a => a.id === hired.id).workerTemplate.version, 1, 'publishing never moves an existing hire');

  await rejects(f.command('upgrade_worker_hire', { agentServiceId: hired.id, version: 2 }), 'PRICING_CHANGED');
  await f.command('upgrade_worker_hire', { agentServiceId: hired.id, version: 2, acceptPricing: true });
  const upgraded = f.agents().find(a => a.id === hired.id);
  assert.deepEqual({ version: upgraded.workerTemplate.version, skills: upgraded.skills, price: upgraded.workerTemplate.billing.amountMinor }, { version: 2, skills: ['public_web_research'], price: 39900 });
  await rejects(f.command('upgrade_worker_hire', { agentServiceId: hired.id, version: 2, acceptPricing: true }), 'VERSION_NOT_NEWER');

  await f.command('upsert_worker_template', { ...draft, id: templateId, tagline: 'Sharper tagline', pricing: { kind: 'subscription', amountMinor: 39900, currency: 'CNY' } });
  await f.command('publish_worker_template', { templateId, changelog: 'Copy fix' });
  await rejects(f.command('upgrade_worker_hire', { agentServiceId: hired.id, version: 3, grantedSkills: ['draft_outreach'] }), 'CAPABILITY_DENIED');
  await f.command('upgrade_worker_hire', { agentServiceId: hired.id, version: 3, grantedSkills: ['public_web_research', 'summarize_rfq'] });
  assert.deepEqual(f.agents().find(a => a.id === hired.id).skills, ['public_web_research', 'summarize_rfq'], 'widening happens only when the owner lists the skills');

  // Pause stops new hires; retire is final.
  await f.command('revoke_agent', { agentServiceId: hired.id });
  await f.command('set_worker_template_status', { templateId, status: 'paused' });
  await rejects(f.command('hire_worker', { templateId, runtime: 'other' }), 'TEMPLATE_UNAVAILABLE');
  await f.command('set_worker_template_status', { templateId, status: 'published' });
  await f.command('set_worker_template_status', { templateId, status: 'retired' });
  await rejects(f.command('upsert_worker_template', { ...draft, id: templateId }), 'TEMPLATE_RETIRED');
  await rejects(f.command('hire_worker', { templateId, runtime: 'other' }), 'TEMPLATE_UNAVAILABLE');
});

test('a hire cannot be upgraded while a task is running or still needs a removed skill', async () => {
  const f = harness(); await f.setup();
  await f.command('upsert_worker_template', draft);
  const templateId = f.mine().id;
  const trial = await f.command('hire_worker', { templateId, runtime: 'other', trial: true, starterId: 'st_a', requesterPartyId: 'factory_fixture' });
  const trialAgent = trial.commerceNetwork.agentServices[0], token = await f.connect(trialAgent.id);
  await f.acceptTask(token, trial.commerceNetwork.workOrders[0].id);
  await f.command('publish_worker_template', { templateId, changelog: 'v1' });
  await f.command('upsert_worker_template', { ...draft, id: templateId, tagline: 'v2 copy' });
  await f.command('publish_worker_template', { templateId, changelog: 'v2' });

  await f.command('propose_order', { requesterPartyId: 'factory_fixture', agentServiceId: trialAgent.id, title: 'Open digest', brief: 'Still open.', allowedActions: ['summarize_rfq'], allowedResourceRefs: [], maximumMinor: 0 });
  await f.command('upsert_worker_template', { ...draft, id: templateId, skills: ['public_web_research'], starters: [draft.starters[0]] });
  await f.command('publish_worker_template', { templateId, changelog: 'v3 drops RFQ' });
  await rejects(f.command('upgrade_worker_hire', { agentServiceId: trialAgent.id, version: 3, grantedSkills: ['public_web_research'] }), 'SKILL_IN_USE');
});

test('shared publish rules agree between the form and the ledger', () => {
  assert.deepEqual(publishIssues({ name: '', tagline: 'x', category: 'x', maintainerName: 'x', instructions: 'short', runsOn: [], skills: ['a'], outputs: ['text'], starters: [], pricing: { kind: 'per_acceptance', amountMinor: 0 } }).sort(), ['instructions', 'name', 'pricing', 'runsOn', 'starters'].sort());
  assert.deepEqual(publishIssues(snapshotOf(BUILTIN_TEMPLATES[0])), []);
  assert.equal(sameSnapshot(BUILTIN_TEMPLATES[0], BUILTIN_TEMPLATES[0].versions[0].snapshot), true);
  assert.equal(widensScope({ skills: ['a'] }, { skills: ['a', 'b'] }), true);
  assert.equal(widensScope({ skills: ['a', 'b'] }, { skills: ['a'] }), false);
});
