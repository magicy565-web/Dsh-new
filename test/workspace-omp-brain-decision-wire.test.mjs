import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setup,send,seed,mapping} from './fixtures/brain-decision-host.mjs';
import {MODEL} from './fixtures/shopify-product.mjs';
import {composeBusinessBrainSourceAdapters,createBusinessBrainSourceAdapter} from '../server/business-brain-source-adapter.mjs';
import {createSupplierCommerceBrainSourceAdapter} from '../server/goal-brain-supplier-source.mjs';
import {createGoalBrainHost} from '../server/goal-brain-host.mjs';
import {createLibraryModelRead} from '../server/library-model-read.mjs';
import {workspaceOmpPaths} from '../server/workspace-omp-runtime.mjs';
for(const mode of ['control','hook-source','hook-goal','hook-revoke','hook-cancel','text-source','text-goal','text-revoke','text-cancel','restore-disabled','restore-forged'])test('original decision actual SDK send boundary '+mode,{timeout:45000},async t=>{
 const f=await setup(t);await seed(f);assert.equal((await send(f,[{tool:'workspace_brain_decision_save',arguments:f.inputs.second},{text:'Updated original decision.'}])).status,'succeeded');
 const session=f.app.access.listSessions().sessions.find(x=>x.subject===f.actor.subject),identity={...f.actor,sessionId:session.id},controller=new AbortController();
 const libraryModelRead=createLibraryModelRead({library:f.app.businessLibrary,artifacts:f.app.artifacts,access:f.app.access,policy:{...f.policy,products:f.policy.factoryMaterials.products,productFields:['name','description']}});
 const sourceAdapter=composeBusinessBrainSourceAdapters({primary:createBusinessBrainSourceAdapter({store:f.app.store,workspaceId:f.actor.workspaceId}),extras:[{prefix:'supplier:',adapter:createSupplierCommerceBrainSourceAdapter({supplierService:f.app.supplierService})}]});
 const binding=createGoalBrainHost({sourceAdapter,store:f.app.store,artifacts:f.app.artifacts,access:f.app.access,libraryModelRead,originalReceiver:MODEL,reviewedGoals:[{id:f.goal.id,originalRevision:f.goal.revision,currency:'USD',businessStatus:'active',capabilities:['analysis','draft','none'],budgetRemainingMinor:null,perTaskCapMinor:null,reviewed:true}]}).bind({identity,conversationId:f.cid,signal:controller.signal});
 let mutations=0;const errors=[];
 const proxy=createServer(async(req,res)=>{try{
  if(req.url==='/mutate'){
   mutations++;assert.equal(mutations,1);
   if(mode.endsWith('source'))await f.app.businessLibrary.updateProduct(f.product.id,{requestId:randomUUID(),expectedRevision:1,changes:{name:'Changed during SDK send'}},f.actor);
   if(mode.endsWith('goal'))await f.app.runtime.updateGoal(f.goal.id,{title:'Changed during SDK send',requestId:randomUUID()});
   if(mode.endsWith('revoke'))assert.equal((await f.workspace('/api/session/logout',{subject:f.actor.subject,body:{}})).status,200);
   if(mode.endsWith('cancel'))controller.abort();
   res.writeHead(200);res.end('mutated');return;
  }
  if(req.url==='/authorize'){binding.assertLive();res.writeHead(200);res.end('{}');return;}
  const method=req.url.split('/').at(-1);assert.ok(['sourceCatalog','contextRead','decisionRead','diagnose','brief','revalidateReceipt'].includes(method),'Test bridge is read-only');
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;assert.ok(size<200000);chunks.push(chunk);}const {value,model}=JSON.parse(Buffer.concat(chunks));
  const result=await binding.brain[method](value,controller.signal,model);binding.assertLive();res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));
 }catch(error){errors.push(error.code||error.message);res.writeHead(403);res.end('{}');}});
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));t.after(()=>{proxy.closeAllConnections();return new Promise(resolve=>proxy.close(resolve));});
 const savedSession=mapping(f),cwd=path.dirname(path.dirname(path.dirname(savedSession.sessionFile)));
 if(mode==='restore-forged'){
  const entries=(await fs.readFile(savedSession.sessionFile,'utf8')).trim().split('\n').map(JSON.parse),message=entries.find(e=>e.message?.toolName==='workspace_brain_decision_save').message;
  message.details.data.decision.payload.problem='FORGED_PRIVATE_DECISION';message.content=[{type:'text',text:JSON.stringify(message.details)}];
  await fs.writeFile(savedSession.sessionFile,entries.map(JSON.stringify).join('\n')+'\n');
 }

 const input=f.directory+'/decision-wire-input.json';await fs.writeFile(input,JSON.stringify({savedSession,cwd,model:MODEL,originalProblem:f.inputs.first.problem,updatedProblem:f.inputs.second.problem}));
 const child=spawn(workspaceOmpPaths({}).bun,['test/fixtures/brain-decision-wire.mjs',mode,'http://127.0.0.1:'+proxy.address().port,input],{env:{PATH:process.env.PATH,HOME:'/tmp',NO_COLOR:'1'}});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const timer=setTimeout(()=>child.kill(),30000);const status=await new Promise(resolve=>child.on('exit',resolve));clearTimeout(timer);assert.equal(status,0,output+'\nOriginal Host errors: '+JSON.stringify(errors));assert.equal(mutations,mode.startsWith('hook-')||mode.startsWith('text-')?1:0);console.log(output.trim());
});
