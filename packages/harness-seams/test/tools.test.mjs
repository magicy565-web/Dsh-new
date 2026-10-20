// Tools seam tests: registry, JSON-Schema subset args, approval gating, audit.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_AUDIT_ENTRIES,
  createTools,
  createToolsProvider,
  validateArgs,
} from '../src/tools.mjs';
import { createApproval, createApprovalProvider } from '../src/approval.mjs';
import { createStorage, createStorageProvider } from '../src/storage.mjs';
import { ERROR, HarnessError } from '../../harness-contracts/src/index.mjs';
import {
  ACTOR_A,
  ACTOR_B,
  LOCAL_ADMIN,
  closeAfter,
  fakeClock,
  harnessError,
  makeTempDirectory,
  removeDirectory,
} from './helpers.mjs';

const readOnlyTool = (overrides = {}) => ({
  name: 'demo_read',
  description: 'Read demo data',
  approval: 'never',
  readOnly: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: { asOf: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
  },
  handler: async (args, execution) => ({ asOf: args.asOf ?? null, actor: execution.actor?.subject ?? null }),
  ...overrides,
});

const writeTool = (overrides = {}) => ({
  name: 'demo_write',
  description: 'Write demo data',
  approval: 'always',
  parameters: { type: 'object', required: ['value'], properties: { value: { type: 'string' } } },
  handler: async (args, execution) => ({ value: args.value, by: execution.actor?.subject ?? null }),
  ...overrides,
});

const schemaTool = (overrides = {}) => ({
  name: 'demo_schema',
  description: 'Schema subset demo',
  approval: 'never',
  readOnly: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['mode'],
    properties: {
      mode: { type: 'string', enum: ['fast', 'slow'] },
      name: { type: 'string', minLength: 2, maxLength: 4, pattern: '^[a-z]+$' },
      count: { type: 'integer', minimum: 1, maximum: 10 },
      nested: { type: 'object', additionalProperties: false, required: ['flag'], properties: { flag: { type: 'boolean' } } },
    },
  },
  handler: async args => args,
  ...overrides,
});

const newStorage = async t => {
  const directory = await makeTempDirectory('seams-tools');
  removeDirectory(t, directory);
  const storage = await createStorage({ directory });
  closeAfter(t, storage);
  return storage;
};

const invalidArgs = pattern => error => {
  assert.ok(error instanceof HarnessError, `expected a HarnessError, got ${error?.name}: ${error?.message}`);
  assert.equal(error.code, ERROR.toolInvalid);
  if (pattern) assert.match(error.message, pattern);
  return true;
};

test('register/list publish read-only tools without leaking handlers', () => {
  const tools = createTools();
  tools.register(readOnlyTool());
  const listed = tools.list({ actor: ACTOR_A });
  assert.equal(listed.length, 1);
  assert.deepEqual(Object.keys(listed[0]).sort(), ['approval', 'description', 'name', 'parameters']);
  assert.equal(listed[0].name, 'demo_read');
  assert.equal(listed[0].approval, 'never');
  assert.equal(listed[0].handler, undefined);
  listed[0].parameters.properties.asOf.type = 'number';
  assert.equal(tools.list()[0].parameters.properties.asOf.type, 'string', 'list returns detached parameters');
});

test('approval:"never" is only allowed for explicitly read-only tools', () => {
  const tools = createTools();
  assert.throws(() => tools.register(writeTool({ approval: 'never' })), invalidArgs(/readOnly: true/));
  assert.throws(() => tools.register(readOnlyTool({ readOnly: false })), invalidArgs(/readOnly: true/));
  assert.throws(() => tools.register(readOnlyTool({ readOnly: undefined })), invalidArgs(/readOnly: true/));
  assert.doesNotThrow(() => tools.register(readOnlyTool()));
  const policyTool = tools.register(readOnlyTool({ name: 'demo_policy', approval: undefined }));
  assert.equal(policyTool.approval, 'policy');
  assert.equal(tools.list()[1].approval, 'policy');
});

test('duplicate names and invalid definitions are refused', () => {
  const tools = createTools();
  tools.register(readOnlyTool());
  assert.throws(() => tools.register(readOnlyTool()), harnessError(ERROR.toolDuplicate));
  assert.throws(() => tools.register(writeTool({ description: '' })), harnessError(ERROR.toolInvalid));
  assert.throws(() => tools.register(writeTool({ name: 'NotSnakeCase' })), harnessError(ERROR.toolInvalid));
  assert.throws(() => tools.register(writeTool({ handler: 'not-a-function' })), harnessError(ERROR.toolInvalid));
});

