import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProduct,productEditPayload,variantEditPayload,MedusaClient} from '../apps/medusa-product-catalog/src/catalog.ts';
const raw={id:'prod-fixture',title:'Synthetic',handle:'synthetic',status:'draft',collection_id:'pcol-original',sales_channels:[{id:'sc-original',name:'Synthetic channel'}],images:[{id:'img',url:'https://synthetic.invalid/image.png'}],variants:[]};
test('normalize keeps Medusa collection and sales channels; title-only edit cannot clear relations',()=>{
 const original=normalizeProduct(raw);assert.equal(original.collection_id,raw.collection_id);assert.deepEqual(original.sales_channels.map(x=>x.id),['sc-original']);
 assert.deepEqual(productEditPayload(original,{...original,title:'Edited'}),{title:'Edited'});
 assert.deepEqual(productEditPayload(original,structuredClone(original)),{});
});
test('partial projections omit unknown relations and explicit clearing stays explicit',()=>{
 const {collection_id,sales_channels,...partial}=raw;const original=normalizeProduct(partial);
 assert.equal(Object.hasOwn(original,'collection_id'),false);assert.equal(Object.hasOwn(original,'sales_channels'),false);
 assert.deepEqual(productEditPayload(original,{...original,title:'Edited'}),{title:'Edited'});
 const full=normalizeProduct(raw);assert.deepEqual(productEditPayload(full,{...full,collection_id:null,sales_channels:[]}),{collection_id:null,sales_channels:[]});
});
test('client save sends only edit payload, preserves existing variants and rereads',async()=>{
 const client=new MedusaClient(),calls=[];client.request=async(path,init={})=>{calls.push({path,...init});return{product:raw}};
 const original=normalizeProduct({...raw,variants:[{id:'variant-fixture',title:'Existing'}]});
 await client.saveProductStructure(raw.id,original,{...original,title:'Edited'});
 assert.equal(calls.length,2);assert.deepEqual(JSON.parse(calls[0].body),{title:'Edited'});assert.ok(calls[1].path.includes('?fields='));
});

test('editing a partial variant never clears unknown price, options or inventory policy',()=>{
 const original=normalizeProduct({...raw,variants:[{id:'v1',title:'Old'}]}).variants[0];
 assert.deepEqual(variantEditPayload(original,{...original,title:'Edited'}),{id:'v1',title:'Edited'});
 const full={...original,prices:[{currency_code:'usd',amount:123}],manage_inventory:true,allow_backorder:false};
 assert.deepEqual(variantEditPayload(full,{...full,title:'Edited'}),{id:'v1',title:'Edited'});
 assert.deepEqual(variantEditPayload(full,{...full,prices:[]}),{id:'v1',prices:[]});
});
