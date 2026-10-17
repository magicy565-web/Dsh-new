import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMedusaCatalogConfiguration, createMedusaCatalogService, medusaSourceHash } from '../server/medusa-catalog.mjs';

const workspaceId = 'factory-test';
const admin = { workspaceId, subject: 'owner', role: 'admin' };
const operator = { workspaceId, subject: 'assistant', role: 'operator' };
function source() {
  return { id: randomUUID(), revision: 1, name: 'Printed textile', description: 'Reviewed non-secret catalog description.',
    category: 'Fabric', status: 'draft', source: { kind: 'user_provided' },
    skus: [{ id: randomUUID(), code: 'SECRET-SKU', moq: 1000, priceTiers: [{ minQuantity: 1000, currency: 'USD', unitPrice: '1.25' }] }],
    supply: { samplePolicy: 'SECRET-POLICY' }, documents: [{ documentId: randomUUID() }], images: [{ id: randomUUID() }] };
}
function setup({ connected = true, owner = source(), remoteProduct = null, rejectPost = false } = {}) {
  const seen = []; let remote = remoteProduct;
  const library = { getProduct(id) {
    if (id !== owner.id) throw Object.assign(new Error('Not found'), { status: 404, code: 'NOT_FOUND' });
    return { product: structuredClone(owner) };
  } };
  const environment = connected ? { WORKSPACE_MEDUSA_SINGLE_TENANT_ACK: '1', WORKSPACE_MEDUSA_WORKSPACE_ID: workspaceId,
    WORKSPACE_MEDUSA_BASE_URL: 'http://127.0.0.1:9000', WORKSPACE_MEDUSA_SECRET_API_KEY: 'sk_test_nonreal' } : {};
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url); seen.push({ url: parsed.pathname, method: init.method, headers: init.headers, body: init.body, redirect: init.redirect });
    assert.equal(parsed.hostname, '127.0.0.1');
    assert.equal(init.headers.Authorization, 'Basic sk_test_nonreal');
    assert.equal(init.redirect, 'error');
    if (init.method === 'GET') return Response.json({ products: remote ? [remote] : [], count: remote ? 1 : 0 });
    if (init.method === 'POST' && !rejectPost) {
      remote = { id: 'prod_real-shaped', ...JSON.parse(init.body) }; return Response.json({ product: remote }, { status: 200 });
    }
    throw new Error('synthetic network lost after write');
  };
  return { owner, seen, library, get remote() { return remote; },
    service: createMedusaCatalogService({ library, environment, workspaceId, fetchImpl }) };
}
test('Medusa connection is opt-in and rejects non-exact enterprise isolation', async () => {
  const f = setup({ connected: false }); const p = f.service.preview(f.owner.id, admin);
  assert.equal(p.medusa.configured, false);
  assert.equal((await f.service.reconcile(f.owner.id, admin)).remote.status, 'unconfigured');
  await assert.rejects(f.service.saveDraft(f.owner.id, { requestId: randomUUID() }, admin), { code: 'MEDUSA_UNCONFIGURED' });
  assert.equal(f.seen.length, 0);
  assert.equal(createMedusaCatalogConfiguration({ WORKSPACE_MEDUSA_BASE_URL: 'https://shop.example.com',
    WORKSPACE_MEDUSA_SECRET_API_KEY: 'secret', WORKSPACE_MEDUSA_SINGLE_TENANT_ACK: '1',
    WORKSPACE_MEDUSA_WORKSPACE_ID: 'another-factory' }, workspaceId).configured, false);
  assert.throws(() => createMedusaCatalogConfiguration({ WORKSPACE_MEDUSA_BASE_URL: 'http://169.254.169.254',
    WORKSPACE_MEDUSA_SECRET_API_KEY: 'secret', WORKSPACE_MEDUSA_SINGLE_TENANT_ACK: '1',
    WORKSPACE_MEDUSA_WORKSPACE_ID: workspaceId }, workspaceId), /HTTPS or (?:exact )?loopback/);
});
test('Private manufacturer pricing, policy, assets and stock never leave through Medusa draft', async () => {
  const f = setup(); const preview = f.service.preview(f.owner.id, admin).preview;
  assert.equal(preview.sourceHash, medusaSourceHash(f.owner));
  assert.equal(preview.title, f.owner.name);
  assert.ok(!JSON.stringify(preview).includes('SECRET-'));
  const saved = await f.service.saveDraft(f.owner.id, {
    requestId: randomUUID(), expectedRevision: preview.revision, sourceHash: preview.sourceHash, confirmed: true,
  }, admin);
  assert.equal(saved.created, true); assert.equal(saved.remote.status, 'linked');
  const wire = JSON.parse(f.seen.find(row => row.method === 'POST').body);
  assert.deepEqual(Object.keys(wire).sort(), ['description', 'handle', 'metadata', 'status', 'title']);
  assert.equal(wire.status, 'draft');
  assert.equal(wire.title, f.owner.name);
  assert.ok(!JSON.stringify(wire).includes('SECRET-'));
  assert.ok(!JSON.stringify(wire).includes('price'));
  assert.equal(wire.metadata.workspace_id, workspaceId);
  assert.equal(wire.metadata.workspace_source_revision, 1);
  assert.equal((await f.service.reconcile(f.owner.id, admin)).remote.status, 'linked');
  const repeated = await f.service.saveDraft(f.owner.id, {
    requestId: randomUUID(), expectedRevision: 1, sourceHash: preview.sourceHash, confirmed: true,
  }, admin);
  assert.equal(repeated.created, false);
  assert.equal(f.seen.filter(row => row.method === 'POST').length, 1);
});
test('Agent/operator cannot silently write or use stale source and cannot adopt foreign remote', async () => {
  const f = setup(); const p = f.service.preview(f.owner.id, operator).preview;
  assert.equal(p.eligible, true);
  const params = { requestId: randomUUID(), expectedRevision: p.revision, sourceHash: p.sourceHash, confirmed: true };
  await assert.rejects(f.service.saveDraft(f.owner.id, params, operator), { code: 'MEDUSA_ROLE_REQUIRED' });
  await assert.rejects(f.service.saveDraft(f.owner.id, { ...params, confirmed: false }, admin), { code: 'MEDUSA_SOURCE_REVIEW_REQUIRED' });
  await assert.rejects(f.service.saveDraft(f.owner.id, { ...params, sourceHash: 'f'.repeat(64) }, admin), { code: 'MEDUSA_SOURCE_REVIEW_REQUIRED' });
  assert.throws(() => f.service.preview(f.owner.id, { ...admin, workspaceId: 'other' }), { code: 'MEDUSA_ROLE_REQUIRED' });
  assert.equal(f.seen.length, 0);
  const foreign = setup({ owner: f.owner, remoteProduct: { id: 'prod_foreign', handle: p.handle, title: p.title,
    description: p.description, status: 'draft', metadata: { workspace_id: 'someone-else' } } });
  await assert.rejects(foreign.service.saveDraft(f.owner.id, params, admin), { code: 'MEDUSA_REMOTE_CONFLICT' });
  assert.equal(foreign.seen.filter(row => row.method === 'POST').length, 0);
});
test('Revisions and published remote status fail closed; transport loss remains unknown', async () => {
  const f = setup(); const p = f.service.preview(f.owner.id, admin).preview;
  const body = { requestId: randomUUID(), expectedRevision: 1, sourceHash: p.sourceHash, confirmed: true };
  const saved = await f.service.saveDraft(f.owner.id, body, admin);
  assert.equal(saved.remote.status, 'linked');
  f.owner.revision = 2; f.owner.description = 'new original revision';
  assert.equal((await f.service.reconcile(f.owner.id, admin)).remote.status, 'stale');
  await assert.rejects(f.service.saveDraft(f.owner.id, body, admin), { code: 'MEDUSA_SOURCE_REVIEW_REQUIRED' });
  f.owner.revision = 1; f.owner.description = p.description; f.remote.status = 'published';
  assert.equal((await f.service.reconcile(f.owner.id, admin)).remote.status, 'not_draft');
  const failed = setup({ rejectPost: true }); const q = failed.service.preview(failed.owner.id, admin).preview;
  await assert.rejects(failed.service.saveDraft(failed.owner.id,
    { requestId: randomUUID(), expectedRevision: q.revision, sourceHash: q.sourceHash, confirmed: true }, admin),
  { code: 'MEDUSA_TRANSPORT_UNCERTAIN' });
  assert.equal(failed.seen.filter(row => row.method === 'POST').length, 1);
});

