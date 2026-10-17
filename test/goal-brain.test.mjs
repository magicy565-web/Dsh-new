import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFixture, prepared, contextInput, decisionInput, model } from './fixtures/goal-brain-fixture.mjs';
import { createBusinessBrain } from '../plugins/workspace-goal-intelligence/src/brain.mjs';
import { createArtifactBrainRepository } from '../plugins/workspace-goal-intelligence/src/artifact-repository.mjs';
import { INPUTS, validate, digest, sourceId } from '../plugins/workspace-goal-intelligence/src/contracts.mjs';
import { evaluateOption, cohortConversion, assessOutcome } from '../plugins/workspace-goal-intelligence/src/economics.mjs';
import extension, { businessBrainExtension, BRAIN_TOOLS } from '../plugins/workspace-goal-intelligence/src/extension.mjs';
const call = (brain, method, input = {}, signal) => brain[method](input, signal, model);
const blocked = (promise, code) => assert.rejects(promise, e => e.code === code);
async function fixture(t) { const f = openFixture(); t.after(() => f.close()); return f; }

// Tenant / authority boundaries.
test('cold start is empty, not invented recommendations or an automatic write', async t => {
  const f = await fixture(t); f.addGoal('A'); const {brain}=f.makeBrain('A');
  const r=await call(brain,'brief'); assert.equal(r.status,'empty'); assert.equal(r.persisted,false); assert.deepEqual(r.data.savedDecisionCards,[]); assert.equal(f.state.commitCount,0);
});
test('two enterprises share record IDs but not sources/context/decisions', async t => {
  const f = await fixture(t), a = await prepared(f,'A'), b = await prepared(f,'B');
  await call(a.brain,'decisionSave',decisionInput('same')); await call(b.brain,'decisionSave',decisionInput('same'));
  const ra=await call(a.brain,'decisionRead',{id:'same'}), rb=await call(b.brain,'decisionRead',{id:'same'});
  assert.notEqual(ra.recordRef.artifactId,rb.recordRef.artifactId);
  assert.equal(ra.data.sources[0].values.name,'A product'); assert.equal(rb.data.sources[0].values.name,'B product');
  assert.notEqual(ra.bindingHash,rb.bindingHash); assert.equal(f.store.read().artifacts.length,4);
  await blocked(b.brain.revalidateReceipt(ra,undefined,model),'BRAIN_CACHE_REFUSED');
});
test('workspace tuple hashes cannot collide like concatenated IDs', () => assert.notEqual(digest(['workspace-brain:v1','a:b']),digest(['workspace-brain:v1','a','b'])));
test('wrong model receiver is refused before any artifact byte read', async t => {
  const f=await fixture(t), {brain}=await prepared(f); const n=f.state.readers;
  await blocked(brain.contextRead({},undefined,{provider:'other',id:'no-model'}),'BRAIN_RECEIVER_MISMATCH'); assert.equal(f.state.readers,n);
});
test('session revocation blocks saved context', async t => {
  const f=await fixture(t), {brain}=await prepared(f); f.state.revoked=true; await blocked(call(brain,'contextRead'),'BRAIN_AUTHORIZATION_REFUSED');
});
test('read-only identity cannot write context', async t => {
  const f=await fixture(t), {brain,ref}=await prepared(f); f.state.writesAllowed=false;
  await blocked(call(brain,'contextSave',contextInput([ref],{expectedRevision:1,requestId:'next'})),'BRAIN_AUTHORIZATION_REFUSED'); assert.equal(f.state.commitCount,1);
});
test('a mismatched enterprise projection is rejected even with a permissive fake authorizer', async t => {
  const f=await fixture(t), {brain,ref}=await prepared(f); f.source('enterprise-A',ref).workspaceId='B';
  await blocked(call(brain,'contextRead'),'BRAIN_SOURCE_SCOPE_MISMATCH');
});
test('unselected fields from an adapter are not disclosed', async t => {
  const f=await fixture(t), {brain,ref}=await prepared(f); f.source('enterprise-A',ref).values.secret='not-authorized';
  await blocked(call(brain,'contextRead'),'BRAIN_SOURCE_SCOPE_MISMATCH');
});
test('goal resolver cannot return another tenant goal', async t => {
  const f=await fixture(t), {brain}=await prepared(f); f.state.goals.get(JSON.stringify(['enterprise-A','overseas'])).workspaceId='B';
  await blocked(call(brain,'contextRead'),'BRAIN_GOAL_INVALID');
});
test('goal projection rejects extra private fields', async t => {
  const f=await fixture(t), {brain}=await prepared(f); f.state.goals.get(JSON.stringify(['enterprise-A','overseas'])).secret='hidden';
  await blocked(call(brain,'contextRead'),'BRAIN_GOAL_INVALID');
});
test('source revocation during the read prevents disclosure', async t => {
  const f=await fixture(t), {brain}=await prepared(f); f.state.afterSource=()=>{f.state.sourceRevoked=true;};
  await blocked(call(brain,'contextRead'),'BRAIN_AUTHORIZATION_REFUSED');
});
test('source revocation during artifact read prevents disclosure', async t => {
  const f=await fixture(t), {brain}=await prepared(f); f.state.afterRead=()=>{f.state.revoked=true;};
  await blocked(call(brain,'contextRead'),'BRAIN_AUTHORIZATION_REFUSED');
});
test('expired source and future observation timestamps fail closed', async t => {
  const f=await fixture(t), {brain,ref}=await prepared(f), row=f.source('enterprise-A',ref);
  row.validUntil=new Date(f.state.clock).toISOString(); await blocked(call(brain,'contextRead'),'BRAIN_SOURCE_STALE');
  row.validUntil=null; row.observedAt=new Date(f.state.clock+1000).toISOString(); await blocked(call(brain,'contextRead'),'BRAIN_SOURCE_STALE');
});
test('source revision changes invalidate current and cached context', async t => {
  const f=await fixture(t), {brain,ref}=await prepared(f); const r=await call(brain,'contextRead'); f.source('enterprise-A',ref).reference.revision='2';
  await blocked(brain.revalidateReceipt(r,undefined,model),'BRAIN_SOURCE_SCOPE_MISMATCH');
});
test('a new source selection repairs stale context without rewriting source business facts', async t => {
  const f=await fixture(t), {brain,ref}=await prepared(f); const row=f.source('enterprise-A',ref); row.reference.revision='2'; row.values.moqMeters=500; row.reference.sha256=digest(row.values);
  const r=await call(brain,'contextSave',contextInput([row.reference],{requestId:'updated-source',expectedRevision:1}));
  assert.equal(r.recordRef.recordRevision,2); assert.equal(r.data.sources[0].values.moqMeters,500); assert.equal(r.humanReviewed,false);
});
// Write idempotency, race safety and real disk persistence through the fixture.
test('identical request replay does not create a second artifact/version', async t => {
  const f=await fixture(t), {brain,ref}=await prepared(f); const a=await call(brain,'contextRead'); const b=await call(brain,'contextSave',contextInput([ref]));
  assert.deepEqual(a,b); assert.equal(f.state.commitCount,1);
});
test('same requestId with modified content is refused', async t => {
  const f=await fixture(t), {brain,ref}=await prepared(f);
  await blocked(call(brain,'contextSave',contextInput([ref],{unknowns:['changed body']})),'BRAIN_REQUEST_CHANGED'); assert.equal(f.state.commitCount,1);
});
test('old expected revision cannot overwrite an updated context', async t => {
  const f=await fixture(t), {brain,ref}=await prepared(f);
  await call(brain,'contextSave',contextInput([ref],{expectedRevision:1,requestId:'r2'}));
  await blocked(call(brain,'contextSave',contextInput([ref],{expectedRevision:1,requestId:'lost-write'})),'BRAIN_REVISION_CONFLICT');
});
test('concurrent writers commit one revision and reject the stale writer', async t => {
  const f=await fixture(t), {brain,ref}=await prepared(f);
  const results=await Promise.allSettled(['one','two'].map(requestId=>call(brain,'contextSave',contextInput([ref],{expectedRevision:1,requestId}))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1); assert.equal(f.state.commitCount,2);
});
test('revocation immediately before original artifact commit leaves no decision', async t => {
  const f=await fixture(t), {brain}=await prepared(f); f.state.beforeCommit=()=>{f.state.revoked=true;};
  await blocked(call(brain,'decisionSave',decisionInput()),'BRAIN_COMMIT_REFUSED'); assert.equal(f.state.commitCount,1);
});
test('source mutation at the commit boundary cannot be saved under old evidence', async t => {
  const f=await fixture(t), {brain,ref}=await prepared(f); f.state.beforeCommit=()=>{f.source('enterprise-A',ref).values.moqMeters=500;};
  await blocked(call(brain,'decisionSave',decisionInput()),'BRAIN_COMMIT_REFUSED'); assert.equal(f.state.commitCount,1);
});
test('goal budget mutation at the commit boundary is fenced', async t => {
  const f=await fixture(t), {brain}=await prepared(f); f.state.beforeCommit=()=>{f.state.goals.get(JSON.stringify(['enterprise-A','overseas'])).perTaskCapMinor=1;};
  await blocked(call(brain,'decisionSave',decisionInput()),'BRAIN_COMMIT_REFUSED');
});
test('already-aborted operation does not access storage', async t => {
  const f=await fixture(t), {brain}=await prepared(f); const c=new AbortController(); c.abort(); const n=f.state.readers;
  await blocked(call(brain,'contextRead',{},c.signal),'BRAIN_CANCELLED'); assert.equal(f.state.readers,n);
});
test('cancellation at commit does not persist a new decision', async t => {
  const f=await fixture(t), {brain}=await prepared(f); const c=new AbortController(); f.state.beforeCommit=()=>c.abort();
  await blocked(call(brain,'decisionSave',decisionInput(),c.signal),'BRAIN_CANCELLED'); assert.equal(f.state.commitCount,1);
});
test('durable reopen retains two independent enterprise contexts and prior decisions', async () => {
  const dir=await mkdtemp(join(tmpdir(),'goal-brain-')); let f;
  try {
    const file=join(dir,'fixture.sqlite'); f=openFixture(file); const a=await prepared(f,'A'), b=await prepared(f,'B');
    await call(a.brain,'decisionSave',decisionInput('decision-A')); const before=await call(a.brain,'contextRead'); f.close(); f=null;
    f=openFixture(file); f.addSource('A','product','cloth',{name:'A product',moqMeters:1000});f.addSource('B','product','cloth',{name:'B product',moqMeters:1000}); f.addGoal('A');f.addGoal('B');
    assert.deepEqual(await call(f.makeBrain('A').brain,'contextRead'),before);
    assert.equal((await call(f.makeBrain('B').brain,'contextRead')).data.sources[0].values.name,'B product');
    assert.equal((await call(f.makeBrain('A').brain,'brief')).data.savedDecisionCards[0].decisionId,'decision-A');
    await blocked(call(f.makeBrain('B').brain,'decisionRead',{id:'decision-A'}),'BRAIN_NOT_FOUND');
  } finally {f?.close();await rm(dir,{recursive:true,force:true});}
});
test('tampered artifact bytes are detected', async t => {
  const f=await fixture(t), {brain}=await prepared(f), id=(await call(brain,'contextRead')).recordRef.artifactId;
  f.db.prepare('UPDATE blobs SET content=? WHERE id=?').run('{}',id); await blocked(call(brain,'contextRead'),'BRAIN_ARTIFACT_INTEGRITY');
});
test('removal of internal artifact visibility blocks reads', async t => {
  const f=await fixture(t), {brain}=await prepared(f), row=f.store.read().artifacts[0];row.metadata.businessLibrary.visibility='public';
  f.db.prepare('UPDATE records SET record=? WHERE id=?').run(JSON.stringify(row),row.id);await blocked(call(brain,'contextRead'),'BRAIN_ARTIFACT_INTEGRITY');
});
// Decision semantics and truthful business outcomes.
test('model-authored context/hypotheses do not become enterprise policy', async t => {
  const f=await fixture(t), {brain}=await prepared(f); const d=await call(brain,'decisionSave',decisionInput());
  assert.equal(d.businessAuthority,false);assert.equal(d.executable,false);assert.equal(d.humanReviewed,false);assert.equal(d.businessGoalVerified,false);
  assert.equal(d.data.evaluations[0].probability,null); assert.equal(d.data.evaluations[0].netContributionMinor,null);
});
test('a new context revision makes old decisions unavailable for recommendation', async t => {
  const f=await fixture(t), {brain,ref}=await prepared(f);await call(brain,'decisionSave',decisionInput());
  await call(brain,'contextSave',contextInput([ref],{expectedRevision:1,requestId:'ctx2'}));
  await blocked(call(brain,'decisionRead',{id:'decision-1'}),'BRAIN_CONTEXT_CHANGED');assert.deepEqual((await call(brain,'brief')).data.savedDecisionCards,[]);
});
for (const [name, mutate, code] of [
  ['no alternative investigation/wait', d=>{d.options.forEach(o=>{o.kind='act';o.capability='analysis';});}, 'BRAIN_ALTERNATIVE_REQUIRED'],
  ['unknown evidence', d=>{d.hypotheses[0].supportingEvidence=['product:other'];}, 'BRAIN_EVIDENCE_NOT_SELECTED'],
  ['same evidence supporting and contradicting',d=>{d.hypotheses[0].contradictingEvidence=['product:cloth'];},'BRAIN_EVIDENCE_CONTRADICTION'],
  ['no support or missing-evidence acknowledgement',d=>{d.hypotheses[0].supportingEvidence=[];d.hypotheses[0].missingEvidence=[];},'BRAIN_HYPOTHESIS_UNGROUNDED'],
  ['duplicate option IDs',d=>{d.options[1].id=d.options[0].id;},'BRAIN_DUPLICATE_REFERENCE'],
  ['over-budget preferred option',d=>{d.options[0].estimate.costMinor.max=999999;},'BRAIN_RECOMMENDATION_BLOCKED'],
  ['unavailable external capability',d=>{d.options[0].capability='external-contact';},'BRAIN_RECOMMENDATION_BLOCKED'],
  ['currency mismatch',d=>{d.options[0].estimate.currency='EUR';},'BRAIN_RECOMMENDATION_BLOCKED'],
  ['inverted money range',d=>{d.options[0].estimate.costMinor.min=900;},'BRAIN_MONEY_INVALID'],
  ['selected option missing',d=>{d.recommendation.optionId='not-an-option';},'BRAIN_OPTION_INVALID'],
]) test(name,async t=>{const f=await fixture(t),{brain}=await prepared(f),d=decisionInput();mutate(d);await blocked(call(brain,'decisionSave',d),code);assert.equal(f.state.commitCount,1);});
test('paused goal cannot receive a new recommendation',async t=>{const f=await fixture(t),{brain}=await prepared(f);f.state.goals.get(JSON.stringify(['enterprise-A','overseas'])).status='paused';await blocked(call(brain,'decisionSave',decisionInput()),'BRAIN_RECOMMENDATION_BLOCKED');});
test('unknown budget stays unknown, never becomes zero or spending authority',async t=>{const f=await fixture(t),{brain}=await prepared(f);f.state.goals.get(JSON.stringify(['enterprise-A','overseas'])).budgetRemainingMinor=null;const r=await call(brain,'decisionSave',decisionInput());assert.ok(r.data.evaluations[0].gaps.includes('BUDGET_UNKNOWN'));assert.equal(r.executable,false);});
test('scenario arithmetic is bounded and not a probability or guaranteed ROI',()=>{const option=decisionInput().options[0];option.estimate.incrementalContributionMinor={min:400,max:1800};const r=evaluateOption(option,{status:'active',capabilities:['analysis'],currency:'USD',budgetRemainingMinor:1000,perTaskCapMinor:1000});assert.deepEqual(r.netContributionMinor,{min:-200,max:1800});assert.equal(r.basis,'unverified-assumptions');assert.equal(r.executable,false);});
test('cohort conversion exposes pending/unknown denominator coverage',()=>{assert.deepEqual(cohortConversion({eligible:20,converted:2,pending:5,unknown:5}),{eligible:20,observed:10,converted:2,pending:5,unknown:5,rate:0.2,coverage:0.5});assert.equal(cohortConversion({eligible:0,converted:0,pending:0,unknown:0}).rate,null);assert.throws(()=>cohortConversion({eligible:2,converted:2,pending:1,unknown:0}));});
async function reviewSetup(t, complete=true) {
  const f=await fixture(t),{brain}=await prepared(f);await call(brain,'decisionSave',decisionInput());
  const start=new Date(f.state.clock).toISOString();f.state.clock+=8*86400000;
  const ref=f.addSource('enterprise-A','metric','window-1',{id:'net-paid-orders',value:complete?2:null,unit:'orders',windowStart:start,windowEnd:new Date(f.state.clock).toISOString(),coverageComplete:complete});
  const input={requestId:'review-1',expectedRevision:0,decisionId:'decision-1',decisionRevision:1,sourceRefs:[ref],metricEvidenceId:sourceId(ref),interpretation:complete?'supported':'inconclusive',rationale:'Observed change does not prove a causal effect.',alternativeExplanations:['Seasonality or buyer mix may explain the change.']};
  return {f,brain,input,ref};
}
test('observed outcome persists but never verifies causation or business success',async t=>{const {brain,input}=await reviewSetup(t);const r=await call(brain,'reviewSave',input);assert.equal(r.data.assessment.status,'observed-not-adjudicated');assert.equal(r.data.assessment.businessGoalVerified,false);assert.equal(r.data.assessment.causalEffect,null);assert.equal((await call(brain,'brief')).data.savedDecisionCards[0].outcomeStatus,'awaiting-owner-review');});
test('missing measurement cannot be promoted into a successful review',async t=>{const {brain,input}=await reviewSetup(t,false);input.interpretation='supported';await blocked(call(brain,'reviewSave',input),'BRAIN_INSUFFICIENT_EVIDENCE');});
test('inconclusive review preserves missing values',async t=>{const {brain,input}=await reviewSetup(t,false);const r=await call(brain,'reviewSave',input);assert.equal(r.data.assessment.value,null);assert.equal(r.data.assessment.status,'insufficient-evidence');});
test('future and pre-decision measurement windows are rejected',()=>{const v={metricId:'m',observationDays:7};const metric={id:'m',value:1,unit:'orders',coverageComplete:true,windowStart:'2026-10-15T00:00:00Z',windowEnd:'2026-10-24T00:00:00Z'};assert.throws(()=>assessOutcome(metric,v,'2026-10-16T00:00:00Z',Date.parse('2026-10-25T00:00:00Z')));metric.windowStart='2026-10-16T00:00:00Z';assert.throws(()=>assessOutcome(metric,v,'2026-10-16T00:00:00Z',Date.parse('2026-10-23T00:00:00Z')));});
// Homepage stability and human-only feedback.
test('brief returns at most three real proposals and no generic filler cards',async t=>{const f=await fixture(t),{brain}=await prepared(f);for(let i=0;i<4;i++)await call(brain,'decisionSave',decisionInput(`d${i}`));const r=await call(brain,'brief');assert.equal(r.data.savedDecisionCards.length,3);assert.equal(r.data.truncated,true);assert.ok(r.data.savedDecisionCards.every(c=>c.action.kind==='open-original-goal'&&!c.executable));});
test('exact same problem/goal is deduplicated in the brief',async t=>{const f=await fixture(t),{brain}=await prepared(f);for(const id of ['d1','d2'])await call(brain,'decisionSave',decisionInput(id,{problem:'identical business question'}));assert.equal((await call(brain,'brief')).data.savedDecisionCards.length,1);});
const feedback=changes=>({requestId:'feedback-1',expectedRevision:0,decisionId:'decision-1',decisionRevision:1,disposition:'dismissed',until:null,reason:'Owner does not want this suggestion now.',...changes});
test('owner dismissal persists without approving or executing work',async t=>{const f=await fixture(t),{brain}=await prepared(f);await call(brain,'decisionSave',decisionInput());const r=await call(brain,'feedbackSave',feedback());assert.equal(r.approvalGranted,false);assert.deepEqual((await call(brain,'brief')).data.savedDecisionCards,[]);});
test('owner snooze expires; feedback does not become permanent business policy',async t=>{const f=await fixture(t),{brain}=await prepared(f);await call(brain,'decisionSave',decisionInput());await call(brain,'feedbackSave',feedback({disposition:'snoozed',until:new Date(f.state.clock+60000).toISOString()}));assert.equal((await call(brain,'brief')).data.savedDecisionCards.length,0);f.state.clock+=60001;assert.equal((await call(brain,'brief')).data.savedDecisionCards.length,1);});
test('model cannot forge a human feedback write',async t=>{const f=await fixture(t),{brain}=await prepared(f);await call(brain,'decisionSave',decisionInput());f.state.human=false;await blocked(call(brain,'feedbackSave',feedback()),'BRAIN_HUMAN_REQUIRED');});
test('human authority revoked immediately before commit blocks feedback',async t=>{const f=await fixture(t),{brain}=await prepared(f);await call(brain,'decisionSave',decisionInput());f.state.beforeCommit=()=>{f.state.human=false;};await blocked(call(brain,'feedbackSave',feedback()),'BRAIN_COMMIT_REFUSED');});
// Cache revalidation and strict native-tool contracts.
test('unchanged receipt revalidates; editing content or adding approval is refused',async t=>{const f=await fixture(t),{brain}=await prepared(f);const r=await call(brain,'contextRead');assert.equal(await brain.revalidateReceipt(r,undefined,model),true);await blocked(brain.revalidateReceipt({...r,humanReviewed:true},undefined,model),'BRAIN_CACHE_REFUSED');r.data.context.payload.unknowns=['model forged history'];await blocked(brain.revalidateReceipt(r,undefined,model),'BRAIN_CACHE_REFUSED');});
test('cached receipt from another subject/session cannot be imported',async t=>{const f=await fixture(t),{brain}=await prepared(f);const r=await call(brain,'contextRead');const next=f.makeBrain('enterprise-A',{subject:'other-member',sessionId:'other-session'}).brain;await blocked(next.revalidateReceipt(r,undefined,model),'BRAIN_CACHE_REFUSED');assert.equal((await call(next,'contextRead')).persisted,true);});
test('goal budget change invalidates an otherwise unchanged cached decision',async t=>{const f=await fixture(t),{brain}=await prepared(f);const r=await call(brain,'decisionSave',decisionInput());f.state.goals.get(JSON.stringify(['enterprise-A','overseas'])).budgetRemainingMinor=10;await blocked(brain.revalidateReceipt(r,undefined,model),'BRAIN_CACHE_REFUSED');assert.deepEqual((await call(brain,'brief')).data.savedDecisionCards,[]);});
for(const [name,mutate] of [
  ['forged workspace',x=>{x.workspaceId='B';}],['forged approval',x=>{x.approved=true;}],['forged execution',x=>{x.execute=true;}],
  ['NaN revision',x=>{x.expectedRevision=NaN;}],['negative revision',x=>{x.expectedRevision=-1;}],['string revision',x=>{x.expectedRevision='0';}],
  ['newline ID',x=>{x.requestId='safe\n';}],['blank ID',x=>{x.requestId=' ';}],['null context',x=>{x.businessModel=null;}],
  ['oversize text',x=>{x.unknowns=['x'.repeat(2000)];}],['unknown nested field',x=>{x.businessModel.approved=true;}],['sparse list',x=>{x.notes=new Array(2);}],
])test(`strict contract rejects ${name}`,()=>{const input=contextInput([]);mutate(input);assert.throws(()=>validate(INPUTS.contextSave,input));});
test('missing reviewed host dependencies do not silently configure a brain',()=>{assert.throws(()=>createBusinessBrain());assert.throws(()=>createArtifactBrainRepository());});
test('ordinary package install exposes only eight fail-closed tools and no ambient model/files/network',async()=>{const tools=[];extension({registerTool:t=>tools.push(t)});assert.equal(tools.length,8);assert.equal(tools.some(t=>/approve|dispatch|feedback|send/.test(t.name)),false);for(const tool of tools){const r=await tool.execute('t',{},undefined,undefined,{model});assert.equal(r.details.status,'unconfigured');assert.equal(r.isError,true);}});
test('configured extension registers the original Host guard before any private tool can run',async t=>{const f=await fixture(t),{brain}=await prepared(f),tools=[];let guard;businessBrainExtension({brain,registerContextGuard:g=>{guard=g;return true;}})({registerTool:t=>tools.push(t)});assert.equal(guard.plugin,'workspace-goal-intelligence');const r=await tools.find(t=>t.name==='workspace_brain_context').execute('t',{},undefined,undefined,{model});assert.equal(r.details.status,'available');assert.equal(await guard.validateReceipt(r.details,undefined,model),true);});
test('guard registration refusal blocks plugin configuration',()=>{assert.throws(()=>businessBrainExtension({brain:{revalidateReceipt(){}},registerContextGuard:()=>false})({registerTool(){}}));});
test('arbitrary upstream error details are not exposed in tool output',async()=>{const tools=[];const brain={revalidateReceipt(){},contextRead(){throw Error('SECRET backend token and private body');}};businessBrainExtension({brain,registerContextGuard:()=>true})({registerTool:t=>tools.push(t)});const r=await tools[0].execute('t',{},undefined,undefined,{model});assert.equal(r.details.reason,'BRAIN_OPERATION_UNAVAILABLE');assert.ok(!JSON.stringify(r).includes('SECRET'));assert.equal(r.details.retryWithNewRequest,false);});
// Additional adversarial audit after the initial 73-case run.
test('a context race is rejected inside the artifact admission transaction',async t=>{
  const f=await fixture(t),{brain,ref}=await prepared(f);
  f.state.beforeCommit=async()=>{f.state.beforeCommit=null;await call(brain,'contextSave',contextInput([ref],{expectedRevision:1,requestId:'concurrent-context'}));};
  await blocked(call(brain,'decisionSave',decisionInput()),'BRAIN_REVISION_CONFLICT');assert.equal(f.store.read().artifacts.length,1);assert.equal(f.state.commitCount,2);
});
test('an async commit authorizer cannot accidentally pass a synchronous transaction gate',async t=>{
  const f=await fixture(t),env=await prepared(f);const brain=createBusinessBrain({...env.options,assertCommit:async()=>true});
  await blocked(call(brain,'decisionSave',decisionInput()),'BRAIN_COMMIT_REFUSED');assert.equal(f.state.commitCount,1);
});
test('mutable caller binding cannot retarget an already created brain',async t=>{
  const f=await fixture(t),env=await prepared(f);const brain=createBusinessBrain(env.options);env.options.binding.workspaceId='other';
  assert.equal((await call(brain,'contextRead')).data.context.workspaceId,'enterprise-A');
});
test('mixing another enterprise repository with a brain binding is rejected',async t=>{
  const f=await fixture(t),a=await prepared(f,'A'),b=await prepared(f,'B');
  const brain=createBusinessBrain({...b.options,repository:a.repository});await blocked(call(brain,'contextRead'),'BRAIN_RECORD_INVALID');
});
test('conflicting source revisions in one decision are rejected',async t=>{
  const f=await fixture(t),{brain,ref}=await prepared(f);const d=decisionInput();d.sourceRefs=[{...ref,revision:'2'}];await blocked(call(brain,'decisionSave',d),'BRAIN_SOURCE_CONFLICT');
});
test('a source failure aborts the whole context rather than returning a partial private result',async t=>{
  const f=await fixture(t),{brain,ref}=await prepared(f);const other={...ref,id:'missing'};await blocked(call(brain,'contextSave',contextInput([ref,other],{expectedRevision:1,requestId:'two-sources'})),'BRAIN_SOURCE_INVALID');assert.equal(f.state.commitCount,1);
});
test('review of the wrong metric cannot be saved',async t=>{
  const {f,brain,input,ref}=await reviewSetup(t);f.source('enterprise-A',ref).values.id='site-visits';await blocked(call(brain,'reviewSave',input),'BRAIN_METRIC_INVALID');
});
test('review cannot silently follow a changed decision',async t=>{
  const {brain,input}=await reviewSetup(t);await call(brain,'decisionSave',decisionInput('decision-1',{expectedRevision:1,requestId:'decision-updated'}));
  await blocked(call(brain,'reviewSave',input),'BRAIN_DECISION_CHANGED');
});
test('duplicate enterprise brain keys are detected instead of returning an arbitrary record',async t=>{
  const f=await fixture(t),{brain}=await prepared(f);const row=f.store.read().artifacts[0];row.id='duplicate';f.db.prepare('INSERT INTO records VALUES(?,?)').run(row.id,JSON.stringify(row));
  await blocked(call(brain,'contextRead'),'BRAIN_ARTIFACT_INTEGRITY');
});
test('no reviewed context guard means even a supplied client remains disabled',async()=>{
  const tools=[];let calls=0;businessBrainExtension({brain:{contextRead(){calls++;}}})({registerTool:t=>tools.push(t)});
  const r=await tools[0].execute('t',{},undefined,undefined,{model});assert.equal(r.details.status,'unconfigured');assert.equal(calls,0);
});
test('homepage GET-equivalent never saves a new record or calls a model',async t=>{
  const f=await fixture(t),{brain}=await prepared(f);await call(brain,'decisionSave',decisionInput());const count=f.state.commitCount;
  const a=await call(brain,'brief'),b=await call(brain,'brief');assert.deepEqual(a,b);assert.equal(f.state.commitCount,count);
});
test('an authorized read-only member can still read the enterprise context',async t=>{
  const f=await fixture(t),{brain}=await prepared(f);f.state.writesAllowed=false;
  assert.equal((await call(brain,'contextRead')).status,'available');
});
