import test from 'node:test';
import assert from 'node:assert/strict';
import {apifyCredentials,collectWithApify,collectSiteInSession} from '../src/apify.js';
import {magazineTools} from '../src/tools.js';
const limits=()=>Response.json({data:{limits:{maxMonthlyUsageUsd:10},current:{monthlyUsageUsd:2},monthlyUsageCycle:{startAt:'2026-10-01T00:00:00Z',endAt:'2026-11-01T00:00:00Z'}}});

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
  calls.push({url,init});return url.endsWith('/users/me/limits')?limits():Response.json({data:{id:'run1234567890',actId:'aYG0l9s7dbB7j3gbS',defaultDatasetId:'data1234567890'}});
 }});
 assert.equal(result.status,'running');assert.equal(result.provider,'apify');
 assert.equal(calls[0].url,'https://api.apify.com/v2/users/me/limits');
 assert.equal(calls[0].init.method,'GET');assert.equal(calls.length,2);
 assert.equal(result.budget.remainingLimitUsd,8);
 const {url,init}=calls[1];
 assert(url.startsWith('https://api.apify.com/v2/acts/apify~website-content-crawler/runs?'));
 assert.equal(new URL(url).searchParams.get('maxTotalChargeUsd'),'1');
 assert.equal(init.headers.Authorization,'Bearer SYNTHETIC_TOKEN');assert(!url.includes('TOKEN'));
 assert.equal(JSON.parse(init.body).maxCrawlPages,6);assert.equal(init.redirect,'error');
 assert(!JSON.stringify(result).includes('SYNTHETIC_TOKEN'));
});
test('Apify access failure is surfaced without credential rotation or fallback',async()=>{
 let calls=0;
 const result=await collectWithApify({action:'start',url:'https://example.com/'},{token:'SYNTHETIC_TOKEN',fetchImpl:async()=>{calls++;return new Response('',{status:403});}});
 assert.equal(result.status,'blocked');assert.equal(result.reason,'APIFY_PREFLIGHT_HTTP_ERROR');assert.equal(result.httpStatus,403);assert.equal(calls,1);
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
 const saved=[];
 const ctx={get:name=>name==='attachments'?{saveFile:async file=>{saved.push(file);return {attachmentId:'a'.repeat(64),name:file.name};}}:undefined};
 const result=await collectSiteInSession(ctx, {action:'status',runId:'run1234567890'}, {signal:new AbortController().signal});
 assert.deepEqual(JSON.parse(JSON.stringify(result)),result);
 assert.equal(result.items[0].title,null);
 assert.deepEqual(result.items[0].images,['https://example.com/photo.jpg']);
 assert.equal(JSON.parse(saved[0].data).run.id,'run1234567890');
 assert.equal(JSON.parse(saved[0].data).items[0].html.includes('<script'),true);
});