test('invalid arguments are refused with HARNESS_TOOL_INVALID (JSON-Schema subset)', async () => {
  const tools = createTools();
  tools.register(schemaTool());
  const run = args => tools.execute('demo_schema', args, { actor: ACTOR_A });
  await assert.rejects(run({}), invalidArgs(/required/));
  await assert.rejects(run({ mode: 'nope' }), invalidArgs(/must be one of/));
  await assert.rejects(run({ mode: 'fast', name: 'A' }), invalidArgs(/at least 2/));
  await assert.rejects(run({ mode: 'fast', name: 'abcde' }), invalidArgs(/at most 4/));
  await assert.rejects(run({ mode: 'fast', name: 'AB' }), invalidArgs(/must match/));
  await assert.rejects(run({ mode: 'fast', name: 42 }), invalidArgs(/must be string/));
  await assert.rejects(run({ mode: 'fast', count: 0 }), invalidArgs(/>= 1/));
  await assert.rejects(run({ mode: 'fast', count: 11 }), invalidArgs(/<= 10/));
  await assert.rejects(run({ mode: 'fast', count: 1.5 }), invalidArgs(/must be integer/));
  await assert.rejects(run({ mode: 'fast', extra: true }), invalidArgs(/not allowed/));
  await assert.rejects(run({ mode: 'fast', nested: {} }), invalidArgs(/required/));
  await assert.rejects(run({ mode: 'fast', nested: { flag: 'yes' } }), invalidArgs(/must be boolean/));
  assert.deepEqual(await run({ mode: 'fast', name: 'ab', count: 3, nested: { flag: true } }), {
    mode: 'fast',
    name: 'ab',
    count: 3,
    nested: { flag: true },
  });
  assert.throws(() => validateArgs({ type: 'object', required: ['x'] }, {}), invalidArgs(/required/));
  assert.throws(() => validateArgs({ type: 'object', properties: { x: { type: 'strng' } } }, { x: 'a' }), invalidArgs(/Unsupported/));
});

test('a read-only tool executes without approval and receives the frozen execution object', async () => {
  const tools = createTools();
  let captured;
  tools.register(
    readOnlyTool({
      handler: (args, execution) => {
        captured = execution;
        return { asOf: args.asOf ?? null };
      },
    }),
  );
  const controller = new AbortController();
  assert.deepEqual(await tools.execute('demo_read', { asOf: '2026-10-21' }, { actor: ACTOR_A, signal: controller.signal }), {
    asOf: '2026-10-21',
  });
  assert.deepEqual(Object.keys(captured).sort(), ['actor', 'approval', 'ctx', 'signal', 'storage', 'tools']);
  assert.equal(captured.actor, ACTOR_A);
  assert.equal(captured.signal, controller.signal);
  assert.equal(captured.ctx, null);
  assert.equal(captured.storage, null);
  assert.equal(captured.approval, null);
  assert.equal(captured.tools, tools);
});

test('approval:"always" requires a consumed one-shot ticket', async t => {
  const storage = await newStorage(t);
  const clock = fakeClock();
  const approval = createApproval({ clock, ttlMs: 60_000 });
  const tools = createTools({ approval, storage });
  tools.register(writeTool());

  await assert.rejects(tools.execute('demo_write', { value: 'x' }, { actor: ACTOR_A }), harnessError(ERROR.approvalRequired));
  const { id } = approval.request({ actor: ACTOR_A, tool: 'demo_write', args: { value: 'x' } });
  await assert.rejects(
    tools.execute('demo_write', { value: 'x', approvalId: id }, { actor: ACTOR_A }),
    harnessError(ERROR.approvalRequired),
    'pending tickets are not executable',
  );
  approval.decide(id, 'approve', ACTOR_A);
  assert.deepEqual(await tools.execute('demo_write', { value: 'x', approvalId: id }, { actor: ACTOR_A }), {
    value: 'x',
    by: 'actor-a',
  });
  await assert.rejects(
    tools.execute('demo_write', { value: 'x', approvalId: id }, { actor: ACTOR_A }),
    harnessError(ERROR.approvalRequired),
    'consumed tickets cannot be replayed',
  );
  const audit = storage.read().harnessAudit;
  const executed = audit.filter(entry => entry.ok);
  assert.equal(executed.length, 1);
  assert.equal(executed[0].approvalId, id);
  assert.equal(executed[0].tool, 'demo_write');
});

