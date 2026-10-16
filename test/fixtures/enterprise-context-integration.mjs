// Actual Node24 Host/signed Sessions/Run/Bun18 SDK and Artifact/Library files.
// Docling HTTP, all source data, identities and model decisions are stand-ins.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {taskFixture,api} from './pi-task-helpers.mjs';
import {MODEL,RECIPIENT} from './factory-materials-read.mjs';
import {createWorkspaceOmpEngineAdapter,workspaceOmpPaths} from '../../server/workspace-omp-bridge.mjs';
import {libraryReadHash} from '../../server/library-model-read-contract.mjs';
const empty=()=>({artifacts:[],skills:[],memoryIds:[],connectorActions:[]});
const names=['workspace_enterprise_context_status','workspace_enterprise_context_memory_search','workspace_enterprise_context_memory_add','workspace_enterprise_context_memory_history','workspace_enterprise_context_parse_upload'];
const stop={text:'SYNTHETIC parsed-source answer; not actual Docling or model reasoning.'};
export async function fixture(t,{script,missing=false,noLibrary=false,timeoutMs=15000,life=()=>{},pluginConfiguration={},allSources=false,transfer=true,memory=false}={}){
 const directory=await fs.mkdtemp('/tmp/enterprise-context-host-');
 const seed=await taskFixture(t,{directory,enterprise:true});const rows=[];
 for(const label of ['A','B']){
  const saved=await seed.app.artifacts.create({requestId:randomUUID(),filename:'synthetic-'+label+'.txt',content:'SYNTHETIC authorized source '+label,metadata:{businessLibrary:{visibility:'internal'}}});
  const asset={artifactId:saved.artifact.id,version:1,sha256:saved.artifact.sha256};
  const document=(await seed.app.businessLibrary.createDocument({requestId:randomUUID(),title:'Synthetic customer '+label,slotKey:'specification',asset},{subject:'member-a',role:'admin'})).document;
  rows.push({documentId:document.id,asset,revision:1,documentVersion:1});
 }
 await seed.app.close();
 const state={calls:0,customer:'A',responseHook:null,responseText:'SYNTHETIC_DOCLING_TEXT',responsePayload:null,responseStatus:200,delay:0,held:null,closed:false,identity:null,
  transferAllowed:true,transferChecks:[],transferHook:null,parserDestination:null,doclingSecret:'synthetic-docling-credential-'+randomUUID()+'@"/+&'};let f;const lifecycle=[];
 const server=createServer(async(req,res)=>{
  state.calls++;assert.equal(req.method,'POST');assert.equal(req.url,'/v1/convert/file');
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const form=await new Request('http://fixture',{method:'POST',body:Buffer.concat(chunks),headers:{'content-type':req.headers['content-type']}}).formData();
  const bytes=Buffer.from(await form.get('files').arrayBuffer());assert.ok(rows.some(row=>row.asset.sha256===createHash('sha256').update(bytes).digest('hex')));
  if(state.responseHook)await state.responseHook();
  res.on('close',()=>{state.closed=true;});if(state.held){state.held();return;}
  if(state.delay)await new Promise(resolve=>setTimeout(resolve,state.delay));
  if(!res.destroyed){res.statusCode=state.responseStatus;res.setHeader('content-type','application/json');res.end(JSON.stringify(state.responsePayload||{status:'success',document:{text_content:state.responseText},errors:[]}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const connection={reviewed:true,baseURL:'http://127.0.0.1:'+server.address().port,apiKey:state.doclingSecret,timeoutMs};
 state.parserDestination=connection.baseURL+'/v1/convert/file';
 const authorizeParserTransfer=transfer?async request=>{
  const {signal,...facts}=request;state.transferChecks.push(facts);if(state.transferHook)await state.transferHook(request);
  const pin=rows.find(row=>row.documentId===request.documentId);
  return state.transferAllowed===true&&request.transfer==='complete-file'&&request.purpose==='document-extraction'
   &&request.recipient.kind==='docling'&&request.recipient.destination===state.parserDestination
   &&request.documentRevision===pin?.revision&&request.documentVersion===pin?.documentVersion&&libraryReadHash(request.target)===libraryReadHash(pin?.asset);
 }:undefined;

 const responses=script?script(rows):[{tool:'workspace_enterprise_context_parse_upload',arguments:rows[0].asset,expectedToolNames:names},stop];
 const engineAdapter=createWorkspaceOmpEngineAdapter({paths:workspaceOmpPaths({}),configuration:{providerId:MODEL.provider,model:MODEL.id,baseUrl:MODEL.baseUrl},enterpriseContext:true,
  pluginConfiguration,syntheticResponses:responses,onWorkerLifecycle:event=>{lifecycle.push(event);life(event,state,f);}});
 const policy={enabled:true,reviewed:true,workspaceId:'pi-enterprise-test',subject:'member-a',expiresAt:'2099-01-01T00:00:00.000Z',recipient:RECIPIENT,company:null,products:[],productFields:['name'],
  factoryMaterials:{products:[],productFields:['name'],documents:rows.map(row=>({id:row.documentId,revision:1,documentVersion:1,asset:row.asset}))}};
 const bindingOptions=()=>({recipient:RECIPIENT,selection:{enabled:true,reviewed:true,customerId:'customer-'+state.customer,...(memory?{allowMemoryRead:true,allowMemoryWrite:true}:{}),sources:allSources?rows:[rows[state.customer==='A'?0:1]]},connection:missing?{}:connection,authorizeParserTransfer});
 f=await taskFixture(t,{directory,enterprise:true,libraryModelReadPolicy:noLibrary?null:policy,businessAgentOptions:{recipient:RECIPIENT,engineAdapter,
  resolveBinding:async({actor,sessionReadonlyClient})=>{state.identity=actor;return {client:sessionReadonlyClient(actor),model:MODEL,enterpriseContextHost:await f.app.enterpriseContextSessionBinding(actor,bindingOptions())};}}});
 t.after(async()=>{await f.app.close();await fs.rm(directory,{recursive:true,force:true});});
 return Object.assign(f,{rows,state,lifecycle,bindingOptions,responses,connection});
}
export async function conversation(f){const r=await f.workspace('/api/conversations',{subject:'member-a',body:{title:'Synthetic enterprise sources',inputContext:empty()}});assert.equal(r.status,201,r.text);return r.json.conversation.id;}
let next=0;
export async function send(f,cid,{write=false}={}){
 const reply=await f.workspace(`/api/conversations/${cid}/messages`,{subject:'member-a',body:{content:'Use only the selected synthetic source, no real service or model claim.',requestId:'enterprise-context-'+(++next),workspaceExecution:write,inputContext:empty()}});
 assert.equal(reply.status,202,reply.text);const until=Date.now()+40000;
 while(Date.now()<until){const run=f.app.store.read().runs.find(row=>row.id===reply.json.run.id);if(run&&!['running','queued'].includes(run.status))return run;await new Promise(resolve=>setTimeout(resolve,25));}
 throw Error('Original Run timeout');
}
export const calls=run=>run.events.filter(row=>row.type==='pi.agent-session.request').length;
export async function journal(f,cid){const map=f.app.store.read().conversations.find(row=>row.id===cid).businessAgentSession;return (await fs.readFile(map.sessionFile,'utf8')).trim().split('\n').map(JSON.parse);}
export async function changeSource(f){await f.app.store.update(state=>{state.businessLibrary.documents.find(row=>row.id===f.rows[0].documentId).revision++;});}
