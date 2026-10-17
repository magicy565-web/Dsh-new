// Original signed Host, disk Store/Artifact/Library/Access. Only the source-scope
// withdrawal case mutates a synthetic trusted projection selection, not a real grant.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {setup,send,mapping,messages} from './brain-decision-host.mjs';
import {MODEL} from './shopify-product.mjs';
import {createGoalBrainHost} from '../../server/goal-brain-host.mjs';
import {createLibraryModelRead} from '../../server/library-model-read.mjs';
export {MODEL,send,mapping};

export async function contextHistory(t){
 const f=await setup(t),productRef=f.inputs.context.sourceRefs.find(r=>r.kind==='product'&&r.id===f.product.id);assert.ok(productRef);
 const first={...f.inputs.context,sourceRefs:[productRef],notes:[]};
 const second={...first,requestId:'context-source-removed',expectedRevision:1,sourceRefs:[],unknowns:['Old source removed from current context.']};
 for(const input of [first,second]){const run=await send(f,[{tool:'workspace_brain_context_save',arguments:input},{text:'Synthetic context saved.'}]);assert.equal(run.status,'succeeded',JSON.stringify(run));}
 const old=(await messages(f)).find(m=>m.toolName==='workspace_brain_context_save').details;
 assert.equal(old.recordRef.recordRevision,1);assert.deepEqual(old.data.context.payload.sourceRefs,[productRef]);
 const context=f.app.store.read().artifacts.find(a=>a.metadata?.businessBrain?.key==='context');assert.equal(context.currentVersion,2);
 const originalRead=createLibraryModelRead({library:f.app.businessLibrary,artifacts:f.app.artifacts,access:f.app.access,policy:{...f.policy,products:f.policy.factoryMaterials.products,productFields:['name','description']}});
 let selection;
 const libraryModelRead={...originalRead,businessBrainForSession:input=>{selection=originalRead.businessBrainForSession(input);return selection;}};
 const session=f.app.access.listSessions().sessions.find(s=>s.subject===f.actor.subject),identity={...f.actor,sessionId:session.id};
 const binding=createGoalBrainHost({store:f.app.store,artifacts:f.app.artifacts,access:f.app.access,libraryModelRead,originalReceiver:MODEL,reviewedGoals:[{id:f.goal.id,originalRevision:f.goal.revision,currency:'USD',businessStatus:'active',capabilities:['analysis','draft','none'],budgetRemainingMinor:null,perTaskCapMinor:null,reviewed:true}]}).bind({identity,conversationId:f.cid});
 return Object.assign(f,{old,context,contextInputs:{first,second},contextBinding:binding,sourceSelection:selection,originalJournal:await fs.readFile(mapping(f).sessionFile)});
}
export async function mutateHistoricalSource(f,mode){
 if(mode==='version')await f.app.businessLibrary.updateProduct(f.product.id,{requestId:randomUUID(),expectedRevision:1,changes:{name:'Changed during final context Artifact read'}},f.actor);
 else if(mode==='delete')await f.app.store.update(state=>{state.businessLibrary.products=state.businessLibrary.products.filter(p=>p.id!==f.product.id);});
 else if(mode==='revoke')f.sourceSelection.scope.products=[]; // Synthetic per-source selection withdrawal; live original Session retained.
 else assert.equal(mode,'control');
 const disk=JSON.parse(await fs.readFile(f.directory+'/workspace.json','utf8')),product=disk.businessLibrary.products.find(p=>p.id===f.product.id);
 if(mode==='version')assert.equal(product.revision,2);
 if(mode==='delete')assert.equal(product,undefined);
 if(mode==='revoke'){assert.equal(product.revision,1);assert.deepEqual(f.sourceSelection.scope.products,[]);assert.ok(f.app.access.nativeSessionById(f.contextBinding.binding.sessionId));}
}
export function injectFinalContextRead(f,mutate){
 const original=f.app.artifacts.read,versions=[];let reached=false,completed=false;
 f.app.artifacts.read=async(...args)=>{
  const result=await original(...args);
  if(args[0]===f.context.id){versions.push(args[1].version);if(versions.length===4){assert.equal(args[1].version,2);reached=true;await mutate();completed=true;}}
  return result;
 };
 return {restore(){f.app.artifacts.read=original;},assertReached(){assert.deepEqual(versions,[2,2,1,2],'Initial/current reads, immutable old v1, then final current v2 read');assert.equal(reached,true);assert.equal(completed,true);},get versions(){return [...versions];}};
}
