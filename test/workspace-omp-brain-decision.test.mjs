// Original signed Node Host, disk Store/Artifact, fd3, official Bun SDK Session.
// Model choices are finite; no external model or business provider is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const tool=(name,args)=>({tool:name,arguments:args});
import {empty} from './fixtures/shopify-product.mjs';
import {setup,send,seed,mapping,decision,messages} from './fixtures/brain-decision-host.mjs';

test('signed Host restores same native Session, saves decision twice and exact retry keeps two versions',{timeout:90000},async t=>{
 const f=await setup(t);await seed(f);const original=mapping(f),before=await fs.readFile(original.sessionFile);
 for(const input of [f.inputs.second,f.inputs.second]){const run=await send(f,[tool('workspace_brain_decision_save',input),{text:'Same original decision updated.'}]);assert.equal(run.status,'succeeded',JSON.stringify(run));}
 assert.equal(mapping(f).agentSessionId,original.agentSessionId);assert.equal(decision(f).length,1);assert.equal(decision(f)[0].currentVersion,2);
 const after=await fs.readFile(original.sessionFile);assert.deepEqual(after.subarray(0,before.length),before,'Original journal/proofs stay byte-identical');
 const rows=(await messages(f)).filter(x=>x.toolName==='workspace_brain_decision_save');assert.equal(rows.length,3);assert.deepEqual(rows.at(-1).details,rows.at(-2).details);
 const disk=JSON.parse(await fs.readFile(f.directory+'/workspace.json','utf8'));assert.equal(disk.artifacts.find(x=>x.id===decision(f)[0].id).currentVersion,2);
 assert.equal(f.remote.calls.length,0);
});
test('lost post-commit Artifact update acknowledgement stays unknown and exact request retry confirms persisted v2',{timeout:90000},async t=>{
 const f=await setup(t);await seed(f);const update=f.app.artifacts.update;let lost=false;
 f.app.artifacts.update=async(id,body,admission)=>{const result=await update(id,body,admission);if(!lost&&body.metadata?.businessBrain?.key==='decision:synthetic-case'){lost=true;throw Error('Synthetic lost acknowledgement after original Store commit');}return result;};
 const uncertain=await send(f,[tool('workspace_brain_decision_save',f.inputs.second),{text:'Write outcome unknown; use exact retry.'}]);assert.equal(uncertain.status,'succeeded',JSON.stringify(uncertain));assert.equal(lost,true);assert.equal(decision(f)[0].currentVersion,2);
 const receipt=(await messages(f)).filter(x=>x.toolName==='workspace_brain_decision_save').at(-1);assert.equal(receipt.isError,true);assert.equal(receipt.details.writeOutcome,'unknown');assert.equal(receipt.details.retryWithNewRequest,false);
 const retried=await send(f,[tool('workspace_brain_decision_save',f.inputs.second),{text:'Exact original request confirmed.'}]);assert.equal(retried.status,'succeeded',JSON.stringify(retried));assert.equal(decision(f)[0].currentVersion,2);
 const confirmed=(await messages(f)).filter(x=>x.toolName==='workspace_brain_decision_save').at(-1);assert.equal(confirmed.isError,false);assert.equal(confirmed.details.persisted,true);assert.equal(confirmed.details.recordRef.recordRevision,2);
});
for(const mode of ['source','goal','disabled','revoked'])test('decision history cannot restore after original '+mode+' change',{timeout:90000},async t=>{
 const pluginConfiguration={},f=await setup(t,{pluginConfiguration});await seed(f);
 assert.equal((await send(f,[tool('workspace_brain_decision_save',f.inputs.second),{text:'Synthetic successor.'}])).status,'succeeded');
 if(mode==='source')await f.app.businessLibrary.updateProduct(f.product.id,{requestId:randomUUID(),expectedRevision:1,changes:{name:'Updated original source'}},f.actor);
 if(mode==='goal')await f.app.runtime.updateGoal(f.goal.id,{title:'Changed original Goal',requestId:randomUUID()});
 if(mode==='disabled')pluginConfiguration.disabled=['workspace-goal-intelligence'];
 if(mode==='revoked'){const r=await f.workspace('/api/session/logout',{subject:f.actor.subject,body:{}});assert.equal(r.status,200,r.text);const refused=await f.workspace(`/api/conversations/${f.cid}/messages`,{subject:f.actor.subject,body:{content:'Must refuse',requestId:randomUUID(),workspaceExecution:false,inputContext:empty()}});assert.equal(refused.status,401);return;}
 const run=await send(f,[{text:'Must not reach model'}]);assert.equal(run.status,'failed');assert.equal(run.events.filter(e=>e.type==='pi.agent-session.request').length,0);
});

