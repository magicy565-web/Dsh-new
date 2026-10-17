import test from 'node:test';
import assert from 'node:assert/strict';
import defaultExtension, { createMarketplaceExtension } from '../plugins/workspace-marketplace/src/extension.js';
import { fixture, buyer, seller } from './fixtures/marketplace.mjs';
function register(extension){const tools=[];extension({registerTool:t=>tools.push(t)});return tools;}
test('ordinary plugin installation has no Host or private identity',async()=>{const tools=register(defaultExtension);assert.equal(tools.length,4);for(const t of tools)assert.equal((await t.execute('x',{})).details.code,'MARKETPLACE_UNCONFIGURED');});
test('plugin exposes no payment, approval, run, accept or provider write tool',()=>{const names=register(defaultExtension).map(t=>t.name);assert.deepEqual(names,['workspace_marketplace_status','workspace_marketplace_find','workspace_marketplace_propose','workspace_marketplace_order']);});
test('raw legacy service/actor injection remains unconfigured and creates no order',async()=>{const f=await fixture(),l=await f.listing();const tools=register(createMarketplaceExtension({marketplace:f.api,readActor:()=>buyer}));const result=await tools.find(t=>t.name.endsWith('_propose')).execute('call',f.orderInput(l));assert.equal(result.details.status,'unconfigured');assert.equal(f.store.read().workerOrders.length,0);assert.equal(f.stats.submits,0);});
test('private client requires a successful original guard and cancelled tools expose no private error',async()=>{
 const client={revalidateReceipt(){},status(){throw Error('PRIVATE_UPSTREAM_BODY');}};
 assert.throws(()=>register(createMarketplaceExtension({client,registerContextGuard:()=>false})),/MARKETPLACE_CONTEXT_GUARD_REQUIRED/);
 const tools=register(createMarketplaceExtension({client,registerContextGuard:()=>true})),c=new AbortController();c.abort();
 const r=await tools[0].execute('x',{},c.signal);assert.equal(r.details.code,'MARKETPLACE_CANCELLED');assert.ok(!JSON.stringify(r).includes('PRIVATE_UPSTREAM_BODY'));
});
test('Marketplace proof messages reject extra images, mismatched details and non-Marketplace receipts',async()=>{
 const {marketplaceMessageReceipt}=await import('../plugins/workspace-marketplace/src/contract.js');
 const receipt={plugin:'workspace-marketplace',method:'order',view:{status:'draft'}},valid={content:[{type:'text',text:JSON.stringify(receipt)}],details:receipt};assert.deepEqual(marketplaceMessageReceipt(valid),receipt);
 for(const message of [{...valid,content:[...valid.content,{type:'image',data:'synthetic'}]},{...valid,details:{...receipt,private:'UNSELECTED_PRIVATE_BODY'}},{content:[{type:'text',text:JSON.stringify({...receipt,plugin:'other'})}]}])assert.throws(()=>marketplaceMessageReceipt(message),/MARKETPLACE_SOURCE_CHANGED/);
});
