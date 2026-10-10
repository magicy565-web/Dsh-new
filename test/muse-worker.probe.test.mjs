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
    return {status:200,headers:{get:()=>null},text:async()=>JSON.stringify(body)};
  };
  return {fetcher,calls};
};

test('the Muse host probe performs only two scoped GET calls, never a claim or upload', async()=>{
  const m=mock();
  const result=await probeMuseReadOnly({baseUrl:BASE,token,expectedWorkerId:'muse-personal-alpha',fetcher:m.fetcher});
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
    baseUrl:BASE,token:'short',expectedWorkerId:'muse-personal-alpha',fetcher:m.fetcher,
  }),{code:'MUSE_CREDENTIAL_REQUIRED'});
  assert.deepEqual(m.calls,[]);
});

test('identity mismatch and unexpectedly enabled Muse are not treated as handshake success',async()=>{
  for(const [override,code] of [
    [{workerId:'chatgpt-dot-xy'},'MUSE_IDENTITY_MISMATCH'],
    [{contract:'workspace.dot.pull.v1'},'MUSE_IDENTITY_MISMATCH'],
    [{approved:true},'MUSE_UNEXPECTED_APPROVAL'],
  ]){
    const m=mock(override);
    await assert.rejects(probeMuseReadOnly({
      baseUrl:BASE,token,expectedWorkerId:'muse-personal-alpha',fetcher:m.fetcher,
    }),{code});
  }
  const withTask=mock({}, {tasks:[{taskRef:'unexpected-task'}]});
  await assert.rejects(probeMuseReadOnly({
    baseUrl:BASE,token,expectedWorkerId:'muse-personal-alpha',fetcher:withTask.fetcher,
  }),{code:'MUSE_UNEXPECTED_TASKS'});
});

test('401 credentials, redirects and oversized responses fail closed',async()=>{
  const cases=[
    [async()=>({status:401,headers:{get:()=>null},text:async()=>''}),'MUSE_UNAUTHORIZED'],
    [async()=>{throw Error('Redirect is refused');},'MUSE_READ_FAILED'],
    [async()=>({status:200,headers:{get:()=>null},text:async()=> 'a'.repeat(65_537)}),'MUSE_RESPONSE_TOO_LARGE'],
  ];
  for(const [fetcher,code] of cases)
    await assert.rejects(probeMuseReadOnly({
      baseUrl:BASE,token,expectedWorkerId:'muse-personal-alpha',fetcher,
    }),{code});
});