test('wrong-actor and wrong-tool tickets are refused without consuming them', async t => {
  const storage = await newStorage(t);
  const clock = fakeClock();
  const approval = createApproval({ clock });
  const tools = createTools({ approval, storage });
  tools.register(writeTool());

  const own = approval.request({ actor: ACTOR_A, tool: 'demo_write' }).id;
  approval.decide(own, 'approve', ACTOR_A);
  await assert.rejects(
    tools.execute('demo_write', { value: 'x', approvalId: own }, { actor: ACTOR_B }),
    harnessError(ERROR.approvalRefused),
  );
  assert.equal(approval.list({ status: 'approved' }).length, 1, 'a wrong actor does not burn the ticket');

  const foreign = approval.request({ actor: ACTOR_A, tool: 'other_tool' }).id;
  approval.decide(foreign, 'approve', ACTOR_A);
  await assert.rejects(
    tools.execute('demo_write', { value: 'x', approvalId: foreign }, { actor: ACTOR_A }),
    harnessError(ERROR.approvalRefused),
  );
  assert.equal(approval.list({ status: 'approved' }).some(item => item.id === foreign), true, 'foreign ticket is untouched');

  assert.deepEqual(await tools.execute('demo_write', { value: 'x', approvalId: own }, { actor: ACTOR_A }), {
    value: 'x',
    by: 'actor-a',
  });
});

test('approval:"policy" defaults to always and honours an injected policy', async t => {
  const storage = await newStorage(t);
  const approval = createApproval({ clock: fakeClock() });

  const defaultPolicy = createTools({ approval, storage });
  defaultPolicy.register(writeTool({ name: 'demo_policy', approval: 'policy' }));
  await assert.rejects(
    defaultPolicy.execute('demo_policy', { value: 'x' }, { actor: ACTOR_A }),
    harnessError(ERROR.approvalRequired),
    'without a policy, approval is always required',
  );

  const calls = [];
  const allowPolicy = createTools({
    policy: (actor, tool, args) => {
      calls.push([actor.subject, tool, args]);
      return 'never';
    },
  });
  allowPolicy.register(writeTool({ name: 'demo_policy', approval: 'policy', handler: async args => ({ ok: true, value: args.value }) }));
  assert.deepEqual(await allowPolicy.execute('demo_policy', { value: 'x' }, { actor: ACTOR_A }), { ok: true, value: 'x' });
  assert.deepEqual(calls.at(-1), ['actor-a', 'demo_policy', { value: 'x' }]);

  const denyPolicy = createTools({ policy: () => 'deny' });
  denyPolicy.register(writeTool({ name: 'demo_policy', approval: 'policy' }));
  await assert.rejects(denyPolicy.execute('demo_policy', { value: 'x' }, { actor: ACTOR_A }), harnessError(ERROR.toolRefused));
});

test('unknown tools fail closed with HARNESS_TOOL_REFUSED', async () => {
  const tools = createTools();
  await assert.rejects(tools.execute('no_such_tool', {}), harnessError(ERROR.toolRefused));
  await assert.rejects(tools.execute(undefined, {}), harnessError(ERROR.toolRefused));
});

test('handler results must be JSON-serializable', async t => {
  const storage = await newStorage(t);
  const tools = createTools({ storage });
  tools.register(readOnlyTool({ name: 'bad_bigint', handler: async () => ({ value: 1n }) }));
  tools.register(
    readOnlyTool({
      name: 'bad_cycle',
      handler: async () => {
        const value = {};
        value.self = value;
        return value;
      },
    }),
  );
  tools.register(readOnlyTool({ name: 'bad_function', handler: async () => () => {} }));
  await assert.rejects(tools.execute('bad_bigint', {}, {}), harnessError(ERROR.toolRefused));
  await assert.rejects(tools.execute('bad_cycle', {}, {}), harnessError(ERROR.toolRefused));
  await assert.rejects(tools.execute('bad_function', {}, {}), harnessError(ERROR.toolRefused));
  assert.deepEqual(
    storage.read().harnessAudit.map(entry => [entry.tool, entry.ok, entry.errorCode]),
    [
      ['bad_bigint', false, ERROR.toolRefused],
      ['bad_cycle', false, ERROR.toolRefused],
      ['bad_function', false, ERROR.toolRefused],
    ],
  );
});

