import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnterpriseDisclosurePolicy, DISCLOSURE_FIELD_GROUPS } from '../server/enterprise-disclosure-policy.mjs';

function fixture(withFga=true) {
  const state={businessLibrary:{products:[{id:'11111111-1111-4111-8111-111111111111',revision:3,status:'draft'}],documents:[{id:'22222222-2222-4222-8222-222222222222',revision:2,currentVersion:4,status:'active'}]}};
  const store={read:()=>structuredClone(state),update:fn=>fn(state)};
  const tuples=[];
  const fga=withFga?{write:async x=>{tuples.push(x);return{}},check:async()=>true}:null;
  const library={getProduct:id=>({product:state.businessLibrary.products.find(x=>x.id===id)}),getDocument:id=>({document:state.businessLibrary.documents.find(x=>x.id===id)})};
  return {state,tuples,policy:createEnterpriseDisclosurePolicy({store,library,fga,workspaceId:'workspace-A',clock:()=>Date.parse('2026-10-16T12:00:00Z')})};
}
const admin={subject:'owner',role:'admin',workspaceId:'workspace-A'};
const expiry='2026-10-17T12:00:00Z';
const productId='11111111-1111-4111-8111-111111111111';

test('grant records creator/authorizer provenance and exact revision',async()=>{
 const {state,tuples,policy}=fixture();
 const out=await policy.grant({requestId:'grant-1',customerId:'buyer-A',resourceType:'product',resourceId:productId,resourceRevision:3,maxLevel:'commercial',expiresAt:expiry,purpose:'RFQ pricing'},admin);
 assert.equal(out.grant.status,'active'); assert.equal(out.grant.createdBy,'owner'); assert.equal(out.grant.authorizedBy,'owner');
 assert.equal(out.grant.sourceSnapshot.revision,3); assert.equal(state.businessLibrary.disclosureGrants.length,1);
 assert.equal(tuples[0].writes[0].relation,'commercial_reader'); assert.ok(out.grant.history.some(x=>x.action==='created')); assert.ok(out.grant.history.some(x=>x.action==='authorized'));
});
test('stronger grant satisfies lower level, but explicit fields cannot exceed the level',async()=>{
 const {policy}=fixture();
 await policy.grant({requestId:'grant-1',customerId:'buyer-A',resourceType:'product',resourceId:productId,resourceRevision:3,maxLevel:'commercial',expiresAt:expiry,purpose:'price'},admin);
 const result=await policy.check({customerId:'buyer-A',resourceType:'product',resourceId:productId,resourceRevision:3,level:'qualified'});
 assert.equal(result.allowed,true);
 await assert.rejects(()=>policy.grant({requestId:'grant-2',customerId:'buyer-B',resourceType:'product',resourceId:productId,resourceRevision:3,maxLevel:'commercial',fields:['name','source'],expiresAt:expiry,purpose:'bad'},admin),e=>e.code==='DISCLOSURE_FIELDS_INVALID');
});
test('revocation is fail-closed before upstream tuple deletion',async()=>{
 const {policy,tuples,state}=fixture();
 const out=await policy.grant({requestId:'grant-1',customerId:'buyer-A',resourceType:'product',resourceId:productId,resourceRevision:3,maxLevel:'commercial',expiresAt:expiry,purpose:'price'},admin);
 const revoked=await policy.revoke(out.grant.id,{reason:'deal ended'},admin);
 assert.equal(revoked.grant.status,'revoked'); assert.equal(revoked.grant.revokedBy,'owner'); assert.ok(tuples.at(-1).deletes);
 await assert.rejects(()=>policy.check({customerId:'buyer-A',resourceType:'product',resourceId:productId,resourceRevision:3,level:'commercial'}),e=>e.code==='DISCLOSURE_SCOPE_DENIED');
 assert.ok(state.businessLibrary.disclosureGrants[0].history.some(x=>x.action==='revoked'));
});
test('old pinned revision is denied after the library advances',async()=>{
 const {policy,state}=fixture();
 await policy.grant({requestId:'grant-1',customerId:'buyer-A',resourceType:'product',resourceId:productId,resourceRevision:3,maxLevel:'commercial',expiresAt:expiry,purpose:'price'},admin);
 state.businessLibrary.products[0].revision=4;
 await assert.rejects(()=>policy.check({customerId:'buyer-A',resourceType:'product',resourceId:productId,resourceRevision:3,level:'commercial'}),e=>e.code==='DISCLOSURE_RESOURCE_CHANGED');
});
test('document disclosure pins the exact original artifact/version/SHA and rejects legacy unpinned grants',async()=>{
 const {policy,state}=fixture();const doc=state.businessLibrary.documents[0];
 const asset={artifactId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',version:2,sha256:'a'.repeat(64)};
 doc.versions=[{version:4,asset}];
 const result=await policy.grant({requestId:'doc-exact',customerId:'buyer-A',resourceType:'document',resourceId:doc.id,resourceRevision:2,documentVersion:4,maxLevel:'qualified',expiresAt:expiry,purpose:'synthetic exact source'},admin);
 assert.deepEqual(result.grant.sourceSnapshot.asset,asset);
 const query={customerId:'buyer-A',resourceType:'document',resourceId:doc.id,resourceRevision:2,documentVersion:4,level:'qualified'};
 await policy.check(query);asset.sha256='b'.repeat(64);
 await assert.rejects(policy.check(query),e=>e.code==='DISCLOSURE_RESOURCE_CHANGED');
 asset.sha256='a'.repeat(64);delete state.businessLibrary.disclosureGrants[0].sourceSnapshot.asset;
 await assert.rejects(policy.check(query),e=>e.code==='DISCLOSURE_RESOURCE_CHANGED');
});
test('a grant revoked during an asynchronous authorization check cannot return allowed',async()=>{
 const state={businessLibrary:{products:[{id:productId,revision:3,status:'draft'}],documents:[]}};
 const store={read:()=>structuredClone(state),update:fn=>fn(state)};let policy,grantId;
 policy=createEnterpriseDisclosurePolicy({store,library:{getProduct:()=>({product:state.businessLibrary.products[0]}),getDocument:()=>({document:null})},workspaceId:'workspace-A',clock:()=>Date.parse('2026-10-16T12:00:00Z'),
  fga:{write:async()=>({}),check:async()=>{await policy.revoke(grantId,{reason:'synthetic in-flight revocation'},admin);return true;}}});
 grantId=(await policy.grant({requestId:'race-grant',customerId:'buyer-A',resourceType:'product',resourceId:productId,resourceRevision:3,maxLevel:'public',expiresAt:expiry,purpose:'synthetic race'},admin)).grant.id;
 await assert.rejects(policy.check({customerId:'buyer-A',resourceType:'product',resourceId:productId,resourceRevision:3,level:'public'}),e=>e.code==='DISCLOSURE_SCOPE_DENIED');
});
test('without OpenFGA no disclosure is ever activated',async()=>{
 const {policy,state}=fixture(false);
 await assert.rejects(()=>policy.grant({requestId:'grant-1',customerId:'buyer-A',resourceType:'product',resourceId:productId,resourceRevision:3,maxLevel:'commercial',expiresAt:expiry,purpose:'price'},admin),e=>e.code==='DISCLOSURE_AUTHZ_NOT_CONFIGURED');
 assert.equal(state.businessLibrary.disclosureGrants[0].status,'sync_error'); assert.equal(policy.status().failClosed,true);
 assert.ok(DISCLOSURE_FIELD_GROUPS.product.commercial.includes('skus.priceTiers'));
});
test('customer isolation is enforced before OpenFGA and is not enumerable by another customer',async()=>{
 const {policy}=fixture();
 await policy.grant({requestId:'grant-1',customerId:'buyer-A',resourceType:'product',resourceId:productId,resourceRevision:3,maxLevel:'commercial',expiresAt:expiry,purpose:'price'},admin);
 await assert.rejects(()=>policy.check({customerId:'buyer-B',resourceType:'product',resourceId:productId,resourceRevision:3,level:'commercial'}),e=>e.code==='DISCLOSURE_SCOPE_DENIED');
 assert.deepEqual(policy.list({customerId:'buyer-B'}).grants,[]);
});
test('expired grants are denied without trusting OpenFGA state',async()=>{
 let now=Date.parse('2026-10-16T12:00:00Z');
 const state={businessLibrary:{products:[{id:productId,revision:3,status:'draft'}],documents:[]}};
 const store={read:()=>structuredClone(state),update:fn=>fn(state)};
 const policy=createEnterpriseDisclosurePolicy({store,library:{getProduct:id=>({product:state.businessLibrary.products.find(x=>x.id===id)}),getDocument:id=>({document:null})},fga:{write:async()=>({}),check:async()=>true},workspaceId:'workspace-A',clock:()=>now});
 await policy.grant({requestId:'grant-1',customerId:'buyer-A',resourceType:'product',resourceId:productId,resourceRevision:3,maxLevel:'commercial',expiresAt:'2026-10-16T13:00:00Z',purpose:'price'},admin);
 now=Date.parse('2026-10-16T14:00:00Z');
 await assert.rejects(()=>policy.check({customerId:'buyer-A',resourceType:'product',resourceId:productId,resourceRevision:3,level:'commercial'}),e=>e.code==='DISCLOSURE_SCOPE_DENIED');
});

test('customer read returns only fields authorized by the pinned grant',async()=>{
 const {policy,state}=fixture();
 state.businessLibrary.products[0].skus=[{id:'sku-1',specs:[{key:'gsm',value:'120'}],unit:'m',moq:1000,leadTimeDays:30,pricingMode:'tiered',pricingNote:'USD/m',priceTiers:[{minQuantity:1000,unitPrice:'1.80',currency:'USD'}]}];
 state.businessLibrary.products[0].supply={packaging:'roll',samplePolicy:'500m',paymentTerms:'T/T',shippingTerms:'FOB',capacityNote:'10k'};
 await policy.grant({requestId:'grant-1',customerId:'buyer-A',resourceType:'product',resourceId:productId,resourceRevision:3,maxLevel:'commercial',expiresAt:expiry,purpose:'price'},admin);
 const out=await policy.read({customerId:'buyer-A',resourceType:'product',resourceId:productId,resourceRevision:3,level:'commercial'});
 assert.equal(out.resource.name,undefined);
 assert.equal(out.resource.skus[0].moq,1000);
 assert.equal(out.resource.skus[0].priceTiers[0].unitPrice,'1.80');
 assert.equal(out.resource.supply,undefined);
 assert.equal(out.resource.source,undefined);
});
test('empty field grants are rejected instead of meaning all fields',async()=>{
 const {policy}=fixture();
 await assert.rejects(
  ()=>policy.grant({requestId:'grant-1',customerId:'buyer-A',resourceType:'product',resourceId:productId,resourceRevision:3,maxLevel:'public',fields:[],expiresAt:expiry,purpose:'empty'},admin),
  e=>e.code==='DISCLOSURE_FIELDS_INVALID'
 );
});

test('document asset is returned only after the exact customer grant and saved SHA pass',async()=>{
 const state={businessLibrary:{products:[],documents:[{id:'22222222-2222-4222-8222-222222222222',revision:2,currentVersion:1,status:'active',versions:[{version:1,asset:{artifactId:'33333333-3333-4333-8333-333333333333',version:1,sha256:'a'.repeat(64)}}]}]}};
 const store={read:()=>structuredClone(state),update:fn=>fn(state)};
 const library={getProduct:id=>({product:null}),getDocument:id=>({document:state.businessLibrary.documents.find(x=>x.id===id)})};
 const fga={write:async()=>({}),check:async()=>true};
 const artifacts={download:async()=>({filename:'policy.pdf',mimeType:'application/pdf',bytes:Buffer.from('PDF'),version:{version:1,size:3,sha256:'a'.repeat(64)}})};
 const p=createEnterpriseDisclosurePolicy({store,library,artifacts,fga,workspaceId:'workspace-A',clock:()=>Date.parse('2026-10-16T12:00:00Z')});
 const grant=await p.grant({requestId:'doc-grant-1',customerId:'buyer-A',resourceType:'document',resourceId:'22222222-2222-4222-8222-222222222222',resourceRevision:2,documentVersion:1,maxLevel:'qualified',expiresAt:'2026-10-17T12:00:00Z',purpose:'certificate review'},admin);
 const out=await p.readDocumentAsset({customerId:'buyer-A',resourceType:'document',resourceId:'22222222-2222-4222-8222-222222222222',resourceRevision:2,documentVersion:1,level:'qualified'});
 assert.equal(out.filename,'policy.pdf');assert.equal(out.sourceSha256,'a'.repeat(64));assert.equal(grant.grant.status,'active');
});
