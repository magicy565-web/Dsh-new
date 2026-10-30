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

test('authoritative product changes committed during context reading invalidate the pinned return',async t=>{
  for(const changes of [{status:'archived'},{description:'Changed while reading'}]){
    await t.test(Object.keys(changes)[0],async t=>{
      const f=await fixture(t),original=f.library.productContext.bind(f.library);
      let reached,release;const blocked=new Promise(r=>{reached=r;}),gate=new Promise(r=>{release=r;});
      f.library.productContext=async(...args)=>{const result=await original(...args);reached();await gate;return result;};
      const pending=f.adapter.resolve(f.mapping);
      await blocked;
      const changed=await f.library.saveProduct({productId:f.product.id,expectedRevision:1,changes});
      assert.equal(changed.revision,2);
      release();
      await assert.rejects(()=>pending,{code:'RESOURCE_CHANGED'});
    });
  }
});

test('normal product context uses one bounded latest-source check without changing its disclosure',async t=>{
  const f=await fixture(t),original=f.library.product.bind(f.library);let reads=0;
  f.library.product=async(...args)=>{reads++;return original(...args);};
  const snapshot=await f.adapter.resolve(f.mapping);
  assert.equal(reads,1);assert.equal(snapshot.version,1);assert.equal(snapshot.content.name,'Linen throw');
  assert.equal(snapshot.source.reviewState,'unreviewed');assert.equal(snapshot.content.verification,'supplier_provided');
});

test('scope revoked during latest-source revalidation still refuses returned content',async t=>{
  const f=await fixture(t),original=f.library.product.bind(f.library);
  f.library.product=async(...args)=>{const result=await original(...args);f.revoke();return result;};
  await assert.rejects(()=>f.adapter.resolve(f.mapping),{code:'RESOURCE_SCOPE'});
});

test('cancellation during the final product recheck refuses returned content',async t=>{
  const f=await fixture(t),controller=new AbortController(),original=f.library.product.bind(f.library);
  f.library.product=async(...args)=>{const result=await original(...args);controller.abort();return result;};
  await assert.rejects(()=>f.adapter.resolve(f.mapping,{signal:controller.signal}),{code:'RESOURCE_CANCELLED'});
});

test('native service replacement during the final product recheck refuses returned content',async t=>{
  const f=await fixture(t);let current=f.library;
  const adapter=createResourceAdapter({getLibrary:()=>current,assertScope:()=>({disclosureApproved:false})});
  const original=f.library.product.bind(f.library);
  f.library.product=async(...args)=>{const result=await original(...args);current={...f.library};return result;};
  await assert.rejects(()=>adapter.resolve(f.mapping),{code:'RESOURCE_UNAVAILABLE'});
});

test('latest-source API is required and its missing record or native failure stays redacted',async t=>{
  const f=await fixture(t);
  f.library.product=undefined;
  await assert.rejects(()=>f.adapter.resolve(f.mapping),{code:'RESOURCE_UNAVAILABLE'});
  f.library.product=async()=>({product:null});
  await assert.rejects(()=>f.adapter.resolve(f.mapping),{code:'RESOURCE_CHANGED'});
  f.library.product=async()=>{throw Object.assign(new Error('/private/storage/path'),{code:'PRODUCT_NOT_FOUND'});};
  await assert.rejects(()=>f.adapter.resolve(f.mapping),error=>error.code==='RESOURCE_CHANGED'&&!error.message.includes('/private/'));
});

test('grant verification also rejects an archive committed during its context await',async t=>{
  const f=await fixture(t),snapshot=await f.adapter.resolve(f.mapping),original=f.library.productContext.bind(f.library);
  let reached,release;const blocked=new Promise(r=>{reached=r;}),gate=new Promise(r=>{release=r;});
  f.library.productContext=async(...args)=>{const result=await original(...args);reached();await gate;return result;};
  const pending=f.adapter.verify(snapshot,{workspaceId,projectId,ref:f.mapping.ref});
  await blocked;
  await f.library.saveProduct({productId:f.product.id,expectedRevision:1,changes:{status:'archived'}});
  release();
  await assert.rejects(()=>pending,{code:'RESOURCE_CHANGED'});
});

