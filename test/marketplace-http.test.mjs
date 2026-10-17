import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mountMarketplace, MARKETPLACE_BUYER_PATH as B, MARKETPLACE_PROVIDER_PATH as P } from '../server/marketplace/host.mjs';
import { MarketplaceError } from '../server/marketplace/contracts.mjs';
import { fixture, buyer, seller, reviewer, fixed } from './fixtures/marketplace.mjs';

// Real HTTP and original WorkerDesk. Original access/store and all third-party
// accounts are EXPLICIT synthetic fixtures, not production SSO/SDK acceptance.
async function host(t, providerAuth = true) {
  const f = await fixture({install:false}), admitted = [], verified = [];
  const app = {
    server:http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({original:true,path:req.url}));}),
    store:f.store, workerDesk:f.desk,
    access:{ mode:'enterprise',
      async begin(req,res,pathname) { admitted.push(pathname); const subject=req.headers['x-test-subject']; if(!subject) throw new MarketplaceError(401,'SESSION_REQUIRED','Synthetic session required'); res.accessFinish=async()=>{}; return {workspaceId:'factory',subject,role:'admin',session:{id:'synthetic-session'}}; },
      verifyBody(ctx,bytes){verified.push(bytes.toString());},
    },
  };
  const api=await mountMarketplace(app,{enabled:true,...f.options,reviewers:[reviewer.subject],authenticateProvider:providerAuth?async({req,rawBody,pathname})=>{assert.ok(pathname.startsWith(P));assert.ok(Buffer.isBuffer(rawBody));if(req.headers['x-test-provider']!==seller.subject)throw new MarketplaceError(401,'PROVIDER_AUTH_REQUIRED','Synthetic provider session');return seller;}:null});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{app.server.closeAllConnections();app.server.close(resolve);}));
  const root='http://127.0.0.1:'+app.server.address().port;
  async function request(path,{method='GET',body,subject=buyer.subject,provider=false,headers={}}={}) {
    const response=await fetch(root+path,{method,headers:{...(subject?{'x-test-subject':subject}:{}),...(provider?{'x-test-provider':seller.subject}:{}),...(method==='POST'?{'content-type':'application/json'}:{}),...headers},...(method==='POST'?{body:JSON.stringify(body??{})}:{})});
    return {status:response.status,body:await response.json()};
  }
  async function listing() {
    assert.equal((await request(P+'/profile',{method:'POST',provider:true,body:{name:'A fixture',requestId:'provider'}})).status,200);
    const l=(await request(P+'/listings',{method:'POST',provider:true,body:{workerId:'worker-a',serviceId:'buyer-discovery',title:'公开客户研究',description:'Fixture only',deliverables:['名单'],acceptance:['Sources'],prices:[fixed],requestId:'listing'}})).body;
    await request(B+'/review/listing',{method:'POST',subject:reviewer.subject,body:{id:l.id,revision:l.revision,approve:true}});return l;
  }
  async function order() {const l=await listing();return (await request(B+'/orders',{method:'POST',body:f.orderInput(l)})).body;}
  return {...f,api,app,request,admitted,verified,listing,order,root};
}

test('feature disabled leaves original server and WorkerDesk untouched',async()=>{const f=await fixture({install:false});const app={server:http.createServer(),workerDesk:f.desk};const before=f.desk.create;assert.equal(await mountMarketplace(app,{enabled:false}),null);assert.equal(app.workerDesk.create,before);app.server.close();});
test('same server and original non-marketplace paths continue unchanged',async t=>{const f=await host(t);assert.equal(f.app.server.listenerCount('request'),1);assert.deepEqual((await f.request('/api/health')).body,{original:true,path:'/api/health'});assert.deepEqual((await f.request('/api/conversations')).body,{original:true,path:'/api/conversations'});});
test('buyer routes use actual original signed pathname and bounded body verification',async t=>{const f=await host(t);const o=await f.order();assert.equal(o.status,'draft');assert.ok(f.admitted.includes(B+'/orders'));assert.ok(f.verified.some(v=>v.includes('publicDataConfirmed')));assert.equal(f.stats.submits,0);});
test('missing buyer session is rejected before private data is returned',async t=>{const f=await host(t);assert.equal((await f.request(B+'/orders',{subject:null})).status,401);});
test('no provider resolver means unavailable, not enterprise credential fallback',async t=>{const f=await host(t,false);assert.equal((await f.request(P+'/profile',{method:'POST',body:{name:'A',requestId:'x'}})).status,503);});
test('enterprise owner cannot self-grant provider or reviewer role in a request',async t=>{const f=await host(t);assert.equal((await f.request(P+'/profile',{method:'POST',body:{name:'A',requestId:'x',kind:'provider'}})).status,401);assert.equal((await f.request(B+'/review/queue')).status,403);});
test('body actor override cannot authorize purchase',async t=>{const f=await host(t),o=await f.order();const r=await f.request(B+'/orders/'+o.id+'/confirm',{method:'POST',body:{confirmed:true,termsHash:o.termsHash,actor:reviewer}});assert.equal(r.status,400);assert.equal(f.stats.checkouts,0);});
test('cross-buyer read and payment synchronization are rejected before side effects',async t=>{const f=await host(t),o=await f.order();assert.equal((await f.request(B+'/orders/'+o.id,{subject:'another-buyer'})).status,404);assert.equal((await f.request(B+'/orders/'+o.id+'/sync-payment',{method:'POST',subject:'another-buyer'})).status,404);});
test('HTTP confirmed checkout, verified webhook and original execution are idempotent',async t=>{const f=await host(t),o=await f.order();const path=B+'/orders/'+o.id;
  assert.equal((await f.request(path+'/confirm',{method:'POST',body:{confirmed:true,termsHash:o.termsHash}})).status,200);
  const cs=await f.request(path+'/checkout',{method:'POST'});assert.equal(cs.status,200);assert.equal(f.stats.submits,0);
  const p=f.ledger.get(o.id);p.status='paid';p.receivedMinor=p.amountMinor;
  const event={eventId:'evt_original',checkoutId:p.checkoutId};
  for(let i=0;i<2;i++)assert.equal((await f.request('/api/marketplace-payments/stripe',{method:'POST',headers:{'stripe-signature':'verified-fixture'},body:event})).status,200);
  assert.equal(f.stats.submits,1);assert.equal((await f.request(path)).body.status,'running');
  assert.equal((await f.request(path+'/settle',{method:'POST'})).status,403);
});
test('foreign receipt is never downloaded by its raw artifact ID',async t=>{const f=await host(t),o=await f.order();assert.equal((await f.request(B+'/orders/'+o.id+'/receipt')).status,409);assert.equal((await f.request(B+'/artifacts/foreign')).status,404);});
test('mount is rejected after server startup and on second installation',async t=>{const f=await host(t);await assert.rejects(()=>mountMarketplace(f.app,{enabled:true,...f.options}),e=>e.code==='HOST_REQUIRED');});
