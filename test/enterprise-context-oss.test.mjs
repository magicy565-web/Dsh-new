import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as oss from '../plugins/workspace-enterprise-context/src/oss.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = payload => new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
const model = { provider: 'approved', id: 'fixed-model' };
const sha = 'a'.repeat(64);
const pinned = { artifactId: 'doc-1', version: 3, sha256: sha };
const approval = Object.freeze({ enabled: true, semanticVectorApproved: true, decisionId: 'SYNTHETIC-TEST-NOT-A-PRODUCTION-APPROVAL' });
const scope = () => ({ enabled: true, reviewed: true, workspaceId: 'factory-A', subject: 'boss-A', role: 'admin',
  expiresAt: '2099-01-01T00:00:00.000Z', customerIds: ['ABC'], uploads: [pinned], memoryIds: ['memory-1'],
  allowMemoryWrite: true, sourceRefs: [{ customerId: 'ABC', ref: 'source-1', version: 2, sha256: sha }] });
const metadata = (overrides = {}) => ({ authority: 'noncanonical-business-note', provenance: 'workspace-approved-source',
  customerId: 'ABC', workspaceId: 'factory-A', sourceRef: 'source-1', sourceVersion: 2, sourceSha256: sha, ...overrides });
const userId = oss.memoryPartitionKey('factory-A', 'ABC');
const note = (overrides = {}) => ({ id: 'memory-1', user_id: userId, memory: 'Customer wants distribution', metadata: metadata(), ...overrides });
const event = (overrides = {}) => ({ memory_id: 'memory-1', user_id: userId, event: 'ADD', created_at: '2026-10-16',
  old_memory: null, new_memory: 'Customer wants distribution', metadata: metadata(), ...overrides });
const authority = ({action}) => !action.includes('forbidden');
const grant = () => true;
const client = (extra = {}, policy = {}) => oss.createEnterpriseContextClient({
  scope: scope(), authorize: authority, assertSourceCurrent: grant, assertUploadCurrent: grant,
  memoryApproval: approval, ...extra, ...policy });

test('default unconfigured/invalid URL; canonical Workspace Library until approved cutover', async () => {
  assert.throws(() => oss.createEnterpriseContextClient({ scope: {...scope(), reviewed: false}, authorize: authority }), /OSS_ORIGINAL_SCOPE_REQUIRED/);
  assert.throws(() => oss.createMem0Reader({ baseURL:'http://169.254.169.254', apiKey:'secret' }), /OSS_URL_UNSAFE/);
  assert.throws(() => oss.createDoclingSourceReader({ baseURL:'https://host.test/path', apiKey:'secret' }), /OSS_URL_UNSAFE/);
  assert.equal(oss.CANONICAL_CONTEXT_STORE, 'Workspace Library');
  assert.equal(typeof oss.createErpnextReader, 'undefined'); // PR #86 sole exact-record owner.
  const ready = await oss.createEnterpriseContextClient({scope:scope(),authorize:authority}).status({}, null, model);
  assert.equal(ready.canonical,'Workspace Library');
  assert.equal(ready.migration, 'no-cutover');
  assert.equal(ready.providers.erpnext,'delegate-to-pr86');
  assert.equal(ready.providers.mem0,'disabled');
});

test('Mem0 embedding-based search and writes remain OFF without owner decision, even when injected', async () => {
  let count=0;
  const mem0={ search: async()=>{count++;return {notes:[note()]}}, remember:async()=>{count++;return {}},
    history:async()=>{count++;return {item:note(),history:[event()]}} };
  const s=oss.createEnterpriseContextClient({scope:scope(),authorize:authority,mem0,assertSourceCurrent:grant});
  await assert.rejects(s.memorySearch({customerId:'ABC',query:'distribution'},null,model),/OSS_MEM0_VECTOR_NOT_APPROVED/);
  await assert.rejects(s.memoryAdd({customerId:'ABC',note:'Test',sourceRef:'source-1',sourceVersion:2,sourceSha256:sha},null,model),/OSS_MEM0_VECTOR_NOT_APPROVED/);
  await assert.rejects(s.memoryHistory({customerId:'ABC',memoryId:'memory-1'},null,model),/OSS_MEM0_VECTOR_NOT_APPROVED/);
  assert.equal(count,0);
  const s2=oss.createEnterpriseContextClient({scope:scope(),authorize:authority,mem0,assertSourceCurrent:grant,
    memoryApproval:{enabled:true,decisionId:'approved-but-not-vector'}});
  await assert.rejects(s2.memorySearch({customerId:'ABC',query:'no'},null,model),/OSS_MEM0_VECTOR_NOT_APPROVED/);
  assert.equal(count,0);
});

