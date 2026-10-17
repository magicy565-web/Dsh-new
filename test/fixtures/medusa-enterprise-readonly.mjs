// Original signed Node Host + Artifact/Library + native worker. All records,
// parser HTTP and model HTTP/decisions are finite synthetic stand-ins.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {taskFixture} from './pi-task-helpers.mjs';
import {createWorkspaceOmpEngineAdapter,workspaceOmpPaths} from '../../server/workspace-omp-bridge.mjs';
import {MEDUSA_ENTERPRISE_TOOLS} from '../../server/workspace-omp-medusa-enterprise.mjs';
export const empty=()=>({artifacts:[],skills:[],memoryIds:[],connectorActions:[]});
export const tool=(name,args={})=>({tool:name,arguments:args});
export async function combinedFixture(t,{wire=false,medusaConfigured=false,missingParser=false,missingEnterprise=false,missingMedusa=false,transfer=true,pluginConfiguration={},life=()=>{},beforeModel=()=>{}}={}){
 const directory=await fs.mkdtemp('/tmp/medusa-enterprise-'),actor={subject:'member-a',role:'admin',workspaceId:'pi-enterprise-test'};
 const seed=await taskFixture(t,{directory,enterprise:true});
 const product=(await seed.app.businessLibrary.createProduct({requestId:randomUUID(),name:'SYNTHETIC_PRIVATE_PRODUCT',description:'Synthetic authorized catalog description'},actor)).product;
 const a=(await seed.app.artifacts.create({requestId:randomUUID(),filename:'synthetic.txt',content:'SYNTHETIC_SOURCE_BYTES',metadata:{businessLibrary:{visibility:'internal'}}})).artifact;
 const asset={artifactId:a.id,version:1,sha256:a.sha256},document=(await seed.app.businessLibrary.createDocument({requestId:randomUUID(),title:'SYNTHETIC_PRIVATE_DOCUMENT',slotKey:'specification',asset},actor)).document;
 await seed.app.close();
 const state={parserCalls:0,medusaCalls:0,wireCalls:0,wireBodies:[],held:null,closed:false,modelHook:null,identity:null,recipientChanged:false,missingEnterprise,missingMedusa,transferAllowed:true,customer:'synthetic-customer'},steps=[],lifecycle=[];let f;
 const handler=async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  if(req.url.startsWith('/admin/products?')){
   assert.equal(req.method,'GET');assert.equal(req.headers.authorization,'Basic synthetic-only-medusa-key');state.medusaCalls++;res.setHeader('content-type','application/json');res.end(JSON.stringify({products:[],count:0}));return;
  }
  if(req.url==='/v1/convert/file'){
   state.parserCalls++;const form=await new Request('http://fixture',{method:'POST',body:Buffer.concat(chunks),headers:{'content-type':req.headers['content-type']}}).formData();
   assert.equal(createHash('sha256').update(Buffer.from(await form.get('files').arrayBuffer())).digest('hex'),asset.sha256);
   res.on('close',()=>{state.closed=true;});if(state.held){state.held();return;}
   res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'success',document:{text_content:'SYNTHETIC_PRIVATE_PARSED_DOCUMENT'},errors:[]}));return;
  }
  assert.equal(req.url,'/chat/completions');const body=JSON.parse(Buffer.concat(chunks));state.wireBodies.push(body);state.wireCalls++;
  assert.deepEqual(body.tools.map(x=>x.function.name).sort(),[...MEDUSA_ENTERPRISE_TOOLS].sort());
  if(state.modelHook)await state.modelHook(body);
  const spec=steps.shift();assert.ok(spec,'finite model refuses extra requests');
  const delta=spec.tool?{tool_calls:[{index:0,id:'synthetic-call-'+state.wireCalls,type:'function',function:{name:spec.tool,arguments:JSON.stringify(spec.arguments)}}]}:{content:spec.text};
  const frame={id:'synthetic-wire',model:body.model,object:'chat.completion.chunk',created:1,choices:[{index:0,delta:{role:'assistant',...delta},finish_reason:null}]};
  const end={...frame,choices:[{index:0,delta:{},finish_reason:spec.tool?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}};
  res.setHeader('content-type','text/event-stream');res.end('data: '+JSON.stringify(frame)+'\n\ndata: '+JSON.stringify(end)+'\n\ndata: [DONE]\n\n');
 };
 const server=createServer(handler);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const base='http://127.0.0.1:'+server.address().port;let modelBase='https://synthetic.invalid',certificate;
 if(wire){
  // Private, disposable local test CA. Keep the original HTTPS receiver rule;
  // do not disable TLS validation or use a real credential/provider.
  certificate=directory+'/synthetic-ca.pem';const key=directory+'/synthetic-key.pem';
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',certificate,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
  const modelServer=createHttpsServer({key:await fs.readFile(key),cert:await fs.readFile(certificate)},handler);
  await new Promise(resolve=>modelServer.listen(0,'127.0.0.1',resolve));t.after(()=>{modelServer.closeAllConnections();return new Promise(resolve=>modelServer.close(resolve));});modelBase='https://127.0.0.1:'+modelServer.address().port;
 }
 const model={provider:'synthetic-combined',id:'finite',baseUrl:modelBase},recipient={kind:'pi-coding-agent',provider:model.provider,model:model.id,destination:modelBase};
 const policy={enabled:true,reviewed:true,workspaceId:actor.workspaceId,subject:actor.subject,expiresAt:'2099-01-01T00:00:00.000Z',recipient,company:null,products:[{id:product.id,revision:1}],productFields:['name','description'],
  factoryMaterials:{products:[{id:product.id,revision:1}],productFields:['name','description','category','status','provenance'],documents:[{id:document.id,revision:1,documentVersion:1,asset}]}};
 const configuration={providerId:model.provider,model:model.id,baseUrl:modelBase,...(wire?{apiKey:'synthetic-finite-wire-only',remainingBudgetVerified:true,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}:{})};
 const engine=createWorkspaceOmpEngineAdapter({paths:workspaceOmpPaths({}),configuration,medusaEnterprise:true,infrastructure:certificate?{NODE_EXTRA_CA_CERTS:certificate}:{},pluginConfiguration,syntheticResponses:wire?null:steps,onWorkerLifecycle:event=>{lifecycle.push(event);life(event,state,f);}});
 const engineAdapter={scope:engine.scope,complete:args=>{beforeModel(args,state,f);return engine.complete({...args,...(state.missingMedusa?{medusaClient:null}:{})});}};
 const options=()=>({recipient:state.recipientChanged?{...recipient,model:'changed'}:recipient,selection:{enabled:true,reviewed:true,customerId:state.customer,sources:[{documentId:document.id,asset}]},connection:missingParser?{}:{reviewed:true,baseURL:base,apiKey:'synthetic-parser-key',timeoutMs:15000},
  ...(transfer?{authorizeParserTransfer:async request=>state.transferAllowed&&request.documentId===document.id&&request.target.artifactId===asset.artifactId&&request.target.version===asset.version&&request.target.sha256===asset.sha256&&request.transfer==='complete-file'&&request.purpose==='document-extraction'&&request.recipient.destination===base+'/v1/convert/file'}:{})});
 f=await taskFixture(t,{directory,enterprise:true,appOptions:medusaConfigured?{capabilityEnvironment:{WORKSPACE_MEDUSA_BASE_URL:base,WORKSPACE_MEDUSA_SECRET_API_KEY:'synthetic-only-medusa-key',WORKSPACE_MEDUSA_WORKSPACE_ID:actor.workspaceId,WORKSPACE_MEDUSA_SINGLE_TENANT_ACK:'1'}}:{},libraryModelReadPolicy:policy,businessAgentOptions:{recipient,engineAdapter,resolveBinding:async({actor:identity,sessionReadonlyClient})=>{state.identity=identity;return {client:sessionReadonlyClient(identity),model,enterpriseContextHost:state.missingEnterprise?undefined:await f.app.enterpriseContextSessionBinding(identity,options())};}}});
 t.after(async()=>{await f.app.close();await fs.rm(directory,{recursive:true,force:true});});
 const created=await f.workspace('/api/conversations',{subject:actor.subject,body:{title:'Synthetic combined readonly Session',inputContext:empty()}});assert.equal(created.status,201,created.text);
 return Object.assign(f,{state,steps,lifecycle,product,document,asset,actor,cid:created.json.conversation.id,model,recipient,policy,engineAdapter});
}
export async function sendCombined(f,steps,{write=false}={}){
 f.steps.splice(0,f.steps.length,...steps);
 const reply=await f.workspace(`/api/conversations/${f.cid}/messages`,{subject:'member-a',body:{content:'Read only the two exact synthetic sources.',requestId:randomUUID(),workspaceExecution:write,inputContext:empty()}});
 if(reply.status!==202)return reply;
 for(let i=0;i<1600;i++){const run=f.app.store.read().runs.find(x=>x.id===reply.json.run.id);if(run&&!['running','queued'].includes(run.status))return run;await new Promise(resolve=>setTimeout(resolve,25));}
 throw Error('FINITE_COMBINED_RUN_TIMEOUT');
}
export const mapping=f=>f.app.store.read().conversations.find(x=>x.id===f.cid).businessAgentSession;
export async function journal(f){return (await fs.readFile(mapping(f).sessionFile,'utf8')).trim().split('\n').map(JSON.parse);}
export const requests=run=>run.events.filter(x=>x.type==='pi.agent-session.request').length;
