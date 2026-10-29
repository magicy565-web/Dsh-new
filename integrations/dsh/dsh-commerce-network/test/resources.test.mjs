import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LibraryStore,createLibraryService} from '../../dsh-workspace-library/index.js';
import {createResourceAdapter} from '../resources.js';

const workspaceId='00000000-0000-0000-0000-000000000001',otherWorkspace='00000000-0000-0000-0000-000000000002';
const projectId='market-us';
async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'commerce-resource-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=new LibraryStore({dir,clock:()=>Date.parse('2026-10-28T00:00:00.000Z')});
  const library=createLibraryService(store);
  const product=await library.saveProduct({name:'Linen throw',description:'Supplier statement for research',category:'Home',skus:[{
    code:'LINEN',unit:'piece',moq:200,leadTimeDays:25,pricingMode:'tiered',pricingNote:'secret negotiation note',
    priceTiers:[{minQuantity:200,unitPrice:'4.83',currency:'USD'}],
    specs:[{key:'material',value:'linen'},{key:'internal cost',value:'1.04'},{key:'margin',value:'38%'}],
  }],supply:{paymentTerms:'internal account details',capacityNote:'private capacity'}});
  let available=true,authorized=true,disclosureApproved=false;
  const mappings=new Map();
  const adapter=createResourceAdapter({getLibrary:()=>available?library:null,clock:()=>Date.parse('2026-10-28T00:00:00.000Z'),assertScope:s=>{
    if(!authorized||s.workspaceId!==workspaceId||s.projectId!==projectId||JSON.stringify(mappings.get(s.ref))!==JSON.stringify(s.sourceRef))return false;
    return {disclosureApproved};
  }});
  const map=(ref,sourceRef)=>{mappings.set(ref,sourceRef);return {workspaceId,projectId,ref,sourceRef};};
  const mapping=map('product:plan-product',{kind:'product',id:product.id,revision:1});
  return {store,library,product,adapter,mapping,map,disable:()=>{available=false;},revoke:()=>{authorized=false;},approveDoc:()=>{disclosureApproved=true;}};
}

test('real native product read exports exact revision and useful fields without internal pricing',async t=>{
  const f=await fixture(t),snapshot=await f.adapter.resolve(f.mapping);
  assert.equal(snapshot.content.name,'Linen throw');assert.equal(snapshot.version,1);
  assert.equal(snapshot.content.skus[0].moq,200);assert.deepEqual(snapshot.content.skus[0].specs,[{key:'material',value:'linen'}]);
  const wire=JSON.stringify(snapshot);
  for(const secret of ['4.83','1.04','38%','secret negotiation','internal account','private capacity','priceTiers','paymentTerms'])assert.equal(wire.includes(secret),false,secret);
  assert.equal(snapshot.source.scope,'profile');assert.equal(snapshot.source.reviewState,'unreviewed');
  assert.equal(snapshot.content.verification,'supplier_provided');
  assert.deepEqual(await f.adapter.verify(snapshot,{workspaceId,projectId,ref:f.mapping.ref}),snapshot);
  assert.equal((await f.library.product(f.product.id)).product.skus[0].priceTiers[0].unitPrice,'4.83');
});

test('scope mapping is checked on every source read and cannot cross a workspace or project',async t=>{
  const f=await fixture(t),snapshot=await f.adapter.resolve(f.mapping);
  await assert.rejects(()=>f.adapter.verify(snapshot,{workspaceId:otherWorkspace,projectId,ref:f.mapping.ref}),{code:'RESOURCE_SCOPE'});
  await assert.rejects(()=>f.adapter.resolve({...f.mapping,projectId:'other'}),{code:'RESOURCE_SCOPE'});
  f.revoke();await assert.rejects(()=>f.adapter.verify(snapshot,{workspaceId,projectId,ref:f.mapping.ref}),{code:'RESOURCE_SCOPE'});
});