test('enterprise/customer tuple mapping cannot collide with separator injection or Unicode', () => {
  const a=oss.memoryPartitionKey('a:customer:b','c');
  const b=oss.memoryPartitionKey('a','b:customer:c');
  assert.notEqual(a,b);
  assert.deepEqual(JSON.parse(Buffer.from(a.split(':')[1],'base64url').toString()),['a:customer:b','c']);
  assert.notEqual(oss.memoryPartitionKey('工厂一','客户甲'),oss.memoryPartitionKey('工厂','一:customer:客户甲'));
  assert.throws(()=>oss.memoryPartitionKey('', 'a'),/OSS_MEMORY_PARTITION_INVALID/);
});

test('Mem0 OSS adapter retains full source metadata and does not filter away unsafe rows', async () => {
  const calls=[];
  const m=oss.createMem0Reader({baseURL:'http://127.0.0.1:8888',apiKey:'m0sk-test',fetchImpl:async(url,init)=>{
    calls.push([url,init]);
    if(url.endsWith('/search'))return json({results:[note(),note({user_id:'other'})]});
    if(url.endsWith('/history'))return json([event()]);
    if(url.includes('/memories/memory-1'))return json(note());
    return json({results:[{id:'memory-1'}]});
  }});
  await m.remember({userId, note:'Confirmed meeting', sourceRef:'source-1', sourceVersion:2, sourceSha256:sha,
    customerId:'ABC',workspaceId:'factory-A'});
  assert.equal(JSON.parse(calls[0][1].body).metadata.sourceVersion,2);
  assert.equal(calls[0][1].headers['X-API-Key'],'m0sk-test');
  const results=await m.search({userId,query:'meeting',limit:10});
  assert.equal(results.notes.length,2); // caller must refuse ENTIRE batch if any source is wrong.
  assert.equal(calls[1][0],'http://127.0.0.1:8888/search');
  const hist=await m.history({userId,memoryId:'memory-1'});
  assert.equal(hist.history[0].metadata.sourceVersion,2);
});

test('memory query validates every returned source version, SHA and live grant before disclosure', async () => {
  const checked=[];
  const mem0={search:async()=>({notes:[note(),{...note(),id:'memory-2'}]})};
  const c=client({mem0, assertSourceCurrent:async req=>{checked.push(req);return true}});
  const out=await c.memorySearch({customerId:'ABC',query:'distribution'},null,model);
  assert.equal(out.notes.length,2);
  assert.deepEqual(out.notes.map(x=>x.sourceVersion),[2,2]);
  assert.equal(checked.length,4); // one live check per row + final per-row return check
  assert(checked.every(x=>x.sourceRef==='source-1'&&x.sourceSha256===sha&&x.customerId==='ABC'));
  assert.deepEqual(Object.keys(out.notes[0]).sort(),['id','note','sourceRef','sourceSha256','sourceVersion'].sort());
});