test('budget inspection is read-only and insufficient or unknown headroom cannot start an Actor',async()=>{
 for(const data of [{limits:{maxMonthlyUsageUsd:2.5},current:{monthlyUsageUsd:2}},{}]){
  const methods=[];
  const result=await collectWithApify({action:'start',url:'https://example.com/'},{token:'SYNTHETIC_TOKEN',fetchImpl:async(_url,init)=>{methods.push(init.method);return Response.json({data});}});
  assert.equal(result.status,'blocked');assert.deepEqual(methods,['GET']);
 }
 const result=await collectWithApify({action:'preflight'},{token:'SYNTHETIC_TOKEN',fetchImpl:async(_url,init)=>{assert.equal(init.method,'GET');return limits();}});
 assert.equal(result.status,'ready');assert.equal(result.budget.scope,'account-limit-headroom-not-reserved-credit');
});
test('invalid charge configuration cannot silently fall back to a paid default',async()=>{
 for(const maxChargeUsd of [0,-1,6,NaN,'1']){
  const result=await collectWithApify({action:'start',url:'https://example.com/'},{token:'SYNTHETIC_TOKEN',maxChargeUsd,fetchImpl:()=>{throw Error('must not request');}});
  assert.equal(result.reason,'APIFY_BUDGET_INVALID');
 }
});
test('a lost start response is unknown and is never automatically retried',async()=>{
 for(const fail of [()=>{throw Error('connection lost');},()=>new Response('',{status:503}),()=>Response.json({data:{id:'invalid'}})]){
  let starts=0;
  const result=await collectWithApify({action:'start',url:'https://example.com/'},{token:'SYNTHETIC_TOKEN',fetchImpl:async(url)=>url.endsWith('/limits')?limits():(starts++,fail())});
  assert.equal(result.status,'unknown');assert.equal(result.reason,'APIFY_START_OUTCOME_UNKNOWN');assert.equal(starts,1);
 }
});
test('empty successful Actor results remain blocked with real run evidence',async t=>{
 const previous=process.env.APIFY_TOKEN;process.env.APIFY_TOKEN='SYNTHETIC_TOKEN';
 t.after(()=>{if(previous===undefined)delete process.env.APIFY_TOKEN;else process.env.APIFY_TOKEN=previous;});
 t.mock.method(globalThis,'fetch',async url=>url.includes('/actor-runs/')?Response.json({data:{id:'run1234567890',actId:'aYG0l9s7dbB7j3gbS',status:'SUCCEEDED',defaultDatasetId:'data1234567890'}}):Response.json([]));
 const saved=[];
 const result=await collectSiteInSession({get:()=>({saveFile:async file=>{saved.push(file);return {attachmentId:'b'.repeat(64)};}})},{action:'status',runId:'run1234567890'},{signal:new AbortController().signal});
 assert.equal(result.status,'blocked');assert.equal(result.reason,'APIFY_DATASET_EMPTY');assert.equal(saved.length,1);
 assert.equal(JSON.parse(saved[0].data).run.status,'SUCCEEDED');assert.deepEqual(JSON.parse(saved[0].data).items,[]);
});
test('native collection requires evidence storage before any paid request',async t=>{
 const previous=process.env.APIFY_TOKEN;process.env.APIFY_TOKEN='SYNTHETIC_TOKEN';
 t.after(()=>{if(previous===undefined)delete process.env.APIFY_TOKEN;else process.env.APIFY_TOKEN=previous;});
 t.mock.method(globalThis,'fetch',()=>{throw Error('must not request');});
 const result=await collectSiteInSession({}, {action:'start',url:'https://example.com/'}, {signal:new AbortController().signal});
 assert.equal(result.reason,'NATIVE_ATTACHMENTS_UNAVAILABLE');
});
test('a dataset transport failure retains its known Run for reconciliation',async()=>{
 const result=await collectWithApify({action:'status',runId:'run1234567890'},{token:'SYNTHETIC_TOKEN',fetchImpl:async url=>{
  if(url.includes('/actor-runs/'))return Response.json({data:{id:'run1234567890',actId:'aYG0l9s7dbB7j3gbS',status:'SUCCEEDED',defaultDatasetId:'data1234567890'}});
  throw Error('connection lost');
 }});
 assert.equal(result.status,'failed');assert.equal(result.runId,'run1234567890');assert.equal(result.datasetId,'data1234567890');
});
test('a native evidence-save failure preserves known Run metadata without claiming delivery',async t=>{
 const previous=process.env.APIFY_TOKEN;process.env.APIFY_TOKEN='SYNTHETIC_TOKEN';
 t.after(()=>{if(previous===undefined)delete process.env.APIFY_TOKEN;else process.env.APIFY_TOKEN=previous;});
 t.mock.method(globalThis,'fetch',async url=>url.includes('/actor-runs/')?Response.json({data:{id:'run1234567890',actId:'aYG0l9s7dbB7j3gbS',status:'RUNNING',defaultDatasetId:'data1234567890'}}):assert.fail('unexpected Dataset read'));
 const result=await collectSiteInSession({get:()=>({saveFile:async()=>{throw Error('disk unavailable');}})},{action:'status',runId:'run1234567890'},{signal:new AbortController().signal});
 assert.equal(result.status,'blocked');assert.equal(result.reason,'APIFY_EVIDENCE_SAVE_FAILED');assert.equal(result.runId,'run1234567890');assert.equal(result.collectionStatus,'running');
 assert.equal(Object.hasOwn(result,'dataset'),false);
});

