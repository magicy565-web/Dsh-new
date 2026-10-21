import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  BusinessMemoryError, STATE_KEY, createBusinessMemoryService, validateMemoryState,
} from '../src/domain.mjs';

const ADMIN = { subject: 'admin-1', role: 'admin', workspaceId: 'alpha' };
const OPERATOR = { subject: 'operator-1', role: 'operator', workspaceId: 'alpha' };
const VIEWER = { subject: 'viewer-1', role: 'viewer', workspaceId: 'alpha' };
const BETA = { subject: 'beta-admin', role: 'admin', workspaceId: 'beta' };

function fakeStorage(initial = {}) {
  let state = structuredClone(initial);
  return {
    read: () => structuredClone(state),
    update: async mutator => {
      const draft = structuredClone(state);
      const result = mutator(draft);
      state = draft;
      return structuredClone(result);
    },
    snapshot: () => structuredClone(state),
  };
}

let now = Date.parse('2026-10-22T00:00:00.000Z');
const clock = () => now;
const advance = ms => { now += ms; };

function serviceWith(options = {}) {
  const storage = options.storage ?? fakeStorage();
  const resolved = options.resolveWorkspace ?? (actor => ({
    workspaceId: actor.workspaceId ?? 'alpha', subject: actor.subject, role: actor.role,
  }));
  const service = createBusinessMemoryService({
    storage,
    workspaceId: 'alpha',
    resolveWorkspace: resolved,
    verifySource: options.verifySource ?? null,
    allowConversationSources: options.allowConversationSources !== false,
    clock,
    audit: options.audit ?? null,
  });
  return { service, storage };
}

function operatorSource(basis = '2026-10-21 与客户采购负责人通话确认') {
  return { kind: 'operator', basis, label: '电话记录' };
}

function proposal(overrides = {}) {
  return {
    requestId: randomUUID(),
    subjectType: 'customer',
    subjectId: 'customer-haiqi',
    subjectLabel: '海祺贸易',
    factKey: 'reorder-window',
    kind: 'fact',
    statement: '海祺贸易通常在每年 3 月和 9 月补货。',
    source: operatorSource(),
    tags: ['复购', '节奏'],
    ...overrides,
  };
}

test('a proposal is a candidate, never an active fact', async () => {
  const { service } = serviceWith();
  const created = await service.propose({ actor: OPERATOR }, proposal());
  assert.equal(created.record.status, 'proposed');
  assert.equal(created.record.lifecycle, 'proposed');
  assert.equal(created.record.revision, 1);
  assert.equal(created.record.source.verified, false);
  const active = service.recall({ actor: ADMIN });
  assert.equal(active.total, 0);
  const proposed = service.recall({ actor: ADMIN }, { status: 'proposed' });
  assert.equal(proposed.total, 1);
  assert.equal(proposed.items[0].id, created.record.id);
  assert.throws(() => service.recall({ actor: VIEWER }, { status: 'proposed' }), error => error.code === 'BUSINESS_MEMORY_FORBIDDEN');
});

test('an administrator approval activates the fact and records the attestation', async () => {
  const { service } = serviceWith();
  const created = await service.propose({ actor: OPERATOR }, proposal());
  const reviewed = await service.review({ actor: ADMIN }, created.record.id, {
    decision: 'approve', requestId: randomUUID(), note: '与客户确认',
  });
  assert.equal(reviewed.record.status, 'active');
  assert.equal(reviewed.record.reviewedBy, ADMIN.subject);
  assert.equal(reviewed.record.reviewNote, '与客户确认');
  assert.ok(reviewed.record.activatedAt);
  const recalled = service.recall({ actor: VIEWER });
  assert.equal(recalled.total, 1);
  assert.equal(recalled.items[0].source.attestation, 'human-attested');
  const read = service.read({ actor: VIEWER }, created.record.id);
  assert.equal(read.record.history.map(entry => entry.action).join(','), 'proposed,activated');
});

