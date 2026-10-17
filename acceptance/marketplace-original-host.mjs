import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../server/index.mjs';
import { mountMarketplace, MARKETPLACE_BUYER_PATH as B } from '../server/marketplace/host.mjs';
import { fixture, seller, fixed } from '../test/fixtures/marketplace.mjs';

// MANDATORY full-checkout gate, not executed in the partial source container.
// Actual original Host, disk Store, Access and Artifact bytes. External model,
// Worker identity, research and payment remain explicitly synthetic.
// No skip/fallback if original dependencies or Node24 are absent.
test('original Host: same server, receipt bytes and cold Store restart',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'marketplace-native-'));
  let app;const f=await fixture({install:false});
  const buyer={kind:'buyer',subject:'local-operator',workspaceId:'local',role:'admin',human:true};
  const provider={...seller,workspaceId:'local'},reviewer={...buyer,kind:'reviewer'};
  async function boot(){app=await createApp({dataDirectory:directory,workerAdapters:{'worker-a':f.adapter}});await mountMarketplace(app,{...f.options,workspaceId:'local',enabled:true,allowLocalPilot:true,reviewers:[buyer.subject]});return app.listen(0);}
  t.after(async()=>{await app?.close();await rm(directory,{recursive:true,force:true});});
  let address=await boot();
  async function request(relative,body){const res=await fetch('http://127.0.0.1:'+address.port+B+relative,{...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});const value=await res.json();assert.equal(res.status,200,JSON.stringify(value));return value;}
  const m=app.marketplace;await m.registerProvider(provider,{name:'Synthetic acceptance provider',requestId:'provider'});
  const l=await m.saveListing(provider,{workerId:'worker-a',serviceId:'buyer-discovery',title:'Original Host acceptance fixture',description:'Not a real service',deliverables:['CSV fixture'],acceptance:['Evidence fixture'],prices:[fixed],requestId:'listing'});
  await m.reviewListing(reviewer,{id:l.id,revision:l.revision,approve:true});
  const o=await request('/orders',f.orderInput(l));
  await request('/orders/'+o.id+'/confirm',{confirmed:true,termsHash:o.termsHash});await request('/orders/'+o.id+'/checkout',{});
  const payment=f.ledger.get(o.id);payment.status='paid';payment.receivedMinor=payment.amountMinor;await request('/orders/'+o.id+'/sync-payment',{});
  f.remote.get(o.id).state='completed';const delivered=await request('/orders/'+o.id+'/refresh',{});
  const accepted=await request('/orders/'+o.id+'/accept',{confirmed:true,deliveryDigest:delivered.deliveryDigest});assert.equal(accepted.status,'accepted');
  const receipt=await request('/orders/'+o.id+'/receipt');assert.equal(receipt.orderId,o.id);assert.equal(receipt.externalClaimsIndependentlyVerified,false);
  assert.equal(app.server.listenerCount('request'),1);await app.close();address=await boot();
  const saved=await request('/orders/'+o.id);assert.equal(saved.status,'accepted');assert.equal(saved.deliveryArtifactId,accepted.deliveryArtifactId);assert.equal(f.stats.submits,1);
  assert.equal((await request('/orders/'+o.id+'/receipt')).orderId,o.id);
});
