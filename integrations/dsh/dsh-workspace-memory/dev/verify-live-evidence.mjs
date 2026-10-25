// Offline consistency check for evidence captured from an official native DSH live run.
// Does not call a model or execute tools. Keep inputs (native journals) and outputs outside Git.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(process.argv[2] ?? '/tmp/dsh-live-memory');
const output = resolve(process.argv[3] ?? join(root, 'verified-report'));
const json = async name => JSON.parse(await readFile(join(root, name), 'utf8'));
const fixture = await json('fixture.json');
const text = message => (message?.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');
const message = event => event.data.message ?? event.data;
async function trace(id) {
  const snapshot = await json(id + '.json');
  const events = snapshot.records.filter(row => row.type === 'event').map(row => row.event);
  assert.equal(events.findLast(event => event.type === 'turn/end')?.data.reason.kind, 'completed');
  const replies = events.filter(event => event.type === 'assistant/message');
  assert.ok(replies.length > 0, 'Native journal must contain real model-message events');
  for (const event of replies) {
    assert.equal(message(event).source.kind, 'model');
    assert.equal(message(event).source.provider, 'deepseek-official');
    assert.equal(message(event).source.model, 'deepseek-flash');
  }
  const calls = events.filter(event => event.type === 'tool/call').map(event => ({
    seq: event.seq, id: event.data.callId, name: event.data.name,
    args: typeof event.data.arguments === 'string' ? JSON.parse(event.data.arguments) : event.data.arguments,
  }));
  const results = new Map(events.filter(event => event.type === 'tool/result').map(event => {
    const result = message(event), body = text(result);
    let value; try { value = JSON.parse(body); } catch { /* expected error text */ }
    return [result.toolCallId, { seq: event.seq, isError: result.isError === true, text: body, value }];
  }));
  for (const call of calls) {
    assert.ok(results.has(call.id), 'Each native tool call must have a correlated result');
    assert.ok(results.get(call.id).seq > call.seq);
    assert.ok(!/bash|shell|pwsh|subagent|workflow|plugin_manager/u.test(call.name), 'Acceptance tasks must not delegate or run a shell');
  }
  return {
    id, events, calls, results,
    finalText: text(message(replies.findLast(event => text(message(event))))),
    userText: events.filter(event => event.type === 'user/message' && message(event).source?.kind === 'user').map(event => text(message(event))).join('\n'),
    named: name => calls.filter(call => call.name === name).map(call => ({ ...call, result: results.get(call.id) })),
    modelMessages: replies.length,
    titleRequests: events.filter(event => event.type === 'session/title-llm-request').length,
  };
}
const ids = [fixture.sessionId, fixture.secondSessionId, fixture.thirdSessionId];
assert.equal(new Set(ids).size, 3, 'The three cases must use independent native sessions');
const [first, second, third] = await Promise.all(ids.map(trace));
const attachment = await json('source-document.json');
assert.equal(attachment.id, fixture.pin.documentId);
assert.equal(attachment.versions[0].attachment.attachmentId, 'sha256:' + fixture.pin.sha256);
const submitted = await json('submitted.json');
assert.deepEqual(submitted.requests.find(request => request.path.endsWith('/references/check')).body.references, [fixture.pin]);
assert.match(submitted.label, /v1/u);
function sourceRead(run) {
  const read = run.named('workspace_library_references').find(call => !call.result.isError);
  assert.ok(read, 'Model must independently read the pinned document');
  assert.deepEqual(read.args.references, [fixture.pin]);
  const item = read.result.value.items[0];
  assert.equal(item.source.version, 1);
  assert.equal(item.source.sha256, fixture.pin.sha256);
  assert.ok(item.source.currentVersion > 1, 'A contrasting newer version must exist');
  assert.equal(createHash('sha256').update(item.content, 'utf8').digest('hex'), fixture.pin.sha256);
  return item;
}
sourceRead(first);
assert.equal(sourceRead(second).source.isCurrentVersion, false);
for (const run of [first, second]) {
  assert.equal([...run.results.values()].filter(result => result.isError).length, 0);
  const recalls = run.named('business_memory_recall');
  assert.ok(recalls.length > 0);
  for (const recall of recalls) {
    assert.equal(recall.result.value.workspaceId, fixture.workspaceId);
    assert.ok(recall.result.value.items.every(record => record.status === 'active' && record.usable));
    assert.equal(JSON.stringify(recall.result.value).includes(fixture.pendingId), false);
    assert.equal(JSON.stringify(recall.result.value).includes('83%'), false);
  }
  assert.ok(recalls.some(call => call.result.value.items.some(record => record.id === fixture.approvedId)));
  assert.match(run.finalText.replace(/\*/gu, ''), /370\s*件/u);
  assert.match(run.finalText.replace(/\*/gu, ''), /17\s*天/u);
  assert.ok(run.finalText.includes('25%') && run.finalText.includes('75%'));
  assert.equal(/940\s*件|31\s*天|83%/u.test(run.finalText), false);
}
const proposals = first.named('business_memory_propose');
assert.equal(proposals.length, 1, 'The clean run creates one candidate without retries');
const proposed = proposals[0].result.value.record;
assert.equal(proposed.id, fixture.proposedId);
assert.equal(proposed.status, 'proposed');
assert.equal(proposed.source.verified, false);
assert.equal(proposed.source.ref, `conversation:${first.id}#tool:${proposals[0].id}`);
const approval = await json('operator-approval.json');
assert.equal(approval.sourceConversationOpened, true);
assert.equal(approval.before.status, 'proposed');
assert.equal(approval.after.status, 'active');
assert.equal(approval.after.reviewedBy, 'dsh-browser-admin');
assert.notEqual(approval.after.proposedBy, approval.after.reviewedBy);
assert.equal(second.userText.includes('中文表格'), false, 'New-session prompt must not repeat the preference content');
assert.ok(second.named('business_memory_recall').some(call => call.result.value.items.some(record => record.id === proposed.id)));
assert.ok(second.finalText.includes(proposed.id) && second.finalText.includes('中文表格'));
assert.match(second.finalText, /历史版本/u);
assert.equal(second.calls.some(call => call.name === 'business_memory_propose'), false);
const revoked = await json('operator-revocations.json');
assert.deepEqual(new Set(revoked.map(record => record.id)), new Set([fixture.approvedId, fixture.proposedId]));
assert.ok(revoked.every(record => record.status === 'revoked'));
const unavailable = third.named('workspace_library_references');
assert.ok(unavailable.some(call => call.result.isError && /archived/iu.test(call.result.text)));
assert.ok(unavailable.every(call => call.args.references.every(pin => pin.version === 1 && pin.sha256 === fixture.pin.sha256)), 'Never silently switch to v2');
const archivedFile = third.named('workspace_library_documents').flatMap(call => call.result.value?.items ?? []).find(item => item.id === fixture.pin.documentId);
assert.equal(archivedFile?.status, 'archived');
assert.equal(archivedFile.hasFile, true);
assert.equal(archivedFile.hasInlineText, false);
assert.equal(archivedFile.hasContent, true, 'An archived stored file is not an empty file');
const negativeRecalls = third.named('business_memory_recall');
assert.ok(negativeRecalls.length > 0);
for (const call of negativeRecalls) {
  assert.equal(call.result.value.items.length, 0);
  assert.equal(call.result.value.searchScope, 'approved-active-only');
  assert.equal(call.result.value.population.proposed, 1);
  assert.equal(call.result.value.population.revoked, 2);
}
assert.ok([...third.results.values()].filter(result => result.isError).every(result => /archived/iu.test(result.text)));
assert.equal(third.calls.some(call => call.name === 'business_memory_propose'), false);
assert.equal(/370\s*件|17\s*天|25%|75%|83%/u.test(third.finalText), false, 'No lost or pending fact may fill the evidence gap');
assert.equal(/没有可直接提请审批的候选|无待审核候选|没有待审核候选|无候选/u.test(third.finalText), false);
assert.ok(/待审核|proposed/u.test(third.finalText));

const cases = [
  { name: 'pinned-file-and-proposal', run: first, checks: ['native composer pin', 'real attachment SHA', 'v1 despite existing v2', 'approved memory only', 'model candidate stays pending'], note: '本场景通过的是执行与来源边界。首轮草稿把旧版条款称为现行，且加入了原文未说明的解释；不将这份草稿判为可直接对外发送。后续补充版本元数据与工具说明，并在第二场景严格引用任务中复测。' },
  { name: 'approved-memory-in-new-session', run: second, checks: ['operator UI approval', 'source conversation link', 'independent session recall', 'preference absent from user prompt', 'historical version identified'] },
  { name: 'archived-and-revoked', run: third, checks: ['archived reference rejected', 'stored file distinguished from inline text', 'no v2 substitution', 'revoked facts excluded', 'pending count preserved without content', 'no historical or pending fact used'] },
];
const report = {
  recordedAt: new Date().toISOString(), source: 'captured official DSH session/page journals', runtime: '0.2.1-rc.2', provider: 'deepseek-official', model: 'deepseek-flash',
  scope: 'native execution and provenance boundaries in the selected scenarios',
  operatorReview: 'Synthetic candidate approved through native UI by the test operator, outside the model.',
  cases: cases.map(({ name, run, checks, note }) => ({ name, passed: true, note, sessionId: run.id, modelMessages: run.modelMessages, nativeTitleRequests: run.titleRequests,
    tools: run.calls.map(call => ({ name: call.name, callSeq: call.seq, resultSeq: run.results.get(call.id).seq, isError: run.results.get(call.id).isError })), checks, response: run.finalText })),
  limitations: ['Synthetic business data; no production business promise.', 'Selected traces validate these scenarios, not universal model factual accuracy.', 'Offline verification itself makes no model request.'],
};
await mkdir(output, { recursive: true });
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
await writeFile(join(output, 'report.md'), '# DSH 真实模型验收\n\n官方 DSH 0.2.1-rc.2 / DeepSeek-V4.1-Flash，隔离 profile，合成数据。\n审批由验收操作者在原生界面执行；模型仅提出候选。\n验收范围是指定场景中的原生执行与来源边界。下方保留模型原答复，首轮草稿的质量问题另行注明。\n\n' + cases.map(({ name, run, checks, note }) => `## ${name}\n\n通过：${checks.join('；')}。\n\n${note ? note + '\n\n' : ''}原生会话：${run.id}，模型消息 ${run.modelMessages} 条，工具调用 ${run.calls.length} 次。\n\n以下为模型原答复：\n\n${run.finalText}\n`).join('\n') + '\n本记录验证指定场景，不代表任意模型输出均无需人工复核。原生会话原文件留在 Git 外。\n');
console.log(`OK: three live-model scenarios; ${cases.reduce((total, item) => total + item.run.calls.length, 0)} correlated native tool calls. Report: ${output}`);