test('a newer approved fact supersedes the current one and keeps the revision chain', async () => {
  const { service } = serviceWith();
  const first = await service.propose({ actor: ADMIN }, proposal());
  await service.review({ actor: ADMIN }, first.record.id, { decision: 'approve', requestId: randomUUID() });
  advance(1000);
  const second = await service.propose({ actor: ADMIN }, proposal({ statement: '海祺贸易改为每年 4 月和 10 月补货。' }));
  const approved = await service.review({ actor: ADMIN }, second.record.id, { decision: 'approve', requestId: randomUUID() });
  assert.equal(approved.record.revision, 2);
  assert.equal(approved.record.previousId, first.record.id);
  const all = service.recall({ actor: ADMIN }, { status: 'all' });
  const old = all.items.find(item => item.id === first.record.id);
  assert.equal(old.status, 'superseded');
  assert.equal(all.items.filter(item => item.status === 'active').length, 1);
  assert.ok(service.read({ actor: ADMIN }, first.record.id).record.history.some(entry => entry.action === 'superseded'));
});

test('reject keeps the candidate out of facts; revoke removes an active fact but keeps history', async () => {
  const { service } = serviceWith();
  const proposalA = await service.propose({ actor: OPERATOR }, proposal());
  const rejected = await service.review({ actor: ADMIN }, proposalA.record.id, {
    decision: 'reject', requestId: randomUUID(), note: '客户尚未确认',
  });
  assert.equal(rejected.record.status, 'rejected');
  assert.equal(service.recall({ actor: ADMIN }).total, 0);

  const proposalB = await service.propose({ actor: OPERATOR }, proposal({ factKey: 'moq', statement: '起订量为 300 件。' }));
  const active = await service.review({ actor: ADMIN }, proposalB.record.id, { decision: 'approve', requestId: randomUUID() });
  const revoked = await service.revoke({ actor: ADMIN }, active.record.id, { requestId: randomUUID(), reason: '口径变化' });
  assert.equal(revoked.record.status, 'revoked');
  assert.equal(service.recall({ actor: ADMIN }).total, 0);
  assert.throws(() => service.read({ actor: VIEWER }, active.record.id), error => error.code === 'BUSINESS_MEMORY_NOT_FOUND');
  const history = service.read({ actor: ADMIN }, active.record.id).record.history;
  assert.deepEqual(history.map(entry => entry.action), ['proposed', 'activated', 'revoked']);
});

test('requestId replays the same result and refuses a different command', async () => {
  const { service } = serviceWith();
  const body = proposal();
  const first = await service.propose({ actor: OPERATOR }, body);
  const replay = await service.propose({ actor: OPERATOR }, body);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.record.id, first.record.id);
  await assert.rejects(
    () => service.propose({ actor: OPERATOR }, { ...body, statement: '完全不同的说法' }),
    error => error.code === 'BUSINESS_MEMORY_IDEMPOTENCY_CONFLICT' && error.status === 409,
  );
});

test('roles are enforced at every write boundary', async () => {
  const { service } = serviceWith();
  await assert.rejects(() => service.propose({ actor: VIEWER }, proposal()), error => error.code === 'BUSINESS_MEMORY_FORBIDDEN');
  const created = await service.propose({ actor: OPERATOR }, proposal());
  await assert.rejects(
    () => service.review({ actor: OPERATOR }, created.record.id, { decision: 'approve', requestId: randomUUID() }),
    error => error.code === 'BUSINESS_MEMORY_ADMIN_REQUIRED',
  );
  await assert.rejects(() => service.revoke({ actor: OPERATOR }, created.record.id, { requestId: randomUUID() }),
    error => error.code === 'BUSINESS_MEMORY_ADMIN_REQUIRED');
});

