// Official Pi SDK and controlled faux transport tests. Backend task semantics
// and the interactive PTY path are independently verified by the host tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createWorkspaceClient, WORKSPACE_TOOLS, workspaceTerminalInputPolicy } from '../pi/extensions/workspace.mjs';
import { createWorkspaceTuiRuntime } from '../scripts/pi-workspace-tui.mjs';

async function fixture(t, { sample = false } = {}) {
  const directory = await fs.mkdtemp('/tmp/workspace-pi-tui-sdk-');
  const calls = [];
  const proposal = { id: 'original-proposal', connectorId: 'selected-connector', action: 'write', resource: 'reviewed-resource', payload: { text: 'Reviewed exact text' }, status: 'awaiting_approval' };
  const client = Object.fromEntries(['submit', 'status', 'cancel', 'resume', 'decision', 'continue'].map(method => [method, async (...args) => {
    calls.push({ method, args });
    return method === 'status' ? { run: { id: 'original-run', status: 'awaiting_approval' }, proposals: [proposal], reply: { content: 'Original persisted reply' }, usage: { completionTokens: 17 } }
      : { run: { id: 'original-run', status: method === 'cancel' ? 'cancelled' : 'running' } };
  }]));
  const out = await createWorkspaceTuiRuntime({ client, isolationDirectory: directory, sample });
  await out.runtime.session.bindExtensions({});
  t.after(async () => { await out.runtime.dispose(); await fs.rm(directory, { recursive: true, force: true }); });
  return { ...out, calls, proposal };
}

test('official SDK Agent invokes only Workspace extension tools with measured keyless faux, retaining typed input and HTTP receipt', async t => {
  const f = await fixture(t, { sample: true });
  assert.deepEqual(f.runtime.session.getActiveToolNames(), WORKSPACE_TOOLS);
  assert.equal(f.runtime.session.sessionFile, undefined);
  await f.runtime.session.prompt('Public synthetic product brief; no ambient files.');
  assert.equal(f.faux.state.callCount, 2);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].method, 'submit');
  assert.equal(f.calls[0].args[0].content, 'Public synthetic product brief; no ambient files.');
  assert.equal(f.calls[0].args[0].delegation, true);
  assert.match(f.calls[0].args[0].requestId, /^[a-f0-9-]{36}$/);
  const answer = f.runtime.session.agent.state.messages.at(-1);
  assert.equal(answer.role, 'assistant');
  assert.match(answer.content[0].text, /original-run/);
  assert.match(answer.content[0].text, /running/);
  assert.ok(answer.usage.output > 0);
  assert.equal(f.runtime.session.agent.state.tools.some(tool => ['bash', 'read', 'write', 'edit', 'grep', 'find', 'ls', 'web_search'].includes(tool.name)), false);
});

test('normal command profile handles natural text without model or task execution and refuses builtin tools and shell escapes', async t => {
  const f = await fixture(t);
  await f.runtime.session.prompt('Do not start unconfigured TUI model work.');
  assert.deepEqual(f.calls, []);
  const runner = f.runtime.session.extensionRunner;
  for (const toolName of ['bash', 'read', 'write', 'edit', 'web_search']) {
    assert.deepEqual(await runner.emitToolCall({ type: 'tool_call', toolName, toolCallId: 'unadmitted-call', input: {} }),
      { block: true, reason: 'Only the admitted Workspace plugin tools are available.' });
  }
  const shell = await runner.emitUserBash({ type: 'user_bash', command: 'touch /tmp/unadmitted-shell-file', excludeFromContext: false, cwd: '/tmp' });
  assert.equal(shell.result.exitCode, 1);
  assert.match(shell.result.output, /unavailable/);
  assert.deepEqual(await runner.emit({ type: 'session_before_switch', reason: 'resume', sessionFile: '/tmp/arbitrary.jsonl' }), { cancel: true });
});

test('Workspace slash commands dispatch task, delegate, status, cancel and explicit checkpoint/action continuation without creating local task state', async t => {
  const f = await fixture(t);
  const runner = f.runtime.session.extensionRunner;
  const errors = [];
  const ctx = { ui: { notify: message => errors.push(message) } };
  const invoke = async (name, args) => runner.getCommand(name).handler(args, ctx);
  await invoke('ws-task', JSON.stringify({ title: 'Public task', content: 'Explicit text', requestId: 'original-request' }));
  await invoke('ws-delegate', JSON.stringify({ title: 'Public child task', content: 'Explicit child text', requestId: 'original-child-request' }));
  await invoke('ws-status', 'original-run');
  await invoke('ws-cancel', 'original-run');
  await invoke('ws-resume', 'original-run');
  await invoke('ws-continue', 'original-run original-proposal');
  assert.deepEqual(errors, []);
  assert.deepEqual(f.calls.map(call => call.method), ['submit', 'submit', 'status', 'cancel', 'resume', 'continue']);
  assert.equal(f.calls[0].args[0].delegation, undefined);
  assert.equal(f.calls[1].args[0].delegation, true);
  assert.equal(f.calls[4].args[0], 'original-run');
  assert.deepEqual(f.calls[5].args.slice(0, 2), ['original-run', 'original-proposal']);
  const replies = f.runtime.session.agent.state.messages.filter(message => message.role === 'custom');
  assert.ok(replies.length > 0);
});

