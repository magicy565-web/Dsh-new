import test from 'node:test';
import assert from 'node:assert/strict';
import { createTools } from '../src/tools.mjs';

const readOnlyTool = name => ({
  name, description: `fixture ${name}`, parameters: { type: 'object', properties: {}, additionalProperties: false },
  approval: 'never', readOnly: true, handler: async () => ({ ok: name }),
});

test('allowedTools hides and refuses every other registered tool', async t => {
  const tools = createTools({ allowedTools: ['alpha'] });
  tools.register(readOnlyTool('alpha'));
  tools.register(readOnlyTool('beta'));
  assert.deepEqual(tools.list().map(tool => tool.name), ['alpha']);
  assert.deepEqual(await tools.execute('alpha', {}, {}), { ok: 'alpha' });
  await assert.rejects(tools.execute('beta', {}, {}), error => error.code === 'HARNESS_TOOL_REFUSED' && error.details.tool === 'beta');
});

test('deniedTools wins over the default and over allowedTools entries', async t => {
  const tools = createTools({ deniedTools: ['beta'] });
  tools.register(readOnlyTool('alpha'));
  tools.register(readOnlyTool('beta'));
  assert.deepEqual(tools.list().map(tool => tool.name), ['alpha']);
  await assert.rejects(tools.execute('beta', {}, {}), error => error.code === 'HARNESS_TOOL_REFUSED');
  assert.throws(() => createTools({ allowedTools: ['alpha'], deniedTools: ['alpha'] }), /must not overlap/u);
  assert.throws(() => createTools({ allowedTools: 'alpha' }), /allowedTools/u);
});

test('a refused call is audited with its error code', async t => {
  const updates = [];
  const storage = {
    read: () => ({ artifacts: [], harnessAudit: [] }),
    update: async callback => { const snapshot = { artifacts: [], harnessAudit: [] }; const result = callback(snapshot); updates.push(structuredClone(snapshot)); return result; },
  };
  const tools = createTools({ storage, deniedTools: ['beta'] });
  tools.register(readOnlyTool('alpha'));
  tools.register(readOnlyTool('beta'));
  await assert.rejects(tools.execute('beta', {}, { actor: { subject: 'op', role: 'admin' } }), /not enabled/u);
  const audit = updates.flatMap(snapshot => snapshot.harnessAudit ?? []);
  assert.equal(audit.at(-1).tool, 'beta');
  assert.equal(audit.at(-1).ok, false);
  assert.equal(audit.at(-1).errorCode, 'HARNESS_TOOL_REFUSED');
});

test('an empty allowedTools list means unrestricted; presets inject non-empty lists only', async t => {
  const unrestricted = createTools({ allowedTools: [] });
  unrestricted.register(readOnlyTool('alpha'));
  unrestricted.register(readOnlyTool('beta'));
  assert.deepEqual(unrestricted.list().map(tool => tool.name).sort(), ['alpha', 'beta']);
  const restricted = createTools({ allowedTools: ['alpha'], deniedTools: [] });
  restricted.register(readOnlyTool('alpha'));
  restricted.register(readOnlyTool('beta'));
  assert.deepEqual(restricted.list().map(tool => tool.name), ['alpha']);
});
