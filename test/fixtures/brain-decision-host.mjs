import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {productFixture,empty} from './shopify-product.mjs';
import {decisionSetup} from './brain-decision-input.mjs';
const tool=(name,args)=>({tool:name,arguments:args});
export async function setup(t,extra={}){
 const f=await productFixture(t,{configured:false,host:true,nativeBusiness:true,brainGoal:true,policy:p=>({...p,products:p.factoryMaterials.products,productFields:['name','description']}),...extra});
 const r=await f.workspace(`/api/conversations/${f.cid}/brain/sources`,{subject:f.actor.subject});assert.equal(r.status,200,r.text);assert.deepEqual(r.json.data.goalIds,[f.goal.id]);
 return Object.assign(f,{inputs:decisionSetup(f.goal.id,r.json.data.sourceRefs)});
}
export async function send(f,steps){
 f.advanceReviewMinute();f.steps.splice(0,f.steps.length,...steps);
 const r=await f.workspace(`/api/conversations/${f.cid}/messages`,{subject:f.actor.subject,body:{content:'Synthetic Brain decision round',requestId:randomUUID(),workspaceExecution:false,inputContext:empty()}});assert.equal(r.status,202,r.text);
 for(let i=0;i<800;i++){const run=f.app.store.read().runs.find(x=>x.id===r.json.run.id);if(!['running','queued'].includes(run.status))return run;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('FINITE_HOST_TIMEOUT');
}
export async function seed(f){const r=await send(f,[tool('workspace_brain_context_save',f.inputs.context),tool('workspace_brain_decision_save',f.inputs.first),{text:'Unreviewed synthetic decision saved.'}]);assert.equal(r.status,'succeeded',JSON.stringify(r));}
export const mapping=f=>f.app.store.read().conversations.find(c=>c.id===f.cid).businessAgentSession;
export const decision=f=>f.app.store.read().artifacts.filter(x=>x.metadata?.businessBrain?.key==='decision:synthetic-case');
export const messages=async f=>(await fs.readFile(mapping(f).sessionFile,'utf8')).trim().split('\n').map(JSON.parse).map(e=>e.message).filter(Boolean);

