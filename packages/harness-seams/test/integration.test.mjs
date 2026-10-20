// Cross-package integration: mount the three seam providers on the real kernel.
//
// The kernel resolves `@workspace-harness/seams/<name>` per CONTRACT.md §2 rule 1,
// mounts the providers through Cordis in composition order, and the seams must
// then be usable from the kernel context exactly as the frozen contract states.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from '../../harness-kernel/src/app.mjs';
import { ERROR } from '../../harness-contracts/src/index.mjs';
import { harnessError, makeTempDirectory, removeDirectory } from './helpers.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SILENT_LOGGER = Object.freeze({ error() {}, warn() {}, info() {}, debug() {} });
const ACTOR = Object.freeze({ subject: 'local-operator', role: 'admin', workspaceId: 'local' });

const compositionFor = dataDirectory =>
  [
    'version: 1',
    'name: seams-integration',
    'server: { host: 127.0.0.1, port: 0 }',
    'plugins:',
    '  - id: storage',
    '    name: "@workspace-harness/seams/storage"',
    `    config: { directory: ${JSON.stringify(dataDirectory)} }`,
    '  - id: approval',
    '    name: "@workspace-harness/seams/approval"',
    '  - id: tools',
    '    name: "@workspace-harness/seams/tools"',
    '',
  ].join('\n');

test('the kernel mounts storage, approval and tools as one working harness', async t => {
  const directory = await makeTempDirectory('seams-integration');
  removeDirectory(t, directory);
  const dataDirectory = path.join(directory, 'data');
  const compositionPath = path.join(directory, 'seams.composition.yml');
  await fs.writeFile(compositionPath, compositionFor(dataDirectory), 'utf8');

  const harness = await createHarness({ compositionPath, root: REPO_ROOT, logger: SILENT_LOGGER });
  let stopped = false;
  try {
    assert.deepEqual([...harness.plugins.keys()], ['storage', 'approval', 'tools']);
    const { ctx } = harness;
    assert.equal(typeof ctx.storage.read, 'function');
    assert.equal(typeof ctx.storage.update, 'function');
    assert.equal(typeof ctx.approval.request, 'function');
    assert.equal(typeof ctx.tools.register, 'function');
    assert.equal(ctx.storage.directory, await fs.realpath(dataDirectory));

    ctx.tools.register({
      name: 'integration_read',
      description: 'read during integration',
      approval: 'never',
      readOnly: true,
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      handler: async (args, execution) => ({ ok: true, actor: execution.actor.subject }),
    });
    assert.deepEqual(await ctx.tools.execute('integration_read', {}, { actor: ACTOR }), {
      ok: true,
      actor: 'local-operator',
    });
    const readAudit = ctx.storage.read().harnessAudit;
    assert.equal(readAudit.length, 1);
    assert.equal(readAudit[0].tool, 'integration_read');
    assert.equal(readAudit[0].ok, true);

    ctx.tools.register({
      name: 'integration_write',
      description: 'approval-gated write during integration',
      approval: 'always',
      parameters: { type: 'object', required: ['value'], properties: { value: { type: 'string' } } },
      handler: async (args, execution) => ({ value: args.value, by: execution.actor.subject }),
    });
    await assert.rejects(
      ctx.tools.execute('integration_write', { value: 'first' }, { actor: ACTOR }),
      harnessError(ERROR.approvalRequired),
    );
    const { id } = ctx.approval.request({ actor: ACTOR, tool: 'integration_write' });
    assert.equal(ctx.approval.decide(id, 'approve', ACTOR).status, 'approved');
    assert.deepEqual(await ctx.tools.execute('integration_write', { value: 'first', approvalId: id }, { actor: ACTOR }), {
      value: 'first',
      by: 'local-operator',
    });
    await assert.rejects(
      ctx.tools.execute('integration_write', { value: 'second', approvalId: id }, { actor: ACTOR }),
      harnessError(ERROR.approvalRequired),
      'the ticket is one-shot across the kernel mount',
    );

    assert.deepEqual(harness.healthz(), {
      status: 'ok',
      plugins: [
        { id: 'storage', status: 'ok' },
        { id: 'approval', status: 'ok' },
        { id: 'tools', status: 'ok' },
      ],
      checks: [],
    });

    const storageService = ctx.storage;
    await harness.stop();
    stopped = true;
    await assert.rejects(storageService.update(() => {}), /closed/i, 'kernel dispose closed the durable store');
  } finally {
    if (!stopped) await harness.stop();
  }

  // A fresh harness over the same composition sees the persisted audit history.
  const restarted = await createHarness({ compositionPath, root: REPO_ROOT, logger: SILENT_LOGGER });
  try {
    const audit = restarted.ctx.storage.read().harnessAudit;
    assert.ok(audit.length >= 3, `expected the earlier audit entries to persist, got ${audit.length}`);
    assert.equal(audit[0].tool, 'integration_read');
    assert.equal(audit.filter(entry => entry.ok).length, 2);
  } finally {
    await restarted.stop();
  }
});