test('memory query fails closed for foreign tenant, absent metadata, wrong SHA/version or revoked source', async () => {
  const variants=[
    note({user_id:oss.memoryPartitionKey('factory-B','ABC')}),
    note({metadata:null}), note({metadata:metadata({customerId:'OTHER'})}),
    note({metadata:metadata({sourceSha256:'b'.repeat(64)})}),
    note({metadata:metadata({sourceVersion:3})}),
    note({metadata:metadata({sourceVersion:undefined})})
  ];
  for(const row of variants){
    const c=client({mem0:{search:async()=>({notes:[note(),row]})}});
    await assert.rejects(c.memorySearch({customerId:'ABC',query:'distribution'},null,model));
  }
  let allow=true;
  const c=client({mem0:{search:async()=>({notes:[note()]})},assertSourceCurrent:async()=>allow});
  allow=false;
  await assert.rejects(c.memorySearch({customerId:'ABC',query:'distribution'},null,model),/OSS_MEMORY_SOURCE_REVOKED/);
  let count=0;
  const r=client({mem0:{search:async()=>({notes:[note(),{...note(),id:'memory-2'}]})},
    assertSourceCurrent:async()=>++count<3});
  await assert.rejects(r.memorySearch({customerId:'ABC',query:'distribution'},null,model),/OSS_MEMORY_SOURCE_REVOKED/);
});

test('memory history rejects any unproven historical event, including stale or missing source version', async () => {
  const baseline={item:note(),history:[event(),event({event:'UPDATE',old_memory:'Old',new_memory:'New'})]};
  const get=(value)=>client({mem0:{history:async()=>value}});
  const result=await get(baseline).memoryHistory({customerId:'ABC',memoryId:'memory-1'},null,model);
  assert.equal(result.history.length,2);
  assert.equal(result.history[1].sourceSha256,sha);
  for(const bad of [event({metadata:null}),event({metadata:metadata({sourceVersion:1})}),
    event({metadata:metadata({sourceSha256:'b'.repeat(64)})}),event({user_id:'foreign'}),
    event({memory_id:'other'}),event({metadata:metadata({workspaceId:'factory-B'})})]) {
    await assert.rejects(get({item:note(),history:[event(),bad]}).memoryHistory({customerId:'ABC',memoryId:'memory-1'},null,model));
  }
  await assert.rejects(get({item:note({metadata:null}),history:[event()]}).memoryHistory({customerId:'ABC',memoryId:'memory-1'},null,model));
  await assert.rejects(get({item:note(),history:[event()]}).memoryHistory({customerId:'ABC',memoryId:'unknown'},null,model),/OSS_MEMORY_HISTORY_NOT_AUTHORIZED/);
});

test('revocation during multi-item memory history validation blocks whole history', async () => {
  let seen=0;
  const c=client({mem0:{history:async()=>({item:note(),history:[event(),event({event:'UPDATE'})]})},
    assertSourceCurrent:async()=>++seen<3});
  await assert.rejects(c.memoryHistory({customerId:'ABC',memoryId:'memory-1'},null,model),/OSS_MEMORY_SOURCE_REVOKED/);
});

test('memory writes require source revision/SHA, current approval and original explicit write intent', async () => {
  let calls=0;
  const c=client({mem0:{remember:async()=>{calls++;return {status:'stored'}}}});
  const input={customerId:'ABC',note:'Met in Las Vegas',sourceRef:'source-1',sourceVersion:2,sourceSha256:sha};
  assert.equal((await c.memoryAdd(input,null,model)).status,'stored');
  assert.equal(calls,1);
  await assert.rejects(c.memoryAdd({...input,sourceVersion:3},null,model),/OSS_MEMORY_SOURCE_NOT_APPROVED/);
  await assert.rejects(c.memoryAdd({...input,sourceSha256:'b'.repeat(64)},null,model),/OSS_MEMORY_SOURCE_NOT_APPROVED/);
  const denied=client({scope:{...scope(),allowMemoryWrite:false},mem0:{remember:async()=>{calls++;}}});
  await assert.rejects(denied.memoryAdd(input,null,model),/OSS_MEMORY_WRITE_NOT_AUTHORIZED/);
  assert.equal(calls,1);
});