test('each workspace has an independent memory', async () => {
  const { service, storage } = serviceWith();
  const alpha = await service.propose({ actor: ADMIN }, proposal());
  await service.review({ actor: ADMIN }, alpha.record.id, { decision: 'approve', requestId: randomUUID() });
  assert.equal(service.recall({ actor: ADMIN }).total, 1);
  assert.equal(service.recall({ actor: BETA }).total, 0);
  const betaProposal = await service.propose({ actor: BETA }, proposal({ statement: 'Beta 的客户事实。' }));
  assert.equal(service.recall({ actor: ADMIN }, { status: 'all' }).total, 1);
  assert.equal(service.recall({ actor: BETA }, { status: 'all' }).total, 1);
  await assert.throws(() => service.read({ actor: BETA }, alpha.record.id), error => error.code === 'BUSINESS_MEMORY_NOT_FOUND');
  assert.equal(betaProposal.record.status, 'proposed');
  const alphaState = storage.snapshot().workspaces.alpha[STATE_KEY];
  const betaState = storage.snapshot().workspaces.beta[STATE_KEY];
  assert.equal(alphaState.records.length, 1);
  assert.equal(betaState.records.length, 1);
  assert.equal(alphaState.records[0].workspaceId, 'alpha');
});

test('external sources fail closed without a verifier and pin the proof with one', async () => {
  const { service: bare } = serviceWith();
  await assert.rejects(
    () => bare.propose({ actor: ADMIN }, proposal({ source: { kind: 'product-page', productId: 'prod_alpha', pageId: randomUUID(), version: 1 } })),
    error => error.code === 'BUSINESS_MEMORY_SOURCE_UNCONFIGURED' && error.status === 503,
  );
  const sha = 'c'.repeat(64);
  const verifications = [];
  const { service } = serviceWith({
    verifySource: async source => {
      verifications.push(source.ref);
      return { verified: true, sha256: sha, label: '产品资料 · 亚麻衬衫 · 销售说明' };
    },
  });
  const created = await service.propose({ actor: ADMIN }, proposal({
    source: { kind: 'product-page', productId: 'prod_alpha', pageId: '11111111-1111-4111-8111-111111111111', version: 2 },
  }));
  assert.equal(created.record.source.ref, 'product:prod_alpha/page:11111111-1111-4111-8111-111111111111@2');
  assert.equal(created.record.source.verified, true);
  assert.equal(created.record.source.sha256, sha);
  assert.equal(verifications.length, 1);
  const approved = await service.review({ actor: ADMIN }, created.record.id, { decision: 'approve', requestId: randomUUID() });
  assert.equal(verifications.length, 2, 'approval re-verifies the exact source');
  assert.equal(approved.record.source.attestation, 'source-verified');
  const stored = service.read({ actor: ADMIN }, created.record.id).record;
  assert.equal(stored.source.attestation, 'source-verified');
});

test('a source that changed before review blocks approval and leaves the proposal pending', async () => {
  let allow = true;
  const { service } = serviceWith({
    verifySource: async () => {
      if (!allow) throw new BusinessMemoryError(409, 'BUSINESS_MEMORY_SOURCE_STALE', 'The product page moved to another version.');
      return { verified: true, sha256: 'd'.repeat(64), label: '产品资料' };
    },
  });
  const created = await service.propose({ actor: ADMIN }, proposal({
    source: { kind: 'product-page', productId: 'prod_alpha', pageId: '22222222-2222-4222-8222-222222222222', version: 1 },
  }));
  allow = false;
  await assert.rejects(
    () => service.review({ actor: ADMIN }, created.record.id, { decision: 'approve', requestId: randomUUID() }),
    error => error.code === 'BUSINESS_MEMORY_SOURCE_STALE',
  );
  assert.equal(service.recall({ actor: ADMIN }, { status: 'proposed' }).total, 1);
  assert.equal(service.recall({ actor: ADMIN }).total, 0);
});

test('expired active facts leave the usable set without erasing the record', async () => {
  const { service } = serviceWith();
  const expiresAt = new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString();
  const created = await service.propose({ actor: OPERATOR }, proposal({ expiresAt }));
  await service.review({ actor: ADMIN }, created.record.id, { decision: 'approve', requestId: randomUUID() });
  advance(11 * 24 * 60 * 60 * 1000);
  const recalled = service.recall({ actor: ADMIN });
  assert.equal(recalled.total, 1);
  assert.equal(recalled.items[0].lifecycle, 'expired');
  assert.equal(recalled.items[0].usable, false);
  const map = service.map({ actor: ADMIN });
  assert.equal(map.counts.expired, 1);
  assert.equal(service.brief({ actor: ADMIN }).basedOn.active, 0, 'expired facts do not feed the brief');
});

