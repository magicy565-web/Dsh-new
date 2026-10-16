import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptanceConfiguration} from '../server/deepseek-acceptance-policy.mjs';
import {createLocalDeepseekTransport,LOCAL_DEEPSEEK_LIMITS as limits} from '../server/workspace-omp-local-deepseek.mjs';
const configuration=acceptanceConfiguration({DEEPSEEK_API_KEY:'explicit-offline-unused'});
const request=content=>new Request('https://api.deepseek.com/chat/completions',{method:'POST',body:JSON.stringify({model:'deepseek-flash',max_tokens:512,thinking:{type:'disabled'},messages:[{role:'user',content}],tools:[]})});
function confirm(transport,input=32000,output=512){
  transport.onSseEvent({data:JSON.stringify({usage:{prompt_tokens:input,completion_tokens:output,total_tokens:input+output}})});
  transport.complete({role:'assistant',content:[{type:'text',text:'Explicit policy-only fixture.'}],stopReason:'stop',usage:{input,output,cacheRead:0,cacheWrite:0,totalTokens:input+output}});
}
test('conversation payload admits history above 12KB and rejects above 128KiB before fetching',async()=>{
  let calls=0;const transport=createLocalDeepseekTransport({configuration,fetchImpl:async r=>{calls++;assert.equal(Buffer.byteLength(await r.text()),limits.maxRequestBytes);return new Response('offline');}});
  const overhead=Buffer.byteLength(await request('').text());
  await transport.fetch(request('x'.repeat(limits.maxRequestBytes-overhead)));assert.equal(calls,1);
  confirm(transport,100,20);transport.finish();
  const refused=createLocalDeepseekTransport({configuration,fetchImpl:async()=>{calls++;throw Error('UNREACHABLE');}});
  await assert.rejects(refused.fetch(request('x'.repeat(limits.maxRequestBytes-overhead+1))),/SHORT_INPUT_LIMIT/);
  assert.equal(calls,1);assert.equal(refused.report().actualProviderRequests,0);assert.equal(refused.report().billingUncertain,false);
});
test('seven maximum confirmed usages plus one unknown request remain bounded and cannot retry',async()=>{
  let calls=0;const transport=createLocalDeepseekTransport({configuration,fetchImpl:async()=>{calls++;if(calls===8)throw Error('Explicit offline unknown response');return new Response('offline');}});
  for(let i=0;i<7;i++){await transport.fetch(request('x'.repeat(13000)));confirm(transport);}
  await assert.rejects(transport.fetch(request('x'.repeat(13000))),/UNCERTAIN/);
  const report=transport.report();assert.equal(calls,8);assert.equal(report.confirmedResponses,7);assert.equal(report.billingUncertain,true);
  assert.ok(Math.abs(report.chargeUpperCny-2.680768)<1e-10);
  assert.ok(report.chargeUpperCny<=limits.maxTaskReserveCny);
  await assert.rejects(transport.fetch(request('again')),/UNCERTAIN/);assert.equal(calls,8);
  assert.ok(limits.normalCompletionUpperCny+report.chargeUpperCny<4.948390);
});
test('complete usage beyond the continuation input ceiling stops before another request',async()=>{
  let calls=0;const transport=createLocalDeepseekTransport({configuration,fetchImpl:async()=>{calls++;return new Response('offline');}});
  await transport.fetch(request('offline'));
  assert.throws(()=>confirm(transport,32001,20),/UNCERTAIN_USAGE/);
  await assert.rejects(transport.fetch(request('again')),/UNCERTAIN_USAGE/);assert.equal(calls,1);
  assert.equal(transport.report().billingUncertain,true);assert.ok(transport.report().chargeUpperCny<=limits.failureInclusiveUpperCny);
});
