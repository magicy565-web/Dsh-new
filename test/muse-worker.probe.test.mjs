import test from 'node:test';
import assert from 'node:assert/strict';
import { probeMuseReadOnly, validateMuseBaseUrl } from '../scripts/check-muse-readonly-connection.mjs';

const BASE='https://workers.testco.net/api/muse-worker/v1';
const token='local-fixture-Muse-only-credential-1234567890';
const identity={workerId:'muse-personal-alpha',muse:'alpha',contract:'workspace.muse.pull.v1',
  approved:false,connected:false,allowedServices:['buyer-discovery']};
const mock = (identityOverride={},inboxOverride={}) => {
  const calls=[];
  const fetcher=async (url,options)=>{
    calls.push({url,method:options.method,redirect:options.redirect,headers:options.headers});
    const body=url.endsWith('/identity')?{...identity,...identityOverride}:
      {workerId:'muse-personal-alpha',tasks:[],...inboxOverride};
    return Response.json(body);
  };
  return {fetcher,calls};
};

test('the Muse host probe performs only two scoped GET calls, never a claim or upload', async()=>{
  const m=mock();
  const result=await probeMuseReadOnly({baseUrl:BASE,token,expectedWorkerId:'muse-personal-alpha',expectedOwnerId:'alpha',fetcher:m.fetcher});
  assert.equal(result.connection,'authenticated-read-only');
  assert.equal(result.approved,false);
  assert.equal(result.inboxCount,0);
  assert.equal(result.liveExecutionVerified,false);
  assert.deepEqual(m.calls.map(x=>x.url),[BASE+'/identity',BASE+'/inbox']);
  assert.ok(m.calls.every(x=>x.method==='GET'&&x.redirect==='error'&&x.headers.Authorization==='Bearer '+token));
  assert.ok(!JSON.stringify(result).includes(token));
});

test('read-only probe refuses placeholder, local, or mismatched API host before any network',async()=>{
  const blocked=['http://workers.testco.net/api/muse-worker/v1',
    'https://example.com/api/muse-worker/v1',
    'https://UNCONFIGURED-HOST.invalid/api/muse-worker/v1',
    'https://127.0.0.1/api/muse-worker/v1',
    'https://localhost/api/muse-worker/v1',
    'https://workers.testco.net/api/dot-worker/v1',
    'https://workers.testco.net/mcp',
    'https://u:p@workers.testco.net/api/muse-worker/v1',
    'https://workers.testco.net/api/muse-worker/v1?token=secret'];
  for(const host of blocked)assert.throws(()=>validateMuseBaseUrl(host));
  const m=mock();
  await assert.rejects(probeMuseReadOnly({
    baseUrl:BASE,token:'short',expectedWorkerId:'muse-personal-alpha',expectedOwnerId:'alpha',fetcher:m.fetcher,
  }),{code:'MUSE_CREDENTIAL_REQUIRED'});
  assert.deepEqual(m.calls,[]);
});

test('identity mismatch and unexpectedly enabled Muse are not treated as handshake success',async()=>{
  for(const [override,code] of [
    [{workerId:'chatgpt-dot-xy'},'MUSE_IDENTITY_MISMATCH'],
    [{contract:'workspace.dot.pull.v1'},'MUSE_IDENTITY_MISMATCH'],
    [{muse:'other-owner'},'MUSE_IDENTITY_MISMATCH'],
    [{approved:true},'MUSE_UNEXPECTED_APPROVAL'],
  ]){
    const m=mock(override);
    await assert.rejects(probeMuseReadOnly({
      baseUrl:BASE,token,expectedWorkerId:'muse-personal-alpha',expectedOwnerId:'alpha',fetcher:m.fetcher,
    }),{code});
  }
  const withTask=mock({}, {tasks:[{taskRef:'unexpected-task'}]});
  await assert.rejects(probeMuseReadOnly({
    baseUrl:BASE,token,expectedWorkerId:'muse-personal-alpha',expectedOwnerId:'alpha',fetcher:withTask.fetcher,
  }),{code:'MUSE_UNEXPECTED_TASKS'});
});

test('401 credentials, redirects and oversized responses fail closed',async()=>{
  const cases=[
    [async()=>new Response('',{status:401}),'MUSE_UNAUTHORIZED'],
    [async()=>{throw Error('Redirect is refused');},'MUSE_READ_FAILED'],
    [async()=>new Response('a'.repeat(65_537)),'MUSE_RESPONSE_TOO_LARGE'],
  ];
  for(const [fetcher,code] of cases)
    await assert.rejects(probeMuseReadOnly({
      baseUrl:BASE,token,expectedWorkerId:'muse-personal-alpha',expectedOwnerId:'alpha',fetcher,
    }),{code});
});

