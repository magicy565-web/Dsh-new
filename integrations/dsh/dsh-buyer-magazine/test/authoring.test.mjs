import test from 'node:test';
import assert from 'node:assert/strict';
import {apifyCredentials,collectWithApify,collectSiteInSession} from '../src/apify.js';
import {magazineTools} from '../src/tools.js';

test('design preset offers collection and authored-file review, not a fixed generator',()=>{
 const names=magazineTools({}).map(t=>t.name);
 assert.deepEqual(names,['buyer_magazine_collect_site','buyer_magazine_review_artifact']);
 const legacy=magazineTools({},{legacyCompiler:true}).map(t=>t.name);
 assert(legacy.includes('buyer_magazine_generate'));
});
test('missing Apify credentials cannot silently become a successful collection',async()=>{
 let requests=0;
 const result=await collectWithApify({action:'start',url:'https://example.com/'},{fetchImpl:async()=>{requests++;throw Error('must not request');}});
 assert.equal(result.reason,'APIFY_NOT_CONFIGURED');assert.equal(result.status,'blocked');assert.equal(requests,0);
});
test('Apify uses the real Actor protocol, bounded spend and a header credential',async()=>{
 const calls=[];
 const result=await collectWithApify({action:'start',url:'https://example.com/',maxPages:6},{token:'SYNTHETIC_TOKEN',fetchImpl:async(url,init)=>{
  calls.push({url,init});return Response.json({data:{id:'run1234567890',defaultDatasetId:'data1234567890'}});
 }});
 assert.equal(result.status,'running');assert.equal(result.provider,'apify');
 const [{url,init}]=calls;
 assert(url.startsWith('https://api.apify.com/v2/acts/apify~website-content-crawler/runs?'));
 assert.equal(new URL(url).searchParams.get('maxTotalChargeUsd'),'1');
 assert.equal(init.headers.Authorization,'Bearer SYNTHETIC_TOKEN');assert(!url.includes('TOKEN'));
 assert.equal(JSON.parse(init.body).maxCrawlPages,6);assert.equal(init.redirect,'error');
 assert(!JSON.stringify(result).includes('SYNTHETIC_TOKEN'));
});
test('Apify access failure is surfaced without credential rotation or fallback',async()=>{
 let calls=0;
 const result=await collectWithApify({action:'start',url:'https://example.com/'},{token:'SYNTHETIC_TOKEN',fetchImpl:async()=>{calls++;return new Response('',{status:403});}});
 assert.equal(result.status,'failed');assert.equal(result.httpStatus,403);assert.equal(calls,1);
});
test('completed Apify results retain actual run metadata and raw evidence',async()=>{
 const calls=[];
 const result=await collectWithApify({action:'status',runId:'run1234567890'},{token:'SYNTHETIC_TOKEN',fetchImpl:async url=>{
  calls.push(url);
  return url.includes('/actor-runs/')?Response.json({data:{id:'run1234567890',actId:'aYG0l9s7dbB7j3gbS',status:'SUCCEEDED',defaultDatasetId:'data1234567890',finishedAt:'2026-10-26T00:00:00Z'}}):Response.json([{url:'https://example.com/',markdown:'Synthetic evidence'}]);
 }});
 assert.equal(result.status,'collected');assert.equal(result.items[0].markdown,'Synthetic evidence');
 assert.equal(calls.length,2);assert(calls[1].includes('/datasets/data1234567890/items?'));
});
test('native Apify excerpts remain lossless JSON when page metadata is missing',async t=>{
 const previous=process.env.APIFY_TOKEN;process.env.APIFY_TOKEN='SYNTHETIC_TOKEN';
 t.after(()=>{if(previous===undefined)delete process.env.APIFY_TOKEN;else process.env.APIFY_TOKEN=previous;});
 t.mock.method(globalThis,'fetch',async url=>url.includes('/actor-runs/')?Response.json({data:{id:'run1234567890',actId:'aYG0l9s7dbB7j3gbS',status:'SUCCEEDED',defaultDatasetId:'data1234567890',finishedAt:'2026-10-26T00:00:00Z'}}):Response.json([{html:'<script src="https://example.com/app.js"></script><img src="https://example.com/photo.jpg">'}]));
 const result=await collectSiteInSession({}, {action:'status',runId:'run1234567890'}, {signal:new AbortController().signal});
 assert.deepEqual(JSON.parse(JSON.stringify(result)),result);
 assert.equal(result.items[0].title,null);
 assert.deepEqual(result.items[0].images,['https://example.com/photo.jpg']);
});

