// Real original Host, signed enterprise Session, Store, Agent coordinator and
// official OMP SDK. All members/principals/tasks/model responses are synthetic;
// no real credential, enterprise record or paid model is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { taskFixture, until } from './fixtures/pi-task-helpers.mjs';
import { request } from './agent-service.helpers.mjs';
import { createWorkspaceOmpBusinessOptions } from '../server/workspace-omp-host.mjs';
import { createWorkspaceOmpEngineAdapter, workspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';
import { acceptanceConfiguration } from '../server/deepseek-acceptance-policy.mjs';
const sha = text => createHash('sha256').update(text).digest('hex');
const empty = () => ({ artifacts: [], skills: [], memoryIds: [], connectorActions: [] });
function options(responses = []) {
  const environment = { DEEPSEEK_API_KEY: 'explicit-synthetic-unused', PI_PROVIDER: 'deepseek', PI_MODEL: 'deepseek-flash',
    WORKSPACE_OMP_PROVIDER_COST_JSON: JSON.stringify({input:0.3,output:1.2,cacheRead:0.006,cacheWrite:0.3}), WORKSPACE_OMP_LIVE_BUDGET_VERIFIED: '1' };
  const opts = createWorkspaceOmpBusinessOptions({ environment });
  opts.engineAdapter = createWorkspaceOmpEngineAdapter({ paths: workspaceOmpPaths({}),
    configuration: acceptanceConfiguration(environment), syntheticResponses: responses });
  return opts;
}
async function fixture(t, { enterprise = true, principals, accessClock, responses = [], customOptions } = {}) {
  return taskFixture(t, { enterprise, principals, accessClock, businessAgentOptions: customOptions || options(responses) });
}
async function http(f, route, body, subject='member-a') {
  return f.enterprise ? f.workspace(route, {subject,...(body===undefined?{}:{body})})
    : request(f.baseURL, route, {method:body===undefined?'GET':'POST',...(body===undefined?{}:{body})});
}
async function identity(f, subject='member-a') {
  const session = await http(f, '/api/session', undefined, subject);
  assert.equal(session.status, 200);
  const view = session.json;
  let sessionId = null;
  if (f.enterprise) {
    const sessions = await http(f, '/api/access/sessions'); assert.equal(sessions.status,200);
    sessionId = sessions.json.sessions.find(row=>row.subject===subject).id;
  }
  return {subject:view.user.id,workspaceId:view.workspaceId,role:view.user.role,sessionId};
}
async function seed(f) {
  const content = '# Synthetic original business document\nFor permission regression only.\n';
  await f.app.store.update(state => {
    state.workspaceAgentTasks.tasks.push(...[
      ['synthetic-owned-old','member-a','pi-enterprise-test','2026-10-14T00:00:00.000Z'],
      ['synthetic-owned-new','member-a','pi-enterprise-test','2026-10-15T00:00:00.000Z'],
      ['synthetic-other-member','member-b','pi-enterprise-test','2026-10-15T01:00:00.000Z'],
      ['synthetic-other-workspace','member-a','other-synthetic-workspace','2026-10-15T02:00:00.000Z'],
    ].map(([id,subject,workspaceId,createdAt])=>({ id,subject,workspaceId,createdAt,finishedAt:createdAt,mode:'model',type:'procurement',
      title:'Synthetic permission regression '+id,status:'done',input:{product:'Synthetic public cup'},steps:[],events:[],attempt:1,
      result:{state:'completed',completion:'documents_ready',businessGoalAchieved:false},
      deliverables:[{name:'synthetic.md',content,bytes:Buffer.byteLength(content),sha256:sha(content),url:'/api/agent/v1/tasks/'+id+'/artifacts/synthetic.md'}] })));
  });
}
async function conversation(f) {
  const r = await http(f, '/api/conversations', {title:'Explicit synthetic Session read',requestId:'session-read-conversation',inputContext:empty()});
  assert.equal(r.status,201,r.text);return r.json.conversation.id;
}
const send = (f,cid,key,workspaceExecution=false)=>http(f,`/api/conversations/${cid}/messages`,{
  content:'Read only my original task; no business execution.',requestId:key,workspaceExecution,inputContext:empty()});

test('Session client requires an existing principal; local valid binding is empty, never fabricated', async t => {
  const f = await fixture(t,{enterprise:false,principals:[]});
  assert.throws(()=>f.app.builtinAgent.sessionReadonlyClient({subject:'local-operator',workspaceId:'local',role:'admin',sessionId:null}),/principal/);
  const cid = await conversation(f), denied = await send(f,cid,'missing-principal');
  assert.equal(denied.status,403);assert.equal(denied.json.error.code,'AGENT_PRINCIPAL_REQUIRED');assert.equal(f.app.store.read().runs.length,0);
  const g = await fixture(t,{enterprise:false,responses:[{tool:'workspace_business_tasks',arguments:{limit:1},expectedToolNames:['workspace_business_tasks','workspace_business_result']},{text:'No authorized original records matched; empty is not a sample result.'}]});
  const client = g.app.builtinAgent.sessionReadonlyClient(await identity(g));
  assert.equal(client.readOnlySession,true);assert.equal(client.businessSubmit,undefined);assert.equal(client.companyProfile,undefined);
  assert.equal((await client.businessTasks({limit:1})).status,'empty');
  assert.equal((await client.businessResult()).status,'empty');assert.equal(g.app.store.read().workspaceAgentTasks.tasks.length,0);
  const gcid=await conversation(g),accepted=await send(g,gcid,'local-empty-read');assert.equal(accepted.status,202,accepted.text);
  await until(()=>{const run=g.app.store.read().runs.find(r=>r.id===accepted.json.run.id);return run&&!['queued','running'].includes(run.status)});
  assert.equal(g.app.store.read().runs[0].status,'succeeded');
  const mapping=g.app.store.read().conversations.find(c=>c.id===gcid).businessAgentSession;
  const entries=(await fs.readFile(mapping.sessionFile,'utf8')).trim().split('\n').map(l=>JSON.parse(l));
  assert.equal(entries.find(e=>e.message?.role==='toolResult').message.details.status,'empty');
  assert.equal(g.app.store.read().workspaceAgentTasks.tasks.length,0);
});

test('enterprise Session reads original owner-scoped tasks/results and rejects selectors, cross-owner IDs and changed identity', async t => {
  const f=await fixture(t);await seed(f);
  const actor=await identity(f),client=f.app.builtinAgent.sessionReadonlyClient(actor);
  const list=await client.businessTasks({limit:1});
  assert.deepEqual(list.tasks.map(t=>t.taskId),['synthetic-owned-new']);assert.equal(list.hasMore,true);
  assert.equal(list.sources[0].api,'/api/agent/v1/tasks/synthetic-owned-new');
  const result=await client.businessResult();assert.equal(result.status,'available');assert.equal(result.task.taskId,'synthetic-owned-new');
  assert.equal(result.sources.find(s=>s.kind==='artifact').sha256,sha(result.artifacts[0].content));
  await assert.rejects(client.businessTasks({limit:1,subject:'member-b'}));
  await assert.rejects(client.businessResult({taskId:'synthetic-other-member'}),/NOT_FOUND/);
  await assert.rejects(client.businessResult({taskId:'synthetic-other-workspace'}),/NOT_FOUND/);
  assert.throws(()=>f.app.builtinAgent.sessionReadonlyClient({...actor,role:'operator'}),/Session/);
  assert.throws(()=>f.app.builtinAgent.sessionReadonlyClient({...actor,workspaceId:'other-synthetic-workspace'}),/Session/);
  const other=f.app.builtinAgent.sessionReadonlyClient(await identity(f,'member-b'));
  assert.deepEqual((await other.businessTasks({limit:20})).tasks.map(t=>t.taskId),['synthetic-other-member']);
  const readArtifact=f.app.builtinAgent.store.readArtifact.bind(f.app.builtinAgent.store);
  f.app.builtinAgent.store.readArtifact=async (...args)=>{const file=await readArtifact(...args);const logout=await http(f,'/api/session/logout',{});assert.equal(logout.status,200);return file;};
  await assert.rejects(client.businessResult({taskId:'synthetic-owned-new'}),/Session/);
  await assert.rejects(client.businessTasks({limit:1}),/Session/);
  assert.equal(f.app.store.read().runs.length,0);assert.equal(f.faux.state.callCount,0);
});

test('Session client rechecks principal expiry and Session rotation; no cached authority survives', async t => {
  let clock=Date.now();
  const principals=[{subject:'member-a',workspaceId:'pi-enterprise-test',tokenSha256:sha('explicit-synthetic-principal'),scopes:['agent:read'],expiresAt:new Date(clock+20000).toISOString()}];
  const f=await fixture(t,{principals,accessClock:()=>clock});
  const first=f.app.builtinAgent.sessionReadonlyClient(await identity(f));
  assert.equal((await first.businessTasks()).status,'empty');
  const rotated=await f.workspace('/api/session/login',{subject:'member-a',body:{},headers:{'X-Workspace-Login':'1'}});assert.equal(rotated.status,200);
  await assert.rejects(first.bindingIdentity(),/Session/);
  f.clearWorkspaceSession('member-a');
  const next=f.app.builtinAgent.sessionReadonlyClient(await identity(f));
  assert.notEqual(next.bindingFingerprint,first.bindingFingerprint);
  clock+=21000;await assert.rejects(next.businessTasks(),/过期|撤销/);
});

test('actual OMP Session calls existing read tools over original Host HTTP with no business bearer or paid model', {timeout:60000}, async t => {
  const responses=[
    {tool:'workspace_business_tasks',arguments:{limit:1},expectedToolNames:['workspace_business_tasks','workspace_business_result']},
    {tool:'workspace_business_result',arguments:{taskId:'synthetic-owned-new'},expectedContextText:'synthetic-owned-new'},
    {text:'Synthetic receipt only: synthetic-owned-new /api/agent/v1/tasks/synthetic-owned-new. Not real enterprise evidence.'},
  ];
  const f=await fixture(t,{responses,principals:[{subject:'member-a',workspaceId:'pi-enterprise-test',tokenSha256:sha('explicit-synthetic-read-only-principal'),scopes:['agent:read']}]});await seed(f);
  const cid=await conversation(f),execution=await send(f,cid,'must-not-submit',true);
  assert.equal(execution.status,403);assert.equal(execution.json.error.code,'SESSION_READONLY_EXECUTION_REFUSED');assert.equal(f.app.store.read().runs.length,0);
  const accepted=await send(f,cid,'original-session-read');assert.equal(accepted.status,202,accepted.text);
  const runId=accepted.json.run.id;
  await until(()=>{const r=f.app.store.read().runs.find(r=>r.id===runId);return r&&!['queued','running'].includes(r.status)});
  const run=f.app.store.read().runs.find(r=>r.id===runId);
  assert.equal(run.status,'succeeded',JSON.stringify(run.error));
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length,4);assert.equal(f.app.store.read().runs.length,1);assert.equal(f.faux.state.callCount,0);
  assert.deepEqual(run.executionRefs.map(r=>r.taskId),['synthetic-owned-new']);
  const mapping=f.app.store.read().conversations.find(c=>c.id===cid).businessAgentSession;
  const entries=(await fs.readFile(mapping.sessionFile,'utf8')).trim().split('\n').map(l=>JSON.parse(l));
  const receipts=entries.filter(e=>e.message?.role==='toolResult');
  assert.deepEqual(receipts.map(e=>e.message.toolName),['workspace_business_tasks','workspace_business_result']);
  assert.ok(receipts.every(e=>!e.message.isError));
  const listed=receipts[0].message.details;assert.equal(listed.sources[0].recordId,'synthetic-owned-new');
  assert.ok(!JSON.stringify(receipts).includes('synthetic-other-member'));
  const status=await http(f,`/api/conversations/${cid}/terminal-status?runId=${runId}`);assert.equal(status.status,200);assert.equal(status.json.run.status,'succeeded');
  const results=await http(f,`/api/conversations/${cid}/business-results`);assert.equal(results.status,200);assert.equal(results.json.status,'available');
  const foreign=await http(f,`/api/conversations/${cid}/business-results`,undefined,'member-b');assert.equal(foreign.status,404);
  const resume=await http(f,`/api/conversations/${cid}/business-tasks/synthetic-owned-new/resume`,{confirmed:true,requestId:'forbidden-resume'});
  assert.equal(resume.status,403);assert.equal(f.app.store.read().runs.length,1);
  const logout=await http(f,'/api/session/logout',{});assert.equal(logout.status,200);
  f.clearWorkspaceSession('member-a');
  const changed=await send(f,cid,'rotated-session-cannot-inherit');assert.equal(changed.status,403);assert.equal(changed.json.error.code,'BUSINESS_AGENT_BINDING_CHANGED');
});


