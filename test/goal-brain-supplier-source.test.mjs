import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupplierCommerceBrainSourceAdapter } from '../server/goal-brain-supplier-source.mjs';

const productId='gid://shopify/Product/123';
const monitor={
  id:'m-123',serviceId:'svc-1',subject:'owner',workspaceId:'A',scope:{productId},
  checks:[
    {requestId:'r-old',sample:{sampledAt:'2026-09-10T10:00:00Z',coverage:{from:'2026-08-01T00:00:00Z',to:'2026-08-08T00:00:00Z'},salesStatus:'available',sales:{grossOrders:100,retainedOrders:15}}},
    {requestId:'r-new',sample:{sampledAt:'2026-10-10T10:00:00Z',coverage:{from:'2026-09-01T00:00:00Z',to:'2026-09-08T00:00:00Z'},salesStatus:'available',sales:{grossOrders:100,retainedOrders:10}}},
  ],
};
const service={id:'svc-1'};
function fakeSupplierService(){
  return {forActor(actor){
    if(actor.workspaceId!=='A') throw new Error('wrong workspace');
    return {list:()=>[service],monitors:()=>[structuredClone(monitor)]};
  }};
}
const identity={subject:'owner',workspaceId:'A',role:'admin',sessionId:'s1'};
const binding={workspaceId:'A',conversationId:'c1',receiver:{provider:'test',id:'model'}};
test('existing Supplier Monitoring becomes a versioned Brain metric source without new storage',async()=>{
  const adapter=createSupplierCommerceBrainSourceAdapter({supplierService:fakeSupplierService()});
  const refs=await adapter.list({identity,binding});
  assert.equal(refs.length,1);
  const current=refs.find(ref=>ref.id.endsWith(':r-new'));
  assert.equal(current.kind,'metric');
  const row=await adapter.read({identity,binding,reference:current});
  assert.equal(row.values.metricType,'commerce-product-cohort-v1');
  assert.equal(row.values.eligible,100);assert.equal(row.values.converted,10);
  assert.equal(row.values.baseline.converted,15);
  assert.equal(row.values.segment.productId,productId);
  const same=adapter.current({identity,binding,reference:current,expected:row});
  assert.deepEqual(same,row);
});
test('changed source revision is detected synchronously before a Brain commit',async()=>{
  const supplier=fakeSupplierService();
  const adapter=createSupplierCommerceBrainSourceAdapter({supplierService:supplier});
  const refs=await adapter.list({identity,binding});const current=refs.find(ref=>ref.id.endsWith(':r-new'));
  const expected=await adapter.read({identity,binding,reference:current});
  const original=monitor.checks[1].sample.sales.retainedOrders;
  monitor.checks[1].sample.sales.retainedOrders=8;
  // The fake service clones monitor, so replace it with a live projection for this test.
  supplier.forActor=()=>({list:()=>[service],monitors:()=>[monitor]});
  assert.throws(()=>adapter.current({identity,binding,reference:current,expected}),e=>e.code==='BRAIN_SOURCE_CHANGED');
  monitor.checks[1].sample.sales.retainedOrders=original;
});
test('unsupported or foreign metric references fail closed',async()=>{
  const adapter=createSupplierCommerceBrainSourceAdapter({supplierService:fakeSupplierService()});
  await assert.rejects(()=>adapter.read({identity,binding,reference:{kind:'metric',id:'commerce-cohort:foreign:r-new',revision:'x',sha256:'0'.repeat(64),fields:[]}}),e=>e.code==='BRAIN_SOURCE_CHANGED');
  await assert.rejects(()=>adapter.read({identity,binding,reference:{kind:'product',id:'x'}}),e=>e.code==='BRAIN_SOURCE_NOT_SELECTED');
});
