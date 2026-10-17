// Original Node Host/Store/WorkerDesk/active Run plus actual SDK. The original
// fd3 production path is separately exercised by the two successful seed turns;
// only this provider serialization probe uses a read-only loopback RPC seam.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {nativeMarketplace,sendMarketplace,resetBusiness,tool,journal,mapping,buyerActor,appendLateUsage} from './fixtures/marketplace-native.mjs';
import {workspaceOmpPaths} from '../server/workspace-omp-runtime.mjs';
import {revalidateBusinessJournal,readBusinessContext} from '../server/workspace-omp-business-journal.mjs';
const modes=['control','hook-grant','hook-source','hook-fields','hook-session','text-grant','text-source','text-fields','text-session','text-cancel','disabled','forged','forged-image','receiver'];
for(const afterReset of [false,true])for(const mode of afterReset?['control','hook-grant','hook-source','text-grant','text-source','text-cancel','disabled','late-usage-source']:modes)test('Marketplace original active Run/SDK egress '+(afterReset?'after reset ':'')+mode,{timeout:45000},async t=>{
 let probe=false,f,receipt,wireFailure;const done=Promise.withResolvers();
 const wrapEngineAdapter=engine=>({scope:engine.scope,complete:async args=>{
  if(!probe)return engine.complete(args);
  const errors=[];let mutations=0;
  const proxy=createServer(async(req,res)=>{try{
   if(req.url==='/authorize'){await args.authorize();res.writeHead(200);res.end('{}');return;}
   if(req.url==='/mutate'){
    mutations++;assert.equal(mutations,1);
    if(mode.endsWith('grant'))f.controls.granted=false;
    if(mode.endsWith('fields'))f.controls.fields=['orderId','status'];
    if(mode.endsWith('source'))await f.app.store.update(s=>{s.workerOrders.find(x=>x.id===f.privateOrder.id).objective='Changed private source version';});
    if(mode.endsWith('session'))assert.equal((await f.workspace('/api/session/logout',{subject:f.actor.subject,body:{}})).status,200);
    if(mode.endsWith('cancel'))assert.equal((await f.workspace(`/api/conversations/${f.cid}/cancel`,{subject:f.actor.subject,body:{}})).status,200);
    res.writeHead(200);res.end('{}');return;
   }
   assert.equal(req.url,'/marketplace/revalidateReceipt','Serialization probe never writes or dispatches');const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;assert.ok(size<200000);chunks.push(chunk);}const {value,model}=JSON.parse(Buffer.concat(chunks));
   const result=await args.marketplaceClient.revalidateReceipt(value,args.input.signal,model);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));
  }catch(error){errors.push(error.code||error.message);res.writeHead(403,{'content-type':'application/json'});res.end(JSON.stringify({code:error.code||'REFUSED'}));}});
  try{
   await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));const input=f.directory+'/marketplace-wire-input.json';await fs.writeFile(input,JSON.stringify({savedSession:args.savedSession,cwd:args.isolationDirectory,model:args.binding.model,runId:args.run.id,orderId:f.privateOrder.id,afterReset}));
   const child=spawn(workspaceOmpPaths({}).bun,['test/fixtures/marketplace-native-wire.mjs',mode,'http://127.0.0.1:'+proxy.address().port,input],{env:{PATH:process.env.PATH,HOME:'/tmp',NO_COLOR:'1'}});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const timer=setTimeout(()=>child.kill(),28000);const status=await new Promise(resolve=>child.on('exit',resolve));clearTimeout(timer);assert.equal(status,0,output+'\nHost errors: '+JSON.stringify(errors));
   receipt=JSON.parse(output.trim().split('\n').at(-1));receipt.hostRefusalCodes=[...new Set(errors)];if(mode==='forged'||mode==='late-usage-source')assert.deepEqual(receipt.hostRefusalCodes,['MARKETPLACE_SOURCE_CHANGED'],'The original Host must reject the forged receipt');assert.equal(mutations,mode.startsWith('hook-')||mode.startsWith('text-')?1:0);
   if(receipt.result){await args.authorize();await revalidateBusinessJournal(await readBusinessContext(await journal(f),{signal:args.input.signal}),{marketplaceClient:args.marketplaceClient,model:args.binding.model,signal:args.input.signal});return receipt.result;}
   throw Object.assign(Error('EXPECTED_SYNTHETIC_MODEL_DISCLOSURE_REFUSED'),{code:'MARKETPLACE_PROBE_EXPECTED_REFUSAL'});
  }catch(error){if(error.code!=='MARKETPLACE_PROBE_EXPECTED_REFUSAL')wireFailure=error;throw error;}
  finally{proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));done.resolve();}
 }});
 f=await nativeMarketplace(t,{wrapEngineAdapter});f.privateOrder=await f.marketplace.createOrder({kind:'buyer',...f.actor,human:true},{...f.proposal,objective:'UNSELECTED_PRIVATE_ORDER_BODY',requestId:'private-status-fixture'});
 const human=await f.workspace('/api/worker-orders/marketplace/orders/'+f.privateOrder.id,{subject:f.actor.subject});assert.equal(human.status,200,human.text);assert.ok(human.text.includes('UNSELECTED_PRIVATE_ORDER_BODY'));
 for(let turn=0;turn<2;turn++){const run=await sendMarketplace(f,[tool('find'),tool('order',{orderId:f.privateOrder.id}),{text:afterReset?'PRE_RESET_MARKETPLACE_STATUS_NOTE':'Reviewed original metadata only.'}]);assert.equal(run.status,'succeeded',JSON.stringify(run));}
 if(afterReset){const original=mapping(f),before=await fs.readFile(original.sessionFile);await f.marketplace.cancel({...buyerActor(f),human:true},f.privateOrder.id);
  const cleared=await resetBusiness(f);assert.equal(cleared.status,'succeeded',JSON.stringify(cleared));assert.equal(cleared.events.filter(e=>e.type==='pi.agent-session.request').length,0);assert.equal(mapping(f).agentSessionId,original.agentSessionId);assert.deepEqual((await fs.readFile(original.sessionFile)).subarray(0,before.length),before);
  const current=await sendMarketplace(f,[tool('order',{orderId:f.privateOrder.id}),{text:'Current cancelled status.',expectedContextText:'cancelled'}]);assert.equal(current.status,'succeeded',JSON.stringify(current));
 }
 if(mode==='late-usage-source'){await appendLateUsage(f);await f.app.store.update(state=>{state.workerOrders.find(o=>o.id===f.privateOrder.id).objective='Changed source after original SDK late usage';});}
 const original=mapping(f),before=await fs.readFile(original.sessionFile);assert.ok(!before.toString().includes('UNSELECTED_PRIVATE_ORDER_BODY'));
 if(mode==='forged'||mode==='forged-image'){const rows=(await journal(f));const message=rows.find(e=>e.message?.toolName==='workspace_marketplace_order').message;if(mode==='forged')message.details.view.status='FORGED_PRIVATE_BODY';message.content=[{type:'text',text:JSON.stringify(message.details)}];if(mode==='forged-image')message.content.push({type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKAAAAABJRU5ErkJggg=='});await fs.writeFile(original.sessionFile,rows.map(JSON.stringify).join('\n')+'\n');}
 probe=true;const pending=sendMarketplace(f,[{text:'Provider serialization probe.'}]);await done.promise;const run=await pending;if(wireFailure)throw wireFailure;assert.ok(receipt);assert.equal(receipt.modelFetches,mode==='control'?1:0);assert.equal(run.status,mode==='control'?'succeeded':mode==='text-cancel'?'cancelled':'failed');
 assert.deepEqual(f.remoteMarketplace.stats,{submits:0,checkouts:0,transfers:0,refunds:0});console.log(JSON.stringify({...receipt,afterReset,result:undefined}));
});
