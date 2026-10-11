import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { createNativeMuseBinding } from '../../server/muse-worker-native.mjs';
import fs from 'node:fs';
// Original relay bytes with only its unavailable Harness error helper stubbed.
const relaySource = fs.readFileSync(new URL('../../deploy/muse-native-overlay/server/workspace-muse-session-host.mjs', import.meta.url), 'utf8');
const relayImport = 'import { pluginFail } from ' + String.fromCharCode(39) + './workspace-plugin-config.mjs' + String.fromCharCode(39) + ';';
if (!relaySource.includes(relayImport)) throw Error('Original relay fixture anchor changed');
const { createMuseSessionRelay } = await import('data:text/javascript;base64,' + Buffer.from(relaySource.replace(relayImport, 'const pluginFail = (code, message) => { throw Object.assign(Error(message), { code }); };')).toString('base64'));
export const actor = { subject: 'original-requester', nativeAgentId: 'original-session' };
export const hash = value => createHash('sha256').update(value).digest('hex');
const key = 'memory-contract-key-not-a-credential-0123456789';
export const workerId = 'cf4a108c-8051-48bb-9bd2-b8e5a10a1db1';

// Synthetic serialized copy-on-write writer and native Session. JSON remounts
// verify protocol recovery only; they do not prove fsync/ACL or original Harness.
export async function museConversationFixture(t) {
  let state = { workerOrders: [], artifacts: [], activity: [], messages: [], conversations: [] };
  let queue = Promise.resolve(), epoch = 1, active = true, failure, flush = true, binding;
  const context = new AsyncLocalStorage(), blobs = new Map(), events = [];
  function check() {
    const token = context.getStore();
    if (!token || token.epoch !== epoch) throw Object.assign(Error('Revoked parent epoch'), { code: 'WORKSPACE_PLUGIN_STALE' });
    if (token.active && !active) throw Object.assign(Error('Paused parent'), { code: 'WORKSPACE_PLUGIN_PAUSED' });
  }
  const store = { read: () => structuredClone(state), update(callback) {
    check(); const token = context.getStore();
    const pending = queue.then(() => context.run(token, () => {
      check(); const next = structuredClone(state), result = callback(next);
      if (failure?.when(next)) { const error = failure.error; failure = undefined; throw error; }
      state = next; return structuredClone(result);
    })); queue = pending.catch(() => {}); return pending;
  } };
  const artifacts = { async create(input, options) {
    check(); const bytes = input.base64 === undefined ? Buffer.from(input.content) : Buffer.from(input.base64, 'base64');
    let item;
    await store.update(next => {
      options.check(next);
      item = next.artifacts.find(row => row.requestId === input.requestId);
      if (!item) {
        item = { id: randomUUID(), requestId: input.requestId, metadata: input.metadata, workerOwner: options.workerOwner,
          filename: input.filename, currentVersion: 1, versions: [{ version: 1, filename: input.filename, sha256: hash(bytes), size: bytes.length }] };
        next.artifacts.push(item);
      } else if (item.versions[0].sha256 !== hash(bytes)) throw Error('Fixture file conflict');
    });
    blobs.set(item.id, bytes); return { artifact: structuredClone(item) };
  }, download(id, options = {}) {
    check(); const item = state.artifacts.find(row => row.id === id), version = options.version ?? 1;
    return { artifact: structuredClone(item), version: structuredClone(item.versions.find(row => row.version === version)),
      bytes: blobs.get(id), mimeType: 'application/json' };
  } };
  function mount() {
    const pinned = epoch;
    return createNativeMuseBinding({ store, artifacts, actor, operators: [actor], expectedHost: 'fixture.test',
      config: { workerId, ownerId: 'original-muse', tokenDigest: hash(key), enabled: true, scopeReviewed: true, externalBudgetVerified: true },
      run: (callback, { active }) => context.run({ epoch: pinned, active }, async () => { check(); const result = await callback(); check(); return result; }),
      readBody: async (req, maximum) => { const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const bytes = Buffer.concat(chunks); if (bytes.length > maximum) throw Error('Fixture body too large'); return JSON.parse(bytes); },
      respond(res, status, body) { res.status = status; res.body = body; } });
  }
  binding = mount();
  t.after(() => binding.close());
  async function call(taskId, operation, body) {
    const pathname = '/api/muse-worker/v1/tasks/' + taskId + '/' + operation;
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method: 'POST', url: pathname, socket: { remoteAddress: '127.0.0.1' },
      headers: { host: 'fixture.test', authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      rawHeaders: ['Host', 'fixture.test', 'Authorization', 'Bearer ' + key, 'Content-Type', 'application/json'] });
    const res = {}; await binding.handle(req, res, pathname); return res;
  }
  const agent = { session: { id: actor.nativeAgentId, ownEvents: () => structuredClone(events) },
    send(message, mode, run) {
      if (mode !== 'next-step' || run !== false) throw Error('Fixture forbids starting model turns');
      events.push({ type: 'agent/inbox/spliced', data: { inserted: [structuredClone(message)] } });
    } };
  const ctx = { agents: { get: id => id === actor.nativeAgentId ? agent : undefined }, sessions: { flush: async () => flush } };
  const relay = createMuseSessionRelay({ ctx, service: { muse: { bindSession: a => binding.bindSession(a) } }, actor });
  const input = requestId => ({ provider: 'muse', conversationId: actor.nativeAgentId, requestId, content: 'Public fixture research request',
    order: { serviceId: 'channel-validation', product: 'Public fixture product', market: 'US',
      objective: 'Protocol fixture only; no real research, contact or payment.', budgetCredits: 5,
      deadlineAt: new Date(Date.now() + 86400_000).toISOString(), publicDataConfirmed: true } });
  async function approveAndDispatch(inputValue) {
    const made = await binding.bindConversation(actor).prepare(inputValue);
    const { orderId, reviewHash } = made.delegation;
    await binding.bindDesk(actor).approve(orderId, { confirmed: true, expectedReviewHash: reviewHash });
    await binding.bindDesk(actor).dispatch(orderId); return binding.bindConversation(actor).get(orderId);
  }
  async function deliver(orderId, attempt) {
    const bytes = Buffer.from(JSON.stringify({ schema: 'workspace.worker.delivery.v1', orderId,
      deliverables: [{ name: 'Synthetic report', type: 'report', summary: 'No real Muse research' }],
      evidence: [{ title: 'Fixture source', url: 'https://www.loc.gov/about/', detail: 'Contract evidence only' }] }));
    const uploaded = await call(orderId, 'upload-file', { attemptId: attempt.attemptId, fence: attempt.fence,
      uploadId: 'original-upload', filename: 'result.json', base64: bytes.toString('base64'), sha256: hash(bytes) });
    await call(orderId, 'submit-result', { attemptId: attempt.attemptId, fence: attempt.fence, requestId: 'original-submit',
      summary: 'Synthetic fixture result', sources: ['https://www.loc.gov/about/'], toolEvidence: [],
      evidenceNote: 'Local protocol fixture; original Muse execution is unverified.' });
    return { bytes, artifactId: uploaded.body.artifactId };
  }
  return { store, input, call, deliver, approveAndDispatch, relay, events, blobs,
    api: () => binding.bindConversation(actor), desk: () => binding.bindDesk(actor), binding: () => binding,
    change(fn) { fn(state); }, pause() { active = false; }, failFlush(value) { flush = !value; },
    failNext(when, error = Object.assign(Error('Fixture persistence failure'), { code: 'EPERM' })) { failure = { when, error }; },
    async restart() { await binding.close(); state = JSON.parse(JSON.stringify(state)); epoch++; binding = mount(); await binding.initialize(); },
  };
}
