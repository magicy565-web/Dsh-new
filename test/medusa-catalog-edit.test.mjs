import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProduct,productEditPayload,variantEditPayload,MedusaClient} from '../apps/medusa-product-catalog/src/catalog.ts';
import {productContextPayload,importedContextPayload} from '../apps/medusa-product-catalog/src/catalog.ts';
const raw={id:'prod-fixture',title:'Synthetic',handle:'synthetic',status:'draft',collection_id:'pcol-original',sales_channels:[{id:'sc-original',name:'Synthetic channel'}],images:[{id:'img',url:'https://synthetic.invalid/image.png'}],variants:[]};

test('context client preserves initial version zero and binds approval to the reviewer snapshot',()=>{
 const context={id:'ctx-fixture',product_id:raw.id,status:'ready_for_review',readiness_score:90};
 assert.equal(productContextPayload(context).review_version,0);
 assert.equal(productContextPayload({...context,review_version:0}).review_version,0);
 assert.throws(()=>productContextPayload({...context,status:'approved'}),/重新打开/);
 const snapshot='a'.repeat(64);
 const approved=productContextPayload({...context,status:'approved',review_version:7},snapshot);
 assert.equal(approved.review_version,7);assert.equal(approved.source_hash,snapshot);
 assert.equal(approved.reviewed_by,undefined);
});
test('context import never promotes CSV approval and keeps the actual current version and fingerprint',()=>{
 const imported={id:'ctx-fixture',product_id:raw.id,status:'approved',readiness_score:100};
 const body=importedContextPayload(imported,{product_context:{...imported,review_version:23},review_source_hash:'b'.repeat(64)});
 assert.equal(body.status,'ready_for_review');assert.equal(body.review_version,23);assert.equal(body.source_hash,'b'.repeat(64));
 const first=importedContextPayload(imported,{product_context:null,review_source_hash:'c'.repeat(64)});
 assert.equal(first.review_version,0);assert.equal(first.status,'ready_for_review');
});
test('context integer ceiling requires the GET fingerprint even for withdrawal; no wrap or synthetic version 1',()=>{
 const context={id:'ctx-fixture',product_id:raw.id,status:'blocked',readiness_score:0,review_version:2147483647};
 assert.throws(()=>productContextPayload(context),/重新打开/);
 assert.equal(productContextPayload(context,'d'.repeat(64)).review_version,2147483647);
 assert.throws(()=>productContextPayload({...context,review_version:2147483648},'d'.repeat(64)));
});
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

test('actual editor sanitizer plus client title-only save preserves partial and unmatched variant assignments',async()=>{
 const {sanitizeProductDraft}=await import('../apps/medusa-product-catalog/src/product-editor.ts');
 for(const assignment of [undefined,{Color:'Not in current partial options'}]){
  const original=normalizeProduct({...raw,options:[{id:'opt',title:'Color',values:[{value:'Red'}]}],variants:[{id:'v1',title:' Existing spacing ',...(assignment?{options:assignment}:{})}]});
  const client=new MedusaClient(),calls=[];client.request=async(path,init={})=>{calls.push({path,...init});return{product:raw}};
  const draft=sanitizeProductDraft({...structuredClone(original),title:'Only title changed'});
  await client.saveProductStructure(raw.id,original,draft);
  assert.deepEqual(JSON.parse(calls[0].body),{title:'Only title changed'});
  assert.equal(calls.length,2,'No variant batch write may be created by editor normalization');
  assert.deepEqual(draft.variants,original.variants);
 }
});
