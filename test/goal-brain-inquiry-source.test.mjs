import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupplyInquiryBrainSourceAdapter } from '../server/goal-brain-inquiry-source.mjs';
import { createCompositeGoalBrainSourceAdapter } from '../server/goal-brain-source-composite.mjs';

const now = Date.parse('2026-10-16T12:00:00.000Z');
const product = 'gid://shopify/Product/123';
const listing1 = { id:'listing-1', productRef:{productId:product} };
const listingUnknown = { id:'listing-unknown' };

function row(overrides = {}) {
  return {
    id: crypto.randomUUID(), workspaceId:'A', listingId:'listing-1', status:'shared',
    createdAt:'2026-10-10T10:00:00.000Z', createdBy:'buyer-1', notes:'PRIVATE BUYER NOTE',
    destination:'PRIVATE DESTINATION', share:{status:'active',merchantSubject:'merchant',reviewHash:'h'},
    shares:[{status:'active',merchantSubject:'merchant',reviewHash:'h'}], replies:[],
    ...overrides,
  };
}
const state = {
  meta:{sequence:41,updatedAt:'2026-10-16T11:59:00.000Z'},
  supplyNetwork:{version:1,workspaceId:'A',suppliers:[],listings:[listing1,listingUnknown],inquiries:[
    row(),
    row({id:crypto.randomUUID(),createdAt:'2026-10-05T10:00:00.000Z',createdBy:'buyer-2',status:'replied',replies:[{id:'reply-1',content:'PRIVATE REPLY'}]}),
    row({id:crypto.randomUUID(),createdAt:'2026-10-01T10:00:00.000Z',listingId:'listing-unknown',createdBy:'buyer-3',status:'revoked',share:{status:'revoked',merchantSubject:'merchant',reviewHash:'h'},shares:[{status:'revoked',merchantSubject:'merchant',reviewHash:'h'}]}),
    row({id:crypto.randomUUID(),createdAt:'2026-10-01T10:00:00.000Z',createdBy:'buyer-5',status:'shared'}),
    row({id:crypto.randomUUID(),createdAt:'2026-10-02T10:00:00.000Z',createdBy:'buyer-4',status:'draft',share:null,shares:[]}),
    row({id:crypto.randomUUID(),createdAt:'2026-09-01T10:00:00.000Z',createdBy:'buyer-old',status:'replied',replies:[{id:'reply-old',content:'PRIVATE'}]}),
    row({id:crypto.randomUUID(),createdAt:'2026-08-20T10:00:00.000Z',createdBy:'buyer-old-2',status:'replied',replies:[{id:'reply-old-2',content:'PRIVATE'}]}),
    row({id:crypto.randomUUID(),workspaceId:'FOREIGN',createdAt:'2026-10-08T10:00:00.000Z',createdBy:'buyer-foreign'}),
    row({id:crypto.randomUUID(),createdAt:'2026-10-07T10:00:00.000Z',createdBy:'buyer-shared-history',status:'revoked',share:{status:'revoked',merchantSubject:'other',reviewHash:'h'},shares:[{status:'revoked',merchantSubject:'merchant',reviewHash:'old'}]}),
  ]},
};
const store={read:()=>structuredClone(state)};
const identity={subject:'merchant',workspaceId:'A',role:'admin',sessionId:'s1'};
const binding={workspaceId:'A',conversationId:'c1',receiver:{provider:'test',id:'model'}};

test('projects only enterprise-owned/shared inquiries and excludes drafts/foreign workspaces',async()=>{
  const adapter=createSupplyInquiryBrainSourceAdapter({store,clock:()=>now});
  const refs=await adapter.list({identity,binding});
  assert.equal(refs.length,3);
  const productRef=refs.find(r=>r.id==='inquiry-pipeline:'+product);
  const unknownRef=refs.find(r=>r.id==='inquiry-pipeline:unknown');
  assert.ok(productRef);assert.ok(unknownRef);
  const productRow=await adapter.read({identity,binding,reference:productRef});
  assert.equal(productRow.values.eligible,3);
  assert.equal(productRow.values.progressed,1);
  assert.equal(productRow.values.pending,2);
  assert.equal(productRow.values.unknown,0);
  assert.equal(productRow.values.uniqueCustomers,3);
  assert.equal(productRow.values.segment.productId,product);
  assert.equal(productRow.values.segment.market,'unknown');
  assert.equal(productRow.values.segment.channel,'supply-network');
  assert.equal(productRow.values.baseline.eligible,2);
  assert.equal(productRow.values.baseline.progressed,2);
  const agingRef=refs.find(r=>r.id==='inquiry-aging:'+product);
  assert.ok(agingRef);
  const aging=await adapter.read({identity,binding,reference:agingRef});
  assert.equal(aging.values.metricType,'inquiry-aging-v1');
  assert.equal(aging.values.stale,1);
  assert.equal(aging.values.staleThresholdDays,7);
  const unknownRow=await adapter.read({identity,binding,reference:unknownRef});
  assert.equal(unknownRow.values.eligible,1);
  assert.equal(unknownRow.values.unknown,1);
  assert.equal(unknownRow.values.uniqueCustomers,1);
  assert.equal(unknownRow.values.segment.productId,'unknown');
});

