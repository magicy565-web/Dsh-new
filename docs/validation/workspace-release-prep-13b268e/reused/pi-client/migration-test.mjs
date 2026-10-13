import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { createApp as oldApp } from './server/index.mjs';
import { createPiProvider as oldPi } from './server/pi-provider.mjs';
import { createApp as newApp } from '/workspace/workspace-release-20261013/server/index.mjs';
import { createPiProvider as newPi } from '/workspace/workspace-release-20261013/server/pi-provider.mjs';

const evidenceRoot = '/tmp/workspace-launch-20261013/baseline49d5360/pi-client';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 500; i++) { if (await check()) return; await pause(10); } throw Error('Migration fixture did not settle'); }
function setup() {
  const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
  return { faux, factory: (constructor, extra = {}) => constructor({ models, providerId: 'faux', model: 'faux-1', ...extra }) };
}

test('exact PR59 32c8ce9 pending V4 disk checkpoint blocks changed endpoint and recovers on new 49d5360 with original identity', async () => {
  const { faux, factory } = setup();
  const directory = await fs.mkdtemp(path.join(evidenceRoot, 'pr59-pending-checkpoint-'));
  const oldProvider = factory(oldPi), newProvider = factory(newPi);
  assert.equal(newProvider.legacyPolicyCompatible, true);
  assert.equal(oldProvider.permissionFingerprint, newProvider.permissionFingerprint);
  assert.notEqual(newProvider.agentPermissionFingerprint, oldProvider.permissionFingerprint);
  faux.setResponses([async (_request, options) => {
    await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
    return fauxAssistantMessage('', { stopReason: 'aborted' });
  }]);
  let app;
  try {
    app = await oldApp({ dataDirectory: directory, provider: oldProvider });
    const conversation = (await app.runtime.createConversation({})).conversation;
    const result = await app.runtime.sendMessage(conversation.id, { content: 'Exact old-source checkpoint fixture', requestId: 'pr59-old-source-request' });
    await until(() => app.runtime.getRun(result.run.id).run.piSubmissionId && faux.state.callCount === 1);
    const before = app.runtime.getRun(result.run.id).run;
    assert.deepEqual(Object.keys(before.execution).sort(), ['kind', 'model', 'permissionFingerprint']);
    await app.close(); app = undefined;
    const changedProvider = factory(newPi, { baseUrl: 'https://changed-endpoint.example/v1' });
    app = await newApp({ dataDirectory: directory, provider: changedProvider });
    assert.equal(app.runtime.getRun(before.id).run.status, 'interrupted');
    await assert.rejects(app.runtime.recoverPiRun(before.id, { requestId: 'deny-new-endpoint' }), { code: 'EXECUTION_SCOPE_CHANGED' });
    assert.equal(faux.state.callCount, 1);
    await app.close(); app = undefined;
    app = await newApp({ dataDirectory: directory, provider: newProvider });
    await pause(50);
    assert.equal(faux.state.callCount, 1, 'New boot must not automatically replay the old checkpoint');
    faux.setResponses([fauxAssistantMessage('Resumed exact PR59 pending checkpoint')]);
    const recovered = await app.runtime.retryRun(before.id, { requestId: 'explicit-new-source-recovery' });
    assert.equal(recovered.recovered, true);
    await until(() => app.runtime.getRun(before.id).run.status !== 'running');
    const after = app.runtime.getRun(before.id).run;
    assert.equal(after.status, 'succeeded', JSON.stringify(after.error));
    for (const field of ['id', 'assistantId', 'piSubmissionId', 'piRequestId', 'reservedOutputTokens', 'executionHash']) assert.equal(after[field], before[field], field);
    assert.equal(app.runtime.listRuns().runs.length, 1);
    assert.equal(app.runtime.bootstrap().messages.filter(item => item.role === 'user').length, 1);
    assert.equal(faux.state.callCount, 2);
    console.log(JSON.stringify({ oldSource: '32c8ce98fe28cda1e22a16bf0d1088c768e081c8', newSource: '49d536007b18fa9f877ffcfe6280e28f2384c7d2', directory, runId: before.id, assistantId: before.assistantId, piSubmissionId: before.piSubmissionId, executionHash: before.executionHash, oldV4Fingerprint: oldProvider.permissionFingerprint, newAgentV5Fingerprint: newProvider.agentPermissionFingerprint, actualSdkDispatches: faux.state.callCount, changedEndpointRejected: true, automaticReplay: false }));
  } finally { await app?.close(); }
});

test('exact PR59 completed disk checkpoint stays deduplicated on new source with zero further SDK dispatches', async () => {
  const { faux, factory } = setup();
  const directory = await fs.mkdtemp(path.join(evidenceRoot, 'pr59-completed-checkpoint-'));
  faux.setResponses([fauxAssistantMessage('Saved old-source result')]);
  let app;
  try {
    app = await oldApp({ dataDirectory: directory, provider: factory(oldPi) });
    const conversation = (await app.runtime.createConversation({})).conversation;
    const request = { content: 'Exact old-source completed fixture', requestId: 'pr59-completed-source-request' };
    const admitted = await app.runtime.sendMessage(conversation.id, request);
    await until(() => app.runtime.getRun(admitted.run.id).run.status === 'succeeded');
    const before = app.runtime.getRun(admitted.run.id).run;
    await app.close(); app = undefined;
    app = await newApp({ dataDirectory: directory, provider: factory(newPi) });
    const repeated = await app.runtime.sendMessage(conversation.id, request);
    assert.equal(repeated.duplicate, true);
    assert.equal(repeated.run.id, before.id);
    assert.equal(app.runtime.getRun(before.id).run.piSubmissionId, before.piSubmissionId);
    assert.equal(faux.state.callCount, 1);
    assert.equal(app.runtime.listRuns().runs.length, 1);
    console.log(JSON.stringify({ directory, runId: before.id, piSubmissionId: before.piSubmissionId, actualSdkDispatches: faux.state.callCount, duplicate: true }));
  } finally { await app?.close(); }
});