test('approval command displays the original exact proposal and only sends a decision after official UI confirmation; model has no approval tool', async t => {
  const f = await fixture(t);
  const command = f.runtime.session.extensionRunner.getCommand('ws-approve');
  const confirmations = [], errors = [];
  let consent = false;
  const ctx = { ui: { notify: value => errors.push(value), confirm: async (title, body) => { confirmations.push({ title, body }); return consent; } } };
  await command.handler('original-run original-proposal', ctx);
  assert.deepEqual(f.calls.map(call => call.method), ['status']);
  assert.deepEqual(JSON.parse(confirmations[0].body), f.proposal);
  consent = true;
  await command.handler('original-run original-proposal', ctx);
  assert.deepEqual(f.calls.map(call => call.method), ['status', 'status', 'decision']);
  assert.deepEqual(f.calls.at(-1).args, ['original-run', 'original-proposal', 'approved']);
  assert.equal(f.runtime.session.getActiveToolNames().some(name => /approve|decision|continue/.test(name)), false);
  await command.handler('original-run unknown-proposal', ctx);
  assert.equal(f.calls.filter(call => call.method === 'decision').length, 1);
  assert.match(errors.at(-1), /No approval was sent/);
});

test('task command rejects ambient path/options and malformed JSON without exposing pasted input or dispatching a request', async t => {
  const f = await fixture(t);
  const errors = [];
  const command = f.runtime.session.extensionRunner.getCommand('ws-task');
  const ctx = { ui: { notify: message => errors.push(message) } };
  await command.handler('{malformed-private-input', ctx);
  await command.handler(JSON.stringify({ title: 'Public task', content: 'Text', file: '/tmp/ambient' }), ctx);
  await command.handler(JSON.stringify({ title: 'A'.repeat(161), content: 'Text' }), ctx);
  await command.handler(JSON.stringify({ title: 'Public task', content: 'Text', requestId: 'invalid:request' }), ctx);
  await command.handler(JSON.stringify({ title: 'Public task', content: 'Text', requestId: 'A'.repeat(97) }), ctx);
  assert.deepEqual(f.calls, []);
  assert.equal(errors.some(value => value.includes('malformed-private-input') || value.includes('/tmp/ambient')), false);
});

test('supported terminal policy consumes builtin exports/auth/imports, external editor and file/clipboard completion before official dispatch', async t => {
  for (const text of ['/export /tmp/private.jsonl', '/login', '/import /tmp/arbitrary', '/share', '/model', '/settings', '/reload', '/copy']) {
    assert.match(workspaceTerminalInputPolicy('\r', text), /Only \/ws-/);
    assert.match(workspaceTerminalInputPolicy('\x1b[13u', text), /Only \/ws-/);
  }
  for (const data of ['\x07', '\x16', '\x1bv', '\t']) assert.match(workspaceTerminalInputPolicy(data, ''), /unavailable/);
  for (const text of ['/ws-task {"title":"Public","content":"Text"}', '/ws-approve original-run original-proposal', '/quit', 'Public literal @/tmp/file path'])
    assert.equal(workspaceTerminalInputPolicy('\r', text), undefined);
  const f = await fixture(t, { sample: true });
  await f.runtime.session.prompt('Public image attachment should not dispatch', { images: [{ type: 'image', data: 'not-image-bytes', mimeType: 'image/png' }] });
  assert.equal(f.faux.state.callCount, 0);
  assert.deepEqual(f.calls, []);
  await f.runtime.session.prompt('/login');
  assert.equal(f.faux.state.callCount, 0);
  assert.deepEqual(f.calls, []);
});

test('thin transport keeps original bearer scope, refuses unsafe origins/redirects and redacts credentials in backend receipts', async () => {
  for (const baseURL of ['http://outside.example', 'https://user:pass@example.com', 'https://example.com/?secret=x', 'https://example.com/other'])
    assert.throws(() => createWorkspaceClient({ baseURL, token: 'synthetic-token' }));
  const requests = [];
  const client = createWorkspaceClient({ baseURL: 'http://127.0.0.1:3210/api/agent/v1', token: 'synthetic-token', fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return Response.json({ run: { id: 'original-run', status: 'running' }, nullable: null, data: ['synthetic-token'] });
  } });
  const receipt = await client.submit({ title: 'Public task', content: 'Text', requestId: 'original-request' });
  assert.equal(requests[0].url, 'http://127.0.0.1:3210/api/agent/v1/pi/tasks');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer synthetic-token');
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(receipt.nullable, null);
  assert.deepEqual(receipt.data, ['[REDACTED]']);
  await client.decision('original-run', 'original-proposal', 'approved');
  assert.deepEqual(JSON.parse(requests[1].options.body), { proposalId: 'original-proposal', decision: 'approved', confirmed: true });
  const refused = createWorkspaceClient({ baseURL: 'https://original.example', token: 'synthetic-token', fetchImpl: async () => { throw new Error('synthetic-token / redirected.example'); } });
  await assert.rejects(refused.status('original-run'), error => !error.message.includes('synthetic-token') && !error.message.includes('redirected.example'));
});
