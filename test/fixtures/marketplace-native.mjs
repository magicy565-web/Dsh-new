// Actual original Host/Store/WorkerDesk/Access. Provider identity, reviewed scope,
// price and all business/model/remote data are explicit synthetic fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {productFixture,RECIPIENT,empty} from './shopify-product.mjs';
import {fixture,fixed,seller,reviewer} from './marketplace.mjs';
import {mountMarketplace} from '../../server/marketplace/host.mjs';
import {MARKETPLACE_PURPOSE} from '../../plugins/workspace-marketplace/src/contract.js';
export {RECIPIENT};
export async function nativeMarketplace(t,{pluginConfiguration={},onWorkerLifecycle,wrapEngineAdapter=x=>x,configured=true,productOptions={}}={}){
 const remote=await fixture({install:false}),controls={granted:true,revision:'1',purpose:MARKETPLACE_PURPOSE,expiresAt:'2099-01-01T00:00:00Z',allowDiscovery:true,allowDrafts:true,allowOwnedOrderStatus:true,fields:['orderId','status','serviceId','workerId','updatedAt','termsHash'],cid:null};
 let host;
 const readReviewedScope=({identity,conversationId})=>{controls.scopeReads=(controls.scopeReads||0)+1;controls.onScopeRead?.(controls.scopeReads);return !controls.granted||identity.subject!=='member-a'||conversationId!==controls.cid?null:{reviewed:true,workspaceId:'pi-enterprise-test',subject:'member-a',conversationId:controls.cid,recipient:RECIPIENT,purpose:controls.purpose,revision:controls.revision,expiresAt:controls.expiresAt,allowDiscovery:controls.allowDiscovery,allowDrafts:controls.allowDrafts,allowOwnedOrderStatus:controls.allowOwnedOrderStatus,fields:controls.fields};};
 const f=await productFixture(t,{...productOptions,host:true,nativeBusiness:true,configured:false,pluginConfiguration,onWorkerLifecycle,wrapEngineAdapter,appOptions:{workerAdapters:{'worker-a':remote.adapter}},beforeListen:async app=>{host=await mountMarketplace(app,{...remote.options,workspaceId:'pi-enterprise-test',enabled:true,reviewers:[reviewer.subject],...(configured?{readReviewedScope}:{})});}});
 controls.cid=f.cid;
 const provider={...seller,workspaceId:f.actor.workspaceId},review={...reviewer,workspaceId:f.actor.workspaceId};
 await host.registerProvider(provider,{name:'Explicit synthetic provider',requestId:'native-provider'});
 const listing=await host.saveListing(provider,{workerId:'worker-a',serviceId:'buyer-discovery',title:'Synthetic published Worker',description:'Public synthetic discovery only',deliverables:['Synthetic report'],acceptance:['Synthetic evidence'],prices:[fixed],requestId:'native-listing'});
 await host.reviewListing(review,{id:listing.id,revision:listing.revision,approve:true});
 const input={listingId:listing.id,revision:listing.revision,priceId:fixed.id,product:'Public synthetic fabric',market:'US',objective:'Prepare a synthetic local draft only',deadlineAt:new Date(Date.now()+3600000).toISOString(),requestId:'native-proposal',publicDataConfirmed:true};
 return Object.assign(f,{marketplace:host,marketplaceHost:f.app.marketplaceModelHost,controls,remoteMarketplace:remote,providerActor:provider,listing,proposal:input});
}
export async function sendMarketplace(f,steps,{execution=false,content='Finite synthetic Marketplace operation'}={}){
 f.advanceReviewMinute();f.steps.splice(0,f.steps.length,...steps);
 const r=await f.workspace(`/api/conversations/${f.cid}/messages`,{subject:f.actor.subject,body:{content,requestId:randomUUID(),workspaceExecution:execution,inputContext:empty()}});assert.equal(r.status,202,r.text);
 for(let i=0;i<1200;i++){const run=f.app.store.read().runs.find(x=>x.id===r.json.run.id);if(!['running','queued'].includes(run.status))return run;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('FINITE_NATIVE_MARKETPLACE_TIMEOUT');
}
export async function resetBusiness(f,body={operation:'resetContext',confirmed:true,requestId:randomUUID()}){
 f.advanceReviewMinute();const r=await f.workspace(`/api/conversations/${f.cid}/terminal-controls`,{subject:f.actor.subject,body});assert.equal(r.status,202,r.text);
 for(let i=0;i<900;i++){const run=f.app.store.read().runs.find(x=>x.id===r.json.run.id);if(!['queued','running'].includes(run.status))return run;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('FINITE_RESET_TIMEOUT');
}
export const mapping=f=>f.app.store.read().conversations.find(c=>c.id===f.cid).businessAgentSession;
export const journal=async f=>(await fs.readFile(mapping(f).sessionFile,'utf8')).trim().split('\n').map(JSON.parse);
export const tool=(name,args={})=>({tool:'workspace_marketplace_'+name,arguments:args});
export const buyerActor=f=>({kind:'buyer',...f.actor,human:false});
export async function appendLateUsage(f){
 const {spawn}=await import('node:child_process');const {workspaceOmpPaths}=await import('../../server/workspace-omp-runtime.mjs');const path=await import('node:path');
 const before=await fs.readFile(mapping(f).sessionFile),saved=mapping(f),paths=workspaceOmpPaths({});
 const child=spawn(paths.bun,['test/fixtures/business-context-append-usage.mjs',saved.sessionFile,path.dirname(saved.sessionFile)],{env:{PATH:process.env.PATH,HOME:'/tmp',NO_COLOR:'1'},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const timer=setTimeout(()=>child.kill(),10000);
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});clearTimeout(timer);assert.equal(code,0,output);const receipt=JSON.parse(output.trim().split('\n').at(-1));assert.equal(receipt.originalSdkAppend,true);assert.equal(receipt.sameSessionId,saved.agentSessionId);assert.equal(receipt.currentToolResultRetained,true);
 const after=await fs.readFile(saved.sessionFile);assert.deepEqual(after.subarray(0,before.length),before,'Late usage only appends original SDK metadata');return receipt;
}