test('chunked oversized responses stop downloading and cancel before the inbox call',async()=>{
  let reads=0, cancelled=false, calls=0;
  const body=new ReadableStream({
    pull(controller){
      reads++;
      // Deliberately unending: a post-download length check would never finish.
      controller.enqueue(new Uint8Array(16_384).fill(97));
    },
    cancel(){cancelled=true;},
  },{highWaterMark:0});
  await assert.rejects(probeMuseReadOnly({
    baseUrl:BASE,token,expectedWorkerId:identity.workerId,expectedOwnerId:identity.muse,
    fetcher:async()=>{calls++;return new Response(body);},
  }),{code:'MUSE_RESPONSE_TOO_LARGE'});
  assert.equal(reads,5);
  assert.equal(cancelled,true);
  assert.equal(calls,1);
  assert.equal(body.locked,false);
});

test('the response cap counts UTF-8 bytes and accepts the exact boundary',async()=>{
  const prefix=JSON.stringify({...identity,note:''});
  const fixedBytes=Buffer.byteLength(prefix);
  const makeBody=size=>JSON.stringify({...identity,note:'a'.repeat(size-fixedBytes)});
  for(const size of [65_536,65_537]){
    const body=makeBody(size);
    assert.equal(Buffer.byteLength(body),size);
    const m=mock();
    const options={baseUrl:BASE,token,expectedWorkerId:identity.workerId,expectedOwnerId:identity.muse,
      fetcher:(url,opts)=>url.endsWith('/identity')?Promise.resolve(new Response(body)):m.fetcher(url,opts)};
    if(size===65_536)assert.equal((await probeMuseReadOnly(options)).inboxCount,0);
    else await assert.rejects(probeMuseReadOnly(options),{code:'MUSE_RESPONSE_TOO_LARGE'});
  }
  const unicodeBody=JSON.stringify({...identity,note:'汉'.repeat(22_000)});
  assert.ok(unicodeBody.length<65_536);
  assert.ok(Buffer.byteLength(unicodeBody)>65_536);
  await assert.rejects(probeMuseReadOnly({
    baseUrl:BASE,token,expectedWorkerId:identity.workerId,expectedOwnerId:identity.muse,
    fetcher:async()=>new Response(unicodeBody),
  }),{code:'MUSE_RESPONSE_TOO_LARGE'});
});

test('an oversized declared body is cancelled without consuming any bytes',async()=>{
  let reads=0,cancelled=false;
  const body=new ReadableStream({
    pull(){reads++;},cancel(){cancelled=true;},
  },{highWaterMark:0});
  await assert.rejects(probeMuseReadOnly({
    baseUrl:BASE,token,expectedWorkerId:identity.workerId,expectedOwnerId:identity.muse,
    fetcher:async()=>new Response(body,{headers:{'content-length':'65537'}}),
  }),{code:'MUSE_RESPONSE_TOO_LARGE'});
  assert.equal(reads,0);
  assert.equal(cancelled,true);
});

test('split UTF-8 chunks decode correctly and malformed UTF-8 is rejected',async()=>{
  const bytes=new TextEncoder().encode(JSON.stringify({...identity,note:'个人 Muse'}));
  const split=bytes.indexOf(228)+1;
  const m=mock();
  const result=await probeMuseReadOnly({
    baseUrl:BASE,token,expectedWorkerId:identity.workerId,expectedOwnerId:identity.muse,
    fetcher:(url,opts)=>{
      if(!url.endsWith('/identity'))return m.fetcher(url,opts);
      return Promise.resolve(new Response(new ReadableStream({start(controller){
        controller.enqueue(bytes.slice(0,split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      }})));
    },
  });
  assert.equal(result.workerId,identity.workerId);
  const malformed=new Uint8Array([...new TextEncoder().encode('{"muse":"'),255,
    ...new TextEncoder().encode('"}')]);
  await assert.rejects(probeMuseReadOnly({
    baseUrl:BASE,token,expectedWorkerId:identity.workerId,expectedOwnerId:identity.muse,
    fetcher:async()=>new Response(malformed),
  }),{code:'MUSE_RESPONSE_INVALID'});
});
