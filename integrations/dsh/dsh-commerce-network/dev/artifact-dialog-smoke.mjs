// Actual delivery dialog and API adapter with controlled HTTP responses.
// Synthetic data only; fetch deliberately ignores abort to exercise stale reads.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';

const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/Inspector.jsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'});
const require=createRequire(import.meta.url),module={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(require,module,module.exports);
const {ArtifactDialog}=module.exports;
const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://workspace.example.test/'});
const saved=new Map();
function expose(key,value){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
for(const key of ['window','document','navigator','HTMLElement','Element','Event','MouseEvent'])expose(key,dom.window[key]);
expose('IS_REACT_ACT_ENVIRONMENT',true);
const requests=[],blobs=[],downloads=[],revoked=[];
expose('fetch',(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject})));
const originalCreate=Object.getOwnPropertyDescriptor(URL,'createObjectURL'),originalRevoke=Object.getOwnPropertyDescriptor(URL,'revokeObjectURL');
Object.defineProperty(URL,'createObjectURL',{configurable:true,writable:true,value:blob=>{blobs.push(blob);return `blob:https://workspace.example.test/${blobs.length}`;}});
Object.defineProperty(URL,'revokeObjectURL',{configurable:true,writable:true,value:url=>revoked.push(url)});
dom.window.HTMLAnchorElement.prototype.click=function(){downloads.push({href:this.href,name:this.download});};
const root=createRoot(document.getElementById('app'));
const sha=value=>createHash('sha256').update(value).digest('hex');
const complete=(id,content,sourceUrls=[],projectId='project-one')=>({id,projectId,orderId:`order-${id}`,agentServiceId:'test-worker',title:`TEST ${id}`,content,sourceUrls,sha256:sha(content),createdAt:'2026-10-28T01:00:00Z',provenance:'external-worker-submission-unverified'});
const metadata=({content,sourceUrls,...rest})=>rest;
const button=pattern=>[...document.querySelectorAll('button')].find(item=>pattern.test(item.textContent));
const download=()=>button(/下载交付记录/);
const content=()=>document.querySelector('.cn-artifact-content')?.textContent||'';
const onClose=()=>{};
async function mount(artifact,sessionId='session-one',projectId=artifact.projectId){
  const count=requests.length;
  await act(async()=>root.render(React.createElement(ArtifactDialog,{artifact,sessionId,projectId,onClose})));
  assert.equal(requests.length,count+1,'each new delivery or authorization scope must fetch its own body');
  const request=requests.at(-1),url=new URL(request.url,dom.window.location.href);
  assert.equal(url.pathname,'/commerce-network-api/delivery');
  assert.equal(url.searchParams.get('sessionId'),sessionId);
  assert.equal(url.searchParams.get('projectId'),projectId);
  assert.equal(url.searchParams.get('deliveryId'),artifact.id);
  assert.equal(request.options.method,'GET');assert.equal(request.options.credentials,'same-origin');
  assert.ok(request.options.signal,'delivery reads must be cancellable');
  assert.ok(download()?.disabled,'download must wait for the full body');
  return request;
}
async function respond(request,data,status=200){
  await act(async()=>{
    request.resolve(new Response(JSON.stringify(status===200?{ok:true,data}:{ok:false,error:data}),{status,headers:{'content-type':'application/json'}}));
    await new Promise(resolve=>setTimeout(resolve,0));
  });
}
async function click(target){
  assert.ok(target,'expected a visible action button');
  await act(async()=>target.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
}
try{
  const first=complete('delivery-a','<script id="delivery-script">window.deliveryRan=true</script>\n<img src=x onerror="alert(1)">\n真实交付正文\n'+'正文'.repeat(800),['https://evidence.example.test/reference','javascript:alert(1)','data:text/html,unsafe']);
  const firstRequest=await mount(metadata(first));
  assert.equal(content(),'','metadata must not be presented as delivery content');
  await click(download());assert.equal(blobs.length,0,'loading must not export an incomplete record');
  await respond(firstRequest,first);
  assert.equal(content(),first.content,'the complete body must be rendered verbatim as text');
  assert.ok(!document.querySelector('#delivery-script'));assert.ok(!document.querySelector('.cn-artifact-content img'));
  assert.equal(dom.window.deliveryRan,undefined);
  const sources=[...document.querySelectorAll('.cn-source-links a')];
  assert.equal(sources.length,1,'only safe HTTP(S) source links should be rendered');
  assert.equal(sources[0].href,first.sourceUrls[0]);assert.equal(sources[0].target,'_blank');
  assert.ok(sources[0].rel.includes('noopener'));
  assert.ok(!download().disabled);await click(download());
  assert.equal(blobs.length,1);assert.equal(downloads.length,1);assert.equal(downloads[0].name,'delivery-a.json');
  const exported=JSON.parse(await blobs[0].text());
  assert.deepEqual(exported,first,'download must retain full content, digest, sources and provenance');
  assert.equal(sha(exported.content),exported.sha256);

  const second=complete('delivery-b','Current session delivery body',['https://current-session.example.test/source']);
  const secondMeta=metadata(second);
  const oldScopeRequest=await mount(secondMeta);
  assert.ok(!content().includes(first.content),'changing the delivery must immediately hide the previous body');
  const currentScopeRequest=await mount(secondMeta,'session-two');
  assert.ok(oldScopeRequest.options.signal.aborted,'changing sessions must cancel the earlier read');
  await respond(currentScopeRequest,second);
  assert.equal(content(),second.content);
  // Same record ID and content digest can exist in separate workspaces. A late
  // read from the prior session must not replace the current source evidence.
  await respond(oldScopeRequest,{...second,sourceUrls:['https://old-session.example.test/private']});
  assert.equal(content(),second.content);
  assert.equal(document.querySelector('.cn-source-links a')?.href,second.sourceUrls[0],'a late response from another session must not replace current evidence');

  const third=complete('delivery-c','Retried delivery body',['https://evidence.example.test/retried'],'project-two');
  const failedRequest=await mount(metadata(third),'session-two');
  assert.ok(!content().includes(second.content));
  await respond(failedRequest,{code:'TEMPORARY_UNAVAILABLE',message:'Synthetic delivery temporarily unavailable'},503);
  assert.ok(document.querySelector('[role="alert"]')?.textContent,'failed reads must show an error');
  assert.ok(download().disabled,'failed reads must not export metadata or stale content');
  await click(download());assert.equal(blobs.length,1);
  const beforeRetry=requests.length;
  await click(button(/重试|重新读取|重新加载/));
  assert.equal(requests.length,beforeRetry+1,'retry must issue another authenticated delivery read');
  assert.ok(download().disabled);
  await respond(requests.at(-1),third);
  assert.equal(content(),third.content);assert.ok(!document.querySelector('[role="alert"]'));
  await click(download());assert.deepEqual(JSON.parse(await blobs.at(-1).text()),third);

  const pending=await mount(metadata(complete('delivery-d','Must never appear')),'session-three');
  await act(async()=>root.render(null));
  assert.ok(pending.options.signal.aborted,'closing the dialog must cancel its pending read');
  await respond(pending,complete('delivery-d','Must never appear'));
  assert.ok(!document.querySelector('[role="dialog"]'),'late responses must not restore a closed dialog');
  console.log(JSON.stringify({ok:true,checks:['authenticated-lazy-delivery-read','loading-and-error-download-gates','full-body-as-text','safe-source-links','complete-json-download','artifact-and-session-scope-reset','stale-response-discard','error-retry','unmount-abort']}));
}finally{
  await act(async()=>root.unmount());dom.window.close();
  if(originalCreate)Object.defineProperty(URL,'createObjectURL',originalCreate);else delete URL.createObjectURL;
  if(originalRevoke)Object.defineProperty(URL,'revokeObjectURL',originalRevoke);else delete URL.revokeObjectURL;
  for(const[key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
}
