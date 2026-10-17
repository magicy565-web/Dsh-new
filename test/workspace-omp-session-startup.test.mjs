// Explicit legacy HTTP entry, original enterprise login/CSRF, disk Host and OMP SDK.
// All identity configuration, task records and model replies are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { openStore } from '../server/store.mjs';
import { signWorkspaceRequest } from '../server/auth-ingress.mjs';
import { request } from './agent-service.helpers.mjs';
const repository = new URL('..', import.meta.url).pathname;
const sha = text => createHash('sha256').update(text).digest('hex');
async function freePort() {
  const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}

test('explicit legacy HTTP entry loads Session reads: signed login -> OMP tools -> saved result; absent binding/logout/rotation refuse', { timeout:60000 }, async t => {
  assert.equal(await fs.stat(repository+'/.env').then(()=>true).catch(()=>false),false,'Do not read a user dotenv file in the synthetic startup fixture.');
  const directory=await fs.mkdtemp('/tmp/omp-session-npm-start-'),port=await freePort(),data=directory+'/original';
  const keys=generateKeyPairSync('ed25519');
  const access={publicOrigin:'https://startup-session.example',workspaceId:'synthetic-startup-workspace',issuer:'synthetic-startup-ingress',keyId:'synthetic-startup-key'};
  await fs.writeFile(directory+'/public.pem',keys.publicKey.export({type:'spki',format:'pem'}),{mode:0o600});
  await fs.writeFile(directory+'/members.json',JSON.stringify([{subject:'synthetic-owner',role:'admin'},{subject:'synthetic-no-binding',role:'operator'}]),{mode:0o600});
  const content='# Synthetic startup document\nPermission regression only; not real enterprise data.\n';
  const store=await openStore(data);
  try { await store.update(state=>{state.workspaceAgentTasks={version:1,tasks:[
    ['synthetic-startup-owned','synthetic-owner'],['synthetic-startup-other','synthetic-no-binding'],
  ].map(([id,subject])=>({id,subject,workspaceId:access.workspaceId,title:'Synthetic startup business record',type:'procurement',mode:'model',status:'done',attempt:1,
    createdAt:'2026-10-15T00:00:00.000Z',finishedAt:'2026-10-15T00:00:00.000Z',input:{product:'Synthetic public cup'},steps:[],events:[],
    result:{state:'completed',completion:'documents_ready',businessGoalAchieved:false},
    deliverables:[{name:'synthetic.md',content,bytes:Buffer.byteLength(content),sha256:sha(content),url:'/api/agent/v1/tasks/'+id+'/artifacts/synthetic.md'}]}))};}); }
  finally {await store.close();}
  // npm start belongs to the native TTY. HTTP Host regression must opt in to
  // the existing legacy entry; do not change the default entry to satisfy it.
  const child=spawn('npm',['run','legacy:workspace'],{cwd:repository,detached:true,stdio:['ignore','pipe','pipe'],env:{
    PATH:process.env.PATH,HOME:directory,TMPDIR:directory,NO_COLOR:'1',NPM_CONFIG_UPDATE_NOTIFIER:'false',PORT:String(port),WORKSPACE_DATA_DIR:data,
    NODE_OPTIONS:'--import '+repository+'/test/fixtures/omp-session-startup-model-preload.mjs',
    WORKSPACE_ACCESS_MODE:'enterprise',WORKSPACE_PUBLIC_ORIGIN:access.publicOrigin,WORKSPACE_ID:access.workspaceId,
    WORKSPACE_INGRESS_ISSUER:access.issuer,WORKSPACE_INGRESS_KEY_ID:access.keyId,WORKSPACE_INGRESS_PUBLIC_KEY_FILE:directory+'/public.pem',WORKSPACE_MEMBERS_FILE:directory+'/members.json',
    WS_AGENT_ENABLED:'1',WS_AGENT_PRINCIPALS:JSON.stringify([{subject:'synthetic-owner',workspaceId:access.workspaceId,tokenSha256:sha('explicit-synthetic-unused-principal'),scopes:['agent:read']}]),
    PI_PROVIDER:'deepseek',PI_MODEL:'deepseek-flash',DEEPSEEK_API_KEY:'explicit-synthetic-unused-model-key',
    WORKSPACE_OMP_PROVIDER_COST_JSON:JSON.stringify({input:0.3,output:1.2,cacheRead:0.006,cacheWrite:0.3}),WORKSPACE_OMP_LIVE_BUDGET_VERIFIED:'1',
  }});
  const exited=once(child,'close');let output='';
  child.stdout.on('data',data=>{output+=data;if(output.length>100000)child.kill();});child.stderr.on('data',data=>{output+=data;});
  t.after(async()=>{
    if(child.exitCode===null)try{process.kill(-child.pid,'SIGTERM');}catch{}
    let timer;await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}resolve();},3000);})]);clearTimeout(timer);
    await exited;await fs.rm(directory,{recursive:true,force:true});
  });
  for(let i=0;i<250&&!output.includes('Workspace server:');i++){if(child.exitCode!==null)throw Error(output);await new Promise(resolve=>setTimeout(resolve,40));}
  assert.match(output,/Workspace server:/);assert.match(output,/scripts\/workspace-omp-legacy\.mjs/);
  const base='http://127.0.0.1:'+port,sessions=new Map();
  async function signed(subject,target,body,login=false){
    const method=body===undefined?'GET':'POST';
    return request(base,target,{method,...(body===undefined?{}:{body}),headers:{Host:'startup-session.example',...(method==='POST'?{Origin:access.publicOrigin}:{}),
      ...(sessions.get(subject)||{}),...(login?{'X-Workspace-Login':'1'}:{}),
      'X-Workspace-Assertion':signWorkspaceRequest({privateKey:keys.privateKey,...access,subject,method,target,body:body===undefined?'':JSON.stringify(body)})}});
  }
  async function login(subject){const r=await signed(subject,'/api/session/login',{},true);assert.equal(r.status,200);sessions.set(subject,{Cookie:r.headers['set-cookie'][0].split(';')[0],'X-CSRF-Token':r.json.csrfToken});}
  const subject='synthetic-owner';
  const beforeLogin=await signed(subject,'/api/session');assert.equal(beforeLogin.status,200);assert.equal(beforeLogin.json.authenticated,false);
  await login(subject);assert.equal((await signed(subject,'/api/session')).json.authenticated,true);
  assert.equal((await signed(subject,'/api/conversations/runtime')).json.engine,'omp');
  const created=await signed(subject,'/api/conversations',{title:'Synthetic actual npm entry',requestId:'npm-entry-conversation'});assert.equal(created.status,201);
  const cid=created.json.conversation.id,route=`/api/conversations/${cid}/messages`;
  const body={content:'Read only my original task and saved result.',requestId:'npm-entry-read',workspaceExecution:false};
  const accepted=await signed(subject,route,body);assert.equal(accepted.status,202,accepted.text);const runId=accepted.json.run.id;
  let state,run;
  for(let i=0;i<400;i++){state=JSON.parse(await fs.readFile(data+'/workspace.json'));run=state.runs.find(r=>r.id===runId);if(run&&!['running','queued'].includes(run.status))break;await new Promise(resolve=>setTimeout(resolve,30));}
  assert.equal(run.status,'succeeded',JSON.stringify(run.error));assert.equal(state.runs.length,1);assert.equal(state.workspaceAgentTasks.tasks.length,2);
  const mapping=state.conversations.find(c=>c.id===cid).businessAgentSession;
  const entries=(await fs.readFile(mapping.sessionFile,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const receipts=entries.filter(e=>e.message?.role==='toolResult');assert.deepEqual(receipts.map(e=>e.message.toolName),['workspace_business_tasks','workspace_business_result']);
  assert.ok(receipts.every(e=>!e.message.isError));assert.equal(receipts[0].message.details.tasks[0].taskId,'synthetic-startup-owned');
  assert.ok(!JSON.stringify(receipts).includes('synthetic-startup-other'));
  const result=await signed(subject,`/api/conversations/${cid}/business-results`);assert.equal(result.status,200);assert.equal(result.json.status,'available');
  assert.equal(result.json.results[0].sources.find(source=>source.kind==='artifact').sha256,sha(content));
  await login('synthetic-no-binding');
  const unbound=await signed('synthetic-no-binding','/api/conversations',{title:'Synthetic missing binding',requestId:'npm-entry-no-binding'});assert.equal(unbound.status,201);
  const denied=await signed('synthetic-no-binding',`/api/conversations/${unbound.json.conversation.id}/messages`,{...body,requestId:'unbound-read'});
  assert.equal(denied.status,403);assert.equal(denied.json.error.code,'AGENT_PRINCIPAL_REQUIRED');
  const logout=await signed(subject,'/api/session/logout',{});assert.equal(logout.status,200);
  assert.equal((await signed(subject,`/api/conversations/${cid}/business-results`)).status,401);
  await login(subject);
  const rotated=await signed(subject,route,{...body,requestId:'rotated-session-read'});assert.equal(rotated.status,403);assert.equal(rotated.json.error.code,'BUSINESS_AGENT_BINDING_CHANGED');
  state=JSON.parse(await fs.readFile(data+'/workspace.json'));assert.equal(state.runs.length,1);assert.equal(state.workspaceAgentTasks.tasks.length,2);
});
