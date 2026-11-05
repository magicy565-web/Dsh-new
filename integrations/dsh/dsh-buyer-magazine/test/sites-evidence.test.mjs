import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSitesEvidence} from '../src/sites-evidence.js';
const NOW=new Date('2026-11-06T00:00:00Z');
const factoryId='dd50b962-ade9-4189-9035-1d5600ee0c92';
const claimId='2f6508eb-0bb0-44e7-b984-68e1975cb5f8';
const url='https://chongker.com/pages/plush-robotic-pet-manufacturer';
const liveRecord={id:factoryId,title:'CHONGKER',url,revision:2,stage:'buyer_enabled',missing_fields:['产能','批发价','贸易条件'],claims:[
 {id:claimId,field:'企业身份',classification:'confirmed',buyerValue:'A manufacturer and wholesale supplier of plush and robotic companion pets.',source:url,quote:'wholesale supplier',capturedAt:'2026-11-04T22:54:24.290Z'},
]};
const run=(r=liveRecord,v=r.revision)=>prepareSitesEvidence(JSON.stringify(r),v,{now:NOW});
test('buyer_enabled facts are editorial only, not independent verification or send permission',()=>{
 const r=run();assert.equal(r.status,'evidence_ready_for_editor');assert.equal(r.editorialDraftAllowed,true);
 assert.equal(r.publicationAllowed,false);assert.equal(r.outreachAllowed,false);
 assert.equal(r.factsForEditor.length,1);assert.equal(r.factsForEditor[0].independentlyVerified,false);
 assert.equal(r.factsForEditor[0].sourceType,'supplier_self_published');
 assert.ok(r.notConfirmedFields.includes('MOQ'));assert.ok(r.declaredMissingFields.includes('批发价'));
});
test('research_review never leaks candidate into buyer-facing facts',()=>{
 const r=run({...liveRecord,revision:1,stage:'research_review',claims:liveRecord.claims.map(x=>({...x,classification:'candidate'}))});
 assert.equal(r.status,'review_required');assert.deepEqual(r.factsForEditor,[]);assert.equal(r.pendingReview.length,1);assert.equal(r.editorialDraftAllowed,false);
});
test('stale revision cannot cross the editor boundary',()=>{
 assert.deepEqual(run(liveRecord,1),{status:'blocked',reason:'REVISION_CONFLICT',publicationAllowed:false,outreachAllowed:false});
});
test('unsafe, credential-bearing or private evidence urls are never used',()=>{
 for(const bad of ['http://chongker.com','https://127.0.0.1/a','https://foo.internal/b','https://site.example.com/?token=abc','https://alice:secret@chongker.com']){
   const rec={...liveRecord,claims:[{...liveRecord.claims[0],source:bad}]};const r=run(rec);
   assert.equal(r.status,'review_required');assert.equal(r.factsForEditor.length,0);
   assert.deepEqual(r.invalidEvidence.map(x=>x.reason),['UNUSABLE_EVIDENCE']);
 }
});
test('future claims are held for review instead of laundered as facts',()=>{
 const r=run({...liveRecord,claims:[{...liveRecord.claims[0],capturedAt:'2026-11-10T10:00:00Z'}]});
 assert.equal(r.editorialDraftAllowed,false);assert.equal(r.invalidEvidence.length,1);
});
test('invalid record shape and unexpected stages fail closed',()=>{
 assert.equal(prepareSitesEvidence('{not json',1,{now:NOW}).reason,'RECORD_INVALID');
 assert.equal(run({...liveRecord,stage:'published'}).reason,'STAGE_NOT_SUPPORTED');
 assert.equal(run({...liveRecord,claims:[...liveRecord.claims,liveRecord.claims[0]]}).reason,'RECORD_INVALID');
 assert.equal(run({...liveRecord,missing_fields:['buy my stuff']}).reason,'RECORD_INVALID');
});
test('non-owner source is still not automatically verified',()=>{
 const r=run({...liveRecord,claims:[{...liveRecord.claims[0],source:'https://directory.example.org/factory'}]});
 assert.equal(r.factsForEditor[0].sourceType,'external_source');
 assert.equal(r.factsForEditor[0].independentlyVerified,false);
});
test('record does not reflect arbitrary sensitive metadata to editor',()=>{
 const r=run({...liveRecord,privateCustomerEmail:'buyer@private.example'});
 assert.equal(JSON.stringify(r).includes('buyer@private.example'),false);
});