test('cancelling original Run stops post-save delivery without inventing rollback',{timeout:90000},async t=>{
 const f=await setup(t);await seed(f);
 const pending=send(f,[tool('workspace_brain_decision_save',f.inputs.second),{wait:5000,text:'Must be cancelled'}]);
 let reached=false;
 for(let i=0;i<800;i++){const run=f.app.store.read().runs.at(-1);if(decision(f)[0].currentVersion===2&&run.events.filter(e=>e.type==='pi.agent-session.request').length>=2){reached=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
 assert.equal(reached,true);const cancelled=await f.workspace(`/api/conversations/${f.cid}/cancel`,{subject:f.actor.subject,body:{}});assert.equal(cancelled.status,200,cancelled.text);
 const run=await pending;assert.equal(run.status,'cancelled');assert.equal(decision(f)[0].currentVersion,2,'Cancellation does not undo a committed original Artifact');
});
test('original Node final delivery refuses a decision source changed after official worker exit',{timeout:90000},async t=>{
 let armed=false,exited=false,changed=false;
 const f=await setup(t,{onWorkerLifecycle:e=>{if(armed&&e.phase==='exit'&&e.code===0)exited=true;}});await seed(f);
 const read=f.app.artifacts.read;f.app.artifacts.read=async(...args)=>{const r=await read(...args);if(exited&&!changed){changed=true;await f.app.businessLibrary.updateProduct(f.product.id,{requestId:randomUUID(),expectedRevision:1,changes:{name:'Changed at final delivery'}},f.actor);}return r;};
 armed=true;const run=await send(f,[tool('workspace_brain_decision_save',f.inputs.second),{text:'Should be withheld'}]);assert.equal(changed,true);assert.equal(run.status,'failed');assert.equal(run.error.code,'OMP_DISCLOSURE_REFUSED');
});

test('real signed Host refuses another member and a foreign-workspace binding before Artifact bytes',{timeout:90000},async t=>{
 const {createGoalBrainHost}=await import('../server/goal-brain-host.mjs');
 const {createLibraryModelRead}=await import('../server/library-model-read.mjs');
 const {MODEL}=await import('./fixtures/shopify-product.mjs');
 const f=await setup(t);await seed(f);let reads=0;const read=f.app.artifacts.read;f.app.artifacts.read=async(...args)=>{reads++;return read(...args);};
 const denied=await f.workspace(`/api/conversations/${f.cid}/brain/decisions/synthetic-case`,{subject:'member-b'});assert.equal(denied.status,404,denied.text);assert.equal(denied.json.error.code,'NOT_FOUND');
 const libraryModelRead=createLibraryModelRead({library:f.app.businessLibrary,artifacts:f.app.artifacts,access:f.app.access,policy:{...f.policy,products:f.policy.factoryMaterials.products,productFields:['name','description']}});
 const host=createGoalBrainHost({store:f.app.store,artifacts:f.app.artifacts,access:f.app.access,libraryModelRead,originalReceiver:MODEL,reviewedGoals:[]}),session=f.app.access.listSessions().sessions.find(x=>x.subject===f.actor.subject);
 assert.throws(()=>host.bind({identity:{...f.actor,workspaceId:'synthetic-foreign-enterprise',sessionId:session.id},conversationId:f.cid}),e=>e.code==='BRAIN_SESSION_EXPIRED');
 assert.equal(reads,0);assert.equal(decision(f)[0].currentVersion,1);
});