test('the map reports structural coverage, not quality or revenue', async () => {
  const { service } = serviceWith();
  const created = await service.propose({ actor: OPERATOR }, proposal());
  await service.review({ actor: ADMIN }, created.record.id, { decision: 'approve', requestId: randomUUID() });
  const map = service.map({ actor: ADMIN });
  assert.equal(map.counts.active, 1);
  const customer = map.subjects.find(row => row.subjectType === 'customer');
  assert.equal(customer.active, 1);
  assert.equal(customer.coverage, 'thin');
  assert.equal(map.subjects.find(row => row.subjectType === 'product').coverage, 'none');
  assert.equal(Object.hasOwn(map, 'revenue'), false);
  assert.equal(Object.hasOwn(map, 'forecast'), false);
});

test('the growth brief cites only existing memory and asks next questions without inventing numbers', async () => {
  const { service, storage } = serviceWith();
  const decision = await service.propose({ actor: OPERATOR }, proposal({
    subjectType: 'product', subjectId: 'prod_alpha', subjectLabel: '亚麻衬衫',
    factKey: 'entry-price', kind: 'decision', statement: '先以 2.9 美元试探美国度假衬衫市场。',
  }));
  await service.review({ actor: ADMIN }, decision.record.id, { decision: 'approve', requestId: randomUUID() });
  advance(3 * 24 * 60 * 60 * 1000);
  const pending = await service.propose({ actor: OPERATOR }, proposal({
    subjectType: 'market', subjectId: 'us', subjectLabel: '美国', factKey: 'demand-signal',
    statement: '美国度假衬衫需求在夏季上升。',
  }));
  advance(3 * 24 * 60 * 60 * 1000);
  const brief = service.brief({ actor: ADMIN });
  const ids = new Set(storage.snapshot().workspaces.alpha[STATE_KEY].records.map(record => record.id));
  assert.ok(brief.items.length >= 3);
  for (const item of brief.items) {
    for (const id of item.evidenceIds) assert.ok(ids.has(id), `brief evidence ${id} exists`);
    assert.equal(typeof item.severity, 'string');
  }
  const unresolved = brief.items.find(item => item.kind === 'decision-unresolved');
  assert.ok(unresolved);
  assert.deepEqual(unresolved.evidenceIds, [decision.record.id]);
  assert.ok(brief.items.some(item => item.kind === 'pending-review'));
  assert.ok(brief.items.some(item => item.subjectType === 'customer' && item.kind === 'missing-coverage'));
  assert.ok(!JSON.stringify(brief.items).match(/revenue|forecast|probability|预计/iu), 'no fabricated forecast vocabulary');
  assert.ok(brief.limits.length >= 2);
  assert.equal(pending.record.status, 'proposed');
});

test('a damaged store fails closed instead of being reset', () => {
  const broken = fakeStorage({ workspaces: { alpha: { [STATE_KEY]: { version: 1, records: [{ id: 'not-a-uuid' }], receipts: [] } } } });
  const { service } = serviceWith({ storage: broken });
  assert.throws(() => service.status({ actor: ADMIN }), error => error.code === 'BUSINESS_MEMORY_INVALID');
  assert.throws(() => validateMemoryState({ version: 1, records: [], receipts: [], extra: true }), error => error.code === 'BUSINESS_MEMORY_INVALID');
});

