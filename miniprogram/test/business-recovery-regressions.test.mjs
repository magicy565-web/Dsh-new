// Original compiled Page/Client -> signed local HTTP -> persistent original
// services/orders; external transports are explicitly synthetic local fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {monitorFixture,until} from './monitor-support.mjs';
import {loadPage} from './support.mjs';
const event=(id,kind,phase)=>({currentTarget:{dataset:{id,kind,phase}}});
test('cold recovery of a lost notification execution selects its original product even when a newer product exists',async t=>{
 for(const phase of ['summary','first_sample'])await t.test(phase,async sub=>{
  const f=await monitorFixture(sub,{first:phase==='first_sample',recent:phase==='first_sample'}),p=await f.open();sub.after(()=>p.page.onUnload());const monitor=await f.ready(p),cid=p.page.data.conversationId;
  const second=await f.raw(`/conversations/${cid}/supplier-services`,'POST',{requestId:randomUUID(),facts:{name:'Another distinct original product',description:'Local facts only'}});assert.equal(second.status,202);assert.notEqual(second.data.service.id,monitor.serviceId);
  await f.subscribe(p,monitor,phase);await f.enableFixture();await p.page.notificationCard(event(monitor.id,'review',phase));await p.review.confirm(['notify']);const operation=(phase==='first_sample'?p.page.data.supplierMonitors[0].firstNotification:p.page.data.supplierMonitors[0].notification).review;
  await p.page.notificationCard(event(monitor.id,'decision',phase));await p.review.confirm(['notify']);await p.page.notificationCard(event(monitor.id,'execute',phase));f.state.uncertain=true;f.loseNext();await p.review.confirm(['execute']);assert.equal(p.client.uncertain,true);assert.equal(f.state.posts,1);const body=f.requests.filter(r=>r.path.endsWith('/notification-execute')).at(-1).body;
  p.page.onUnload();await f.reopen();const cold=f.client(),{page}=loadPage(cold,f.platform);sub.after(()=>page.onUnload());page.onShow();await until(()=>page.data.supplierServices.length===2);
  assert.equal(page.data.supplierMode,true,'cold entry must expose the original notification business context without requiring beginSupplier');assert.equal(page.data.selectedSupplierId,monitor.serviceId,'the pending request belongs to the older original product, not the latest product');assert.equal(page.data.pendingLabel,'通知执行');await until(()=>page.data.supplierMonitors.some(m=>m.id===monitor.id));
  await Promise.all([page.retry(),page.retry()]);assert.equal(cold.uncertain,false);assert.equal(page.data.selectedSupplierId,monitor.serviceId);const restored=page.data.supplierMonitors.find(m=>m.id===monitor.id),notification=phase==='first_sample'?restored.firstNotification:restored.notification;assert.equal(notification.review.id,operation.id);assert.equal(notification.delivery.status,'unknown');assert.equal(f.state.posts,1);assert.deepEqual(f.requests.filter(r=>r.path.endsWith('/notification-execute')).map(r=>r.body),[body]);assert.equal(f.state.nativeCalls,1);assert.equal(f.app.store.read().workspaceSupplierServices.monitors.length,1);
 });
});

test('lost original draft approval and rejection replay the same request after cold restart without new operation or external write',async t=>{
 const {publicationFixture,event}=await import('./publication-support.mjs');
 for(const decision of ['approved','denied'])await t.test(decision,async sub=>{
  const f=await publicationFixture(sub);let p=await f.open();sub.after(()=>p.page.onUnload());const service=await f.ready(p.page,p.client);await p.page.beginDraftWrite(event(service.id));await p.review.confirm(['draft','images']);const original=p.page.data.publicationState.latest;p.page.publicationCard(event(original.id,'decision'));f.loseNext();if(decision==='denied')await p.review.deny();else await p.review.confirm(['draft','images']);assert.equal(p.client.uncertain,true);const body=f.attempts.filter(r=>r.path.endsWith('/shopify-decision')).at(-1).body;assert.equal(body.operationId,original.id);assert.equal(body.expectedScopeHash,original.scopeHash);
  p.page.onUnload();await f.reopen();p=await f.open();await until(()=>p.page.data.publicationState?.latest);assert.equal(p.client.pendingKind,'publication-decision');await Promise.all([p.page.retry(),p.page.retry()]);assert.equal(p.client.uncertain,false);assert.equal(p.page.data.publicationState.latest.id,original.id);assert.equal(p.page.data.publicationState.latest.scopeHash,original.scopeHash);assert.equal(p.page.data.publicationState.latest.status,decision);assert.equal(p.page.data.publicationState.operations.length,1);assert.equal(f.app.capabilities.listApprovals().length,1);assert.equal(f.remote.count('SupplierCreateDraft'),0);assert.equal(f.remote.state.uploads,0);assert.deepEqual(f.attempts.filter(r=>r.path.endsWith('/shopify-decision')).map(r=>r.body),[body,body]);
 });
});