function credentialEnvironment(t,values){
 const names=['APIFY_TOKEN',...Array.from({length:100},(_,i)=>['APIFY_TOKEN_'+(i+1),'APIFY_TOKEN'+(i+1)]).flat()];
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
  if(url.endsWith('/users/me/limits'))return limits();
  return Response.json({data:{id:'run1234567890',defaultDatasetId:'data1234567890',actId:'aYG0l9s7dbB7j3gbS',status:'RUNNING'}});
 });
 const exec={signal:new AbortController().signal};
 const ctx={get:()=>({saveFile:async file=>({attachmentId:'c'.repeat(64),name:file.name})})};
 for(const credentialId of [5,100]){
  const start=await collectSiteInSession(ctx, {action:'start',url:'https://example.com/',credentialId},exec);
  const status=await collectSiteInSession(ctx, {action:'status',runId:start.runId,credentialId},exec);
  assert.equal(start.credentialId,credentialId);assert.equal(status.credentialName,'APIFY_TOKEN_'+credentialId);
  assert(!JSON.stringify([start,status]).includes('SYNTHETIC_'));
 }
 assert.deepEqual(headers,['Bearer SYNTHETIC_FIVE','Bearer SYNTHETIC_FIVE','Bearer SYNTHETIC_FIVE','Bearer SYNTHETIC_HUNDRED','Bearer SYNTHETIC_HUNDRED','Bearer SYNTHETIC_HUNDRED']);
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
 const ctx={get:()=>({saveFile:async()=>assert.fail('preflight failure has no Run to save')})};
 const legacy=await collectSiteInSession(ctx,args,exec);assert.equal(legacy.credentialName,'APIFY_TOKEN');
 delete process.env.APIFY_TOKEN;
 const first=await collectSiteInSession(ctx,args,exec);assert.equal(first.credentialId,1);
 for(code of [403,429]){
  const selected=await collectSiteInSession(ctx, {...args,credentialId:5},exec);
  assert.equal(selected.httpStatus,code);assert.equal(selected.credentialId,5);
 }
 assert.deepEqual(headers,['Bearer SYNTHETIC_LEGACY','Bearer SYNTHETIC_ONE','Bearer SYNTHETIC_FIVE','Bearer SYNTHETIC_FIVE']);
});
test('unseparated names from the environment UI work for default, selection and status',async t=>{
 credentialEnvironment(t,{APIFY_TOKEN1:'SYNTHETIC_UI_ONE',APIFY_TOKEN5:'SYNTHETIC_UI_FIVE',APIFY_TOKEN100:'SYNTHETIC_UI_HUNDRED'});
 const headers=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  headers.push(init.headers.Authorization);
  if(url.endsWith('/users/me/limits'))return limits();
  return Response.json({data:{id:'run1234567890',defaultDatasetId:'data1234567890',actId:'aYG0l9s7dbB7j3gbS',status:'RUNNING'}});
 });
 const inventory=await collectSiteInSession({}, {action:'credentials'}, {});
 assert.deepEqual(inventory.credentials,[{credentialId:1,name:'APIFY_TOKEN1'},{credentialId:5,name:'APIFY_TOKEN5'},{credentialId:100,name:'APIFY_TOKEN100'}]);
 assert.equal(inventory.defaultCredential,'APIFY_TOKEN1');
 const exec={signal:new AbortController().signal};
 const ctx={get:()=>({saveFile:async file=>({attachmentId:'d'.repeat(64),name:file.name})})};
 const first=await collectSiteInSession(ctx, {action:'start',url:'https://example.com/'},exec);
 assert.equal(first.credentialName,'APIFY_TOKEN1');
 for(const credentialId of [5,100]){
  const start=await collectSiteInSession(ctx, {action:'start',url:'https://example.com/',credentialId},exec);
  const status=await collectSiteInSession(ctx, {action:'status',runId:start.runId,credentialId},exec);
  assert.equal(status.credentialName,'APIFY_TOKEN'+credentialId);
 }
 assert.deepEqual(headers,['Bearer SYNTHETIC_UI_ONE','Bearer SYNTHETIC_UI_ONE','Bearer SYNTHETIC_UI_FIVE','Bearer SYNTHETIC_UI_FIVE','Bearer SYNTHETIC_UI_FIVE','Bearer SYNTHETIC_UI_HUNDRED','Bearer SYNTHETIC_UI_HUNDRED','Bearer SYNTHETIC_UI_HUNDRED']);
 assert(!JSON.stringify(inventory).includes('SYNTHETIC_'));
});
test('mixed naming resolves each slot once and never retries its alias on denial',async t=>{
 credentialEnvironment(t,{APIFY_TOKEN_5:'SYNTHETIC_UNDERSCORE',APIFY_TOKEN5:'SYNTHETIC_ALIAS',APIFY_TOKEN100:'SYNTHETIC_HUNDRED'});
 const inventory=apifyCredentials();assert.equal(inventory.credentials.length,2);
 assert.deepEqual(inventory.credentials[0],{credentialId:5,name:'APIFY_TOKEN_5'});
 const headers=[];t.mock.method(globalThis,'fetch',async(url,init)=>{headers.push(init.headers.Authorization);return new Response('',{status:403});});
 const ctx={get:()=>({saveFile:async()=>assert.fail('denied preflight must not have a Run')})};
 const result=await collectSiteInSession(ctx, {action:'start',url:'https://example.com/',credentialId:5}, {signal:new AbortController().signal});
 assert.equal(result.httpStatus,403);assert.equal(result.credentialName,'APIFY_TOKEN_5');
 assert.deepEqual(headers,['Bearer SYNTHETIC_UNDERSCORE']);
 const missing=await collectSiteInSession(ctx, {action:'start',url:'https://example.com/',credentialId:4}, {signal:new AbortController().signal});
 assert.deepEqual(missing.acceptedSecretNames,['APIFY_TOKEN_4','APIFY_TOKEN4']);
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
