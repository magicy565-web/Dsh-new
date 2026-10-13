import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceThreadMessages, isWorkspaceRefreshNotification } from '/workspace/workspace-release-20261013/src/assistant/workspaceRuntimeAdapter.ts';

const message = { id: 'message-one', role: 'assistant', content: 'Model text says workspace_input; that is not an observed call.', status: 'complete', conversationId: 'conversation-one', runId: 'run-one', createdAt: '2026-10-13T09:00:00Z', artifactId: 'artifact-one', artifactReference: { id: 'artifact-one', version: 1, sha256: 'a'.repeat(64) } };
const run = { id: 'run-one', conversationId: 'conversation-one', status: 'succeeded', outputArtifactId: 'artifact-one', events: [{ sequence: 1, type: 'pi.submission' }, { sequence: 2, type: 'pi.tool.started', toolName: 'workspace_input', toolCallId: 'b'.repeat(64) }, { sequence: 3, type: 'pi.tool.finished', toolName: 'workspace_input', toolCallId: 'b'.repeat(64) }, { sequence: 4, type: 'pi.tool.started', toolName: 'shell', toolCallId: 'c'.repeat(64) }] };
const artifact = { id: 'artifact-one', sourceRunId: 'run-one', sourceConversationId: 'conversation-one', versions: [{ version: 1, sha256: 'a'.repeat(64), filename: 'result.md' }] };
const convert = (messages, runs = [run], artifacts = [artifact]) => workspaceThreadMessages(messages, { conversationId: 'conversation-one', runs, artifacts });
const tools = result => result.content.filter(part => part.type === 'tool-call');

test('conversation authority excludes foreign messages and never derives a tool from model text', () => {
  const own = convert([message, { ...message, id: 'foreign', conversationId: 'conversation-two' }]);
  assert.equal(own.length, 1);
  assert.equal(tools(convert([message], [{ ...run, events: [] }])[0]).length, 0);
  assert.equal(tools(convert([message], [{ ...run, conversationId: 'conversation-two' }])[0]).length, 0);
});

test('actual persisted whitelist observations display original call identity and explicit observation-only phase', () => {
  const parts = tools(convert([message])[0]);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].toolCallId, 'b'.repeat(64));
  assert.equal(parts[0].toolName, 'workspace_input');
  assert.equal(parts[0].result.workspaceObservation.phase, 'finished');
  assert.equal(parts[0].result.workspaceObservation.resultAvailable, false);
  assert.equal(parts[0].artifact.workspaceObservation.argumentsAvailable, false);
  assert.equal(parts[0].args, undefined);
  const failed = tools(convert([message], [{ ...run, events: [{ sequence: 2, type: 'pi.tool.failed', toolName: 'workspace_input', toolCallId: 'b'.repeat(64) }] }])[0]);
  assert.equal(failed[0].isError, true);
  assert.equal(failed[0].result.workspaceObservation.phase, 'failed');
});

test('one original call is shown once on the last assistant step without copying events into all replies', () => {
  const steps = convert([message, { ...message, id: 'message-two', artifactId: undefined, artifactReference: undefined }]);
  assert.equal(tools(steps[0]).length, 0);
  assert.equal(tools(steps[1]).length, 1);
});

test('file output stays bound to exact original run, conversation, version, and SHA', () => {
  assert.equal(convert([message])[0].metadata.custom.verifiedArtifactReference.id, 'artifact-one');
  for (const changed of [{ ...artifact, sourceConversationId: 'conversation-two' }, { ...artifact, sourceRunId: 'run-two' }, { ...artifact, versions: [{ ...artifact.versions[0], sha256: 'd'.repeat(64) }] }, { ...artifact, versions: [{ ...artifact.versions[0], version: 2 }] }])
    assert.equal(convert([message], [run], [changed])[0].metadata.custom.verifiedArtifactReference, undefined);
  assert.equal(convert([message], [], [artifact])[0].metadata.custom.verifiedArtifactReference, undefined);
});

test('cancelled and blocked messages retain original terminal state instead of becoming successful responses', () => {
  assert.equal(convert([{ ...message, status: 'cancelled' }])[0].status.reason, 'cancelled');
  const blocked = convert([{ ...message, content: '', status: 'blocked', error: { code: 'SETUP_REQUIRED', message: 'Configure the original provider' } }])[0];
  assert.equal(blocked.status.reason, 'error');
  assert.match(blocked.content[0].text, /SETUP_REQUIRED/);
});

test('SSE accepts only original refresh notifications and never treats them as provider/tool execution events', () => {
  assert.equal(isWorkspaceRefreshNotification(JSON.stringify({ sequence: 4, bootstrap: '/api/bootstrap' })), true);
  for (const value of [JSON.stringify({ type: 'pi.tool.finished' }), JSON.stringify({ sequence: 4, bootstrap: 'https://other.test' }), JSON.stringify({ sequence: -1, bootstrap: '/api/bootstrap' }), '{broken'])
    assert.equal(isWorkspaceRefreshNotification(value), false);
});