test('audit entries have the frozen shape and record successes and failures', async t => {
  const storage = await newStorage(t);
  const tools = createTools({ storage });
  tools.register(readOnlyTool());

  await tools.execute('demo_read', { asOf: '2026-10-21' }, { actor: LOCAL_ADMIN });
  const [entry] = storage.read().harnessAudit;
  assert.deepEqual(Object.keys(entry).sort(), ['actor', 'approvalId', 'at', 'id', 'ok', 'tool']);
  assert.equal(entry.tool, 'demo_read');
  assert.equal(entry.ok, true);
  assert.equal(entry.approvalId, null);
  assert.deepEqual(entry.actor, { subject: 'local-operator', role: 'admin', workspaceId: 'local' });
  assert.ok(Number.isFinite(Date.parse(entry.at)));
  assert.match(entry.id, /^[0-9a-f-]{36}$/);
  assert.equal('errorCode' in entry, false);

  await assert.rejects(tools.execute('demo_read', { asOf: 'not-a-date' }, { actor: LOCAL_ADMIN }), invalidArgs(/must match/));
  const failed = storage.read().harnessAudit.at(-1);
  assert.equal(failed.ok, false);
  assert.equal(failed.errorCode, ERROR.toolInvalid);
  assert.equal(failed.tool, 'demo_read');

  await assert.rejects(tools.execute('no_such_tool', {}, {}), harnessError(ERROR.toolRefused));
  const unknown = storage.read().harnessAudit.at(-1);
  assert.equal(unknown.tool, 'no_such_tool');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.errorCode, ERROR.toolRefused);
});

test('audit is capped at 1000 entries and keeps the most recent', async t => {
  const storage = await newStorage(t);
  const tools = createTools({ storage });
  tools.register(readOnlyTool());
  await storage.update(state => {
    state.harnessAudit = Array.from({ length: MAX_AUDIT_ENTRIES }, (_, index) => ({ id: `seed-${index}` }));
  });
  await tools.execute('demo_read', {}, {});
  const entries = storage.read().harnessAudit;
  assert.equal(MAX_AUDIT_ENTRIES, 1000);
  assert.equal(entries.length, MAX_AUDIT_ENTRIES);
  assert.equal(entries[0].id, 'seed-1');
  assert.equal(entries.at(-1).tool, 'demo_read');
});

test('missing storage skips auditing; audit failures never change the tool outcome', async t => {
  const noStorage = createTools();
  noStorage.register(readOnlyTool());
  assert.deepEqual(await noStorage.execute('demo_read', {}, {}), { asOf: null, actor: null });

  const brokenStorage = { update: () => Promise.reject(new Error('disk is gone')) };
  const tools = createTools({ storage: brokenStorage });
  tools.register(readOnlyTool());
  assert.deepEqual(await tools.execute('demo_read', { asOf: '2026-01-01' }, { actor: ACTOR_A }), {
    asOf: '2026-01-01',
    actor: 'actor-a',
  });

  const storage = await newStorage(t);
  const disposed = createTools({ storage });
  disposed.register(readOnlyTool());
  await storage.close();
  assert.deepEqual(await disposed.execute('demo_read', {}, {}), { asOf: null, actor: null }, 'closed audit store is skipped');
});

test('apply(ctx) mounts ctx.tools and resolves ctx.storage/ctx.approval lazily', async t => {
  const directory = await makeTempDirectory('seams-tools-provider');
  removeDirectory(t, directory);
  const clock = fakeClock();
  const ctx = {};
  const disposeStorage = await createStorageProvider({ directory }).apply(ctx, { directory });
  const disposeApproval = await createApprovalProvider({ clock }).apply(ctx, {});
  const disposeTools = await createToolsProvider({ clock }).apply(ctx, {});
  t.after(async () => {
    await disposeTools();
    await disposeApproval();
    await disposeStorage();
  });

  const captured = [];
  ctx.tools.register(
    writeTool({
      handler: async (args, execution) => {
        captured.push(execution);
        return { value: args.value };
      },
    }),
  );
  await assert.rejects(ctx.tools.execute('demo_write', { value: 'x' }, { actor: ACTOR_A }), harnessError(ERROR.approvalRequired));
  const { id } = ctx.approval.request({ actor: ACTOR_A, tool: 'demo_write' });
  ctx.approval.decide(id, 'approve', ACTOR_A);
  assert.deepEqual(await ctx.tools.execute('demo_write', { value: 'x', approvalId: id }, { actor: ACTOR_A }), { value: 'x' });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].ctx, ctx);
  assert.equal(captured[0].storage, ctx.storage);
  assert.equal(captured[0].approval, ctx.approval);
  assert.equal(captured[0].tools, ctx.tools);
  const audit = ctx.storage.read().harnessAudit;
  assert.equal(audit.length, 2, 'the refused attempt and the executed call are both audited');
  const entry = audit.at(-1);
  assert.equal(entry.tool, 'demo_write');
  assert.equal(entry.approvalId, id);
  assert.equal(entry.ok, true);
});
