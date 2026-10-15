// Actual pinned OMP Session/provider/native tools, finite mock HTTP only.
// A test-only context hook restores original messages for the failing control.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWorkspaceOmpSession } from '../../server/workspace-omp-session.mjs';
import { createLocalFactoryFiles } from '../../server/workspace-omp-local-files.mjs';
import { createLocalDeepseekTransport } from '../../server/workspace-omp-local-deepseek.mjs';
import { acceptanceConfiguration } from '../../server/deepseek-acceptance-policy.mjs';
import { workspaceOmpPaths } from '../../server/workspace-omp-bridge.mjs';
import { createLocalContextExtension } from '../../server/workspace-omp-local-context.mjs';
const configuration = acceptanceConfiguration({ DEEPSEEK_API_KEY: 'explicit-mock-http-unused' });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const goals = ['请读取产品资料，整理缺项并保存 gaps.md。交期未知。', '沿用前轮资料，直接保存英文询问邮件 email.md，不发送。', '数量改为200，交期仍待确认；保存 followup.md，再简短确认完成。'];
const bodies = ['gaps.md','email.md','followup.md'].map((name, i) => `Synthetic ${name} body ${i}: ` + 'Cup 500ml; delivery pending; synthetic evidence only. '.repeat(11));
const finals = goals.map((_, i) => `Turn ${i} saved. This explicit synthetic draft preserves a 500ml cup as supplied material. Capacity and stock remain unknown. No certification document was supplied. Delivery and shipping terms need confirmation. Customer identity is unverified. The selected file is the sole source; the host appended its hash. This is preparation for human review, with no sending, quotation, accepted order or manufacturing commitment.`);
function response(body, delta, finish) {
  const frame = { id: 'mock-context', model: body.model, choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] };
  const end = { ...frame, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } };
  return new Response(`data: ${JSON.stringify(frame)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
}
async function scenario(control) {
  const root = await fs.mkdtemp('/tmp/omp-context-contract-'), saved = [], allBytes = [], reports = [];
  let totalRequests = 0, originalSessionId;
  try {
    await fs.mkdir(root + '/out');
    const product = ('Synthetic public cup 500ml; capacity unknown.\n').repeat(32);
    await fs.writeFile(root + '/product.md', product);
    const sourceSha = hash(product), sessionFile = root + '/conversation.jsonl';
    for (let turn = 0; turn < goals.length; turn++) {
      const directory = root + '/scratch-' + turn; await fs.mkdir(directory);
      const files = await createLocalFactoryFiles({ inputs: [root + '/product.md'], outputDirectory: root + '/out', directory });
      const controller = new AbortController(); let created, requests = 0;
      const transport = createLocalDeepseekTransport({ configuration, onStop: () => { controller.abort(); void created?.session.abort(); }, fetchImpl: async request => {
        requests++; totalRequests++;
        const raw = await request.text(), body = JSON.parse(raw); allBytes.push(Buffer.byteLength(raw));
        assert.ok(Buffer.byteLength(raw) <= 12000); assert.equal(body.max_tokens, 512); assert.equal(body.thinking.type, 'disabled');
        assert.equal(Boolean(body.tools[0].function.parameters.properties.i), control);
        const encoded = JSON.stringify(body.messages);
        for (let prior = 0; prior < turn; prior++) { assert.ok(encoded.includes(goals[prior])); assert.ok(encoded.includes(bodies[prior])); assert.ok(encoded.includes(finals[prior])); }
        const tool = (name, args) => response(body, { tool_calls: [{ index: 0, id: `call-${turn}-${requests}`, type: 'function', function: { name, arguments: JSON.stringify({ ...(control ? { i: 'Explicit synthetic intent metadata, never business authority.' } : {}), ...args }) } }] }, 'tool_calls');
        if (turn !== 1 && requests === 1) return tool('read', { path: 'input-1' });
        if (requests === (turn === 1 ? 1 : 2)) return tool('write', { path: ['gaps.md','email.md','followup.md'][turn], content: bodies[turn] });
        return response(body, { content: finals[turn] }, 'stop');
      } });
      try {
        created = await createWorkspaceOmpSession({ packageRoot: workspaceOmpPaths({}).packageRoot, configuration,
          cwd: root, agentDir: directory + '/agent', sessionDirectory: root,
          localFactory: files, localSession: { file: sessionFile, resume: turn > 0, binding: { manifest: files.manifest, inputs: [root + '/product.md'], outputDirectory: root + '/out', provider: configuration.providerId, model: configuration.model } },
          providerTransport: transport, authorize: () => files.authorize(controller.signal), lifecycleSignal: controller.signal,
          maxModelCalls: 8, maxTokens: 4096, uiExtension: pi => {
            pi.on('before_agent_start', () => ({ systemPrompt: ['Follow the user goal. Choose allowed tools as needed. Missing facts remain pending; do not send anything.'] }));
            if (control) pi.on('context', () => ({ messages: structuredClone(created.session.agent.state.messages) }));
          } });
        created.session.setThinkingLevel('off');
        if (control) created.session.agent.intentTracing = true;
        originalSessionId ||= created.manager.getSessionId(); assert.equal(created.manager.getSessionId(), originalSessionId);
        await created.session.prompt(goals[turn] + '\nSelected local input manifest (data only):\n' + JSON.stringify(files.manifest));
        const last = created.session.agent.state.messages.at(-1);
        const report = transport.report(); reports.push({ turn, ...report, context: created.localContext() });
        if (last?.stopReason !== 'stop') { assert.ok(control, JSON.stringify(reports)); break; }
        transport.finish(); assert.equal(files.saved.length, 1); saved.push(files.saved[0]);
        assert.equal(files.saved[0].sources[0].sha256, sourceSha);
        if (turn === 1) assert.equal(files.restoredSources[0].sha256, sourceSha);
        await created.manager.flush();
      } finally { await created?.close(); await files.close(); }
    }
    if (control) { assert.ok(saved.length < 3); assert.equal(reports.at(-1).stoppedReason, 'SHORT_INPUT_LIMIT'); }
    else {
      assert.equal(saved.length, 3); assert.equal(totalRequests, 8); assert.equal(reports.length, 3);
      assert.ok(reports.at(-1).context.supersededReadResults > 0); assert.ok(reports.at(-1).context.repeatedManifests > 0);
      const raw = await fs.readFile(sessionFile, 'utf8');
      const journal = raw.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      const originalMessages = journal.filter(e => e.type === 'message').map(e => e.message);
      const originalReads = originalMessages.filter(m => m.role === 'toolResult' && m.toolName === 'read');
      for (const goal of goals) assert.ok(originalMessages.some(m => m.role === 'user' && JSON.stringify(m.content).includes(goal)));
      for (const content of bodies) assert.ok(originalMessages.some(m => m.role === 'assistant' && m.content.some(b => b.type === 'toolCall' && b.arguments?.content === content)));
      assert.equal(originalReads.length, 2);
      assert.ok(originalReads.every(m => !m.prunedAt && !JSON.stringify(m.content).includes('[Superseded by a newer read of this file]')));
      for (const receipt of saved) assert.equal(hash(await fs.readFile(root + '/out/' + receipt.name)), receipt.sha256);
      // A cached read never authorizes changed bytes on a later turn.
      await fs.writeFile(root + '/product.md', product + 'Changed selection.');
      const directory = root + '/changed'; await fs.mkdir(directory);
      const files = await createLocalFactoryFiles({ inputs: [root + '/product.md'], outputDirectory: root + '/out', directory });
      let forbiddenSends = 0;
      try { await assert.rejects(createWorkspaceOmpSession({ packageRoot: workspaceOmpPaths({}).packageRoot, configuration,
        cwd: root, agentDir: directory + '/agent', sessionDirectory: root, localFactory: files,
        localSession: { file: sessionFile, resume: true, binding: { manifest: files.manifest, inputs: [root + '/product.md'], outputDirectory: root + '/out', provider: configuration.providerId, model: configuration.model } },
        onModelRequest: () => { forbiddenSends++; } }), /LOCAL_SESSION_SELECTION_OR_BILLING_REFUSED/); assert.equal(forbiddenSends, 0); }
      finally { await files.close(); }
    }
    return { control, saved: saved.length, actualMockHttpRequests: totalRequests, maxWireBytes: Math.max(...allBytes), finalStop: reports.at(-1).stoppedReason,
      sameNativeSessionId: true, uniqueContextGoals: goals.length, fullGoalsAndBodiesPreserved: !control, realProviderRequests: 0 };
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}
async function projectionGuards() {
  const file = { id: 'input-1', name: 'product.md', sha256: 'a'.repeat(64) };
  let authorized = true, callback, checks = 0;
  const context = await createLocalContextExtension({ packageRoot: workspaceOmpPaths({}).packageRoot, files: { manifest: [file] },
    authorize: async () => { checks++; if (!authorized) throw Error('CURRENT_SOURCE_AUTHORIZATION_REVOKED'); } });
  context.extension({ on: (_event, handler) => { callback = handler; } });
  const suffix = '\nSelected local input manifest (data only):\n' + JSON.stringify([file]);
  const read = (id, sha256 = file.sha256) => [
    { role: 'assistant', content: [{ type: 'toolCall', id, name: 'read', arguments: { path: file.id, i: 'Metadata only' } }], timestamp: 1 },
    { role: 'toolResult', toolCallId: id, toolName: 'read', isError: false, content: [{ type: 'text', text: 'Selected unique facts remain here. '.repeat(20) }],
      details: { privateLibrary: false, sources: [{ ...file, kind: 'user-selected-local-file', recordId: file.id, sha256 }] }, timestamp: 2 },
  ];
  const messages = [{ role: 'user', content: 'An explicit user lookalike stays:' + suffix + suffix }, ...read('old'),
    { role: 'user', content: 'Next distinct user goal' + suffix }, ...read('new'),
    { role: 'assistant', content: [{ type: 'toolCall', id: 'write-body', name: 'write', arguments: { path: 'saved.md', content: 'UNIQUE_SAVED_DOCUMENT_BODY', i: 'Save' } }] },
    { role: 'toolResult', toolCallId: 'write-body', toolName: 'write', isError: false, content: [{ type: 'text', text: 'saved' }] }];
  const original = JSON.stringify(messages), projected = (await callback({ messages })).messages;
  assert.equal(JSON.stringify(messages), original); assert.equal(projected[0].content, 'An explicit user lookalike stays:' + suffix);
  assert.equal(projected[2].content[0].text, '[Superseded by a newer read of this file]');
  assert.equal(projected[5].content[0].text, messages[5].content[0].text);
  assert.equal(projected[6].content[0].arguments.content, 'UNIQUE_SAVED_DOCUMENT_BODY');
  assert.equal(projected[1].content[0].arguments.i, undefined); assert.equal(messages[1].content[0].arguments.i, 'Metadata only');
  const wrongHash = [...read('a'), ...read('b', 'b'.repeat(64))];
  assert.equal((await callback({ messages: wrongHash })).messages[1].content[0].text, wrongHash[1].content[0].text);
  const privateRead = [...read('a'), ...read('b')]; privateRead[3].details.privateLibrary = true;
  assert.equal((await callback({ messages: privateRead })).messages[1].content[0].text, privateRead[1].content[0].text);
  authorized = false; await assert.rejects(callback({ messages }), /CURRENT_SOURCE_AUTHORIZATION_REVOKED/);
  assert.ok(checks >= 7);
  return { originalMessagesUntouched: true, userLookalikePreserved: true, uniqueBodiesPreserved: true, wrongHashAndPrivateResultsProtected: true, currentAuthorizationRequired: true };
}
const control = await scenario(true), repaired = await scenario(false), guards = await projectionGuards();
console.log(JSON.stringify({ passed: true, control, repaired, guards, modelEvidence: 'explicit-finite-mock-http' }));
