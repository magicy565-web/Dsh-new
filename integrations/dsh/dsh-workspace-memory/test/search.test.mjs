import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceSearch, registerSearchTool } from '../search.js';
import { createMemoryService, createStorageAdapter } from '../service.js';
import { LibraryStore, createLibraryService } from '../../dsh-workspace-library/index.js';

const alpha = randomUUID(), beta = randomUUID();
const execution = (id = 'session-alpha', signal) => ({ agent: { session: { id } }, callId: 'search-fixture', signal });
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'workspace-search-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const workspaces = [{ id: alpha, sessionIds: ['session-alpha'] }, { id: beta, sessionIds: ['session-beta'] }];
  const registry = { list: () => workspaces, get: id => workspaces.find(row => row.id === id) };
  const library = createLibraryService(new LibraryStore({ dir })); let state = {};
  const memory = createMemoryService({ storage: createStorageAdapter({ get: () => state, async set(next) { state = next; } }), registry, getLibrary: () => library });
  const options = { registry, memory, getLibrary: () => library, getInquiries: () => undefined };
  const search = createWorkspaceSearch(options); t.after(async () => { await search.close(); await memory.close(); });
  async function remember(workspace, approved, factKey) {
    const result = await memory.propose(workspace, { requestId: randomUUID(), subjectType: 'company', subjectId: 'company', factKey, statement: 'Linen policy', source: { kind: 'operator', basis: 'Synthetic operator fixture' } });
    if (approved) await memory.review(workspace, result.record.id, { requestId: randomUUID(), expectedRevision: (await memory.state(workspace)).revision, decision: 'approve' });
    return result.record;
  }
  return { search, options, registry, library, memory, remember };
}
test('discovery is read-only, preserves version pins and separates profile library from workspace memory', async t => {
  const f = await setup(t);
  const doc = await f.library.addDocument({ title: 'Linen policy', content: 'do not expose original text in discovery' });
  await f.library.addDocumentVersion(doc.id, { content: 'new original' });
  await f.library.saveProduct({ name: 'Linen fabric' });
  await f.library.saveProduct({ name: 'Linen archived', status: 'archived' });
  const approved = await f.remember(alpha, true, 'approved'); const pending = await f.remember(alpha, false, 'pending'); const foreign = await f.remember(beta, true, 'foreign');
  const before = await f.library.status();
  const result = await f.search.execute({ q: 'Linen' }, execution());
  assert.equal(result.discoveryOnly, true); assert.equal(result.exhaustive, false);
  const library = result.groups.find(group => group.name === 'library');
  assert.equal(library.items.filter(item => item.kind === 'product').length, 1);
  assert.ok(library.items.every(item => item.scope === 'profile'));
  const old = library.items.find(item => item.version === 1); assert.equal(old.sha256, doc.versions[0].sha256);
  assert.equal(old.isCurrentVersion, false);
  assert.equal((await f.library.readReferences(old.reader.arguments.references)).items[0].content, 'do not expose original text in discovery');
  const hits = result.groups.find(group => group.name === 'memory').items;
  assert.equal(hits.length, 1); assert.equal(hits[0].id, approved.id); assert.equal(hits[0].workspaceId, alpha);
  assert.equal(JSON.stringify(result).includes(pending.id), false); assert.equal(JSON.stringify(result).includes(foreign.id), false);
  assert.equal(JSON.stringify(result).includes('do not expose'), false);
  assert.equal(result.groups.find(group => group.name === 'inquiries').status, 'unavailable');
  assert.equal((await f.library.status()).sequence, before.sequence);
  assert.equal((await f.search.execute({ q: 'Linen', sources: ['memory'] }, execution('session-beta'))).groups[0].items[0].id, foreign.id);
});
test('revoked memory and archived documents are excluded; discovery never uses raw document snippets', async t => {
  const f = await setup(t), record = await f.remember(alpha, true, 'revoke');
  const doc = await f.library.addDocument({ title: 'Linen private', content: 'not searchable by body-only term' });
  await f.library.updateDocument(doc.id, { expectedRevision: 1, changes: { status: 'archived' } });
  await f.memory.revoke(alpha, record.id, { requestId: randomUUID(), expectedRevision: (await f.memory.state(alpha)).revision, reason: 'Fixture revocation' });
  const result = await f.search.execute({ q: 'Linen' }, execution());
  assert.equal(result.groups.find(group => group.name === 'memory').items.length, 0);
  assert.equal(result.groups.find(group => group.name === 'library').items.length, 0);
});
test('failed sources differ from empty results and cannot substitute a different workspace', async t => {
  const f = await setup(t);
  const search = createWorkspaceSearch({ ...f.options, getInquiries: () => ({ async toolRead() { return { workspaceId: beta, items: [] }; } }) }); t.after(() => search.close());
  const result = await search.execute({ q: 'Linen' }, execution());
  assert.equal(result.groups.find(group => group.name === 'library').status, 'available');
  assert.equal(result.groups.find(group => group.name === 'inquiries').status, 'failed');
  assert.equal(result.groups.find(group => group.name === 'inquiries').code, 'SEARCH_SOURCE_CHANGED');
});
test('invalid inputs, cancellation and a changed native session owner reject before returning hits', async t => {
  const f = await setup(t);
  for (const body of [{ q: '' }, { q: 'x', workspaceId: beta }, { q: 'x', sources: ['memory', 'memory'] }, { q: 'x', perSourceLimit: 11 }])
    await assert.rejects(() => f.search.execute(body, execution()));
  await assert.rejects(() => f.search.execute({ q: 'x' }, execution('unknown')), { code: 'SEARCH_WORKSPACE_REQUIRED' });
  await assert.rejects(() => f.search.execute({ q: 'x' }, execution('session-alpha', AbortSignal.abort())), { code: 'SEARCH_CANCELLED' });
  const moving = createWorkspaceSearch({ ...f.options, memory: { async recall() { f.registry.get(alpha).sessionIds = []; return { workspaceId: alpha, items: [] }; } } }); t.after(() => moving.close());
  await assert.rejects(() => moving.execute({ q: 'x', sources: ['memory'] }, execution()), { code: 'SEARCH_WORKSPACE_REQUIRED' });
});
test('native registration disposes cleanly and output remains bounded', async t => {
  const f = await setup(t), tools = new Map(), disposers = [];
  registerSearchTool({ effect: fn => disposers.push(fn()), tools: { register(def) { tools.set(def.name, def); return () => tools.delete(def.name); } } }, f.search);
  const tool = tools.get('workspace_context_search');
  assert.equal((await tool.execute({ q: 'x' }, execution())).workspaceId, alpha);
  assert.ok(tool.output.render({}, { discoveryOnly: true })[0].text.includes('discoveryOnly'));
  disposers.reverse().forEach(dispose => dispose()); assert.equal(tools.size, 0);
  const oversized = { products: async () => ({ items: [{ id: 'prd_fixture', name: 'x'.repeat(33_000) }] }), referenceCandidates: async () => ({ items: [] }) };
  const large = createWorkspaceSearch({ ...f.options, getLibrary: () => oversized }); t.after(() => large.close());
  await assert.rejects(() => large.execute({ q: 'x', sources: ['library'] }, execution()), { code: 'SEARCH_TOO_LARGE' });
  await f.search.close(); await assert.rejects(() => f.search.execute({ q: 'x' }, execution()), { code: 'SEARCH_CANCELLED' });
});
