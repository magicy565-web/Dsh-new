import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CommerceStore} from '../store.js';
import {createCommerceService} from '../service.js';
import {createResourceAdapter} from '../resources.js';
import {LibraryStore,createLibraryService} from '../../dsh-workspace-library/index.js';

const W1='00000000-0000-0000-0000-000000000001',W2='00000000-0000-0000-0000-000000000002';
const S1='session-00000000-0000-0000-0000-000000000011',S2='session-00000000-0000-0000-0000-000000000012';
const at=Date.parse('2026-10-28T00:00:00.000Z');
function fixture(t,options={}){
  const store=new CommerceStore(':memory:');
  const workspaces=new Map([[W1,{id:W1,sessionIds:[S1]}],[W2,{id:W2,sessionIds:[S2]}]]);
  let now=at,sequence=0;
  const registry={get:id=>workspaces.get(id),list:()=>[...workspaces.values()]};
  const service=createCommerceService({store,registry,clock:()=>now,...options});t.after(()=>service.close());
  const requestId=()=>`test_${++sequence}`;
  const state=(session=S1)=>service.state(session,'project');
  async function command(command,payload={},session=S1){
    return service.command(session,{command,payload,requestId:requestId(),projectId:command==='create_project'?undefined:'project',expectedRevision:service.state(session).revision});
  }
  async function tool(command,payload={},session=S1){
    return service.toolCommand({command,payload,requestId:requestId(),projectId:'project',expectedRevision:service.state(session).revision},{agent:{session:{id:session}},callId:requestId()});
  }
  async function setup(session=S1){
    await command('create_project',{id:'project',title:'Synthetic test project'},session);
    await tool('apply_plan',{parties:[{id:'factory',type:'factory',displayName:'Test factory'},{id:'provider',type:'provider',displayName:'Test provider'}],agents:[{id:'agent',providerPartyId:'provider',displayName:'Test Worker',skills:['public_web_research','read_granted_product_context']}],products:[{id:'product',name:'Test product',description:'Synthetic scoped product material'}]},session);
    const issued=await command('issue_agent_credential',{agentServiceId:'agent'},session);
    const token=issued.credential.token;await service.worker(token,'connect',{requestId:requestId()});return token;
  }
  async function propose({id='order',maximumMinor=0,refs=['product:product'],session=S1,dependsOn=[],agentServiceId='agent'}={}){
    await tool('propose_order',{id,requesterPartyId:'factory',agentServiceId,title:'Research public companies',brief:'Synthetic acceptance task; no outreach.',allowedActions:['public_web_research'],allowedResourceRefs:refs,maximumMinor,currency:'USD',ttlSeconds:3600,dependsOn},session);
  }
  async function approve(id='order',session=S1){
    const review=await service.review(session,'project',id);
    return command('approve_order',{orderId:id,reviewDigest:review.reviewDigest},session);
  }
  async function queue(id='order',session=S1){await propose({id,session});await approve(id,session);await tool('dispatch_order',{orderId:id},session);}
  async function claim(token,id='order'){return service.worker(token,'claim',{requestId:requestId(),orderId:id});}
  return {service,store,workspaces,command,tool,setup,propose,approve,queue,claim,state,requestId,advance:ms=>{now+=ms;}};
}

test('workers and native sessions cannot cross workspace boundaries or self-assert privileges',async t=>{
  const f=fixture(t),token=await f.setup();await f.setup(S2);await f.queue();
  const first=await f.claim(token),leaseId=first.order.leaseId;
  assert.equal(first.order.resources.length,1);
  assert.equal(f.state(S2).commerceNetwork.workOrders.length,0);
  await assert.rejects(()=>f.service.worker(token,'resources',{requestId:f.requestId(),orderId:'order',leaseId,workspaceId:W2}),{code:'INPUT'});
  await assert.rejects(()=>f.service.worker(token,'accept',{requestId:f.requestId(),orderId:'order',leaseId}),{code:'WORKER_ACTION'});
  await assert.rejects(()=>f.tool('approve_order',{orderId:'order'}),{code:'OWNER_ACTION_REQUIRED'});
  await assert.rejects(()=>f.tool('issue_agent_credential',{agentServiceId:'agent'}),{code:'OWNER_ACTION_REQUIRED'});
  await assert.rejects(()=>f.command('dispatch_order',{orderId:'order'}),{code:'NATIVE_DISPATCH_REQUIRED'});
  const secondToken=(await f.command('issue_agent_credential',{agentServiceId:'agent'},S2)).credential.token;
  await f.service.worker(secondToken,'connect',{requestId:f.requestId()});
  await assert.rejects(()=>f.service.worker(secondToken,'resources',{requestId:f.requestId(),orderId:'order',leaseId}),{code:'ORDER_NOT_FOUND'});
});

