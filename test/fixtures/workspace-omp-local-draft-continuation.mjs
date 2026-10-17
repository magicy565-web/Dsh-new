// Original local entry, Session, tools and DeepSeek HTTP/SSE adapter; finite
// responses only. Never read historical private evidence or ambient credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runLocalFactorySession, parseLocalArguments } from '../../scripts/workspace-omp-local.mjs';
import { acceptanceConfiguration } from '../../server/deepseek-acceptance-policy.mjs';
import { workspaceOmpPaths, verifyWorkspaceOmpRuntime } from '../../server/workspace-omp-runtime.mjs';
import { LOCAL_DEEPSEEK_LIMITS } from '../../server/workspace-omp-local-deepseek.mjs';

let networkFallbacks = 0;
globalThis.fetch = async () => { networkFallbacks++; throw Error('FINITE_TEST_NETWORK_FORBIDDEN'); };
const paths = workspaceOmpPaths({});
const runtime = await verifyWorkspaceOmpRuntime(paths);
const configuration = acceptanceConfiguration({ DEEPSEEK_API_KEY: 'explicit-finite-unused-no-network' });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const source = 'Synthetic public product: cup, 500 ml. Delivery and certification unconfirmed.\n';
const goals = [
  '读取资料，保存内部询盘回复 inquiry.md：数量100，交期和认证待确认。不要发送。',
  '修改刚保存的询盘草稿：数量改为200；其他待确认项保留。新版本保存 inquiry-v2.md，保留首版，不发送。',
];
const bodies = [
  'Synthetic internal inquiry draft. Cup 500 ml; quantity 100. Delivery and certification remain unconfirmed.',
  'Synthetic internal inquiry draft, revision of inquiry.md. Cup 500 ml; quantity 200. Delivery and certification remain unconfirmed.',
];
const finals = ['已保存内部草稿 inquiry.md，交期和认证待确认，未发送。', '已保存修订草稿 inquiry-v2.md，保留首版，未发送。'];
function sse(body, delta, finish) {
  const frame = { id: 'explicit-finite-draft-continuation', model: body.model,
    choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] };
  const end = { ...frame, choices: [{ index: 0, delta: {}, finish_reason: finish }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } };
  return new Response('data: ' + JSON.stringify(frame) + '\n\ndata: ' + JSON.stringify(end) + '\n\ndata: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } });
}
const root = await fs.mkdtemp('/tmp/omp-draft-continuation-');
let totalRequests = 0, sessionId, firstJournal, firstFile;
const sizes = [], summaries = [];
try {
  await fs.mkdir(root + '/output'); await fs.writeFile(root + '/product.md', source);
  const args = ['--input', root + '/product.md', '--output-dir', root + '/output'];
  const sessionFile = root + '/output/factory-session.jsonl';
  async function run(task, respond) {
    const directory = await fs.mkdtemp(root + '/scratch-');
    let requests = 0, fetchAssertion;
    const result = await runLocalFactorySession({ directory, paths, configuration,
      options: parseLocalArguments([...args, task]) }, { fetchImpl: async request => {
      // Count before any assertion: a thrown wire assertion is never a zero-send pass.
      requests++; totalRequests++;
      try {
        const raw = await request.text(), body = JSON.parse(raw);
        sizes.push(Buffer.byteLength(raw));
        assert.ok(Buffer.byteLength(raw) <= LOCAL_DEEPSEEK_LIMITS.maxRequestBytes);
        assert.equal(body.max_tokens, 512); assert.deepEqual(body.thinking, { type: 'disabled' });
        assert.equal(request.url, 'https://api.deepseek.com/chat/completions');
        return respond(body, requests);
      } catch (error) { fetchAssertion = error; throw error; }
    } });
    if (fetchAssertion) throw fetchAssertion;
    // After a tool failure the SDK may enter the next logical provider call;
    // the existing stopped transport must refuse it before another HTTP send.
    if (result.status !== 'stopped') assert.equal(result.modelRequests, requests);
    assert.equal(result.provider.actualProviderRequests, requests);
    assert.equal(result.provider.confirmedResponses, requests);
    assert.equal(result.provider.billingUncertain, false);
    return { result, requests };
  }
  for (let turn = 0; turn < 2; turn++) {
    const { result, requests } = await run(goals[turn], (body, call) => {
      const encoded = JSON.stringify(body.messages);
      assert.ok(encoded.includes(goals[turn]));
      if (turn) {
        for (const previous of [goals[0], bodies[0], finals[0]]) assert.ok(encoded.includes(previous), 'PRIOR_GOAL_DRAFT_OR_COMPLETION_LOST');
        assert.ok(encoded.includes(sha(source)), 'PRIOR_SOURCE_PROOF_LOST');
      }
      const tool = (name, args) => sse(body, { tool_calls: [{ index: 0, id: 'draft-' + turn + '-' + call,
        type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls');
      if (!turn && call === 1) return tool('read', { path: 'input-1' });
      if (call === (turn ? 1 : 2)) return tool('write', { path: turn ? 'inquiry-v2.md' : 'inquiry.md', content: bodies[turn] });
      return sse(body, { content: finals[turn] }, 'stop');
    });
    assert.equal(requests, turn ? 2 : 3); assert.equal(result.status, 'saved-local-drafts');
    assert.equal(result.answer, finals[turn]); assert.equal(result.paidModelVerified, false);
    assert.equal(result.externalActions, false); assert.equal(result.workspaceHostUsed, false);
    assert.equal(result.saved.length, 1);
    assert.deepEqual(result.toolReceipts.map(r => r.tool), turn ? ['write'] : ['read', 'write']);
    const receipt = result.saved[0], bytes = await fs.readFile(root + '/output/' + receipt.name);
    assert.equal(receipt.humanApproved, false); assert.equal(receipt.sent, false);
    assert.equal(receipt.sha256, sha(bytes)); assert.ok(bytes.toString().startsWith(bodies[turn]));
    assert.equal(receipt.sources[0].sha256, sha(source)); assert.equal(receipt.sources[0].recordId, 'input-1');
    sessionId ||= result.localSession.id; assert.equal(result.localSession.id, sessionId);
    assert.equal(result.localSession.file, sessionFile); assert.equal(result.localSession.resumed, Boolean(turn));
    const journal = await fs.readFile(sessionFile), rows = journal.toString().trim().split('\n').map(JSON.parse);
    assert.equal(rows.filter(e => e.message?.role === 'assistant').at(-1).message.stopReason, 'stop');
    assert.equal((await fs.stat(sessionFile)).mode & 0o777, 0o600);
    if (turn) {
      assert.ok(journal.subarray(0, firstJournal.length).equals(firstJournal), 'FIRST_TURN_JOURNAL_REWRITTEN');
      assert.ok((await fs.readFile(root + '/output/inquiry.md')).equals(firstFile));
      assert.equal(result.revalidatedPriorSources[0].sha256, sha(source));
    } else { firstJournal = journal; firstFile = bytes; }
    summaries.push({ turn: turn + 1, status: result.status, mockHttpRequests: requests,
      normalStop: true, sourceSha256: receipt.sources[0].sha256, savedSha256: receipt.sha256 });
  }
  // Resuming does not widen the original create-only write authority.
  const overwrite = await run('尝试覆盖 inquiry.md。', body => sse(body, { tool_calls: [{ index: 0,
    id: 'forbidden-overwrite', type: 'function', function: { name: 'write', arguments: JSON.stringify({ path: 'inquiry.md', content: 'Forbidden overwrite.' }) } }] }, 'tool_calls'));
  assert.equal(overwrite.requests, 1); assert.equal(overwrite.result.status, 'stopped');
  assert.equal(overwrite.result.modelRequests, 2);
  assert.equal(overwrite.result.reason, 'LOCAL_TOOL_ERROR_STOP_DO_NOT_RETRY');
  assert.equal(overwrite.result.saved.length, 0); assert.equal(overwrite.result.toolReceipts[0].isError, true);
  assert.ok((await fs.readFile(root + '/output/inquiry.md')).equals(firstFile));
  // A changed selected source cannot reuse the prior native Session's proof.
  await fs.writeFile(root + '/product.md', source + 'Changed selection.');
  const changed = await run('继续修改同一草稿。', () => { throw Error('CHANGED_SOURCE_MUST_NOT_REACH_MODEL'); });
  assert.equal(changed.requests, 0); assert.equal(changed.result.status, 'stopped');
  assert.equal(changed.result.modelRequests, 0);
  assert.equal(changed.result.reason, 'LOCAL_SESSION_SELECTION_OR_BILLING_REFUSED');
  assert.equal(changed.result.saved.length, 0);
  assert.equal(networkFallbacks, 0); assert.equal(totalRequests, 6);
  console.log(JSON.stringify({ passed: true, runtime, evidenceKind: 'original-local-entry-finite-http-sse',
    turns: summaries, sameNativeSessionId: true, priorJournalPrefixUnchanged: true, firstDraftUnchanged: true,
    revisionStorage: 'new-basename-no-overwrite-authority', overwriteRefused: true, changedSourceMockRequests: 0,
    maxWireBytes: Math.max(...sizes), currentWireCapBytes: LOCAL_DEEPSEEK_LIMITS.maxRequestBytes,
    actualMockHttpRequests: totalRequests, networkFallbacks, realProviderRequests: 0, newSpendCny: 0 }));
} finally { await fs.rm(root, { recursive: true, force: true }); }