test('duplicate active facts in one workspace are refused as corrupt state', () => {
  const base = {
    version: 1, records: [], receipts: [],
  };
  const record = {
    id: randomUUID(), workspaceId: 'alpha', subjectType: 'customer', subjectId: 'c1', subjectLabel: 'C1',
    factKey: 'moq', kind: 'fact', statement: 'MOQ 300.', detail: null, confidence: null, tags: [],
    audience: 'internal', status: 'active', revision: 1, previousId: null,
    source: { kind: 'operator', ref: 'operator:admin-1', label: '电话', sha256: null, verified: false, verifiedAt: null, basis: '通话' },
    proposedBy: 'admin-1', proposedAt: '2026-10-22T00:00:00.000Z', reviewedBy: 'admin-1', reviewedAt: '2026-10-22T00:00:00.000Z',
    reviewNote: null, activatedAt: '2026-10-22T00:00:00.000Z',
    createdAt: '2026-10-22T00:00:00.000Z', createdBy: 'admin-1', updatedAt: '2026-10-22T00:00:00.000Z', updatedBy: 'admin-1',
    expiresAt: null, history: [{ revision: 1, action: 'activated', at: '2026-10-22T00:00:00.000Z', actor: 'admin-1' }],
  };
  assert.throws(
    () => validateMemoryState({ ...base, records: [record, { ...record, id: randomUUID() }] }),
    error => error.code === 'BUSINESS_MEMORY_INVALID',
  );
});

test('audit receives metadata-only events and never the statement body', async () => {
  const events = [];
  const { service } = serviceWith({ audit: { record: event => events.push(event) } });
  const created = await service.propose({ actor: OPERATOR }, proposal());
  await service.review({ actor: ADMIN }, created.record.id, { decision: 'approve', requestId: randomUUID() });
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(event => event.action), ['propose', 'approve']);
  for (const event of events) {
    assert.equal(event.kind, 'business-memory');
    assert.equal(JSON.stringify(event).includes('海祺贸易'), false);
  }
});

test('input guards refuse unknown keys, oversized text and malformed sources', async () => {
  const { service } = serviceWith();
  await assert.rejects(() => service.propose({ actor: ADMIN }, { ...proposal(), extra: true }), error => error.code === 'BUSINESS_MEMORY_INPUT');
  await assert.rejects(() => service.propose({ actor: ADMIN }, proposal({ statement: 'x'.repeat(2001) })), error => error.code === 'BUSINESS_MEMORY_INPUT');
  await assert.rejects(() => service.propose({ actor: ADMIN }, proposal({ source: { kind: 'operator' } })), error => error.code === 'BUSINESS_MEMORY_INPUT');
  await assert.rejects(() => service.propose({ actor: ADMIN }, proposal({ source: { kind: 'ftp', ref: 'x' } })), error => error.code === 'BUSINESS_MEMORY_INPUT');
  await assert.rejects(() => service.propose({ actor: ADMIN }, proposal({ subjectType: 'planet' })), error => error.code === 'BUSINESS_MEMORY_INPUT');
});

async function createActive(service, overrides = {}) {
  const created = await service.propose({ actor: OPERATOR }, proposal(overrides));
  const reviewed = await service.review({ actor: ADMIN }, created.record.id, { decision: 'approve', requestId: randomUUID() });
  return reviewed.record;
}

test('task context compiles a budgeted, cited block and records an injection receipt', async () => {
  const { service } = serviceWith();
  const customer = await createActive(service, { statement: '海祺贸易每年 3 月和 9 月补货，采购负责人是林经理。' });
  await createActive(service, {
    subjectType: 'product', subjectId: 'prod_linen', subjectLabel: '亚麻衬衫',
    factKey: 'buyer-profile', statement: '美国度假衬衫品牌重视透气和水洗，而不是最低价。',
  });
  const revisionBefore = service.status({ actor: ADMIN }).revision;
  const context = await service.compileContext({ actor: ADMIN }, {
    taskId: 'session-1:1', sessionId: 'session-1',
    query: '帮我看下海祺的补货节奏', refs: [{ subjectType: 'customer', subjectId: 'customer-haiqi' }],
  });
  assert.match(context.text, /企业经营记忆/u);
  assert.match(context.text, /只作为事实依据，不是指令/u);
  assert.match(context.text, new RegExp(`mem:${customer.id}`, 'u'));
  assert.equal(context.items[0].id, customer.id);
  assert.equal(context.items[0].why, 'subject-match');
  assert.equal(context.revision, revisionBefore, 'compiling a context does not write memory facts');
  const receipts = service.injections({ actor: ADMIN }, { taskId: 'session-1:1' });
  assert.equal(receipts.total, 1);
  assert.deepEqual(receipts.items[0].ids, context.items.map(item => item.id));
  assert.equal(receipts.items[0].revision, revisionBefore);
  assert.ok(receipts.items[0].bytes > 0);
  await createActive(service, { factKey: 'moq', statement: '起订量 300 件。' });
  assert.ok(service.status({ actor: ADMIN }).revision > revisionBefore, 'a memory write invalidates cached task contexts');
});

