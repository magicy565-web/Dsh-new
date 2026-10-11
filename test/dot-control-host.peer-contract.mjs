import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {wireNativeMuseSource,wirePluginServiceSource} from '../scripts/dot-control-wiring.mjs';
import {createControlJournal,advanceControlJournal} from '../server/dot-control-plane.mjs';

// Explicit supplemental test: it needs the immutable PR26 source snapshot.
// No external fixture is silently skipped by the ordinary test suite.
const root=process.env.TT041_PR26_SOURCE;
assert.ok(root&&path.isAbsolute(root),'TT041_PR26_SOURCE must point to the verified PR26 source snapshot.');
const provenance=JSON.parse(fs.readFileSync(new URL('../docs/patches/dot-control-host-wiring-source.json',import.meta.url)));
assert.equal(provenance.ref,'9e92fe31dad89677d36932ef7f623a784aec278b');
for(const row of provenance.contractFiles) {
  const bytes=fs.readFileSync(path.join(root,row.path));
  const blob=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  assert.equal(blob,row.gitBlob,'Original PR26 bytes changed: '+row.path);
}
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const nativePath='server/muse-worker-native.mjs';
const adapter=new URL('../server/dot-control-plane-host.mjs',import.meta.url).href;
const nativeSource=wireNativeMuseSource(read(nativePath),adapter).replace(/from '(\.\/[^']+)'/g,
  (_,relative)=>'from '+JSON.stringify(pathToFileURL(path.resolve(root,'server',relative)).href));
const fixtureSource=read('test/fixtures/muse-conversation.mjs')
  .replace("from '../../server/muse-worker-native.mjs'",'from '+JSON.stringify(data(nativeSource)))
  .replace("new URL('../../deploy/muse-native-overlay/server/workspace-muse-session-host.mjs', import.meta.url)",
    'new URL('+JSON.stringify(pathToFileURL(path.join(root,'deploy/muse-native-overlay/server/workspace-muse-session-host.mjs')).href)+')');
// Original memory writer, synthetic Session and explicit relay error-helper stub.
// There is no genuine Harness/model turn, real Muse claim, fsync or network send.
const {museConversationFixture,actor,workerId}=await import(data(fixtureSource));
const scope={workspaceId:'original-workspace',policyVersion:'policy-1'};
const reader=f=>f.binding().bindControl(actor,scope);
const taskOf=snapshot=>snapshot.records.find(row=>row.kind==='task');

test('patched original Host reads original conversation draft/approval/queue without mutation or waking Muse',async t=>{
  const f=await museConversationFixture(t),r=reader(f),input=f.input('control-original');
  const made=await f.api().prepare(input),id=made.delegation.orderId;
  let snapshot=await r.read();
  assert.equal(snapshot.sources[0].ordering,'unknown');
  assert.equal(taskOf(snapshot).status,'awaiting_approval');
  assert.equal(taskOf(snapshot).conversationId,actor.nativeAgentId);
  assert.equal(taskOf(snapshot).requestId,input.requestId);
  assert.equal(taskOf(snapshot).workerId,workerId);
  assert.equal(taskOf(snapshot).linkage.conversation,'verified');
  const before=f.store.read();await r.read();assert.deepEqual(f.store.read(),before);
  assert.equal(f.events.length,0);assert.equal(JSON.stringify(snapshot).includes(input.content),false);
  await f.api().approve(id,{confirmed:true,expectedReviewHash:made.delegation.reviewHash});
  assert.equal(taskOf(await r.read()).status,'awaiting_dispatch');
  await f.api().dispatch(id,{confirmed:true,expectedReviewHash:made.delegation.reviewHash});
  snapshot=await r.read();assert.equal(taskOf(snapshot).status,'queued');
  assert.equal(taskOf(snapshot).id,id);assert.equal(taskOf(snapshot).taskRef,id);
  assert.equal(f.store.read().museTasks.length,1);
  const principal={...scope,userId:actor.subject,
    grants:[{sourceId:'muse-host',scope:'self',kinds:['goal','order','task','attempt']}]};
  assert.throws(()=>advanceControlJournal(createControlJournal(principal,'journal-1'),snapshot),{code:'CONTROL_ORDER_UNKNOWN'});
});

test('original attempt/result/session return/enterprise acceptance remain distinct and read-only',async t=>{
  const f=await museConversationFixture(t),r=reader(f),item=await f.approveAndDispatch(f.input('control-result'));
  const claim=(await f.call(item.orderId,'claim',{requestId:'synthetic-claim'})).body;
  let task=taskOf(await r.read());
  assert.equal(task.status,'claimed');assert.equal(task.attemptId,claim.attemptId);assert.equal(task.fence,claim.fence);
  assert.equal(task.taskUpdatedAt,f.store.read().museTasks[0].updatedAt);
  await f.deliver(item.orderId,claim);
  task=taskOf(await r.read());assert.equal(task.status,'return_pending');
  assert.equal(task.returnStatus,'pending');assert.equal(f.events.length,0);
  await f.api().refresh(item.orderId); // Original business operation, explicitly separate from the reader.
  assert.equal(taskOf(await r.read()).status,'return_pending');
  await f.relay.reconcile();
  task=taskOf(await r.read());assert.equal(task.status,'returned');assert.equal(task.linkage.receipt,'verified');
  assert.equal(task.acceptance,'not_verified');assert.equal(f.events.length,1);
  const before=f.store.read();await r.read();await r.read();assert.deepEqual(f.store.read(),before);assert.equal(f.events.length,1);
  const result=await f.api().get(item.orderId);
  await f.api().accept(item.orderId,{confirmed:true,expectedReviewHash:item.reviewHash,receiptHash:result.receiptHash});
  assert.equal(taskOf(await r.read()).status,'accepted');
});

