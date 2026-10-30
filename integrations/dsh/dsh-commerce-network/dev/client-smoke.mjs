// Native factory/DOM contract smoke. Explicit synthetic HTTP fixtures only;
// this does not establish a live DSH model or external Worker acceptance.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';

const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://workspace.example.test/'});
const saved=new Map();
function expose(key,value){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
for(const key of ['window','document','navigator','HTMLElement','Element','MutationObserver','Event','MouseEvent'])expose(key,dom.window[key]);
expose('getComputedStyle',dom.window.getComputedStyle.bind(dom.window));
// jsdom has no browser layout engine. Supply dimensions only; retain the real
// bundled React Flow and its rendering/hooks so nonempty-path failures surface.
const dimensions=element=>element.classList?.contains('cn-node')?{width:270,height:185}:{width:1000,height:680};
Object.defineProperty(dom.window.HTMLElement.prototype,'offsetWidth',{configurable:true,get(){return dimensions(this).width;}});
Object.defineProperty(dom.window.HTMLElement.prototype,'offsetHeight',{configurable:true,get(){return dimensions(this).height;}});
dom.window.HTMLElement.prototype.getBoundingClientRect=function(){const size=dimensions(this);return {x:0,y:0,top:0,left:0,right:size.width,bottom:size.height,...size};};
dom.window.SVGElement.prototype.getBBox=function(){return {x:0,y:0,width:(this.textContent?.length||1)*7,height:14};};
class TestResizeObserver {constructor(callback){this.callback=callback;this.active=true;}observe(target){queueMicrotask(()=>{if(this.active&&target.isConnected)this.callback([{target,contentRect:target.getBoundingClientRect()}]);});}unobserve(){}disconnect(){this.active=false;}}
class TestDOMMatrix {constructor(){this.m11=1;this.m22=1;}}
expose('ResizeObserver',TestResizeObserver);expose('DOMMatrixReadOnly',TestDOMMatrix);dom.window.ResizeObserver=TestResizeObserver;dom.window.DOMMatrixReadOnly=TestDOMMatrix;
expose('IS_REACT_ACT_ENVIRONMENT',true);
expose('requestAnimationFrame',callback=>setTimeout(callback,0));
expose('cancelAnimationFrame',clearTimeout);
const requests=[];
const empty={workspaceId:'test-workspace',revision:0,projectId:null,projects:[],events:[],canvasLayouts:[],commerceNetwork:{parties:[],agentServices:[],workOrders:[],salesAuthorizations:[]}};
const deliveryContent='TEST ONLY: complete synthetic research delivery.\nThis body is fetched only after opening its saved delivery record.';
const deliveryMeta={id:'d1',projectId:'p1',orderId:'o1',title:'TEST ONLY research delivery',createdAt:'2026-10-28T00:00:00.000Z',sha256:createHash('sha256').update(deliveryContent).digest('hex'),contentBytes:Buffer.byteLength(deliveryContent)};
const completeDelivery={...deliveryMeta,content:deliveryContent,sourceUrls:['https://sources.example.test/synthetic-research']};
let fixture=empty;
const requestUrl=request=>new URL(request.url,dom.window.location.href);
const deliveryRequests=()=>requests.filter(request=>requestUrl(request).pathname==='/commerce-network-api/delivery');
expose('fetch',async(url,options)=>{
  const request={url,options};requests.push(request);
  const path=requestUrl(request).pathname;
  assert.ok(['/commerce-network-api/workspace','/commerce-network-api/delivery','/commerce-network-api/trade'].includes(path),`unexpected synthetic API path: ${path}`);
  const data=path==='/commerce-network-api/trade'?{contractVersion:'commerce-trade-v1',projectId:fixture.projectId,workspaceId:fixture.workspaceId,rfqs:[],buyers:[],quotes:[],orders:[],samples:[]}:path==='/commerce-network-api/delivery'?completeDelivery:fixture;
  return new Response(JSON.stringify({ok:true,data}),{status:200,headers:{'content-type':'application/json'}});
});
const require=createRequire(import.meta.url);let exports;
dom.window.__ModuleLoader__={load:registration=>{assert.equal(registration.id,'dsh-commerce-network');exports=registration.factory(require);}};
new Function('window',await readFile(new URL('../client.js',import.meta.url),'utf8'))(dom.window);
const slots=[],disposers=[],prompts=[],opens=[];const source={getSnapshot:()=>({revision:0,entries:[],change:{kind:'replace'}}),subscribe:()=>()=>{}};
const sessionId='session-61c8013e-110a-431c-b214-8c7fe715a4f8';
const binding={sessionId,eventSource:source,session:{prompt:async(messages,mode,signal,requestId)=>{prompts.push({messages,mode,requestId});return {ok:true,value:{accepted:true}};}}};
const ctx={effect:register=>{const disposer=register();if(typeof disposer==='function')disposers.push(disposer);},locale:{register:()=>()=>{},bind:()=>()=> '商业网络'},sidebarRightTabs:{register:definition=>{assert.ok(['dsh-commerce-network/canvas','dsh-commerce-network/ai-work'].includes(definition.id));return()=>{};}},sidebarRight:{mounted:{getSnapshot:()=>sessionId},openTab:kind=>opens.push(kind)},sessions:{binding:()=>binding,retain:()=>({ready:Promise.resolve(binding),release(){}})},slots:{inject:(_name,register)=>register(),register:(definition,component)=>{slots.push({definition,component});return()=>{};}}};
exports.apply(ctx);
assert.equal(slots.some(s=>s.definition.name==='main'),false,'must not replace the native conversation');
const slot=slots.find(s=>s.definition.name==='sidebar.right.pane.tab');
assert.equal(slot.definition.key,'dsh-commerce-network/canvas');
const abort=new AbortController();let refresh;
const props={sessionId,...slot.definition.inject(sessionId),useTabInfo:()=>({tab:{visible:true,signal:abort.signal,actions:{bindCommands:commands=>{refresh=commands.refresh;return()=>{};}}}})};
const root=createRoot(document.getElementById('app'));
try{
  await act(async()=>{root.render(React.createElement(slot.component,props));await new Promise(resolve=>setTimeout(resolve,15));});
  assert.ok(document.querySelector('.cv-onboarding'),'an empty workspace shows the dismissible onboarding card on the grid');
  assert.ok(document.querySelector('.cn-flow'),'the empty canvas is still a real pannable surface');
  assert.equal(document.querySelectorAll('.cn-node').length,0,'empty workspace must not show fabricated operational nodes');
  assert.ok(requests[0].url.includes(`sessionId=${sessionId}`));
  assert.equal(requests[0].options.credentials,'same-origin');
  const start=[...document.querySelectorAll('button')].find(button=>button.textContent.includes('从产品资料开始'));
  await act(async()=>{start.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,5));});
  assert.equal(prompts.length,1);assert.equal(prompts[0].mode,'queue');assert.match(prompts[0].messages[0].text,/commerce_network_plan/);
  assert.ok([...document.querySelectorAll('.cv-banner')].some(banner=>banner.textContent.includes('已交给当前 Assistant')));
  assert.equal(document.querySelectorAll('.cn-node').length,0,'native prompt admission must not fabricate a completed canvas');
  await act(async()=>{refresh();await new Promise(resolve=>setTimeout(resolve,5));});
  assert.ok(requests.length>=2);
  fixture={
    ...empty,revision:1,projectId:'p1',projects:[{id:'p1',name:'TEST ONLY network'},{id:'p2',name:'TEST ONLY second project'}],products:[],routes:[],
    canvasLayouts:[{projectId:'p1',revision:1,nodes:[],viewport:{x:0,y:0,zoom:1}}],deliverables:[deliveryMeta],
    commerceNetwork:{projectId:'p1',revision:1,layoutWriteSupported:true,layoutContractVersion:'commerce-layout-v1',
      parties:[{id:'f1',projectId:'p1',type:'factory',displayName:'TEST factory'},{id:'pvd',projectId:'p1',type:'provider',displayName:'TEST provider'}],
      agentServices:[{id:'a1',projectId:'p1',providerPartyId:'pvd',displayName:'TEST worker',skills:['public_web_research'],protocol:'pull_gateway',status:'connected',endpointVerificationReceiptId:'endpoint-test',endpointVerifiedAt:'2026-10-28T00:00:00.000Z'}],
      workOrders:[{id:'o1',projectId:'p1',requesterPartyId:'f1',agentServiceId:'a1',title:'TEST research order',status:'delivered',allowedActions:['public_web_research'],allowedResourceRefs:[],maximumMinor:0,currency:'USD',
        approvalReceiptId:'approval-test',grantId:'grant-test',budgetReservationId:'budget-test',dshTaskRef:'native-task-test',claimReceiptId:'claim-test',leaseId:'lease-test',heartbeatReceiptId:'heartbeat-test',deliveryReceiptId:'delivery-receipt-test',deliverableId:deliveryMeta.id}],
      salesAuthorizations:[]},
  };
  await act(async()=>{refresh();await new Promise(resolve=>setTimeout(resolve,20));});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
  assert.equal(document.querySelectorAll('.cn-node').length,3,'nonempty native graph must render actual React Flow node components');
  assert.ok(document.querySelector('.cn-flow'),'a rendering failure must not be hidden by the error boundary');
  assert.ok(document.querySelector('.cn-node').textContent.includes('TEST'));
  assert.equal(document.querySelectorAll('.react-flow__edge').length,2,'actual delegated work relation edges must mount');
  assert.equal(deliveryRequests().length,0,'rendering a canvas must not eagerly fetch delivery bodies');
  assert.equal(document.body.textContent.includes(deliveryContent),false,'workspace projection carries delivery metadata only');
  assert.equal(Object.hasOwn(fixture.deliverables[0],'content'),false);
  assert.equal(Object.hasOwn(fixture.deliverables[0],'sourceUrls'),false);

  const orderNode=document.querySelector('.react-flow__node[data-id="service_order:o1"]');
  assert.ok(orderNode,'the saved work order must be an actual React Flow node');
  await act(async()=>{orderNode.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,5));});
  const inspector=document.querySelector('.cn-inspector');
  assert.ok(inspector?.textContent.includes('交付已到，等待验收'),'valid delivered receipts must expose the delivery inspection path');
  assert.equal([...inspector.querySelectorAll('button')].some(button=>button.textContent.includes('取消这项委托')),false,'delivered work orders must not offer an invalid cancellation');
  const artifactButton=inspector.querySelector('button.cn-artifact');
  assert.ok(artifactButton?.textContent.includes(deliveryMeta.title));
  assert.equal(deliveryRequests().length,0,'selecting a work order must still not fetch its delivery body');
  await act(async()=>{artifactButton.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,10));});
  assert.equal(deliveryRequests().length,1,'opening a delivery must issue exactly one scoped detail request');
  const detailRequest=deliveryRequests()[0],detailUrl=requestUrl(detailRequest);
  assert.deepEqual(Object.fromEntries(detailUrl.searchParams),{sessionId,projectId:'p1',deliveryId:deliveryMeta.id},'the actual canvas must pass the native session, selected project and delivery to its dialog');
  assert.equal(detailRequest.options.method,'GET');
  assert.equal(detailRequest.options.credentials,'same-origin');
  const artifactDialog=document.querySelector('[role="dialog"]');
  assert.equal(artifactDialog?.querySelector('.cn-artifact-content')?.textContent,deliveryContent,'the dialog must render the separately fetched full content');
  assert.equal(artifactDialog.querySelector('.cn-source-links a')?.href,completeDelivery.sourceUrls[0]);
  assert.equal([...artifactDialog.querySelectorAll('button')].find(button=>button.textContent.includes('下载交付记录'))?.disabled,false,'download becomes available only for the fetched full record');

  // Switching the real project selector must clear the previous project's body.
  fixture={...empty,revision:2,projectId:'p2',projects:fixture.projects,deliverables:[]};
  const projectSelect=document.querySelector('.cn-project-select select');
  await act(async()=>{projectSelect.value='p2';projectSelect.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,10));});
  assert.equal(document.querySelector('[role="dialog"]'),null,'changing projects must close the previous delivery dialog');
  assert.equal(document.body.textContent.includes(deliveryContent),false,'the previous project delivery must not remain visible');
  assert.equal(requestUrl(requests.at(-1)).searchParams.get('projectId'),'p2');
  assert.equal(deliveryRequests().length,1,'project switching must not fetch a previous project delivery');
  console.log(JSON.stringify({ok:true,checks:['native-right-sidebar-contract','host-react-factory','authenticated-session-read','honest-empty-state','native-prompt-admission-only','native-refresh-binding','nonempty-react-flow-node-render','actual-relation-edge-render','metadata-only-canvas-deliveries','delivered-order-decisions','scoped-delivery-detail-dialog','project-switch-clears-delivery']}));
}finally{
  await act(async()=>root.unmount());abort.abort();for(const dispose of disposers.reverse())dispose();dom.window.close();
  for(const[key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
}
