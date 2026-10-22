// End-to-end smoke for the run loop.
//
// Boots the real composition with the offline echo provider, posts one message,
// follows the run over SSE until it completes, then proves the answer was stored
// on the conversation. No credential and no network call are involved.
//
// Usage: node scripts/runner-smoke.mjs
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { createHarness } from '../packages/harness-kernel/src/app.mjs';

const root = path.resolve(import.meta.dirname, '..');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) }); };

function reader(response) {
  const source = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    async next(timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const index = buffer.indexOf('\n\n');
        if (index >= 0) {
          const raw = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (!raw.trim() || raw.startsWith(':')) continue;
          const fields = Object.fromEntries(raw.split('\n').map(line => {
            const at = line.indexOf(': ');
            return [line.slice(0, at), line.slice(at + 2)];
          }));
          return { id: Number(fields.id), event: fields.event, data: JSON.parse(fields.data) };
        }
        if (Date.now() > deadline) throw new Error('timed out waiting for an SSE frame');
        const { done, value } = await source.read();
        if (done) return null;
        buffer += decoder.decode(value, { stream: true });
      }
    },
  };
}

const composition = parse(await readFile(path.join(root, 'harness.local.yml'), 'utf8'));
composition.server = { host: '127.0.0.1', port: 0 };
composition.plugins = composition.plugins.map(row => {
  if (row.id === 'llm-bridge') return { id: 'echo-provider', name: './scripts/fixtures/echo-provider' };
  // Small batches so the smoke can observe several incremental frames.
  if (row.id === 'runner') return { ...row, config: { ...row.config, deltaBatchChars: 4, deltaBatchMs: 0, tools: false } };
  return row;
});
// Relative plugin rows resolve against the composition file, so write the
// smoke composition next to the real one and remove it afterwards.
const compositionPath = path.join(root, '.harness-runner-smoke.yml');
await writeFile(compositionPath, stringify(composition), 'utf8');

const harness = await createHarness({ compositionPath, root, logger: { info() {}, warn() {}, error() {} } });
try {
  const { address } = await harness.start();
  const base = address.url;

  const created = await fetch(`${base}/api/chat/conversations`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), title: 'runner smoke' }),
  }).then(response => response.json());

  const question = '海祺这个月该补货吗？';
  const posted = await fetch(`${base}/api/chat/conversations/${created.conversation.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), content: question }),
  }).then(response => response.json());
  check('a message prepares a run', posted.run.status === 'prepared', posted.run.status);

  const stream = await fetch(`${base}/api/chat/runs/${posted.run.id}/events`, { headers: { accept: 'text/event-stream' } });
  const frames = reader(stream);
  const seen = [];
  const deltas = [];
  for (;;) {
    const frame = await frames.next();
    if (frame === null) break;
    seen.push(frame.event);
    if (frame.event === 'run.delta') deltas.push(frame.data?.data?.text ?? '');
    if (frame.event === 'run.completed' || frame.event === 'run.failed') break;
  }
  check('the run goes through running and completes', seen.includes('run.running') && seen.includes('run.completed'), seen);
  check('the stream carries incremental deltas', deltas.length > 1, deltas.length);
  check('the deltas concatenate to the answer', deltas.join('') === question, deltas.join(''));

  const { conversation, messages } = await fetch(`${base}/api/chat/conversations/${created.conversation.id}`).then(response => response.json());
  check('the conversation has the user message and one answer', messages.length === 2, messages.length);
  check('the answer came from the model seam', messages.at(-1)?.role === 'assistant' && messages.at(-1)?.content === question, messages.at(-1)?.content);
  check('the run is terminal and counted', conversation.lastRunId === posted.run.id);

  const run = await fetch(`${base}/api/chat/runs/${posted.run.id}`).then(response => response.json());
  check('the run records the provider model', run.run.status === 'completed' && typeof run.run.model === 'string', run.run.model);

  // Context assembly: a selected skill is resolved from the real skills seam,
  // pinned by a body hash and recorded on the run.
  const selected = await fetch(`${base}/api/chat/conversations/${created.conversation.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), content: '带技能的问题', selection: { skills: ['enterprise-context'] } }),
  }).then(response => response.json());
  const skillStream = await fetch(`${base}/api/chat/runs/${selected.run.id}/events`, { headers: { accept: 'text/event-stream' } });
  const skillFrames = reader(skillStream);
  for (;;) {
    const frame = await skillFrames.next();
    if (frame === null || frame.event === 'run.completed' || frame.event === 'run.failed') break;
  }
  const withSkill = await fetch(`${base}/api/chat/runs/${selected.run.id}`).then(response => response.json());
  const pinned = withSkill.run.snapshot?.skills ?? [];
  check('the selected skill is pinned on the run', pinned.length === 1 && pinned[0].name === 'enterprise-context', withSkill.run.snapshot);
  check('the pinned skill carries a body hash', /^[a-f0-9]{64}$/u.test(pinned[0]?.sha256 ?? ''), pinned[0]?.sha256);

  // A file uploaded through the artifacts surface can be attached to a message
  // and is pinned by version + hash on the run.
  const uploaded = await fetch(`${base}/api/artifacts`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename: '客户需求.md', content: 'MOQ 500，交期 30 天。', mimeType: 'text/markdown' }),
  }).then(response => response.json());
  check('a text file can be uploaded', Boolean(uploaded.artifact?.id), uploaded.artifact?.filename);

  const withFile = await fetch(`${base}/api/chat/conversations/${created.conversation.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), content: '看看这个文件', selection: { artifacts: [uploaded.artifact.id] } }),
  }).then(response => response.json());
  const fileStream = await fetch(`${base}/api/chat/runs/${withFile.run.id}/events`, { headers: { accept: 'text/event-stream' } });
  const fileFrames = reader(fileStream);
  for (;;) {
    const frame = await fileFrames.next();
    if (frame === null || frame.event === 'run.completed' || frame.event === 'run.failed') break;
  }
  const storedFile = await fetch(`${base}/api/chat/runs/${withFile.run.id}`).then(response => response.json());
  const pinnedFile = storedFile.run.snapshot?.artifacts?.[0];
  check('the uploaded file is pinned on the run', pinnedFile?.id === uploaded.artifact.id, pinnedFile);
  check('the pinned file keeps its version and hash',
    pinnedFile?.version === 1 && pinnedFile?.sha256 === uploaded.artifact.sha256, pinnedFile?.sha256);
} finally {
  await harness.stop().catch(() => {});
  await unlink(compositionPath).catch(() => {});
}

const failed = results.filter(item => !item.ok);
for (const item of results) console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}${item.detail === undefined ? '' : ` (${JSON.stringify(item.detail)})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
