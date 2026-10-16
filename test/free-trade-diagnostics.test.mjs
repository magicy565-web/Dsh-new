// Synthetic HTTP only. Never call the actual TED/SAM endpoints or any model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTenderClient,requestJson} from '../plugins/workspace-free-trade/src/free-trade.mjs';
import {HTTP_DIAGNOSTIC_LIMITS} from '../plugins/workspace-free-trade/src/http-diagnostics.mjs';
const query={provider:'ted',query:'publication-date>=20260101',page:1,limit:1};
async function refused({status=403,body='',headers={},observer}={}){
 const diagnostics=[];let calls=0;
 const client=createTenderClient({onDiagnostic:value=>{diagnostics.push(value);return observer?.(value);},fetchImpl:async()=>{calls++;return new Response(body,{status,headers});}});
 await assert.rejects(client.search(query),error=>{
  assert.equal(error.code,status===429?'RATE_LIMITED':status===401||status===403?'REMOTE_AUTHORIZATION_REFUSED':'REMOTE_HTTP_ERROR');
  assert.equal(error.diagnostic,undefined);return true;
 });
 assert.equal(calls,1);assert.equal(diagnostics.length,1);assert.equal(diagnostics[0].provider,'ted');assert.equal(diagnostics[0].causeProven,false);
 assert.ok(Buffer.byteLength(JSON.stringify(diagnostics[0]))<=HTTP_DIAGNOSTIC_LIMITS.encodedBytes);return diagnostics[0];
}
for(const [status,body,headers,classification,signal]of [
 [403,'Forbidden',{'content-type':'text/plain'},'http_forbidden_unknown_origin','access_denied_text'],
 [403,'Authentication required; API key',{'content-type':'application/json'},'http_forbidden_unknown_origin','authentication_text'],
 [403,'Blocked by the proxy',{'x-mitmproxy-blocked-reason':'ROBOTS_DENIED'},'intermediary_policy_signal','proxy_block_page'],
 [403,'Verify you are human',{'cf-mitigated':'challenge','server':'cloudflare'},'challenge_signal','challenge_page'],
 [401,'Unauthorized',{},'http_unauthorized_unknown_origin','authentication_text'],
 [429,'Too many requests',{'retry-after':'60'},'rate_limited','rate_limit_text'],
 [400,'Invalid query',{},'http_request_rejected_unknown_origin','query_error'],
 [503,'Unavailable',{},'http_server_failure_unknown_origin',null],
])test('bounded HTTP diagnostic classifies '+status+' as '+classification+(signal?' / '+signal:''),async()=>{
 const d=await refused({status,body,headers});assert.equal(d.classification,classification);if(signal)assert.ok(d.bodySignals.includes(signal));
});
test('diagnostics project a header/body whitelist without reflecting arbitrary private text or URLs',async()=>{
 const marker='synthetic-private-diagnostic-marker-DO-NOT-ECHO';
 const d=await refused({body:JSON.stringify({message:'Forbidden',api_key:marker,customer:marker,url:'https://private.invalid/?token='+marker}),headers:{
  'content-type':'application/json; private='+marker,'set-cookie':'session='+marker,'authorization':'Bearer '+marker,'www-authenticate':'Bearer '+marker,
  'x-secret':marker,'x-request-id':marker,'location':'https://private.invalid/?token='+marker,'via':marker,'server':marker,
  'x-mitmproxy-blocked-reason':marker,'retry-after':marker,
 }});
 const encoded=JSON.stringify(d);assert.ok(!encoded.includes(marker));assert.ok(!encoded.includes('private.invalid'));
 assert.deepEqual(d.headers,{'content-type':'application/json',viaPresent:true,serverHint:'other',intermediaryPolicyHint:'other'});
 assert.equal(d.classification,'http_forbidden_unknown_origin');assert.equal(d.body,undefined);assert.equal(d.bodyPreview,undefined);
});
test('diagnostic body sample stops at 2048 bytes and ignores signals beyond the prefix',async()=>{
 const d=await refused({body:'Forbidden '+'.'.repeat(4096)+' Blocked by the proxy'});
 assert.equal(d.sampledBodyBytes,2048);assert.equal(d.bodyTruncated,true);assert.equal(d.bodyRead,'bounded');
 assert.equal(d.classification,'http_forbidden_unknown_origin');assert.deepEqual(d.bodySignals,['access_denied_text']);
});
test('stalled body and stalled cancellation cannot delay HTTP refusal beyond diagnostic deadline', {timeout:3000},async()=>{
 let cancelled=0,calls=0;const diagnostics=[],started=Date.now();
 const stream=new ReadableStream({pull:()=>new Promise(()=>{}),cancel:()=>{cancelled++;return new Promise(()=>{});}});
 const client=createTenderClient({onDiagnostic:value=>diagnostics.push(value),fetchImpl:async()=>{calls++;return new Response(stream,{status:403});}});
 await assert.rejects(client.search(query),{code:'REMOTE_AUTHORIZATION_REFUSED'});
 assert.ok(Date.now()-started<2000);assert.equal(calls,1);assert.equal(cancelled,1);assert.equal(diagnostics[0].bodyRead,'unavailable');assert.equal(diagnostics[0].sampledBodyBytes,0);
});
test('throwing or rejected diagnostic observers cannot mask the original HTTP refusal',async()=>{
 for(const observer of [()=>{throw Error('synthetic private observer text');},()=>Promise.reject(Error('synthetic private observer text'))]){
  const d=await refused({body:'Forbidden',observer});assert.equal(d.httpStatus,403);
 }
});
test('short transport timeout bounds diagnostic sampling without relabeling a received HTTP403',async()=>{
 const diagnostics=[],started=Date.now();const stream=new ReadableStream({pull:()=>new Promise(()=>{})});
 const client=createTenderClient({timeoutMs:20,onDiagnostic:value=>diagnostics.push(value),fetchImpl:async()=>new Response(stream,{status:403})});
 await assert.rejects(client.search(query),{code:'REMOTE_AUTHORIZATION_REFUSED'});
 assert.ok(Date.now()-started<200);assert.equal(diagnostics[0].httpStatus,403);assert.equal(diagnostics[0].bodyRead,'unavailable');
});
test('transport diagnostic retains only a static stage and class, never exception text or URL',async()=>{
 const diagnostics=[];await assert.rejects(requestJson('https://fixture.invalid/private?token=synthetic-private',{onDiagnostic:value=>diagnostics.push(value),fetchImpl:async()=>{throw Error('synthetic-private-dns-host');}}),{code:'NETWORK_UNAVAILABLE'});
 assert.deepEqual(diagnostics,[{stage:'transport',classification:'network_unavailable',httpStatus:null,causeProven:false}]);
});
test('TED-only observer is not attached to SAM requests containing its existing API key',async()=>{
 let calls=0,diagnostics=0;const client=createTenderClient({samApiKey:'fixture-sam-only',onDiagnostic:()=>diagnostics++,fetchImpl:async()=>{calls++;return new Response('Forbidden',{status:403});}});
 await assert.rejects(client.search({provider:'sam',postedFrom:'2026-10-01',postedTo:'2026-10-16'}),{code:'REMOTE_AUTHORIZATION_REFUSED'});
 assert.equal(calls,1);assert.equal(diagnostics,0);
});
