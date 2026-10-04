import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../server/index.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 500; i++) { const result = await check(); if (result) return result; await sleep(5); } throw new Error('Business-flow fixture timed out'); }
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-business-'));
  let app = await createApp({ dataDirectory: directory, ...options }), address = await app.listen(0);
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  async function api(route, method = 'GET', body) {
    const response = await fetch(`http://127.0.0.1:${address.port}/api${route}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json(); return { status: response.status, data };
  }
  return { api, get app() { return app; }, async restart() { await app.close(); app = await createApp({ dataDirectory: directory, ...options }); address = await app.listen(0); } };
}

test('shipped local library connector works without custom adapter injection, credentials or network', async t => {
  const { api } = await fixture(t);
  const created = await api('/connectors', 'POST', { name: 'Local Library', adapter: 'workspace-library', capabilities: ['read_file', 'create_file', 'update_file'] });
  assert.equal(created.status, 201); const connector = created.data.connector;
  assert.equal(connector.enabled, false); assert.equal(connector.adapterConfigured, true); assert.equal(connector.credentialConfigured, true);
  await api(`/connectors/${connector.id}`, 'PATCH', { enabled: true });
  const input = { action: 'create_file', resource: 'library:new', payload: { filename: 'business.txt', content: 'A persisted local result' } };
  assert.equal((await api(`/connectors/${connector.id}/execute`, 'POST', input)).status, 403);
  const pending = await api(`/connectors/${connector.id}/approval`, 'POST', input);
  const approvalId = pending.data.approval.id;
  assert.equal((await api('/artifacts')).data.artifacts.length, 0);
  await api(`/approvals/${approvalId}/decision`, 'POST', { decision: 'approved', confirmed: true });
  const result = await api(`/connectors/${connector.id}/execute`, 'POST', { ...input, approvalId });
  assert.equal(result.status, 200); assert.equal(result.data.execution.status, 'succeeded');
  const artifactId = result.data.execution.result.artifactId;
  assert.equal((await api(`/artifacts/${artifactId}/content`)).data.content, 'A persisted local result');
  assert.equal((await api(`/connectors/${connector.id}/execute`, 'POST', { ...input, approvalId })).status, 409);
  assert.equal((await api('/artifacts')).data.artifacts.length, 1);
});

// Provider outputs below are explicitly local scripted fixtures. The connector,
// approval, runtime, HTTP, persistence and output file paths are the real app.
test('one conversation goal consumes pinned inputs, waits for approval, executes real local action and saves final file', async t => {
  let connectorId, calls = 0, sourceId;
  const requests = [];
  const f = await fixture(t, { provider: { configured: true, complete: async input => {
    requests.push(input); calls++;
    assert.match(JSON.stringify(input.messages), /PINNED_VERSION_ONE/);
    assert.doesNotMatch(JSON.stringify(input.messages), /UNSELECTED_PRIVATE_NOTE|NEWER_UNSELECTED_VERSION/);
    if (calls === 1) return { content: JSON.stringify({ done: false, content: 'I can create the requested draft file after you approve this exact action.', plan: [{ id: 'read', title: 'Read pinned source', status: 'completed' }, { id: 'save', title: 'Create requested draft', status: 'in_progress' }], action: { connectorId, action: 'create_file', resource: 'library:new', payload: { filename: 'approved-draft.md', content: '# Approved draft\nBased on PINNED_VERSION_ONE' } } }), usage: { promptTokens: 80, completionTokens: 100, totalTokens: 180 } };
    assert.match(JSON.stringify(input.messages), /Verified application connector receipt/);
    assert.match(JSON.stringify(input.messages), /succeeded/);
    assert.match(JSON.stringify(input.messages), /approved-draft.md/);
    return { content: JSON.stringify({ done: true, content: 'The approved draft was saved. The review summary is ready.', plan: [{ id: 'read', title: 'Read pinned source', status: 'completed' }, { id: 'save', title: 'Create requested draft', status: 'completed' }], artifact: { filename: 'review-summary.md', content: '# Review summary\nThe approved local action returned a successful receipt.' } }), usage: { promptTokens: 100, completionTokens: 80, totalTokens: 180 } };
  } } });
  const { api } = f;
  sourceId = (await api('/artifacts', 'POST', { filename: 'source.txt', content: 'PINNED_VERSION_ONE' })).data.artifact.id;
  await api(`/artifacts/${sourceId}`, 'PATCH', { content: 'NEWER_UNSELECTED_VERSION' });
  await api('/memories', 'POST', { content: 'UNSELECTED_PRIVATE_NOTE' });
  connectorId = (await api('/connectors', 'POST', { name: 'Library', adapter: 'workspace-library', capabilities: ['create_file'] })).data.connector.id;
  await api(`/connectors/${connectorId}`, 'PATCH', { enabled: true });
  const selection = { artifacts: [{ id: sourceId, version: 1 }], skills: [], memoryIds: [], connectorActions: [{ connectorId, action: 'create_file' }] };
  const conversation = (await api('/conversations', 'POST', { inputContext: selection })).data.conversation;
  const goal = (await api('/goals', 'POST', { title: 'Create an approved draft', conversationId: conversation.id, maxSteps: 3 })).data.goal;
  assert.equal((await api(`/goals/${goal.id}`, 'PATCH', { action: 'start', requestId: 'start-goal' })).status, 200);
  const waiting = await until(async () => (await api('/runs')).data.runs.find(run => run.status === 'awaiting_approval'));
  assert.equal(calls, 1); assert.equal(waiting.inputContextSnapshot.artifacts[0].content, 'PINNED_VERSION_ONE');
  assert.equal((await api('/artifacts')).data.artifacts.length, 1);
  const proposal = waiting.proposals[0];
  assert.equal((await api(`/runs/${waiting.id}/resume`, 'POST', { proposalId: proposal.id, requestId: 'unapproved' })).status, 403);
  assert.equal((await api(`/approvals/${proposal.approvalId}/decision`, 'POST', { decision: 'approved', confirmed: true })).status, 409);
  assert.equal((await api(`/conversations/${conversation.id}/messages`, 'POST', { content: 'Concurrent' })).status, 409);
  assert.equal((await api(`/runs/${waiting.id}/action-decision`, 'POST', { proposalId: proposal.id, decision: 'approved', confirmed: true })).status, 200);
  assert.equal(calls, 1); assert.equal((await api('/artifacts')).data.artifacts.length, 1);
  const resume = await api(`/runs/${waiting.id}/resume`, 'POST', { proposalId: proposal.id, requestId: 'resume-goal' });
  assert.equal(resume.status, 200, JSON.stringify(resume.data));
  const finished = await until(async () => { const run = (await api(`/runs/${waiting.id}`)).data.run; return run.status === 'succeeded' && run; });
  assert.equal(calls, 2); assert.equal(finished.id, waiting.id); assert.equal(finished.proposals[0].receipt.status, 'succeeded');
  assert.equal((await api(`/goals/${goal.id}`)).data.goal.status, 'review_required');
  assert.equal((await api(`/artifacts/${finished.outputArtifactId}/content`)).data.content, '# Review summary\nThe approved local action returned a successful receipt.');
  assert.equal((await api(`/runs/${waiting.id}/resume`, 'POST', { proposalId: proposal.id, requestId: 'resume-goal' })).data.duplicate, true);
  assert.equal((await api('/connector-runs')).data.runs.length, 1); assert.equal(calls, 2);
  await f.restart();
  assert.equal((await api(`/runs/${waiting.id}`)).data.run.status, 'succeeded');
  assert.equal((await api('/artifacts')).data.artifacts.length, 3);
  assert.equal(calls, 2);
});