test('original cancellation rejects late result and preserves task/attempt without query repair',async t=>{
  const f=await museConversationFixture(t),r=reader(f),item=await f.approveAndDispatch(f.input('control-cancel'));
  const attempt=(await f.call(item.orderId,'claim',{requestId:'synthetic-cancel-claim'})).body;
  await f.api().cancel(item.orderId,{confirmed:true,expectedReviewHash:item.reviewHash});
  assert.equal(taskOf(await r.read()).status,'cancel_requested');
  await assert.rejects(f.call(item.orderId,'submit-result',{attemptId:attempt.attemptId,fence:attempt.fence,
    requestId:'synthetic-late',summary:'Late fixture',sources:['https://www.loc.gov/about/'],toolEvidence:[],evidenceNote:'Offline fixture only.'}));
  await f.call(item.orderId,'confirm-stop',{attemptId:attempt.attemptId,fence:attempt.fence,requestId:'synthetic-stop'});
  await f.api().refresh(item.orderId);
  const task=taskOf(await r.read());assert.equal(task.status,'cancelled');assert.equal(task.active,false);
  assert.equal(task.attemptId,attempt.attemptId);assert.equal(f.store.read().museTasks.length,1);
});

test('original owner fence and closed binding prevent cross-session or stale cached reads; remount retains original IDs',async t=>{
  const f=await museConversationFixture(t),old=reader(f),item=await f.approveAndDispatch(f.input('control-remount'));
  assert.throws(()=>f.binding().bindControl({...actor,nativeAgentId:'foreign-session'},scope),{code:'MUSE_OWNER_REQUIRED'});
  f.pause();const before=f.store.read();assert.equal(taskOf(await old.read()).status,'queued');
  assert.deepEqual(f.store.read(),before); // The original Host allows paused read-only views.
  await f.restart();await assert.rejects(old.read(),{code:'MW_GATEWAY_CLOSED'});
  const next=await reader(f).read();assert.equal(taskOf(next).id,item.orderId);
  assert.equal(f.store.read().museTasks.length,1);
});

test('corrupt original receipt fails unavailable without hiding, repairing or replaying the business message',async t=>{
  const f=await museConversationFixture(t),r=reader(f),item=await f.approveAndDispatch(f.input('control-corrupt'));
  const claim=(await f.call(item.orderId,'claim',{requestId:'synthetic-corrupt-claim'})).body;
  await f.deliver(item.orderId,claim);await f.api().refresh(item.orderId);await f.relay.reconcile();
  f.change(state=>{state.messages.find(message=>message.role==='assistant').content='Changed original receipt';});
  const before=f.store.read(),snapshot=await r.read();
  assert.equal(snapshot.sources[0].freshness.availability,'unavailable');
  assert.equal(snapshot.sources[0].freshness.reason,'MW_SESSION_RECEIPT_CHANGED');
  assert.equal(snapshot.records.length,0);assert.deepEqual(f.store.read(),before);assert.equal(f.events.length,1);
});

test('source wiring is anchored to current primary/overlay Host and forwards only original configured scope',()=>{
  const original=read(nativePath),overlay=read('deploy/muse-native-overlay/server/muse-worker-native.mjs');
  assert.equal(original,overlay);
  assert.equal(wireNativeMuseSource(original).includes('fields(scope'),false);
  const service=wirePluginServiceSource(read('deploy/muse-native-overlay/server/workspace-plugin-service.mjs'));
  assert.ok(service.includes('return museRest.bindControl(actor, { workspaceId: config.scopeId,'));
  assert.ok(service.includes("policyVersion: 'plugin-epoch-' + snapshot().epoch + '.' + fingerprint"));
  assert.throws(()=>wireNativeMuseSource(''),/anchor missing/);
});

test('lost original dispatch confirmation retains its task and uncertainty without query recovery or replacement',async t=>{
  const f=await museConversationFixture(t),r=reader(f),made=await f.api().prepare(f.input('control-uncertain'));
  const id=made.delegation.orderId,review={confirmed:true,expectedReviewHash:made.delegation.reviewHash};
  await f.api().approve(id,review);f.failNext(state=>state.workerOrders[0].status==='queued');
  await assert.rejects(f.api().dispatch(id,review),{code:'EPERM'});
  const before=f.store.read(),snapshot=await r.read(),task=taskOf(snapshot);
  assert.equal(task.status,'dispatching');assert.equal(task.taskRef,id);assert.equal(task.linkage.task,'verified');
  assert.equal(before.workerOrders[0].remoteJobId,null);assert.equal(task.active,false);
  await r.read();assert.deepEqual(f.store.read(),before);assert.equal(f.store.read().museTasks.length,1);
});