test('Docling rechecks live authorization AFTER download and BEFORE releasing bytes', async () => {
  const bytes=Buffer.from('%PDF-sample');const pin={artifactId:'doc-1',version:3,sha256:hash(bytes)};
  let authorized=true, uploads=0, parsing=0;
  const c=client({scope:{...scope(),uploads:[pin]},authorize:async()=>authorized,
    assertUploadCurrent:async()=>{uploads++;return true},
    artifacts:{download:async()=>{authorized=false;return {bytes,mimeType:'application/pdf',version:{sha256:pin.sha256}}}},
    doclingReader:async()=>{parsing++;return {status:'available'}}});
  await assert.rejects(c.parseUpload(pin,null,model),/OSS_ORIGINAL_AUTHORIZATION_REQUIRED/);
  assert.equal(uploads,1);
  assert.equal(parsing,0);
  let calls=0, checks=0;
  const d=client({scope:{...scope(),uploads:[pin]},authorize:authority,
    assertUploadCurrent:async()=>++checks<2,
    artifacts:{download:async()=>{calls++;return {bytes,mimeType:'application/pdf',version:{sha256:pin.sha256}}}},
    doclingReader:async()=>{parsing++;return {status:'available'}}});
  await assert.rejects(d.parseUpload(pin,null,model),/OSS_UPLOAD_REVOKED/);
  assert.equal(calls,1);assert.equal(parsing,0);assert.equal(checks,2);
});

test('Docling checks exact bytes and refuses tamper; permitted dispatch gets exact SHA bytes only', async () => {
  const bytes=Buffer.from('%PDF-sample');const pin={artifactId:'doc-1',version:3,sha256:hash(bytes)};
  const checks=[], sent=[];
  const doclingReader=oss.createDoclingSourceReader({baseURL:'http://127.0.0.1:5001',apiKey:'local-key',
    fetchImpl:async (url,init)=>{sent.push([url,init]);return json({status:'success',document:{md_content:'# Catalog'},errors:[]})}});
  const c=client({scope:{...scope(),uploads:[pin]},authorize:({action})=>{checks.push(action);return true},
    assertUploadCurrent:async({action})=>{checks.push(action+':artifact');return true},
    artifacts:{download:async()=>({bytes,mimeType:'application/pdf',version:{sha256:pin.sha256}})},doclingReader});
  const result=await c.parseUpload(pin,null,model);
  assert.equal(result.sourceSha256,pin.sha256);assert.equal(result.text,'# Catalog');
  assert.equal(sent.length,1);assert(sent[0][0].endsWith('/v1/convert/file'));
  assert(checks.indexOf('upload.dispatch')>=0 && checks.indexOf('upload.dispatch:artifact')>checks.indexOf('upload.dispatch'));
  assert.equal(sent[0][1].body.get('files').name,'selected.pdf');
  const tampered=client({scope:{...scope(),uploads:[pin]},authorize:authority,assertUploadCurrent:grant,
    artifacts:{download:async()=>({bytes:Buffer.from('forged'),mimeType:'application/pdf',version:{sha256:pin.sha256}})},
    doclingReader:async()=>{throw Error('MUST_NOT_SEND')}});
  await assert.rejects(tampered.parseUpload(pin,null,model),/OSS_SOURCE_VERSION_CHANGED/);
  await assert.rejects(c.parseUpload({...pin,version:4},null,model),/OSS_UPLOAD_NOT_AUTHORIZED/);
});

test('revocation after Docling response still denies output; missing current-asset authority never calls download', async () => {
  const bytes=Buffer.from('check');const pin={artifactId:'doc-1',version:3,sha256:hash(bytes)};
  let allowed=true,downloads=0,parses=0;
  const c=client({scope:{...scope(),uploads:[pin]},authorize:()=>allowed,assertUploadCurrent:grant,
    artifacts:{download:async()=>{downloads++;return {bytes,mimeType:'text/plain',version:{sha256:pin.sha256}}}},
    doclingReader:async()=>{parses++;allowed=false;return {status:'available',text:'secret'}}});
  await assert.rejects(c.parseUpload(pin,null,model),/OSS_ORIGINAL_AUTHORIZATION_REQUIRED/);
  assert.equal(parses,1);
  const d=client({scope:{...scope(),uploads:[pin]},assertUploadCurrent:undefined,
    artifacts:{download:async()=>{downloads++;}}});
  await assert.rejects(d.parseUpload(pin,null,model),/OSS_UPLOAD_NOT_AUTHORIZED/);
  assert.equal(downloads,1);
});