test('current recipient keeps revoked aggregate history without restoring a previous recipient or buyer data',async()=>{
  const adapter=createSupplyInquiryBrainSourceAdapter({store,clock:()=>now});
  const ref=(await adapter.list({identity,binding})).find(r=>r.id==='inquiry-pipeline:unknown');
  const result=await adapter.read({identity,binding,reference:ref});
  const json=JSON.stringify(result.values);
  for(const secret of ['buyer-3','PRIVATE BUYER NOTE','PRIVATE DESTINATION','PRIVATE REPLY','merchant']) assert.equal(json.includes(secret),false);
});

test('current source detects store revision changes before a Brain commit',async()=>{
  const mutable=structuredClone(state);
  const liveStore={read:()=>mutable};
  const adapter=createSupplyInquiryBrainSourceAdapter({store:liveStore,clock:()=>now});
  const ref=(await adapter.list({identity,binding})).find(r=>r.id==='inquiry-pipeline:'+product);
  const expected=await adapter.read({identity,binding,reference:ref});
  assert.equal(expected.observedAt,'2026-10-16T12:00:00.000Z');
  mutable.meta.sequence++;
  assert.throws(()=>adapter.current({identity,binding,reference:ref,expected}),e=>e.code==='BRAIN_SOURCE_CHANGED');
  mutable.meta.sequence=41;
  mutable.supplyNetwork.inquiries[0].share.status='revoked';
  mutable.supplyNetwork.inquiries[0].status='revoked';
  assert.throws(()=>adapter.current({identity,binding,reference:ref,expected}),e=>e.code==='BRAIN_SOURCE_CHANGED');
});

test('foreign workspace is fail-closed instead of silently returning another enterprise',async()=>{
  const foreignStore={read:()=>({meta:state.meta,supplyNetwork:{...state.supplyNetwork,workspaceId:'B'}})};
  const adapter=createSupplyInquiryBrainSourceAdapter({store:foreignStore,clock:()=>now});
  await assert.rejects(()=>adapter.list({identity,binding}),e=>e.code==='BRAIN_SOURCE_SCOPE_MISMATCH');
});

test('existing commerce and inquiry sources share one Brain sourceAdapter contract',async()=>{
  const commerce={list:async()=>[{kind:'metric',id:'commerce-cohort:m:r',revision:'1',sha256:'a'.repeat(64),fields:['metricType']}],read:async()=>({kind:'commerce'}),current:()=>({kind:'commerce'})};
  const inquiry={list:async()=>[{kind:'metric',id:'inquiry-pipeline:'+product,revision:'1',sha256:'b'.repeat(64),fields:['metricType']},{kind:'metric',id:'inquiry-aging:'+product,revision:'1',sha256:'c'.repeat(64),fields:['metricType']}],read:async()=>({kind:'inquiry'}),current:()=>({kind:'inquiry'})};
  const productSource={list:async()=>[{kind:'metric',id:'product-completeness:all',revision:'1',sha256:'d'.repeat(64),fields:['metricType']}],read:async()=>({kind:'product'}),current:()=>({kind:'product'})};
  const composite=createCompositeGoalBrainSourceAdapter({commerce,inquiry,product:productSource});
  assert.equal((await composite.list()).length,4);
  assert.equal((await composite.read({reference:{kind:'metric',id:'commerce-cohort:m:r'}})).kind,'commerce');
  assert.equal((await composite.read({reference:{kind:'metric',id:'inquiry-pipeline:'+product}})).kind,'inquiry');
  assert.equal((await composite.read({reference:{kind:'metric',id:'inquiry-aging:'+product}})).kind,'inquiry');
  assert.equal((await composite.read({reference:{kind:'metric',id:'product-completeness:all'}})).kind,'product');
});
test('inquiry list/read/current stays stable while the real clock advances inside the observation hour',async()=>{
 let clock=now+123;const adapter=createSupplyInquiryBrainSourceAdapter({store,clock:()=>clock++});
 const reference=(await adapter.list({identity,binding}))[0];
 const expected=await adapter.read({identity,binding,reference});
 assert.deepEqual(adapter.current({identity,binding,reference,expected}),expected);
 clock=now+3_600_000;
 assert.throws(()=>adapter.current({identity,binding,reference,expected}),e=>e.code==='BRAIN_SOURCE_CHANGED');
});
