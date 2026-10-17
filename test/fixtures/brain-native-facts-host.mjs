// Actual original Node app/Store/Library/ledger and official OMP worker.
// All documents, identities, fact statements and provider choices are synthetic.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {taskFixture} from './pi-task-helpers.mjs';
import {createWorkspaceOmpEngineAdapter,workspaceOmpPaths} from '../../server/workspace-omp-bridge.mjs';
export const MODEL={provider:'brain-native-explicit-faux',id:'finite',api:'openai-completions',baseUrl:'https://synthetic.invalid'};
export const RECIPIENT={kind:'pi-coding-agent',provider:MODEL.provider,model:MODEL.id,destination:MODEL.baseUrl};
export const QUERY={subjectType:'product',subjectId:'synthetic-bottle',factKey:'moq'};
export const STATEMENT='SYNTHETIC selected MOQ is 120 units; observation only.';
export const UNSELECTED='SYNTHETIC_UNSELECTED_FACT_MUST_NOT_LEAVE_HOST';
export const empty=()=>({artifacts:[],skills:[],memoryIds:[],connectorActions:[]});
export const tool=(name,args={})=>({tool:name,arguments:args});
export const mapping=f=>f.app.store.read().conversations.find(c=>c.id===f.cid).businessAgentSession;
export async function messages(f){return (await fs.readFile(mapping(f).sessionFile,'utf8')).trim().split('\n').map(JSON.parse).map(e=>e.message).filter(Boolean);}
export async function setup(t,{facts=true,allowMemoryRead=true,onDisclosure=null,onFinalCheck=null,engineComplete=null,onLifecycle=null,model=MODEL,engineFactory=null}={}){
 const recipient={kind:'pi-coding-agent',provider:model.provider,model:model.id,destination:model.baseUrl};
 const directory=await fs.mkdtemp('/tmp/brain-native-facts-'),actor={subject:'member-a',workspaceId:'pi-enterprise-test',role:'admin'};
 const seed=await taskFixture(t,{directory,enterprise:true});
 const a=(await seed.app.artifacts.create({requestId:randomUUID(),filename:'synthetic-facts.txt',content:'SYNTHETIC document evidence only.',metadata:{businessLibrary:{visibility:'internal'}}})).artifact;
 const asset={artifactId:a.id,version:a.currentVersion,sha256:a.sha256};
 const document=(await seed.app.businessLibrary.createDocument({requestId:randomUUID(),title:'Synthetic fact evidence',slotKey:'specification',asset},actor)).document;
 const owner=await seed.workspace('/api/conversations',{subject:actor.subject,body:{title:'Synthetic original Goal owner',requestId:randomUUID(),inputContext:empty()}});assert.equal(owner.status,201,owner.text);
 const g=await seed.workspace('/api/goals',{subject:actor.subject,body:{title:'Investigate synthetic MOQ only',description:'No external action or spending',conversationId:owner.json.conversation.id,requestId:randomUUID(),inputContext:empty()}});assert.equal(g.status,201,g.text);const goal=g.json.goal;
 await seed.app.close();
 const now=Date.now()+1000,steps=[],trace=[],state={facts,allowMemoryRead,keys:[{...QUERY}],seeded:false,parserCalls:0};let f;
 const selection=(write=false)=>({enabled:true,reviewed:true,customerId:'synthetic-customer',sources:[{documentId:document.id,asset}],allowMemoryRead:write||state.allowMemoryRead,allowMemoryWrite:write});
 const connection={reviewed:true,baseURL:'https://synthetic-docling.invalid',apiKey:'synthetic-only-docling-screen-value',fetchImpl:async()=>{state.parserCalls++;throw Error('No parser request admitted by this fixture');}};
 const hostFor=(identity,write=false)=>f.app.enterpriseContextSessionBinding(identity,{recipient,selection:selection(write),connection});
 const engineOptions={paths:workspaceOmpPaths(process.env),nativeBusiness:true,
  pluginConfiguration:{disabled:['workspace-market-validation','workspace-shopify-product','workspace-medusa-catalog','workspace-marketplace']},
  configuration:{providerId:model.provider,model:model.id,baseUrl:model.baseUrl},syntheticResponses:steps,
  onWorkerLifecycle:e=>{trace.push(e);onLifecycle?.(e,f);}};
 const engine=engineFactory?await engineFactory(engineOptions):createWorkspaceOmpEngineAdapter(engineOptions);
 const wrapped={scope:engine.scope,async complete(args){
  if(!state.seeded){
   const writer=(await hostFor(args.run.businessAgentContext,true)).open('synthetic-preparation-native',{conversationId:args.input.conversationId,runId:args.run.id,requestId:args.run.requestId});
   await writer.structuredMemoryRemember({...QUERY,statement:STATEMENT},args.input.signal,model);
   await writer.structuredMemoryRemember({...QUERY,factKey:'unselected',statement:UNSELECTED},args.input.signal,model);state.seeded=true;
  }
  const originalBind=args.bindBrainForNativeSession,originalSave=args.saveSession,originalEvent=args.input.onEvent;
  const wrappedArgs={...args,input:{...args.input,onEvent:async e=>{trace.push({phase:'host-event',event:e.type});return originalEvent?.(e);}},
   saveSession:async value=>{await originalSave(value);trace.push({phase:'saved',nativeSessionId:value.agentSessionId});},
   ...(originalBind?{bindBrainForNativeSession:async nativeSessionId=>{
    trace.push({phase:'sdk-ready',nativeSessionId});const bound=await originalBind(nativeSessionId);trace.push({phase:'bound',nativeSessionId,scopeHash:bound.scopeHash});
    return {...bound,control:{...bound.control,authorizeDisclosure:async(payload,signal,receiver)=>{
     trace.push({phase:'disclose',nativeSessionId,receiver:{...receiver},wire:typeof payload.wireBody==='string'});
     await onDisclosure?.({f,payload,signal,receiver,control:bound.control});return bound.control.authorizeDisclosure(payload,signal,receiver);
    },finalCheck:async(signal,receiver)=>{trace.push({phase:'final-check',nativeSessionId,receiver:{...receiver}});await onFinalCheck?.({f,signal,receiver});return bound.control.finalCheck(signal,receiver);}}};
   }}:{})};
  return engineComplete?engineComplete(wrappedArgs,{f,engine,trace,hostFor}):engine.complete(wrappedArgs);
 }};
 const policy={enabled:true,reviewed:true,workspaceId:actor.workspaceId,subject:actor.subject,expiresAt:'2099-01-01T00:00:00.000Z',recipient,company:null,products:[],productFields:['name'],factoryMaterials:{products:[],productFields:['name'],documents:[{id:document.id,revision:document.revision,documentVersion:document.currentVersion,asset}]}};
 f=await taskFixture(t,{directory,enterprise:true,accessClock:()=>now,libraryModelReadPolicy:policy,
  appOptions:{goalBrainOptions:{originalReceiver:model,reviewedGoals:[{id:goal.id,originalRevision:goal.revision,currency:'USD',businessStatus:'active',capabilities:['analysis','draft','none'],budgetRemainingMinor:null,perTaskCapMinor:null,reviewed:true}]}},
  businessAgentOptions:{recipient,engineAdapter:wrapped,resolveBinding:async({actor,sessionReadonlyClient})=>({client:sessionReadonlyClient(actor),model,
   ...(state.facts?{enterpriseContextHost:await hostFor(actor),brainMemoryFactKeys:state.keys}:{})})}});
 t.after(async()=>{await f.app.close();await fs.rm(directory,{recursive:true,force:true});});
 const c=await f.workspace('/api/conversations',{subject:actor.subject,body:{title:'Synthetic native fact investigation',requestId:randomUUID(),inputContext:empty()}});assert.equal(c.status,201,c.text);
 return Object.assign(f,{model,actor,asset,document,goal,cid:c.json.conversation.id,steps,trace,state,hostFor});
}
export async function send(f,steps){
 f.steps.splice(0,f.steps.length,...steps);
 const r=await f.workspace(`/api/conversations/${f.cid}/messages`,{subject:f.actor.subject,body:{content:'Use only the explicitly selected synthetic fact; keep conclusions unreviewed.',requestId:randomUUID(),workspaceExecution:false,inputContext:empty()}});assert.equal(r.status,202,r.text);
 for(let i=0;i<3000;i++){const run=f.app.store.read().runs.find(x=>x.id===r.json.run.id);if(!['running','queued'].includes(run.status))return run;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('FINITE_NATIVE_FACT_HOST_TIMEOUT');
}

// Isolated test-only RPC bridge for exercising the official provider's actual
// Request serialization and fetch hook with finite SSE, on a fresh Session.
export async function wireTurn(args,{f,trace},mode){
 const [{createServer},{spawn},{fileURLToPath},{default:path}]=await Promise.all([import('node:http'),import('node:child_process'),import('node:url'),import('node:path')]);
 const paths=workspaceOmpPaths(process.env);let bound,nativeId,changed=false,wireChecks=0,modelCalls=0;
 const server=createServer(async(req,res)=>{try{
  let text='';for await(const chunk of req)text+=chunk;const value=JSON.parse(text);let result=true;
  if(req.url==='/authorize')await args.authorize();
  else if(req.url==='/ready'){assert.equal(bound,undefined);nativeId=value.nativeSessionId;bound=await args.bindBrainForNativeSession(nativeId);}
  else if(req.url==='/save'){assert.equal(value.agentSessionId,nativeId);await args.saveSession(value);}
  else if(req.url==='/model'){assert.ok(bound);modelCalls++;assert.equal(value.modelCalls,modelCalls);await args.input.onEvent?.({type:'pi.agent-session.request',engine:'omp'});}
  else if(req.url==='/brain'){assert.ok(['sourceCatalog','contextRead','contextSave','diagnose','decisionRead','decisionSave','reviewSave','brief','revalidateReceipt'].includes(value.method));result=await bound.brain[value.method](value.value,args.input.signal,value.model);}
  else if(req.url==='/disclosure'){
   assert.equal(value.nativeSessionId,nativeId);assert.equal(value.modelCalls,modelCalls);assert.deepEqual(value.receiver,{provider:MODEL.provider,id:MODEL.id,baseUrl:MODEL.baseUrl});
   const payload={messages:[],context:[],...(value.wireBody===undefined?{}:{wireBody:value.wireBody})};
   if(payload.wireBody!==undefined)wireChecks++;
   if(!changed&&payload.wireBody?.includes(STATEMENT)&&mode!=='control'){
    changed=true;
    if(mode==='dependency')await f.app.businessLibrary.updateDocument(f.document.id,{requestId:randomUUID(),expectedRevision:f.document.revision,changes:{title:'Changed before finite wire dispatch'}},f.actor);
    else if(mode==='cancel'){const c=await f.workspace(`/api/conversations/${f.cid}/cancel`,{subject:f.actor.subject,body:{}});assert.equal(c.status,200,c.text);}
    else throw Error('Unknown finite wire mode');
   }
   result=await bound.control.authorizeDisclosure(payload,args.input.signal,value.receiver);
  }else throw Error('Unknown fixture RPC');
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result??true));
 }catch{res.writeHead(409,{'content-type':'application/json'});res.end('{}');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const sessionDirectory=path.join(args.isolationDirectory,'sessions',args.binding.client.bindingFingerprint),agentDir=path.join(args.isolationDirectory,'wire-agent');
 await fs.mkdir(sessionDirectory,{recursive:true,mode:0o700});await fs.mkdir(agentDir,{recursive:true,mode:0o700});
 const file=path.join(args.isolationDirectory,'finite-wire.json');await fs.writeFile(file,JSON.stringify({mode,endpoint:'http://127.0.0.1:'+server.address().port,packageRoot:paths.packageRoot,cwd:args.isolationDirectory,agentDir,sessionDirectory,model:MODEL,goalId:f.goal.id,runId:args.run.id,statement:STATEMENT,unselected:UNSELECTED}),{mode:0o600});
 try{
  const outcome=await new Promise((resolve,reject)=>{const child=spawn(paths.bun,[fileURLToPath(new URL('./brain-native-facts-wire.mjs',import.meta.url)),file],{cwd:args.isolationDirectory,env:{PATH:path.dirname(paths.bun)+':/usr/bin:/bin',HOME:args.isolationDirectory,NO_COLOR:'1'},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>child.kill('SIGKILL'),60000);child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});});
  assert.equal(outcome.code,0,outcome.stderr+outcome.stdout);const report=JSON.parse(outcome.stdout.trim().split('\n').at(-1));f.state.wireSummary={...report,wireChecks,changed};
  if(!report.result)throw Error('FINITE_NATIVE_FACT_WIRE_REFUSED');
  await bound.control.finalCheck(args.input.signal,MODEL);await args.authorize();bound.control.assertDisclosureCurrent({messages:[],context:[]},MODEL,args.input.signal);
  return report.result;
 }finally{await new Promise(resolve=>server.close(resolve));}
}
