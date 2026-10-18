// Real original startWorkspaceServer, upload/Library/Session/Run/SDK. Only
// provider SSE and Docling text are finite stand-ins, using synthetic files.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash,generateKeyPairSync,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {startWorkspaceServer} from '../../server/index.mjs';
import {signWorkspaceRequest} from '../../server/auth-ingress.mjs';
import {workspaceOmpPaths,verifyWorkspaceOmpRuntime} from '../../server/workspace-omp-runtime.mjs';
import {DEEPSEEK_PRICES} from '../../server/deepseek-acceptance-policy.mjs';
import {NATIVE_FACTS_PAID_ACCEPTANCE} from '../../server/workspace-omp-local-deepseek.mjs';
import {decisionSetup} from './brain-decision-input.mjs';
import {request} from '../agent-service.helpers.mjs';
export const QUERY={subjectType:'product',subjectId:'synthetic-bottle',factKey:'moq'};
export const STATEMENT='SYNTHETIC bottle MOQ is 120 units; confirm the supplier before any commercial promise.';
const empty=()=>({artifacts:[],skills:[],memoryIds:[],connectorActions:[]});
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
export async function startupFixture(t,{documents=true,mode='control'}={}){
 const original=workspaceOmpPaths(process.env);await verifyWorkspaceOmpRuntime(original);
 const directory=await fs.mkdtemp('/tmp/native-document-startup-'),dataDirectory=path.join(directory,'data'),configFile=path.join(directory,'finite.json'),reportFile=path.join(directory,'provider-summary.json'),wrapper=path.join(directory,'finite-bun');
 const keys=generateKeyPairSync('ed25519'),workspaceId='document-startup-test',subject='member-a',parserSecret='synthetic-parser-only-no-network';
 const identity={workspaceId,publicOrigin:'https://workspace.example',issuer:'document-fixture',keyId:'document-fixture-key'};
 const publicKeyFile=path.join(directory,'ingress-public.pem'),membersFile=path.join(directory,'members.json');
 await fs.writeFile(publicKeyFile,keys.publicKey.export({type:'spki',format:'pem'}),{mode:0o600});await fs.writeFile(membersFile,JSON.stringify([{subject,role:'admin'},{subject:'member-b',role:'operator'}]),{mode:0o600});
 await fs.writeFile(wrapper,'#!/bin/sh\nexport WORKSPACE_NATIVE_DOCUMENT_FIXTURE='+quote(configFile)+'\nexec '+quote(original.bun)+' --no-install --preload '+quote(fileURLToPath(new URL('./native-document-provider-preload.mjs',import.meta.url)))+' "$@"\n',{mode:0o700});
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const environment={PORT:String(port),WORKSPACE_DATA_DIR:dataDirectory,WORKSPACE_RUNTIME:'omp',WORKSPACE_OMP_PROFILE:'business',WORKSPACE_ACCESS_MODE:'enterprise',WORKSPACE_PUBLIC_ORIGIN:identity.publicOrigin,WORKSPACE_ID:workspaceId,WORKSPACE_INGRESS_ISSUER:identity.issuer,WORKSPACE_INGRESS_KEY_ID:identity.keyId,WORKSPACE_INGRESS_PUBLIC_KEY_FILE:publicKeyFile,WORKSPACE_MEMBERS_FILE:membersFile,
  WS_AGENT_ENABLED:'1',WS_AGENT_PRINCIPALS:JSON.stringify([subject,'member-b'].map(s=>({subject:s,workspaceId,tokenSha256:createHash('sha256').update('synthetic-fixture-'+s).digest('hex'),scopes:['agent:read','agent:submit']}))),
  PI_PROVIDER:'deepseek',PI_MODEL:'deepseek-flash',DEEPSEEK_API_KEY:'synthetic-unused-offline',WORKSPACE_OMP_PROVIDER_COST_JSON:JSON.stringify(DEEPSEEK_PRICES.ompUsdPerMillion),WORKSPACE_OMP_LIVE_BUDGET_VERIFIED:'1',WORKSPACE_BUN_BIN:wrapper,WORKSPACE_OMP_PACKAGE_ROOT:original.packageRoot,WORKSPACE_DOCLING_API_KEY:parserSecret};
 let app=await startWorkspaceServer({environment});const sessions=new Map(),baseURL='http://127.0.0.1:'+port;
 const workspace=async(route,{body,subject:who=subject}={})=>{
  if(!sessions.has(who)){
   const target='/api/session/login',login=await request(baseURL,target,{method:'POST',body:{},headers:{Host:'workspace.example',Origin:identity.publicOrigin,'X-Workspace-Login':'1','X-Workspace-Assertion':signWorkspaceRequest({privateKey:keys.privateKey,...identity,subject:who,method:'POST',target,body:'{}'})}});
   assert.equal(login.status,200,login.text);sessions.set(who,{Cookie:login.headers['set-cookie'][0].split(';')[0],'X-CSRF-Token':login.json.csrfToken});
  }
  const method=body===undefined?'GET':'POST';return request(baseURL,route,{method,...(body===undefined?{}:{body}),headers:{Host:'workspace.example',...(body===undefined?{}:{Origin:identity.publicOrigin}),...sessions.get(who),'X-Workspace-Assertion':signWorkspaceRequest({privateKey:keys.privateKey,...identity,subject:who,method,target:route,body:body===undefined?'':JSON.stringify(body)})}});
 };
 let parserCalls=0;const parser=createServer(async(req,res)=>{
  assert.equal(req.url,'/v1/convert/file');assert.equal(req.method,'POST');const parts=[];for await(const chunk of req)parts.push(chunk);
  const form=await new Request('http://synthetic-loopback',{method:'POST',headers:{'content-type':req.headers['content-type']},body:Buffer.concat(parts)}).formData();
  assert.equal(await form.get('files').text(),STATEMENT);parserCalls++;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({status:'success',document:{text_content:STATEMENT},errors:[]}));
 });await new Promise(r=>parser.listen(0,'127.0.0.1',r));
 t.after(async()=>{await app.close();await new Promise(r=>{parser.close(r);parser.closeAllConnections();});await fs.rm(directory,{recursive:true,force:true});});
 const uploaded=await workspace('/api/artifacts',{body:{requestId:randomUUID(),filename:'synthetic-bottle.txt',base64:Buffer.from(STATEMENT).toString('base64'),metadata:{businessLibrary:{visibility:'internal'}}}});assert.equal(uploaded.status,201,uploaded.text);
 const asset={artifactId:uploaded.json.artifact.id,version:uploaded.json.artifact.currentVersion,sha256:uploaded.json.artifact.sha256};
 const linked=await workspace('/api/library/documents',{body:{requestId:randomUUID(),title:'Synthetic bottle evidence',slotKey:'specification',asset}});assert.equal(linked.status,201,linked.text);const document=linked.json.document;
 // Existing reviewed Goal is an explicit fixture prerequisite. Use the
 // original ordinary owner conversation service, never a business-owned chat
 // or a direct Store seed; the Goal itself still goes through original HTTP.
 const owner=await app.runtime.createConversation({requestId:randomUUID(),title:'Original Goal owner',inputContext:empty()},{subject,workspaceId});
 const g=await workspace('/api/goals',{body:{requestId:randomUUID(),title:'Investigate synthetic MOQ',description:'No external action or spending',conversationId:owner.conversation.id,inputContext:empty()}});assert.equal(g.status,201,g.text);const goal=g.json.goal;
 assert.equal(app.store.read().businessLibrary.enterpriseMemories.length,0);
 await app.close();sessions.clear();
 const model={provider:'workspace-deepseek',id:'deepseek-flash',api:'openai-completions',baseUrl:'https://api.deepseek.com'},recipient={kind:'pi-coding-agent',provider:model.provider,model:model.id,destination:model.baseUrl};
 const libraryModelReadPolicy={enabled:true,reviewed:true,workspaceId,subject,expiresAt:'2099-01-01T00:00:00.000Z',recipient,company:null,products:[],productFields:['name'],factoryMaterials:{products:[],productFields:['name'],documents:[{id:document.id,revision:document.revision,documentVersion:document.currentVersion,asset}]}};
 const goalBrainOptions={originalReceiver:model,reviewedGoals:[{id:goal.id,originalRevision:goal.revision,currency:'USD',businessStatus:'active',capabilities:['analysis','draft','none'],budgetRemainingMinor:null,perTaskCapMinor:null,reviewed:true}]};
 const pluginConfiguration={disabled:['workspace-factory-materials','workspace-market-validation','workspace-shopify-product','workspace-medusa-catalog','workspace-marketplace']};
 const reviewed={pluginConfiguration,libraryModelReadPolicy,goalBrainOptions,selection:{enabled:true,reviewed:true,customerId:'synthetic-customer',sources:[{documentId:document.id,asset}],allowMemoryRead:true,allowMemoryWrite:true},connection:{reviewed:true,baseURL:'http://127.0.0.1:'+parser.address().port},parserTransfer:{approved:true,purpose:'document-extraction',transfer:'complete-file',recipient:{kind:'docling',destination:'http://127.0.0.1:'+parser.address().port+'/v1/convert/file'}},brainMemoryFactKeys:[QUERY],brainDocumentTools:true,paidAcceptance:{kind:NATIVE_FACTS_PAID_ACCEPTANCE,historicalUpperCny:0.139804}};
 const reviewFile=path.join(directory,'reviewed-business.json');await fs.writeFile(reviewFile,JSON.stringify(reviewed),{mode:0o600});
 if(documents)app=await startWorkspaceServer({environment:{...environment,WORKSPACE_BUSINESS_REVIEW_FILE:reviewFile}});
 else app=await startWorkspaceServer({environment,reviewedBusiness:{libraryModelReadPolicy,goalBrainOptions,resolveBinding:async()=>({})}});
 const c=await workspace('/api/conversations',{body:{requestId:randomUUID(),title:'Document to Brain first slice',inputContext:empty()}});assert.equal(c.status,201,c.text);const cid=c.json.conversation.id;
 if(documents){const missing=await workspace('/api/conversations/'+cid+'/messages',{body:{requestId:randomUUID(),content:'Read only explicitly reviewed selected documents.',workspaceExecution:false,inputContext:empty()}});assert.equal(missing.status,409,missing.text);assert.equal(missing.json.error.code,'BUSINESS_AGENT_DOCUMENT_SELECTION_REQUIRED');assert.equal(app.store.read().runs.length,0);}
 const refs=await workspace('/api/conversations/'+cid+'/library-references',{body:{requestId:randomUUID(),expectedRevision:0,references:{products:[],documents:[{documentId:document.id,documentVersion:document.currentVersion}]}}});assert.equal(refs.status,200,refs.text);
 const writeFixture=turn=>fs.writeFile(configFile,JSON.stringify({mode,documents,bounded:documents,turn,statement:STATEMENT,parserSecret,inputs:decisionSetup('not-a-discovered-goal',[]),reportFile}),{mode:0o600});await writeFixture(1);
 return {app,workspace,cid,asset,document,goal,writeFixture,parserCalls:()=>parserCalls,readProvider:async()=>JSON.parse(await fs.readFile(reportFile,'utf8')),
  mapping:()=>app.store.read().conversations.find(c=>c.id===cid).businessAgentSession,
  messages:async()=>{const map=app.store.read().conversations.find(c=>c.id===cid).businessAgentSession;return(await fs.readFile(map.sessionFile,'utf8')).trim().split('\n').map(JSON.parse).map(e=>e.message).filter(Boolean);}};
}
export async function sendStartup(f,content='Read my selected uploaded document, save the exact MOQ fact with its source, then analyze it against the existing Goal; do not execute anything.'){
 const sent=await f.workspace('/api/conversations/'+f.cid+'/messages',{body:{requestId:randomUUID(),content,workspaceExecution:false,inputContext:empty()}});assert.equal(sent.status,202,sent.text);
 const deadline=Date.now()+65000;while(Date.now()<deadline){const run=f.app.store.read().runs.find(r=>r.id===sent.json.run.id);if(!['queued','running'].includes(run.status))return run;await new Promise(r=>setTimeout(r,20));}throw Error('Original startup fixture did not settle');
}
