// Synthetic DOM fixtures; no remote provider or real business records are created.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://workspace.example.test/'}),saved=new Map();
function expose(k,v){saved.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:v});}
for(const k of ['window','document','navigator','HTMLElement','Element','Event','MouseEvent'])expose(k,dom.window[k]);
expose('IS_REACT_ACT_ENVIRONMENT',true);
const sessionId='session-test',prompts=[],opens=[],requests=[];
let fixture={workspaceId:'test-workspace',projectId:null,revision:0,projects:[],commerceNetwork:{agentServices:[],workOrders:[]}}, fail=false;
expose('fetch',async(url,options)=>{requests.push({url,options});if(fail)return new Response(JSON.stringify({ok:false,error:{message:'TEST read failed'}}),{status:503});return new Response(JSON.stringify({ok:true,data:fixture}),{status:200,headers:{'content-type':'application/json'}});});
let exports;const require=createRequire(import.meta.url);
dom.window.__ModuleLoader__={load:r=>{exports=r.factory(require);}};
new Function('window',await readFile(new URL('../client.js',import.meta.url),'utf8'))(dom.window);
const slots=[],disposers=[];
const source={getSnapshot:()=>({revision:0,entries:[],change:{kind:'replace'}}),subscribe:()=>()=>{}};
const binding={sessionId,eventSource:source,session:{prompt:async(messages)=>{prompts.push(messages[0].text);return {ok:true,value:{accepted:true}};}}};
const ctx={effect:fn=>{const result=fn();if(typeof result==='function')disposers.push(result);},locale:{register:()=>()=>{},bind:()=>key=>key},sidebarRightTabs:{register:()=>()=>{}},sidebarRight:{mounted:{getSnapshot:()=>sessionId},openTab:kind=>opens.push(kind)},sessions:{binding:()=>binding,retain:()=>({ready:Promise.resolve(binding),release(){}})},slots:{inject:(_name,fn)=>fn(),register:(definition,component)=>{slots.push({definition,component});return()=>{};}}};
exports.apply(ctx);
const slot=slots.find(s=>s.definition.key==='dsh-commerce-network/ai-work');assert.ok(slot);
const controller=new AbortController();let refresh;
const props={sessionId,...slot.definition.inject(sessionId),useTabInfo:()=>({tab:{visible:true,signal:controller.signal,actions:{bindCommands:c=>{refresh=c.refresh;return()=>{};}}}})};
const root=createRoot(document.getElementById('app'));
try{
  await act(async()=>{root.render(React.createElement(slot.component,props));await new Promise(r=>setTimeout(r,25));});
  assert.ok(document.querySelector('.aw-root'));assert.equal(document.querySelectorAll('.aw-provider').length,2);
  assert.equal(document.querySelectorAll('.aw-badge-verified').length,0);assert.match(document.body.textContent,/尚未创建项目/);assert.match(document.body.textContent,/你的工作，从这里开始/);
  const start=[...document.querySelectorAll('.aw-card-action')].find(x=>x.closest('.aw-grokbot'));
  await act(async()=>{start.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));await new Promise(r=>setTimeout(r,5));});
  assert.match(prompts[0],/providerType grokbot/);assert.match(document.body.textContent,/已交给当前 Assistant/);
  fixture={workspaceId:'test-workspace',revision:3,projectId:'p1',projects:[{id:'p1',name:'TEST project'},{id:'p2',name:'TEST second'}],commerceNetwork:{agentServices:[{id:'a1',providerType:'grokbot',displayName:'TEST Grok',status:'connected',lastSeenAt:'2026-10-30T00:00:00Z'},{id:'a2',displayName:'Muse Agent',status:'connected'}],workOrders:[{id:'o1',agentServiceId:'a1',title:'TEST real task',status:'running',workerProgress:'TEST progress',updatedAt:'2026-10-30T00:00:00Z'}]}};
  await act(async()=>{refresh();await new Promise(r=>setTimeout(r,15));});
  assert.equal(document.querySelector('.aw-grokbot .aw-badge').textContent,'网关已认证');assert.equal(document.querySelector('.aw-muse .aw-badge').textContent,'尚未接入');
  assert.match(document.body.textContent,/TEST real task/);assert.match(document.body.textContent,/TEST progress/);assert.match(document.body.textContent,/另有 1 个其他已登记 Worker/);
  fixture.commerceNetwork.workOrders[0].grokHandoff={state:'unknown'};
  await act(async()=>{refresh();await new Promise(r=>setTimeout(r,10));});
  assert.match(document.querySelector('.aw-task-status').textContent,/派送结果待核对/);
  await act(async()=>{document.querySelector('.aw-task').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));});assert.equal(opens.at(-1),'commerce-network');
  fixture={workspaceId:'test-workspace',revision:3,projectId:'p2',projects:fixture.projects,commerceNetwork:{agentServices:[],workOrders:[]}};
  await act(async()=>{const select=document.querySelector('.aw-project select');select.value='p2';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,15));});
  assert.equal(document.body.textContent.includes('TEST real task'),false);assert.equal(new URL(requests.at(-1).url,dom.window.location.href).searchParams.get('projectId'),'p2');
  fail=true;await act(async()=>{refresh();await new Promise(r=>setTimeout(r,10));});assert.match(document.querySelector('[role="alert"]').textContent,/TEST read failed/);
  console.log(JSON.stringify({ok:true,checks:['native-ai-work-tab','honest-empty-providers','native-session-configuration','explicit-provider-identity','real-task-progress','canvas-navigation','project-isolation','read-error']}));
}finally{await act(async()=>root.unmount());controller.abort();for(const dispose of disposers.reverse())dispose();dom.window.close();for(const[k,d]of saved){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}