test('credential secret appears once, only hashes persist, and stale browser revisions cannot overwrite',async t=>{
  const f=fixture(t);await f.setup();
  const input={command:'issue_agent_credential',payload:{agentServiceId:'agent'},requestId:f.requestId(),projectId:'project',expectedRevision:f.state().revision};
  const issued=await f.service.command(S1,input),token=issued.credential.token;
  const replay=await f.service.command(S1,input);
  assert.equal(replay.credential.token,null);assert.equal(replay.credential.alreadyIssued,true);
  assert.equal(JSON.stringify(f.state()).includes(token),false);
  assert.equal(JSON.stringify(f.store.load(W1)).includes(token),false);
  const record=f.store.credential(token.slice(4,28));assert.equal(record.secret_hash,createHash('sha256').update(token).digest('hex'));
  assert.equal(JSON.stringify(record).includes(token),false);
  await assert.rejects(()=>f.service.command(S1,{...input,requestId:f.requestId(),command:'set_budget',payload:{maximumMinor:0,currency:'USD'}}),{code:'REVISION_CONFLICT'});
  await assert.rejects(()=>f.service.command(S1,{...input,payload:{agentServiceId:'other'}}),{code:'REQUEST_ID_CONFLICT'});
});

test('authorization reserves the complete maximum budget atomically',async t=>{
  const f=fixture(t);await f.setup();await f.command('set_budget',{maximumMinor:100,currency:'USD'});
  await f.propose({id:'one',maximumMinor:60});await f.propose({id:'two',maximumMinor:60});
  await f.approve('one');await assert.rejects(()=>f.approve('two'),{code:'BUDGET_EXCEEDED'});
  assert.equal(f.state().budget.reservedMinor,60);assert.equal(f.state().commerceNetwork.grants.length,1);
  await assert.rejects(()=>f.command('set_budget',{maximumMinor:59,currency:'USD'}),{code:'BUDGET_COMMITTED'});
  await f.command('cancel_order',{orderId:'one'});await f.approve('two');
  assert.equal(f.state().budget.reservedMinor,60);assert.equal(f.state().budget.accruedMinor,0);
});

test('forged delivery cost is rolled back and actual bytes are hashed before distinct owner acceptance',async t=>{
  const f=fixture(t),token=await f.setup();await f.queue();const lease=(await f.claim(token)).order;
  await f.service.worker(token,'heartbeat',{requestId:f.requestId(),orderId:lease.id,leaseId:lease.leaseId});
  const input={requestId:f.requestId(),orderId:lease.id,leaseId:lease.leaseId,title:'Research evidence',content:'Synthetic evidence document with a source.',sourceUrls:['https://example.org'],actualMinor:1};
  await assert.rejects(()=>f.service.worker(token,'deliver',input),{code:'INPUT'});
  assert.equal(f.state().deliverables.length,0);assert.equal(f.state().commerceNetwork.workOrders[0].status,'running');
  input.actualMinor=0;const result=await f.service.worker(token,'deliver',input);
  assert.equal(result.deliverable.sha256,createHash('sha256').update(input.content).digest('hex'));
  assert.equal(f.state().commerceNetwork.workOrders[0].status,'delivered');assert.equal(f.state().budget.accruedMinor,0);
  await f.service.worker(token,'deliver',input);assert.equal(f.state().deliverables.length,1);
  await assert.rejects(()=>f.service.worker(token,'deliver',{...input,content:'changed'}),{code:'REQUEST_ID_CONFLICT'});
  await f.command('accept_delivery',{orderId:'order'});
  assert.equal(f.state().commerceNetwork.workOrders[0].status,'accepted');assert.equal(f.state().budget.paymentStatus,'not_connected');
});