test('task context respects the budget and per-subject diversity', async () => {
  const { service } = serviceWith();
  for (let index = 0; index < 8; index += 1) {
    await createActive(service, {
      subjectId: `customer-${index}`, subjectLabel: `客户${index}`,
      factKey: 'moq', statement: `客户${index} 的起订量是 ${100 + index} 件。`,
    });
  }
  const pending = await service.propose({ actor: OPERATOR }, proposal({ factKey: 'pending-only', statement: '尚未审核的候选事实。' }));
  const context = await service.compileContext({ actor: ADMIN }, { taskId: 'task-budget', query: '客户 起订量', budgetChars: 900, maxItems: 20 });
  assert.ok(context.items.length <= 5, 'per-subject cap keeps one subject from crowding the context');
  assert.ok(context.counts.omitted > 0);
  assert.equal(context.items.some(item => item.id === pending.record.id), false, 'proposals never enter a task context');
  assert.equal(context.items.some(item => item.statement.includes('尚未审核')), false);
  assert.ok(Buffer.byteLength(context.text, 'utf8') < 2000);
  assert.ok(context.counts.active >= 8);
});

test('task context excludes expired facts and is isolated per workspace', async () => {
  const { service } = serviceWith();
  const expiring = await service.propose({ actor: OPERATOR }, proposal({
    factKey: 'temporary-window', statement: '临时补货窗口只到本月。',
    expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
  }));
  await service.review({ actor: ADMIN }, expiring.record.id, { decision: 'approve', requestId: randomUUID() });
  const before = await service.compileContext({ actor: ADMIN }, { taskId: 'task-expire-1', query: '补货窗口' });
  assert.ok(before.items.some(item => item.id === expiring.record.id));
  advance(2 * 24 * 60 * 60 * 1000);
  const after = await service.compileContext({ actor: ADMIN }, { taskId: 'task-expire-2', query: '补货窗口' });
  assert.equal(after.items.some(item => item.id === expiring.record.id), false);

  await createActive(service, { statement: 'Alpha 的客户补货节奏。' });
  const beta = await service.compileContext({ actor: BETA }, { taskId: 'beta:1', query: '补货' });
  assert.equal(beta.items.length, 0);
  assert.match(beta.text, /当前没有已确认的经营记忆/u);
  assert.deepEqual(beta.warnings, ['BUSINESS_MEMORY_EMPTY']);
  const betaReceipts = service.injections({ actor: BETA }, {});
  assert.equal(betaReceipts.total, 1);
});

test('context requests are bounded and receipts can be disabled', async () => {
  const { service } = serviceWith();
  await assert.rejects(() => service.compileContext({ actor: ADMIN }, { budgetChars: 100 }), error => error.code === 'BUSINESS_MEMORY_INPUT');
  await assert.rejects(() => service.compileContext({ actor: ADMIN }, { maxItems: 500 }), error => error.code === 'BUSINESS_MEMORY_INPUT');
  await assert.rejects(() => service.compileContext({ actor: ADMIN }, { random: true }), error => error.code === 'BUSINESS_MEMORY_INPUT');
  await assert.rejects(() => service.compileContext({ actor: ADMIN }, { refs: [{ subjectType: 'planet', subjectId: 'x' }] }), error => error.code === 'BUSINESS_MEMORY_INPUT');
  const context = await service.compileContext({ actor: ADMIN }, { record: false, query: '补货' });
  assert.equal(context.taskId, null);
  assert.equal(service.injections({ actor: ADMIN }, {}).total, 0);
  assert.throws(() => service.injections({ actor: OPERATOR }, {}), error => error.code === 'BUSINESS_MEMORY_ADMIN_REQUIRED');
});
