import test from 'node:test';
import assert from 'node:assert/strict';
import {collectWithApify,collectSiteInSession} from '../src/apify.js';
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
