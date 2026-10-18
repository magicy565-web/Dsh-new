// Manual proof against compiled commit 3e7ce823, never a success test of fixed code.
const assert=require('node:assert/strict');
const root=process.env.MEDUSA_REVIEWED_PACKAGE;
if(!root)throw Error('MEDUSA_REVIEWED_PACKAGE must point to the compiled reviewed package');
const {fixture}=require(root+'/test/acceptance-fixture.cjs');
const {reviewSourceHash}=require(root+'/.medusa/server/src/product-context-review.js');
process.env.AGENT_CONTEXT_READ_TOKEN='synthetic-only-token';
(async()=>{
 for(const initial of [99999,100000]){
  const f=fixture();await f.approve();f.state.record.review_version=initial;f.state.record.source_hash=reviewSourceHash(f.state.record,f.state.product);
  const approve=await f.approve(),revoke=await f.edit({status:'blocked'});
  assert.equal(approve.code,initial===99999?200:409);assert.equal(revoke.code,409);assert.equal(f.state.record.status,'approved');
  console.log(JSON.stringify({initial,approve:approve.code,storedVersion:f.state.record.review_version,revoke:revoke.code,finalStatus:f.state.record.status}));
 }
 for(const kind of ['evidence.label','commercial_policy.moq']){
  const f=fixture();await f.approve();
  if(kind==='evidence.label')f.state.record.evidence=[{id:'e',label:{source:'SYNTHETIC PRIVATE'},type:'certificate',status:'verified'}];
  else f.state.record.commercial_policy={moq:{internal_note:'SYNTHETIC PRIVATE'}};
  const result=await f.approve(),single=await f.single(),list=await f.list();
  assert.equal(result.code,200);assert.equal(single.code,200);assert.ok(JSON.stringify(single.body).includes('SYNTHETIC PRIVATE'));assert.ok(JSON.stringify(list.body).includes('SYNTHETIC PRIVATE'));
  console.log(JSON.stringify({kind,reapproval:result.code,single:single.code,nestedPrivateReturned:true}));
 }
})().catch(error=>{console.error(error);process.exitCode=1});
