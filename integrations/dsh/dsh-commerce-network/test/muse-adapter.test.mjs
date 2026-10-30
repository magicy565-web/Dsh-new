import test from 'node:test';
import assert from 'node:assert/strict';
import { createMuseAdapter } from '../muse-adapter.mjs';

test('Muse maps explicit leases and results to the native gateway without starting a poller',async()=>{
  const calls=[], token=`cnw_${'a'.repeat(24)}.${'b'.repeat(43)}`;
  const fetch=async(url,options)=>{calls.push({path:new URL(url).pathname,body:JSON.parse(options.body),redirect:options.redirect});return new Response(JSON.stringify({ok:true,data:{accepted:true}}),{headers:{'content-type':'application/json'}});};
  const muse=createMuseAdapter({baseUrl:'https://dsh.example.test',token,fetch});
  assert.equal(calls.length,0);
  await muse.connect({requestId:'connect-1'});
  await muse.claim('order-1',{requestId:'claim-1'});
  await muse.heartbeat({orderId:'order-1',leaseId:'lease-1'},'researching',{requestId:'progress-1'});
  await muse.submitResult({orderId:'order-1',leaseId:'lease-1'},{title:'TEST',content:'TEST content',sourceUrls:['https://example.test/source']},{requestId:'delivery-1'});
  assert.deepEqual(calls.map(c=>c.path),['/commerce-worker-api/connect','/commerce-worker-api/claim','/commerce-worker-api/heartbeat','/commerce-worker-api/deliver']);
  assert.deepEqual(calls[2].body,{orderId:'order-1',leaseId:'lease-1',summary:'researching',requestId:'progress-1'});
  assert.equal(calls[3].body.requestId,'delivery-1');assert.equal(calls[3].body.actualMinor,0);assert.ok(calls.every(c=>c.redirect==='error'));
  assert.throws(()=>muse.status({orderId:'order-1'}),/leaseId/);
});

test('Muse retains the request ID and reports uncertainty on a lost result',async()=>{
  const muse=createMuseAdapter({baseUrl:'https://dsh.example.test',token:`cnw_${'a'.repeat(24)}.${'b'.repeat(43)}`,fetch:async()=>{throw new Error('network lost');}});
  await assert.rejects(muse.submitResult({orderId:'order',leaseId:'lease'},{title:'Result',content:'TEST'},{requestId:'same-delivery-id'}),e=>e.outcomeUnknown===true&&e.requestId==='same-delivery-id');
});