test('revocation blocks resource replay and late delivery but preserves a scoped stop acknowledgement',async t=>{
  const f=fixture(t),token=await f.setup();await f.queue();const leased=(await f.claim(token)).order;
  const read={requestId:f.requestId(),orderId:leased.id,leaseId:leased.leaseId};
  await f.service.worker(token,'resources',read);
  await f.command('revoke_agent',{agentServiceId:'agent'});
  assert.equal(f.state().commerceNetwork.workOrders[0].status,'stop_requested');
  await assert.rejects(()=>f.service.worker(token,'resources',read),{code:'WORKER_UNAUTHORIZED'});
  await assert.rejects(()=>f.service.worker(token,'deliver',{requestId:f.requestId(),orderId:leased.id,leaseId:leased.leaseId,title:'Late',content:'Late output'}),{code:'WORKER_UNAUTHORIZED'});
  const status=await f.service.worker(token,'status',{...read,requestId:f.requestId()});assert.equal(status.stopRequested,true);
  const stopped=await f.service.worker(token,'stopped',{...read,requestId:f.requestId()});assert.equal(stopped.order.status,'cancelled');
  assert.equal(f.state().deliverables.length,0);
});

test('expired leases fail without automatic retries or duplicate worker execution',async t=>{
  const f=fixture(t),token=await f.setup();await f.queue();const leased=(await f.claim(token)).order;
  f.advance(120_001);
  await assert.rejects(()=>f.service.worker(token,'heartbeat',{requestId:f.requestId(),orderId:leased.id,leaseId:leased.leaseId}),error=>['LEASE_EXPIRED','GRANT_REVOKED'].includes(error.code));
  assert.equal(f.state().commerceNetwork.workOrders[0].status,'failed');
  assert.equal(f.state().commerceNetwork.workOrders[0].stopUnconfirmed,true);
  assert.equal((await f.claim(token)).order,null);
});

test('multi-node plan writes roll back completely when a relation references a missing product',async t=>{
  const f=fixture(t);await f.command('create_project',{id:'project',title:'Synthetic'});
  const before=f.state();
  await assert.rejects(()=>f.tool('apply_plan',{parties:[{id:'will-rollback',type:'factory',displayName:'Transient'}],routes:[{id:'bad-route',name:'Bad route',market:'US',channel:'email',productIds:['missing']}]}),{code:'PRODUCT_NOT_FOUND'});
  const after=f.state();assert.equal(after.revision,before.revision);assert.deepEqual(after.commerceNetwork.parties,[]);assert.equal(after.events.length,before.events.length);
});

test('native workspace removal invalidates even a correctly signed worker credential',async t=>{
  const f=fixture(t),token=await f.setup();f.workspaces.delete(W1);
  await assert.rejects(()=>f.service.worker(token,'connect',{requestId:f.requestId()}),{code:'WORKSPACE_REQUIRED'});
});

