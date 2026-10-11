import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {actor,hash,museConversationFixture} from './fixtures/muse-conversation.mjs';

// Actual merged Host/control/Store/artifact modules. Native Session and Muse
// sender remain explicit synthetic fixtures; this cannot prove a model turn.
const scope={workspaceId:'original-workspace',policyVersion:'integration-policy-1'};
const taskOf=snapshot=>snapshot.records.find(row=>row.kind==='task');
test('integrated control reads original v3 disk delegation and exact returned receipt across reopening',async t=>{
  const root=path.resolve(os.tmpdir()),dir=await fs.mkdtemp(path.join(root,'workspace-integration-disk-'));
  t.after(async()=>{
    assert.equal(path.dirname(path.resolve(dir)),root);
    assert.ok(path.basename(dir).startsWith('workspace-integration-disk-'));
    await fs.rm(dir,{recursive:true,force:true});
  });
  const f=await museConversationFixture(t,{diskDirectory:dir});
  const read=()=>f.binding().bindControl(actor,scope);
  const input=f.input('integrated-original-request'),draft=await f.api().prepare(input);
  const oldReader=read(),before=f.store.read(),snapshot=await oldReader.read();
  assert.equal(before.version,3);
  assert.equal(snapshot.sources[0].sequence,before.meta.sequence);
  assert.equal(snapshot.sources[0].epoch,before.meta.createdAt);
  assert.equal(snapshot.sources[0].ordering,'known');
  assert.equal(taskOf(snapshot).status,'awaiting_approval');
  assert.equal(taskOf(snapshot).conversationId,actor.nativeAgentId);
  assert.equal(taskOf(snapshot).requestId,input.requestId);
  await oldReader.read();assert.deepEqual(f.store.read(),before);
  assert.throws(()=>f.binding().bindControl({...actor,nativeAgentId:'foreign'},scope),{code:'MUSE_OWNER_REQUIRED'});
  const item=await f.approveAndDispatch(input);
  await f.restart();await assert.rejects(oldReader.read(),{code:'MW_GATEWAY_CLOSED'});
  assert.equal((await f.api().prepare(input)).delegation.orderId,draft.delegation.orderId);
  assert.equal(taskOf(await read().read()).status,'queued');
  assert.equal(f.store.read().workerOrders.length,1);assert.equal(f.store.read().museTasks.length,1);
  const claim=(await f.call(item.orderId,'claim',{requestId:'integrated-claim'})).body;
  const claimed=taskOf(await read().read());
  assert.equal(claimed.status,'claimed');assert.equal(claimed.attemptId,claim.attemptId);
  assert.equal(claimed.fence,claim.fence);
  const file=await f.deliver(item.orderId,claim);await f.api().refresh(item.orderId);
  assert.equal(taskOf(await read().read()).status,'return_pending');
  await f.relay.reconcile();
  const returned=await f.api().get(item.orderId),projected=taskOf(await read().read());
  assert.equal(projected.status,'returned');assert.equal(projected.linkage.receipt,'verified');
  assert.equal(projected.returnStatus,'returned');assert.equal(projected.acceptance,'not_verified');
  assert.equal(Object.hasOwn(projected,'returnedHash'),false);
  assert.equal(returned.returnedHash,returned.receiptHash);
  assert.equal(returned.wake.observed,false);assert.equal(returned.executionStartedAt,null);
  await f.api().accept(item.orderId,{confirmed:true,expectedReviewHash:item.reviewHash,receiptHash:returned.receiptHash});
  await f.restart();
  assert.equal(taskOf(await read().read()).status,'accepted');
  assert.deepEqual((await f.api().download(item.orderId,{artifactId:file.artifactId,version:1,sha256:hash(file.bytes)})).bytes,file.bytes);
  assert.equal(f.store.read().messages.length,2);assert.equal(f.events.length,1);
  assert.equal(f.diskDiagnostics().durability,'confirmed');
});