test('original instance proof rejects a client from a different Host before admitting a Run', async t => {
  const opts=options(),resolve=opts.resolveBinding;
  opts.resolveBinding=async args=>{const b=await resolve(args);return {...b,client:{...b.client,bindingIdentity:async signal=>({...await b.client.bindingIdentity(signal),instanceId:'different-synthetic-instance'})}};};
  const f=await fixture(t,{customOptions:opts}),cid=await conversation(f);
  const denied=await send(f,cid,'wrong-host-instance');assert.equal(denied.status,403);assert.equal(denied.json.error.code,'BUSINESS_AGENT_IDENTITY_CHANGED');
  assert.equal(f.app.store.read().runs.length,0);assert.equal(f.faux.state.callCount,0);
});

test('forged model write call cannot submit business work through Session client or OMP RPC', {timeout:60000}, async t => {
  const f=await fixture(t,{responses:[{tool:'workspace_factory_task',arguments:{title:'Synthetic forbidden write'}},{text:'The attempted write is unavailable; no execution.'}]});
  const cid=await conversation(f),accepted=await send(f,cid,'forged-write');assert.equal(accepted.status,202,accepted.text);
  await until(()=>{const r=f.app.store.read().runs.find(r=>r.id===accepted.json.run.id);return r&&!['queued','running'].includes(r.status)});
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length,0);assert.equal(f.app.store.read().runs.length,1);
  assert.equal(f.faux.state.callCount,0);
  const c=f.app.store.read().conversations.find(c=>c.id===cid);
  const entries=(await fs.readFile(c.businessAgentSession.sessionFile,'utf8')).trim().split('\n').map(l=>JSON.parse(l));
  const receipt=entries.find(e=>e.message?.role==='toolResult');assert.ok(receipt);assert.equal(receipt.message.isError,true);
});