async function approvedDocumentFixture(t){
 const f=await fixture(t),document=await f.library.addDocument({title:'Synthetic approved specification',slotKey:'specification',content:'Synthetic reference bytes.'});
 await f.library.reviewDocument(document.id,1,{expectedRevision:1,decision:'verified'});f.approveDoc();
 const mapping=f.map(`approved_document:${document.id}`,{kind:'document',id:document.id,version:1,sha256:document.versions[0].sha256});
 return {...f,document,documentMapping:mapping};
}
function pauseDocumentRead(library){
 const original=library.readReferences.bind(library);let reached,release;
 const blocked=new Promise(r=>{reached=r;}),gate=new Promise(r=>{release=r;});
 library.readReferences=async(...args)=>{const value=await original(...args);reached();await gate;return value;};
 return {blocked,release:()=>release()};
}
test('latest native document state invalidates content captured before archive, review withdrawal or supersession',async t=>{
 for(const action of ['archive','review-withdrawal','supersession'])await t.test(action,async t=>{
  const f=await approvedDocumentFixture(t),paused=pauseDocumentRead(f.library);
  const pending=f.adapter.resolve(f.documentMapping);await paused.blocked;
  if(action==='archive')await f.library.updateDocument(f.document.id,{expectedRevision:2,changes:{status:'archived'}});
  else if(action==='review-withdrawal')await f.library.reviewDocument(f.document.id,1,{expectedRevision:2,decision:'rejected',note:'Synthetic withdrawal'});
  else await f.library.addDocumentVersion(f.document.id,{content:'Synthetic replacement bytes.'});
  paused.release();await assert.rejects(pending,{code:action==='review-withdrawal'?'RESOURCE_UNAPPROVED':'RESOURCE_CHANGED'});
 });
});
test('grant verification also refuses document archive committed during source read',async t=>{
 const f=await approvedDocumentFixture(t),snapshot=await f.adapter.resolve(f.documentMapping),paused=pauseDocumentRead(f.library);
 const pending=f.adapter.verify(snapshot,{workspaceId,projectId,ref:f.documentMapping.ref});await paused.blocked;
 await f.library.updateDocument(f.document.id,{expectedRevision:2,changes:{status:'archived'}});paused.release();
 await assert.rejects(pending,{code:'RESOURCE_CHANGED'});
});
test('unchanged approved document uses exactly one additional metadata recheck and preserves input',async t=>{
 const f=await approvedDocumentFixture(t),input=structuredClone(f.documentMapping),check=f.library.document.bind(f.library);let checks=0;
 f.library.document=async(...args)=>{checks++;return check(...args);};
 const result=await f.adapter.resolve(f.documentMapping);assert.equal(checks,2);assert.deepEqual(f.documentMapping,input);
 assert.equal(result.content.text,'Synthetic reference bytes.');assert.equal(result.source.reviewState,'verified');
});
test('latest document metadata await retains scope and cancellation fences',async t=>{
 for(const mode of ['scope','cancel'])await t.test(mode,async t=>{
  const f=await approvedDocumentFixture(t),controller=new AbortController(),check=f.library.document.bind(f.library);let count=0;
  f.library.document=async(...args)=>{const value=await check(...args);if(++count===2){if(mode==='scope')f.revoke();else controller.abort();}return value;};
  await assert.rejects(f.adapter.resolve(f.documentMapping,{signal:controller.signal}),{code:mode==='scope'?'RESOURCE_SCOPE':'RESOURCE_CANCELLED'});
 });
});
test('latest document metadata failure is redacted',async t=>{
 const f=await approvedDocumentFixture(t),check=f.library.document.bind(f.library);let count=0;
 f.library.document=async(...args)=>{if(++count===2)throw Error('/private/synthetic/path INTERNAL_SECRET');return check(...args);};
 await assert.rejects(f.adapter.resolve(f.documentMapping),error=>error.code==='RESOURCE_UNAVAILABLE'&&!error.message.includes('INTERNAL_SECRET')&&!error.message.includes('/private/'));
});
test('document metadata recheck refuses native service replacement',async t=>{
 const f=await approvedDocumentFixture(t);let current=f.library,count=0;
 const adapter=createResourceAdapter({getLibrary:()=>current,assertScope:()=>({disclosureApproved:true})});
 const check=f.library.document.bind(f.library);
 f.library.document=async(...args)=>{const value=await check(...args);if(++count===2)current={...f.library};return value;};
 await assert.rejects(adapter.resolve(f.documentMapping),{code:'RESOURCE_UNAVAILABLE'});
});
test('latest document classification enforces certificate validity after a slot change',async t=>{
 for(const slotKey of ['license','certificate','test_report'])await t.test(slotKey,async t=>{
  const f=await approvedDocumentFixture(t),paused=pauseDocumentRead(f.library);
  const pending=f.adapter.resolve(f.documentMapping);await paused.blocked;
  await f.library.updateDocument(f.document.id,{expectedRevision:2,changes:{slotKey}});paused.release();
  await assert.rejects(pending,{code:'RESOURCE_EXPIRED'});
 });
});
test('certificate crossing its validity date during content read is refused at final snapshot',async t=>{
 const f=await fixture(t),document=await f.library.addDocument({title:'Synthetic dated certificate',slotKey:'certificate',content:'Synthetic certificate bytes.',certificate:{expiryMode:'dated',validFrom:'2026-10-01',validUntil:'2099-10-28'}});
 await f.library.reviewDocument(document.id,1,{expectedRevision:1,decision:'verified'});
 let now=Date.parse('2099-10-28T23:59:59Z');
 const adapter=createResourceAdapter({getLibrary:()=>f.library,assertScope:()=>({disclosureApproved:true}),clock:()=>now});
 const mapping=f.map(`approved_document:${document.id}`,{kind:'document',id:document.id,version:1,sha256:document.versions[0].sha256}),paused=pauseDocumentRead(f.library);
 const pending=adapter.resolve(mapping);await paused.blocked;now=Date.parse('2099-10-29T00:00:00Z');paused.release();
 await assert.rejects(pending,{code:'RESOURCE_EXPIRED'});
});
test('malformed final document record never defaults to approved disclosure',async t=>{
 for(const field of ['versions','reviews'])await t.test(field,async t=>{
  const f=await approvedDocumentFixture(t),read=f.library.document.bind(f.library);let count=0;
  f.library.document=async(...args)=>{const value=await read(...args);if(++count===2)delete value.document[field];return value;};
  await assert.rejects(f.adapter.resolve(f.documentMapping),{code:field==='versions'?'RESOURCE_CHANGED':'RESOURCE_UNAPPROVED'});
 });
});