test('stale and published remote private text never enters service or model receipts', async () => {
  const {createMedusaProductClient}=await import('../server/medusa-product-client.mjs');
  const f=setup(),preview=f.service.preview(f.owner.id,admin).preview;
  await f.service.saveDraft(f.owner.id,{requestId:randomUUID(),expectedRevision:1,sourceHash:preview.sourceHash,confirmed:true},admin);
  f.remote.title='REMOTE_PRIVATE_TITLE';f.remote.description='REMOTE_PRIVATE_DESCRIPTION';
  const client=createMedusaProductClient({identity:admin,authorize:async()=>true,assertCurrent:()=>true,
    materialsClient:{materials:async()=>({status:'available',products:[{id:f.owner.id,revision:1,name:f.owner.name,description:f.owner.description,category:f.owner.category,status:f.owner.status,provenance:{kind:'user_provided'}}],sources:[{id:f.owner.id}],authorization:{workspaceId,subject:admin.subject}})},
    medusaCatalog:f.service});
  for(const [remoteStatus,expected]of [['draft','stale'],['published','not_draft']]){
    f.remote.status=remoteStatus;
    const service=await f.service.reconcile(f.owner.id,admin),receipt=await client.reconcile({productId:f.owner.id});
    assert.equal(receipt.view.remote.status,expected);assert.equal(receipt.view.remote.product,null);
    assert.ok(!JSON.stringify(service).includes('REMOTE_PRIVATE'));assert.ok(!JSON.stringify(receipt).includes('REMOTE_PRIVATE'));
  }
  // Independent model boundary remains safe even if an upstream adapter returns text.
  const unsafe={...f.service,reconcile:async()=>({preview,medusa:{configured:true},remote:{status:'stale',product:{title:'REMOTE_PRIVATE_TITLE',description:'REMOTE_PRIVATE_DESCRIPTION'}}})};
  const guarded=createMedusaProductClient({identity:admin,authorize:async()=>true,assertCurrent:()=>true,materialsClient:{materials:async()=>({status:'available',products:[{id:f.owner.id,revision:1,name:f.owner.name,description:f.owner.description,category:f.owner.category,status:f.owner.status,provenance:{kind:'user_provided'}}],sources:[{id:f.owner.id}],authorization:{workspaceId,subject:admin.subject}})},medusaCatalog:unsafe});
  assert.ok(!JSON.stringify(await guarded.reconcile({productId:f.owner.id})).includes('REMOTE_PRIVATE'));
});