test('product revision drift, archive and removed native plugin invalidate prior disclosures',async t=>{
  const f=await fixture(t),snapshot=await f.adapter.resolve(f.mapping);
  await f.library.saveProduct({productId:f.product.id,expectedRevision:1,changes:{description:'New specification'}});
  await assert.rejects(()=>f.adapter.verify(snapshot,{workspaceId,projectId,ref:f.mapping.ref}),{code:'RESOURCE_CHANGED'});
  const next=f.map(f.mapping.ref,{kind:'product',id:f.product.id,revision:2});
  const current=await f.adapter.resolve(next);
  await f.library.saveProduct({productId:f.product.id,expectedRevision:2,changes:{status:'archived'}});
  await assert.rejects(()=>f.adapter.verify(current,{workspaceId,projectId,ref:f.mapping.ref}),{code:'RESOURCE_CHANGED'});
  f.disable();await assert.rejects(()=>f.adapter.resolve(next),{code:'RESOURCE_UNAVAILABLE'});
});

test('native source or authority revoked during an await cannot leak a stale snapshot',async t=>{
  const f=await fixture(t),read=f.library.productContext.bind(f.library);
  f.library.productContext=async(...args)=>{const result=await read(...args);f.revoke();return result;};
  await assert.rejects(()=>f.adapter.resolve(f.mapping),{code:'RESOURCE_SCOPE'});
});

test('source descriptor, content hash and scope tampering fail closed',async t=>{
  const f=await fixture(t),snapshot=await f.adapter.resolve(f.mapping);
  const mutated=structuredClone(snapshot);mutated.content.name='pretend original';
  await assert.rejects(()=>f.adapter.verify(mutated,{workspaceId,projectId,ref:f.mapping.ref}),{code:'RESOURCE_SCOPE'});
  await assert.rejects(()=>f.adapter.resolve({...f.mapping,sourceRef:{...f.mapping.sourceRef,url:'https://example.com'}}),{code:'RESOURCE_INPUT'});
  await assert.rejects(()=>f.adapter.resolve(f.mapping,{signal:AbortSignal.abort()}),{code:'RESOURCE_CANCELLED'});
});

test('document evidence approval alone does not authorize external disclosure',async t=>{
  const f=await fixture(t),document=await f.library.addDocument({title:'Technical specification',slotKey:'specification',content:'Linen, 165 GSM, MOQ 200.'});
  await f.library.reviewDocument(document.id,1,{expectedRevision:1,decision:'verified'});
  const mapping=f.map(`approved_document:${document.id}`,{kind:'document',id:document.id,version:1,sha256:document.versions[0].sha256});
  await assert.rejects(()=>f.adapter.resolve(mapping),{code:'RESOURCE_DISCLOSURE_REQUIRED'});
  f.approveDoc();const snapshot=await f.adapter.resolve(mapping);
  assert.equal(snapshot.content.text,'Linen, 165 GSM, MOQ 200.');assert.equal(snapshot.source.reviewState,'verified');
  await f.library.reviewDocument(document.id,1,{expectedRevision:2,decision:'rejected',note:'withdrawn'});
  await assert.rejects(()=>f.adapter.verify(snapshot,{workspaceId,projectId,ref:mapping.ref}),{code:'RESOURCE_UNAPPROVED'});
});

test('even an approved document cannot silently switch to a newer version or return archived bytes',async t=>{
  const f=await fixture(t),document=await f.library.addDocument({title:'Specification',slotKey:'specification',content:'Current version'});
  await f.library.reviewDocument(document.id,1,{expectedRevision:1,decision:'verified'});f.approveDoc();
  const mapping=f.map(`approved_document:${document.id}`,{kind:'document',id:document.id,version:1,sha256:document.versions[0].sha256});
  const snapshot=await f.adapter.resolve(mapping);
  await f.library.addDocumentVersion(document.id,{content:'Replacement version'});
  await assert.rejects(()=>f.adapter.verify(snapshot,{workspaceId,projectId,ref:mapping.ref}),{code:'RESOURCE_UNAPPROVED'});
  await f.library.updateDocument(document.id,{expectedRevision:3,changes:{status:'archived'}});
  await assert.rejects(()=>f.adapter.resolve(mapping),{code:'RESOURCE_CHANGED'});
});