async function nativeFixture(t){
  const dir=await mkdtemp(join(tmpdir(),'commerce-live-source-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=createLibraryService(new LibraryStore({dir}));
  const product=await library.saveProduct({name:'Pinned catalog product',description:'Native library source',category:'Home',skus:[{code:'PINNED',unit:'piece',moq:100}]});
  let f;
  const resourceAdapter=createResourceAdapter({getLibrary:()=>library,assertScope:scope=>{
    const p=f.store.load(scope.workspaceId).products.find(p=>p.projectId===scope.projectId&&`product:${p.id}`===scope.ref);
    return !!p&&JSON.stringify(p.sourceRef)===JSON.stringify(scope.sourceRef);
  }});
  f=fixture(t,{resourceAdapter});const token=await f.setup();
  await f.command('upsert_product',{id:'product',name:'Catalog link',sourceRef:{kind:'product',id:product.id,revision:1}});
  return {...f,library,product,resourceAdapter,token};
}

test('archiving an actual native product after owner approval prevents the queued Worker reading it',async t=>{
  const f=await nativeFixture(t);await f.propose();await f.approve();await f.tool('dispatch_order',{orderId:'order'});
  await f.library.saveProduct({productId:f.product.id,expectedRevision:1,changes:{status:'archived'}});
  await assert.rejects(()=>f.claim(f.token),{code:'RESOURCE_CHANGED'});
  assert.equal(f.state().commerceNetwork.workOrders[0].status,'queued');
  assert.equal(f.state().deliverables.length,0);
});

test('owner review digest cannot approve stale native content and no grant is written on failure',async t=>{
  const f=await nativeFixture(t);await f.propose();const review=await f.service.review(S1,'project','order');
  await f.library.saveProduct({productId:f.product.id,expectedRevision:1,changes:{description:'Changed after preview'}});
  await assert.rejects(()=>f.command('approve_order',{orderId:'order',reviewDigest:review.reviewDigest}),{code:'RESOURCE_CHANGED'});
  assert.equal(f.state().commerceNetwork.grants.length,0);assert.equal(f.state().commerceNetwork.workOrders[0].status,'proposed');
});

test('dependency edges reject missing targets and cycles atomically',async t=>{
  const f=fixture(t);await f.setup();
  const spec=id=>({id,requesterPartyId:'factory',agentServiceId:'agent',title:id,brief:'Synthetic dependency task',allowedActions:['public_web_research'],allowedResourceRefs:[]});
  const before=f.state().revision;
  await assert.rejects(()=>f.tool('apply_plan',{workOrders:[{...spec('a'),dependsOn:['b']},{...spec('b'),dependsOn:['a']}]}),{code:'DEPENDENCY_CYCLE'});
  assert.equal(f.state().revision,before);assert.deepEqual(f.state().commerceNetwork.workOrders,[]);
  await assert.rejects(()=>f.propose({id:'missing',dependsOn:['other-project-order']}),{code:'DEPENDENCY_INVALID'});
  await assert.rejects(()=>f.propose({id:'self',dependsOn:['self']}),{code:'DEPENDENCY_INVALID'});
});

test('ordered dispatch waits for human acceptance and dependency edges disclose no output by themselves',async t=>{
  const f=fixture(t),token=await f.setup();
  await f.propose({id:'first',refs:[]});await f.propose({id:'second',refs:[],dependsOn:['first']});
  await f.approve('first');await f.approve('second');
  await assert.rejects(()=>f.tool('dispatch_order',{orderId:'second'}),{code:'DEPENDENCY_NOT_ACCEPTED'});
  await f.tool('dispatch_order',{orderId:'first'});const lease=(await f.claim(token,'first')).order;
  await f.service.worker(token,'heartbeat',{requestId:f.requestId(),orderId:lease.id,leaseId:lease.leaseId});
  await f.service.worker(token,'deliver',{requestId:f.requestId(),orderId:lease.id,leaseId:lease.leaseId,title:'First output',content:'Unshared predecessor text'});
  await assert.rejects(()=>f.tool('dispatch_order',{orderId:'second'}),{code:'DEPENDENCY_NOT_ACCEPTED'});
  await f.command('accept_delivery',{orderId:'first'});await f.tool('dispatch_order',{orderId:'second'});
  const next=(await f.claim(token,'second')).order;assert.deepEqual(next.resources,[]);
  assert.equal(JSON.stringify(next).includes('Unshared predecessor text'),false);
});

test('actual predecessor bytes pass to another Personal Worker only through explicit reviewed accepted-output grant',async t=>{
  const f=fixture(t),firstToken=await f.setup();
  await f.command('register_agent',{id:'agent2',providerPartyId:'provider',displayName:'Second independent Worker',skills:['public_web_research']});
  const secondToken=(await f.command('issue_agent_credential',{agentServiceId:'agent2'})).credential.token;
  await f.service.worker(secondToken,'connect',{requestId:f.requestId()});
  await f.propose({id:'first',refs:[]});await f.propose({id:'second',agentServiceId:'agent2',refs:['accepted_deliverable:first'],dependsOn:['first']});
  await assert.rejects(()=>f.service.review(S1,'project','second'),{code:'DELIVERY_INPUT_UNAVAILABLE'});
  await f.approve('first');await f.tool('dispatch_order',{orderId:'first'});const first=(await f.claim(firstToken,'first')).order;
  await f.service.worker(firstToken,'heartbeat',{requestId:f.requestId(),orderId:first.id,leaseId:first.leaseId});
  const content='Three synthetic source-backed company findings for the next worker.';
  await f.service.worker(firstToken,'deliver',{requestId:f.requestId(),orderId:first.id,leaseId:first.leaseId,title:'Research',content});
  await assert.rejects(()=>f.service.review(S1,'project','second'),{code:'DELIVERY_INPUT_UNAVAILABLE'});
  await f.command('accept_delivery',{orderId:'first'});
  const review=await f.service.review(S1,'project','second');assert.equal(review.resources[0].content.text,content);
  await f.command('approve_order',{orderId:'second',reviewDigest:review.reviewDigest});await f.tool('dispatch_order',{orderId:'second'});
  const next=(await f.claim(secondToken,'second')).order;
  assert.equal(next.resources.length,1);assert.equal(next.resources[0].content.text,content);
  assert.equal(next.resources[0].source.deliverableSha256,createHash('sha256').update(content).digest('hex'));
  await assert.rejects(()=>f.service.worker(firstToken,'resources',{requestId:f.requestId(),orderId:next.id,leaseId:next.leaseId}),{code:'LEASE_DENIED'});
});

test('factory-distributor authorization is owner-scoped and never fabricates a legal signature',async t=>{
  const f=fixture(t);await f.setup();
  await f.command('upsert_party',{id:'distributor',type:'distributor',displayName:'Test distributor'});
  await f.tool('propose_mandate',{id:'mandate',factoryPartyId:'factory',distributorPartyId:'distributor',marketCode:'US',productIds:['product'],scope:'Research and draft only'});
  assert.equal(f.state().commerceNetwork.salesAuthorizations[0].status,'proposed');
  await assert.rejects(()=>f.tool('approve_mandate',{mandateId:'mandate'}),{code:'OWNER_ACTION_REQUIRED'});
  await f.command('approve_mandate',{mandateId:'mandate'});
  const approved=f.state().commerceNetwork.salesAuthorizations[0];assert.equal(approved.status,'active');assert.equal(approved.legalSignature,false);
  assert.ok(approved.approvalReceiptId);await f.command('revoke_mandate',{mandateId:'mandate'});
  assert.equal(f.state().commerceNetwork.salesAuthorizations[0].status,'revoked');
});

test('uncertain remote stops keep budget reserved until a real acknowledgement and explicit owner resolution',async t=>{
  const f=fixture(t),token=await f.setup();await f.command('set_budget',{maximumMinor:100,currency:'USD'});
  await f.propose({id:'paid',maximumMinor:100});await f.approve('paid');await f.tool('dispatch_order',{orderId:'paid'});const lease=(await f.claim(token,'paid')).order;
  f.advance(120_001);let state=f.state();assert.equal(state.budget.reservedMinor,100);assert.equal(state.budget.riskHeldMinor,100);
  await assert.rejects(()=>f.command('resolve_failed_order',{orderId:'paid',reason:'No proof yet'}),{code:'STOP_UNCONFIRMED'});
  await f.service.worker(token,'stopped',{requestId:f.requestId(),orderId:lease.id,leaseId:lease.leaseId});
  assert.equal(f.state().budget.riskHeldMinor,100);
  await f.command('resolve_failed_order',{orderId:'paid',reason:'Stop confirmed and service invoice reviewed'});
  state=f.state();assert.equal(state.budget.reservedMinor,0);assert.equal(state.budget.riskHeldMinor,0);
});

test('read-only worker polling leaves owner revisions stable and credential bursts are rate limited',async t=>{
  const f=fixture(t),token=await f.setup();await f.queue();const lease=(await f.claim(token)).order;
  const revision=f.state().revision;
  for(let i=0;i<58;i++)await f.service.worker(token,'status',{requestId:f.requestId(),orderId:lease.id,leaseId:lease.leaseId});
  assert.equal(f.state().revision,revision);
  await assert.rejects(()=>f.service.worker(token,'status',{requestId:f.requestId(),orderId:lease.id,leaseId:lease.leaseId}),{code:'WORKER_RATE_LIMIT',status:429});
  f.advance(60_001);const status=await f.service.worker(token,'status',{requestId:f.requestId(),orderId:lease.id,leaseId:lease.leaseId});
  assert.equal(status.order.status,'claimed');assert.equal(f.state().revision,revision);
});
