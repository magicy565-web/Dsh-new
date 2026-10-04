import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../server/index.mjs';

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(check) { for (let count = 0; count < 400; count++) { const result = await check(); if (result) return result; await sleep(5); } throw new Error('API fixture timed out'); }
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-http-v2-'));
  const app = await createApp({ dataDirectory: directory, schedulerIntervalMs: 50, ...options });
  const address = await app.listen(0);
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  async function api(route, method = 'GET', body, headers = {}) { const response = await fetch(`${base}${route}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, data: await response.json() }; }
  return { directory, app, base, api };
}

test('HTTP v2: loopback origins on another port are rejected; exact origin is accepted', async t => {
  const { api, base } = await fixture(t);
  assert.equal((await api('/api/conversations', 'POST', {}, { Origin: 'http://127.0.0.1:1' })).status, 403);
  assert.equal((await api('/api/conversations', 'POST', {}, { Origin: base })).status, 201);
  assert.equal((await api('/api/conversations', 'POST', {}, { Origin: base.replace('http:', 'https:') })).status, 403);
  assert.equal((await api('/api/bootstrap', 'GET', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
});

test('HTTP v2: SSE gives durable invalidation cursors without private event payloads and closes cleanly', async t => {
  const { app, base, api } = await fixture(t);
  const controller = new AbortController();
  const response = await fetch(`${base}/api/events`, { signal: controller.signal });
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  const initial = new TextDecoder().decode((await reader.read()).value);
  assert.match(initial, /id: \d+/); assert.match(initial, /event: change/);
  await api('/api/conversations', 'POST', { title: 'PRIVATE_TITLE_NOT_IN_SSE' });
  const changed = new TextDecoder().decode((await reader.read()).value);
  assert.match(changed, /sequence/); assert.doesNotMatch(changed, /PRIVATE_TITLE/);
  controller.abort(); await reader.cancel().catch(() => {});
  await app.close();
});

test('HTTP v2: artifact upload, metadata, version update and attachment download use real private bytes', async t => {
  const { api, base } = await fixture(t);
  const created = await api('/api/artifacts', 'POST', { filename: 'memo.txt', content: 'Local artifact fixture', mimeType: 'text/plain' });
  assert.equal(created.status, 201);
  const id = created.data.artifact.id;
  const listed = await api('/api/artifacts'); assert.equal(listed.data.artifacts[0].id, id);
  const changed = await api(`/api/artifacts/${id}`, 'PATCH', { content: 'Version two fixture' }); assert.equal(changed.status, 200);
  const download = await fetch(`${base}/api/artifacts/${id}/download`);
  assert.equal(download.status, 200); assert.match(download.headers.get('content-disposition'), /attachment/);
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff'); assert.equal(await download.text(), 'Version two fixture');
  assert.equal((await api('/api/artifacts', 'POST', { filename: '../../outside.txt', content: 'bad' })).status, 400);
  assert.equal((await api(`/api/artifacts/${id}`, 'DELETE')).status, 200);
  assert.equal((await api(`/api/artifacts/${id}`)).status, 404);
});

test('HTTP v2: search and singular resources use actual saved data without fabricated rows', async t => {
  const { api } = await fixture(t);
  const { data: { goal } } = await api('/api/goals', 'POST', { title: 'Findable fixture' });
  assert.equal((await api(`/api/goals/${goal.id}`)).data.goal.id, goal.id);
  const found = await api('/api/search?q=Findable'); assert.ok(found.data.results.some(item => item.id === goal.id));
  assert.deepEqual((await api('/api/search?q=nonexistent')).data.results, []);
  assert.equal((await api('/api/search?q=')).status, 400);
  assert.equal((await api('/api/events?after=bad')).status, 400);
});

test('HTTP v2: skill registry reaches context only after activation and explicit selection', async t => {
  let request;
  const { api } = await fixture(t, { provider: { configured: true, complete: async input => { request = input; return { content: 'Fixture reply' }; } } });
  const { data: { skill } } = await api('/api/skills', 'POST', { name: 'Fixture style', instructions: 'LOCAL_SKILL_SENT' });
  assert.equal(skill.enabled, false);
  assert.equal((await api('/api/skills')).data.skills.length, 1);
  const enabled = (await api(`/api/skills/${skill.id}`, 'PATCH', { enabled: true })).data.skill;
  const { data: { conversation } } = await api('/api/conversations', 'POST', {});
  await api(`/api/conversations/${conversation.id}/messages`, 'POST', { content: 'Hello', inputContext: { skills: [{ id: skill.id, revision: enabled.revision }] } });
  await until(() => request); assert.match(JSON.stringify(request.messages), /LOCAL_SKILL_SENT/);
});

test('HTTP v2: connector without installed adapter returns blocked and never invents connection success', async t => {
  const { api } = await fixture(t);
  const created = await api('/api/connectors', 'POST', { name: 'Not installed', adapter: 'uninstalled', capabilities: ['read'] });
  assert.equal(created.status, 201); const id = created.data.connector.id;
  await api(`/api/connectors/${id}`, 'PATCH', { enabled: true });
  const result = await api(`/api/connectors/${id}/execute`, 'POST', { action: 'read', resource: 'fixture:document' });
  assert.equal(result.data.execution.status, 'blocked'); assert.equal(result.data.execution.error.code, 'ADAPTER_MISSING');
  const list = (await api('/api/connectors')).data.connectors;
  assert.equal(list[0].connectionVerified, false);
  assert.equal((await api('/api/connectors', 'POST', { name: 'bad', adapter: 'uninstalled', capabilities: ['read'], credentialRefs: { apiKey: 'raw-secret-value' } })).status, 400);
});

test('HTTP v2: exact connector approvals reject tampering, absent consent and replay before a fixture adapter executes', async t => {
  let calls = 0;
  const { api } = await fixture(t, { connectorAdapters: { fixture: { capabilities: ['read'], execute: async input => { calls++; return { text: input.payload.query }; } } } });
  const { data: { connector } } = await api('/api/connectors', 'POST', { name: 'Fixture connector', adapter: 'fixture', capabilities: ['read'] });
  await api(`/api/connectors/${connector.id}`, 'PATCH', { enabled: true });
  const execution = { action: 'read', resource: 'fixture:document', payload: { query: 'approved fixture' } };
  assert.equal((await api(`/api/connectors/${connector.id}/execute`, 'POST', execution)).status, 403);
  const { data: { approval } } = await api(`/api/connectors/${connector.id}/approval`, 'POST', execution);
  assert.equal(approval.status, 'pending');
  await api(`/api/approvals/${approval.id}/decision`, 'POST', { decision: 'approved', confirmed: true });
  assert.equal((await api(`/api/connectors/${connector.id}/execute`, 'POST', { ...execution, resource: 'fixture:other', approvalId: approval.id })).status, 403);
  const result = await api(`/api/connectors/${connector.id}/execute`, 'POST', { ...execution, approvalId: approval.id });
  assert.equal(result.data.execution.status, 'succeeded'); assert.equal(calls, 1);
  assert.equal((await api(`/api/connectors/${connector.id}/execute`, 'POST', { ...execution, approvalId: approval.id })).status, 409);
  assert.equal((await api('/api/connector-runs')).data.runs.length, 1);
});

test('HTTP v2: opt-in local one-shot schedule persists approval and enqueues one bounded fixture goal', async t => {
  let calls = 0;
  const { api } = await fixture(t, { provider: { configured: true, complete: async () => { calls++; return { content: JSON.stringify({ done: true, content: 'Scheduled fixture output' }) }; } } });
  const { data: { goal } } = await api('/api/goals', 'POST', { title: 'Fixture scheduled goal' });
  const { data: { schedule } } = await api('/api/schedules', 'POST', { title: 'Fixture schedule', goalId: goal.id, kind: 'at', scheduledAt: new Date(Date.now() + 200).toISOString() });
  assert.equal(schedule.enabled, false);
  assert.equal((await api(`/api/schedules/${schedule.id}/enable`, 'POST', {})).status, 403);
  const { data: { approval } } = await api(`/api/schedules/${schedule.id}/approval`, 'POST', {});
  await api(`/api/approvals/${approval.id}/decision`, 'POST', { decision: 'approved', confirmed: true });
  assert.equal((await api(`/api/schedules/${schedule.id}/enable`, 'POST', { approvalId: approval.id })).status, 200);
  await until(async () => (await api(`/api/goals/${goal.id}`)).data.goal.status === 'review_required');
  await sleep(100); assert.equal(calls, 1);
  assert.equal((await api('/api/schedule-runs')).data.runs[0].status, 'queued');
});

test('HTTP v2: static symlinks cannot expose files outside dist', async t => {
  const staticDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-static-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-outside-'));
  t.after(async () => { await fs.rm(staticDirectory, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }); });
  await fs.writeFile(path.join(outside, 'private.txt'), 'PRIVATE'); await fs.symlink(path.join(outside, 'private.txt'), path.join(staticDirectory, 'leak.txt'));
  const { base } = await fixture(t, { staticDirectory });
  const result = await fetch(`${base}/leak.txt`); assert.equal(result.status, 403); assert.doesNotMatch(await result.text(), /PRIVATE/);
});

test('HTTP v2: invalid construction options do not leak writer locks', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-options-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await assert.rejects(createApp({ dataDirectory: directory, allowedOrigins: ['https://external.example'] }));
  await assert.rejects(createApp({ dataDirectory: directory, schedulerIntervalMs: 1 }));
  const valid = await createApp({ dataDirectory: directory }); await valid.close();
});


test('HTTP v2: idle scheduler does not rewrite state or advance event sequence', async t => {
  const { app } = await fixture(t);
  await sleep(100);
  const before = app.store.read().meta.sequence;
  await sleep(160);
  assert.equal(app.store.read().meta.sequence, before);
});

test('HTTP integration: goal change between schedule claim and admission is rejected atomically', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-schedule-race-')); let calls = 0;
  const app = await createApp({ dataDirectory: directory, provider: { configured: true, complete: async () => { calls++; return { content: JSON.stringify({ done: true, content: 'MUST NOT EXECUTE' }) }; } } });
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const { goal } = await app.runtime.createGoal({ title: 'Approved title' });
  const { schedule } = await app.capabilities.createSchedule({ title: 'Race fixture', goalId: goal.id, kind: 'at', scheduledAt: new Date(Date.now() + 150).toISOString() });
  const { approval } = await app.capabilities.requestApproval(app.capabilities.scheduleApprovalRequest(schedule.id));
  await app.capabilities.decideApproval(approval.id, { decision: 'approved', confirmed: true }); await app.capabilities.enableSchedule(schedule.id, { approvalId: approval.id });
  const update = app.store.update.bind(app.store); let changed = false;
  app.store.update = callback => update(callback).then(async result => {
    if (!changed && Array.isArray(result) && result[0]?.status === 'dispatching') { changed = true; await app.runtime.updateGoal(goal.id, { title: 'Unapproved changed title' }); }
    return result;
  });
  await sleep(160); await app.capabilities.tick();
  assert.equal(changed, true); assert.equal(calls, 0); assert.equal(app.runtime.bootstrap().goals[0].status, 'draft');
  assert.equal(app.capabilities.listSchedules()[0].status, 'blocked');
});

test('HTTP lifecycle: recovered queue cannot dispatch before successful bind or after a bind failure', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-bind-recovery-'));
  const first = await createApp({ dataDirectory: directory, maxConcurrentRuns: 1, provider: { configured: true, complete: ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('fixture stopped')), { once: true })) } });
  const a = (await first.runtime.createConversation({})).conversation;
  const b = (await first.runtime.createConversation({})).conversation;
  await first.runtime.sendMessage(a.id, { content: 'Active fixture' }); await first.runtime.sendMessage(b.id, { content: 'Queued fixture', queued: true });
  await first.close();
  let calls = 0;
  const recovering = await createApp({ dataDirectory: directory, provider: { configured: true, complete: async () => { calls++; return { content: 'recovered fixture' }; } } });
  const occupiedDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-occupied-'));
  const occupied = await createApp({ dataDirectory: occupiedDirectory }); const address = await occupied.listen(0);
  t.after(async () => { await recovering.close(); await occupied.close(); await fs.rm(directory, { recursive: true, force: true }); await fs.rm(occupiedDirectory, { recursive: true, force: true }); });
  await sleep(40); assert.equal(calls, 0);
  await assert.rejects(recovering.listen(address.port), { code: 'EADDRINUSE' }); await sleep(40); assert.equal(calls, 0);
  await recovering.close();
});
