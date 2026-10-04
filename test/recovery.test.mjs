import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/index.mjs';
import { createBackup, verifyBackup, restoreBackup } from '../scripts/recovery.mjs';
async function fixture(t) { const root = await fs.mkdtemp(path.join(tmpdir(), 'workspace-recovery-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return { root, data: path.join(root, 'data'), backup: path.join(root, 'backup'), restored: path.join(root, 'restored') }; }
test('offline backup verifies every byte; recovery pauses work and revokes approvals before restart', async t => {
  const f = await fixture(t); let app = await createApp({ dataDirectory: f.data });
  const { artifact } = await app.artifacts.create({ filename: 'evidence.txt', content: 'Recovery fixture bytes' });
  await assert.rejects(createBackup(f.data, f.backup), /already open/);
  await app.close();
  const synthetic = JSON.parse(await fs.readFile(path.join(f.data, 'workspace.json'), 'utf8'));
  ((state) => { state.conversations.push({ id: 'c', title: 'Fixture', status: 'running' }); state.messages.push({ id: 'm', conversationId: 'c', status: 'pending', content: 'Fixture' }); state.runs.push({ id: 'r', status: 'queued' }); state.goals.push({ id: 'g', status: 'running' }); state.capabilities.schedules.push({ id: 's', enabled: true, revision: 1, consent: { fixture: true } }); state.capabilities.approvals.push({ id: 'a', status: 'approved' }); })(synthetic);
  await fs.writeFile(path.join(f.data, 'workspace.json'), JSON.stringify(synthetic));
  const before = await fs.readFile(path.join(f.data, 'workspace.json'));
  const backup = await createBackup(f.data, f.backup); assert.equal(backup.verified, true);
  assert.deepEqual(await fs.readFile(path.join(f.backup, 'workspace.json')), before);
  const result = await restoreBackup(f.backup, f.restored); assert.equal(result.queuedWorkResumed, false);
  const restored = JSON.parse(await fs.readFile(path.join(f.restored, 'workspace.json'), 'utf8'));
  assert.equal(restored.runs[0].status, 'interrupted'); assert.equal(restored.goals[0].status, 'paused'); assert.equal(restored.messages[0].status, 'blocked'); assert.equal(restored.capabilities.schedules[0].enabled, false); assert.equal(restored.capabilities.approvals[0].status, 'denied');
  // Remove minimal synthetic capability entries before exercising service validators.
  restored.capabilities.schedules = []; restored.capabilities.approvals = []; restored.goals = []; restored.runs = []; restored.messages = []; restored.conversations = [];
  await fs.writeFile(path.join(f.restored, 'workspace.json'), JSON.stringify(restored));
  app = await createApp({ dataDirectory: f.restored });
  assert.equal((await app.artifacts.download(artifact.id)).bytes.toString(), 'Recovery fixture bytes'); await app.close();
  assert.deepEqual(await fs.readFile(path.join(f.data, 'workspace.json')), before);
  await assert.rejects(restoreBackup(f.backup, f.data), /already exists/);
});
test('backup and restore reject unsafe/unlisted/tampered files and existing destinations', async t => {
  const f = await fixture(t), app = await createApp({ dataDirectory: f.data }); await app.close();
  await fs.writeFile(path.join(f.data, 'unexpected.key'), 'not copied'); await assert.rejects(createBackup(f.data, f.backup), /Unrecognized/); await fs.unlink(path.join(f.data, 'unexpected.key'));
  await fs.symlink(path.join(f.data, 'workspace.json'), path.join(f.data, 'linked')); await assert.rejects(createBackup(f.data, f.backup), /symbolic/); await fs.unlink(path.join(f.data, 'linked'));
  await createBackup(f.data, f.backup); await assert.rejects(createBackup(f.data, f.backup), /already exists/);
  await fs.writeFile(path.join(f.backup, 'extra'), 'no'); await assert.rejects(verifyBackup(f.backup), /unlisted/); await fs.unlink(path.join(f.backup, 'extra'));
  await fs.appendFile(path.join(f.backup, 'workspace.json'), ' '); await assert.rejects(restoreBackup(f.backup, f.restored), /integrity/); await assert.rejects(fs.stat(f.restored), { code: 'ENOENT' });
});
test('backup requires all registered artifact bytes and refuses nested backup destinations', async t => {
  const f = await fixture(t), app = await createApp({ dataDirectory: f.data }); await app.artifacts.create({ filename: 'fixture.txt', content: 'Bytes' }); await app.close();
  await assert.rejects(createBackup(f.data, path.join(f.data, 'snapshot')), /outside/);
  const blob = (await fs.readdir(path.join(f.data, 'artifacts'))).find(name => name.endsWith('.blob')); await fs.unlink(path.join(f.data, 'artifacts', blob));
  await assert.rejects(createBackup(f.data, f.backup), /missing or inconsistent/);
});

test('real HTTP crash-shaped snapshot restores complete records without replay, retains versions and supports explicit new work', async t => {
  const f = await fixture(t); let calls = 0;
  const provider = { configured: true, complete: async ({ signal }) => { calls++; return new Promise((resolve, reject) => { const stop = () => reject(new Error('Fixture abort')); if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true }); }); } };
  let app = await createApp({ dataDirectory: f.data, provider, maxConcurrentRuns: 1 }); let address = await app.listen(0); let base = `http://127.0.0.1:${address.port}`;
  const api = async (route, method = 'GET', body) => { const res = await fetch(`${base}/api${route}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); const data = await res.json(); assert.ok(res.ok, JSON.stringify(data)); return data; };
  try {
    const { conversation } = await api('/conversations', 'POST', { title: 'Recovery chat' });
    const { goal } = await api('/goals', 'POST', { title: 'Recovery bounded goal', maxSteps: 2 });
    const { memory } = await api('/memories', 'POST', { content: 'Scoped recovery fixture', enabled: false, conversationId: conversation.id });
    const { artifact } = await api('/artifacts', 'POST', { filename: 'versioned.txt', content: 'Version one', sourceConversationId: conversation.id });
    await api(`/artifacts/${artifact.id}`, 'PATCH', { content: 'Version two', expectedRevision: artifact.revision });
    await api('/skills', 'POST', { name: 'Recovery skill', instructions: 'Fixture instruction', requestId: 'recovery-skill' });
    const { connector } = await api('/connectors', 'POST', { name: 'Unconfigured recovery connector', adapter: 'no-live-adapter', capabilities: ['read'], requestId: 'recovery-connector' });
    const { schedule } = await api('/schedules', 'POST', { title: 'Never-due recovery fixture', goalId: goal.id, kind: 'at', scheduledAt: '2099-01-01T00:00:00Z', requestId: 'recovery-schedule' });
    const { approval } = await api(`/schedules/${schedule.id}/approval`, 'POST', {});
    await api(`/approvals/${approval.id}/decision`, 'POST', { decision: 'approved', confirmed: true });
    await api(`/schedules/${schedule.id}/enable`, 'POST', { approvalId: approval.id });
    const pending = await api(`/connectors/${connector.id}/approval`, 'POST', { action: 'read', resource: 'fixture-only', payload: {} });
    await api(`/approvals/${pending.approval.id}/decision`, 'POST', { decision: 'approved', confirmed: true });
    const running = await api(`/conversations/${conversation.id}/messages`, 'POST', { content: 'Held local fixture request', requestId: 'recovery-running' });
    await api(`/goals/${goal.id}`, 'PATCH', { action: 'start', queued: true, requestId: 'recovery-queued-goal' });
    const snapshot = app.store.read(); assert.equal(snapshot.runs.find(run => run.id === running.run.id).status, 'running'); assert.ok(snapshot.runs.some(run => run.kind === 'goal' && run.status === 'queued')); assert.equal(calls, 1);
    // Capture fully valid durable in-flight records, then stop all fixture executors.
    // Replacing the stopped fixture with that captured state simulates crash recovery;
    // no live process or production workspace is modified.
    await app.close(); app = null; await fs.writeFile(path.join(f.data, 'workspace.json'), JSON.stringify(snapshot));
    await createBackup(f.data, f.backup); await restoreBackup(f.backup, f.restored);
    let unexpectedCalls = 0;
    const restoredProvider = { configured: true, complete: async () => { unexpectedCalls++; return { content: 'Explicit new recovery request succeeded', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }; } };
    app = await createApp({ dataDirectory: f.restored, provider: restoredProvider, maxConcurrentRuns: 1 }); address = await app.listen(0); base = `http://127.0.0.1:${address.port}`;
    await new Promise(resolve => setTimeout(resolve, 75));
    const state = await api('/bootstrap'); assert.equal(unexpectedCalls, 0); assert.ok(state.runs.every(run => run.status === 'interrupted'));
    assert.equal(state.goals[0].status, 'paused'); assert.equal(state.goals[0].runId, null); assert.equal(state.capabilities.schedules[0].enabled, false); assert.equal(state.capabilities.schedules[0].consent, null);
    assert.equal(state.capabilities.approvals.find(item => item.id === pending.approval.id).status, 'denied'); assert.equal(state.memories.find(item => item.id === memory.id).enabled, false);
    assert.equal((await api(`/artifacts/${artifact.id}/content?version=1`)).content, 'Version one'); assert.equal((await api(`/artifacts/${artifact.id}/content`)).content, 'Version two');
    const next = await api(`/conversations/${conversation.id}/messages`, 'POST', { content: 'Explicit new attempt after review', requestId: 'recovery-reviewed-new-request' });
    for (let i = 0; i < 100; i++) { if ((await api(`/runs/${next.run.id}`)).run.status === 'succeeded') break; await new Promise(resolve => setTimeout(resolve, 5)); }
    assert.equal((await api(`/runs/${next.run.id}`)).run.status, 'succeeded'); assert.equal(unexpectedCalls, 1);
  } finally { await app?.close(); }
});