function credentialEnvironment(t,values){
 const names=['APIFY_TOKEN',...Array.from({length:100},(_,i)=>'APIFY_TOKEN_'+(i+1))];
 const previous=new Map(names.map(n=>[n,process.env[n]]));
 for(const name of names)delete process.env[name];
 Object.assign(process.env,values);
 t.after(()=>{for(const [name,value] of previous)if(value===undefined)delete process.env[name];else process.env[name]=value;});
}
test('credential inventory supports 100 slots without returning secret values',async t=>{
 const values=Object.fromEntries(Array.from({length:100},(_,i)=>['APIFY_TOKEN_'+(i+1),'SYNTHETIC_SECRET_'+(i+1)]));
 credentialEnvironment(t,values);
 const inventory=await collectSiteInSession({}, {action:'credentials'}, {});
 assert.equal(inventory.credentials.length,100);assert.equal(inventory.capacity,100);
 assert.deepEqual(inventory.credentials.at(-1),{credentialId:100,name:'APIFY_TOKEN_100'});
 assert(!JSON.stringify(inventory).includes('SYNTHETIC_SECRET'));
 assert.deepEqual(apifyCredentials({APIFY_TOKEN_5:'SYNTHETIC'}).credentials,[{credentialId:5,name:'APIFY_TOKEN_5'}]);
});
test('selected credentials are used for start and status, including slot 100',async t=>{
 credentialEnvironment(t,{APIFY_TOKEN:'SYNTHETIC_LEGACY',APIFY_TOKEN_5:'SYNTHETIC_FIVE',APIFY_TOKEN_100:'SYNTHETIC_HUNDRED'});
 const headers=[];
 t.mock.method(globalThis,'fetch',async (url,init)=>{
  headers.push(init.headers.Authorization);
  return Response.json({data:{id:'run1234567890',defaultDatasetId:'data1234567890',actId:'aYG0l9s7dbB7j3gbS',status:'RUNNING'}});
 });
 const exec={signal:new AbortController().signal};
 for(const credentialId of [5,100]){
  const start=await collectSiteInSession({}, {action:'start',url:'https://example.com/',credentialId},exec);
  const status=await collectSiteInSession({}, {action:'status',runId:start.runId,credentialId},exec);
  assert.equal(start.credentialId,credentialId);assert.equal(status.credentialName,'APIFY_TOKEN_'+credentialId);
  assert(!JSON.stringify([start,status]).includes('SYNTHETIC_'));
 }
 assert.deepEqual(headers,['Bearer SYNTHETIC_FIVE','Bearer SYNTHETIC_FIVE','Bearer SYNTHETIC_HUNDRED','Bearer SYNTHETIC_HUNDRED']);
});
test('missing or invalid slots cannot fall back to another account',async t=>{
 credentialEnvironment(t,{APIFY_TOKEN:'SYNTHETIC_LEGACY',APIFY_TOKEN_5:'SYNTHETIC_FIVE'});
 let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;throw Error('must not request');});
 const exec={signal:new AbortController().signal};
 const missing=await collectSiteInSession({}, {action:'start',url:'https://example.com/',credentialId:4},exec);
 assert.equal(missing.reason,'APIFY_NOT_CONFIGURED');assert.equal(missing.requiredSecret,'APIFY_TOKEN_4');
 for(const credentialId of [0,101,-1,1.5,'5']){
  const invalid=await collectSiteInSession({}, {action:'start',url:'https://example.com/',credentialId},exec);
  assert.equal(invalid.reason,'APIFY_CREDENTIAL_INVALID');
 }
 assert.equal(requests,0);
});
test('legacy default remains compatible and HTTP failures do not rotate selected tokens',async t=>{
 credentialEnvironment(t,{APIFY_TOKEN:'SYNTHETIC_LEGACY',APIFY_TOKEN_1:'SYNTHETIC_ONE',APIFY_TOKEN_5:'SYNTHETIC_FIVE'});
 const headers=[];let code=429;
 t.mock.method(globalThis,'fetch',async (url,init)=>{headers.push(init.headers.Authorization);return new Response('',{status:code});});
 const exec={signal:new AbortController().signal},args={action:'start',url:'https://example.com/'};
 const legacy=await collectSiteInSession({},args,exec);assert.equal(legacy.credentialName,'APIFY_TOKEN');
 delete process.env.APIFY_TOKEN;
 const first=await collectSiteInSession({},args,exec);assert.equal(first.credentialId,1);
 for(code of [403,429]){
  const selected=await collectSiteInSession({}, {...args,credentialId:5},exec);
  assert.equal(selected.httpStatus,code);assert.equal(selected.credentialId,5);
 }
 assert.deepEqual(headers,['Bearer SYNTHETIC_LEGACY','Bearer SYNTHETIC_ONE','Bearer SYNTHETIC_FIVE','Bearer SYNTHETIC_FIVE']);
});

import {openAuthoredArtifact} from '../src/authored-review.js';
import {memoryHost} from './native-fixture.mjs';
import {failure} from '../src/core.js';
test('authored HTML is read byte-for-byte; linked assets stay inside the project',async()=>{
 const host=memoryHost(),root=host.state.root;
 const html=Buffer.from('<!doctype html><title>Own composition</title><h1>自由设计</h1>');
 host.files.set(root+'/publication/index.html',{type:'file',data:html,version:'1'});
 host.files.set(root+'/publication/type.css',{type:'file',data:Buffer.from('h1{font-size:7vw}'),version:'2'});
 const file=await openAuthoredArtifact(host.ctx,'publication/index.html',host.exec);
 assert.deepEqual(file.html,html);assert.equal(host.state.writes,0);
 assert.equal((await file.readAsset('type.css')).toString(),'h1{font-size:7vw}');
 await assert.rejects(file.readAsset('../other.css'),e=>failure(e).code==='MAGAZINE_WORKSPACE_DENIED');
 host.files.set(root+'/publication/type.css',{type:'file',data:Buffer.from('h1{font-size:3vw}'),version:'3'});
 assert.equal(await file.verify(),false);
});
test('authored review refuses escaped HTML and symlink targets outside the Session',async()=>{
 const host=memoryHost();
 await assert.rejects(openAuthoredArtifact(host.ctx,'../outside.html',host.exec),e=>failure(e).code==='MAGAZINE_WORKSPACE_DENIED');
 host.files.set(host.state.root+'/escaped.html',{type:'symlink',target:'/outside.html'});
 await assert.rejects(openAuthoredArtifact(host.ctx,'escaped.html',host.exec),e=>failure(e).code==='MAGAZINE_WORKSPACE_DENIED');
 assert.equal(host.state.writes,0);
});
