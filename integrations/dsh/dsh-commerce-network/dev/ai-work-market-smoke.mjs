// Drives the built embedded app against a real in-memory CommerceService, so screen data and owner commands are
// checked against the actual ledger. Synthetic records only; no remote provider, payment or Worker is contacted.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
import {CommerceStore} from '../store.js';
import {createCommerceService} from '../service.js';

const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://workspace.example.test/'}),saved=new Map();
function expose(k,v){saved.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:v});}
for(const k of ['window','document','navigator','HTMLElement','Element','Event','MouseEvent'])expose(k,dom.window[k]);
expose('IS_REACT_ACT_ENVIRONMENT',true);
// React decides at load time whether the DOM supports `input` events, so it must load after the DOM globals exist.
const ReactModule=await import('react'),React=ReactModule.default,{act}=ReactModule;
const {createRoot}=await import('react-dom/client');

const workspaceId=randomUUID(),sessionId='session-market',opens=[],commands=[];
const registry={list:()=>[{id:workspaceId,sessionIds:[sessionId]}],get:id=>id===workspaceId?{id,sessionIds:[sessionId]}:undefined};
const service=createCommerceService({store:new CommerceStore(':memory:'),registry});
const execution=()=>({agent:{session:{id:sessionId}},callId:`call_${randomUUID()}`,signal:new AbortController().signal});
let projectId=null;
const owner=(command,payload,extra={})=>service.command(sessionId,{projectId,requestId:randomUUID(),expectedRevision:service.state(sessionId,projectId||undefined).revision,command,payload,...extra});
const tool=(command,payload)=>service.toolCommand({projectId,requestId:randomUUID(),expectedRevision:service.state(sessionId,projectId||undefined).revision,command,payload},execution());
const ledger=()=>service.state(sessionId,projectId||undefined).commerceNetwork;

expose('fetch',async(url,options)=>{
  try{
    const target=new URL(url,'https://workspace.example.test/');let data;
    if(options?.method==='POST'){const {sessionId:session,...input}=JSON.parse(options.body);commands.push(input);data=await service.command(session,input);}
    else data=service.state(sessionId,target.searchParams.get('projectId')||undefined);
    return new Response(JSON.stringify({ok:true,data}),{status:200,headers:{'content-type':'application/json'}});
  }catch(error){return new Response(JSON.stringify({ok:false,error:{code:error.code,message:error.message}}),{status:error.status||500});}
});

let exports;const require=createRequire(import.meta.url);
dom.window.__ModuleLoader__={load:r=>{exports=r.factory(require);}};
new Function('window',await readFile(new URL('../client.js',import.meta.url),'utf8'))(dom.window);
const slots=[],disposers=[];
const source={getSnapshot:()=>({revision:0,entries:[],change:{kind:'replace'}}),subscribe:()=>()=>{}};
const binding={sessionId,eventSource:source,session:{prompt:async()=>({ok:true,value:{accepted:true}})}};
const ctx={effect:fn=>{const result=fn();if(typeof result==='function')disposers.push(result);},locale:{register:()=>()=>{},bind:()=>key=>key},sidebarRightTabs:{register:()=>()=>{}},sidebarRight:{mounted:{getSnapshot:()=>sessionId},openTab:kind=>opens.push(kind)},sessions:{binding:()=>binding,retain:()=>({ready:Promise.resolve(binding),release(){}})},slots:{inject:(_name,fn)=>fn(),register:(definition,component)=>{slots.push({definition,component});return()=>{};}}};
exports.apply(ctx);
const slot=slots.find(s=>s.definition.key==='dsh-commerce-network/ai-work');assert.ok(slot);
const controller=new AbortController();let refresh;
const props={sessionId,...slot.definition.inject(sessionId),useTabInfo:()=>({tab:{visible:true,signal:controller.signal,actions:{bindCommands:c=>{refresh=c.refresh;return()=>{};}}}})};
const root=createRoot(document.getElementById('app'));

const wait=ms=>act(async()=>{await new Promise(r=>setTimeout(r,ms));});
const click=el=>{assert.ok(el,'element to click exists');return act(async()=>{el.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));await new Promise(r=>setTimeout(r,20));});};
const type=(el,value)=>{assert.ok(el,'field to type into exists');const proto=el instanceof dom.window.HTMLTextAreaElement?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;return act(async()=>{Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});};
const find=(selector,text)=>[...document.querySelectorAll(selector)].find(el=>el.textContent.includes(text));
const tab=label=>[...document.querySelectorAll('.aw-tabbar button')].find(b=>b.textContent===label);
const sheet=()=>document.querySelector('.aw-sheet');
const fieldByLabel=label=>{const l=[...document.querySelectorAll('.aw-field label')].find(el=>el.textContent===label);assert.ok(l,`field ${label}`);return document.getElementById(l.getAttribute('for'));};
const checkByLabel=label=>[...document.querySelectorAll('.aw-check')].find(el=>el.querySelector('strong')?.textContent===label)?.querySelector('input');
const back=()=>click(document.querySelector('button[aria-label="返回"]'));

try{
  await tool('apply_plan',{title:'TEST project',goal:'Synthetic market smoke',parties:[{id:'factory_t',type:'factory',displayName:'TEST Factory'}],products:[{id:'prod_t',name:'TEST product',description:'synthetic',source:'test-only'}]});
  projectId=service.state(sessionId).projectId;

  await act(async()=>{root.render(React.createElement(slot.component,props));await new Promise(r=>setTimeout(r,40));});
  assert.deepEqual([...document.querySelectorAll('.aw-tabbar button')].map(b=>b.textContent),['今天','招募','任务','Worker']);

  // Recruiting: built-in Workers come from the ledger, searchable and filterable.
  await click(tab('招募'));
  assert.equal(document.querySelectorAll('.aw-badge-row').length,3);
  assert.match(document.body.textContent,/跨工作区的公开市场尚未接入/);
  await type(document.querySelector('.aw-search input'),'询盘');
  assert.equal(document.querySelectorAll('.aw-badge-row').length,1);
  assert.match(document.querySelector('.aw-badge-row').textContent,/询盘汇总员/);
  await type(document.querySelector('.aw-search input'),'不存在的关键词');
  assert.match(document.querySelector('.aw-empty').textContent,/没有匹配的 Worker/);
  await type(document.querySelector('.aw-search input'),'');
  await click(find('.aw-cats button','外联文案'));
  assert.equal(document.querySelectorAll('.aw-badge-row').length,1);
  await click(find('.aw-cats button','全部'));

  // Detail: honest about maintainer, price and evidence.
  await click(find('.aw-badge-row','询盘汇总员'));
  assert.equal(document.querySelector('.aw-badge-body h2').textContent,'询盘汇总员');
  assert.match(document.querySelector('.aw-sign').textContent,/DSH 内置/);
  assert.match(document.querySelector('.aw-price').textContent,/免费/);assert.match(document.querySelector('.aw-price').textContent,/尚未接入支付与托管/);
  assert.match(document.querySelector('.aw-evidence').textContent,/样本不足/);
  assert.equal(document.querySelectorAll('.aw-starter').length,2);
  assert.equal(document.querySelectorAll('.aw-primary').length,1);
  assert.equal(commands.length,0,'browsing never writes');

  // Hire through a starter task: one atomic owner command.
  await click(find('.aw-starter','本周询盘汇总'));
  assert.ok(sheet()&&sheet().getAttribute('role')==='dialog'&&sheet().getAttribute('aria-modal')==='true');
  assert.equal(document.activeElement,sheet(),'focus moves into the sheet');
  await click(sheet().querySelector('input[name="aw-runtime"][value="muse"]'));
  assert.equal(find('.aw-pick','Muse Agent').dataset.on,'true');
  assert.ok(document.getElementById('aw-requester'),'a requester is required for the starter task');
  assert.match(sheet().textContent,/看不到你的项目数据/);
  await click(find('.aw-sheet .aw-primary','确认招募'));
  const hire=commands.at(-1);
  assert.equal(hire.command,'hire_worker');
  assert.deepEqual({runtime:hire.payload.runtime,starterId:hire.payload.starterId,requesterPartyId:hire.payload.requesterPartyId,skills:[...hire.payload.grantedSkills].sort()},{runtime:'muse',starterId:'starter_rfq_week',requesterPartyId:'factory_t',skills:['classify_opted_in_replies','summarize_rfq']});
  assert.match(sheet().textContent,/已招募/);assert.match(sheet().textContent,/签发专用凭证/);
  assert.equal(ledger().agentServices.length,1);assert.equal(ledger().workOrders[0].status,'proposed');
  await click(find('.aw-sheet .aw-primary','打开协作画布'));
  assert.equal(opens.at(-1),'commerce-network');assert.equal(sheet(),null,'the sheet closes after handing off to the canvas');
  assert.match(document.querySelector('.aw-sticky').textContent,/查看已招募的 Worker/);
  await click(find('.aw-starter','本周询盘汇总'));
  assert.match(sheet().querySelector('h2').textContent,/起草任务/,'a hired Worker offers starter tasks as plain drafts');
  await click(sheet().querySelector('button[aria-label="关闭"]'));assert.equal(sheet(),null);

  // The hired Worker shows what it is pinned to.
  await click(tab('Worker'));
  assert.equal(document.querySelectorAll('.aw-badge-row').length,1);
  assert.match(document.querySelector('.aw-badge-row').textContent,/v1/);
  await click(document.querySelector('.aw-badge-row'));
  assert.match(document.querySelector('.aw-kv-card').textContent,/询盘汇总员/);assert.match(document.querySelector('.aw-kv-card').textContent,/v1/);assert.match(document.querySelector('.aw-kv-card').textContent,/未接入支付/);
  assert.equal(document.querySelectorAll('.aw-primary').length,1,'one primary action on a Worker page');
  await back();

  // Maintainer studio: draft, save, trial, publish gate.
  await click(find('.aw-seat','维护者工作台'));
  assert.match(document.querySelector('.aw-empty').textContent,/还没有自己的 Worker/);
  await click(find('.aw-sticky .aw-primary','新建 Worker'));
  assert.equal(document.querySelector('.aw-heading h1').textContent,'新建 Worker');
  assert.equal(find('.aw-sticky .aw-primary','创建草稿').disabled,true,'a name is required');
  await type(fieldByLabel('名称'),'TEST 调研员');
  await type(fieldByLabel('一句话介绍'),'TEST 一句话');
  await type(fieldByLabel('分类'),'TEST 分类');
  await type(fieldByLabel('维护者署名'),'TEST 维护者');
  await type(fieldByLabel('写给 Agent 的岗位说明'),'只用公开资料，逐条附来源，不联系任何人。');
  await click(checkByLabel('公开网页调研'));
  await click(find('button.aw-add','添加预置任务'));
  await type(fieldByLabel('标题'),'TEST 速览');
  await type(fieldByLabel('任务说明'),'调研目标市场并附来源。');
  assert.equal(document.querySelector('.aw-starter-edit .aw-chip input').checked,true,'a new starter task starts with the first selected skill');
  await click(find('.aw-sticky .aw-primary','创建草稿'));
  const created=commands.at(-1);
  assert.equal(created.command,'upsert_worker_template');assert.equal(created.payload.id,undefined);assert.deepEqual(created.payload.skills,['public_web_research']);
  assert.equal(created.payload.starters[0].id,undefined,'new starter ids are minted by the ledger');
  const mine=ledger().workerTemplates.find(t=>!t.builtin);
  assert.equal(mine.status,'draft');assert.equal(document.querySelector('.aw-heading h1').textContent,'编辑 Worker','the editor now points at the saved template');
  assert.equal(mine.draft.starters[0].id.startsWith('starter_'),true);
  assert.match(document.body.textContent,/还没有被验收的真实任务/);
  assert.equal(find('.aw-actions .aw-primary','发布 v1').disabled,true,'the first publish needs an accepted real task');
  assert.equal(find('.aw-sticky .aw-primary','保存草稿').disabled,true,'a clean draft has nothing to save');

  await click(find('.aw-actions .aw-secondary','试运行'));
  assert.match(sheet().querySelector('h2').textContent,/试运行/);
  await click(find('.aw-sheet .aw-primary','开始试运行'));
  assert.equal(commands.at(-1).payload.trial,true);
  await click(find('.aw-sheet .aw-secondary','查看这个 Worker'));
  assert.equal(document.querySelector('.aw-heading h1').textContent,'TEST 调研员');
  assert.match(document.querySelector('.aw-kv-card').textContent,/试运行草稿/);

  // A real accepted task (driven through the ledger) unlocks publishing.
  const trial=ledger().agentServices.find(a=>a.workerTemplate?.trial);
  const credential=await owner('issue_agent_credential',{agentServiceId:trial.id});
  const token=credential.credential.token;
  await service.worker(token,'connect',{requestId:randomUUID()});
  await owner('propose_order',{requesterPartyId:'factory_t',agentServiceId:trial.id,title:'TEST trial task',brief:'Synthetic trial.',allowedActions:['public_web_research'],allowedResourceRefs:[],maximumMinor:0});
  const orderId=ledger().workOrders.find(o=>o.status==='proposed'&&o.agentServiceId===trial.id).id;
  const preview=await service.review(sessionId,projectId,orderId);
  await owner('approve_order',{orderId,reviewDigest:preview.reviewDigest},{expectedRevision:preview.networkRevision});
  await tool('dispatch_order',{orderId});
  const claimed=await service.worker(token,'claim',{requestId:randomUUID(),orderId});
  assert.equal(claimed.order.workerPackage.instructions,'只用公开资料，逐条附来源，不联系任何人。');
  await service.worker(token,'heartbeat',{requestId:randomUUID(),orderId,leaseId:claimed.order.leaseId});
  await service.worker(token,'deliver',{requestId:randomUUID(),orderId,leaseId:claimed.order.leaseId,title:'Delivery',content:'Synthetic delivery.',actualMinor:0,sourceUrls:[]});
  await owner('accept_delivery',{orderId});

  await back();
  assert.equal(document.querySelector('.aw-heading h1').textContent,'编辑 Worker');
  await act(async()=>{refresh();await new Promise(r=>setTimeout(r,25));});
  assert.match(document.body.textContent,/已有 1 个被验收的真实任务/);
  const publish=find('.aw-actions .aw-primary','发布 v1');assert.equal(publish.disabled,false);
  await click(publish);
  assert.equal(find('.aw-sheet .aw-primary','发布 v1').disabled,true,'a changelog is required');
  await type(sheet().querySelector('textarea'),'TEST 首发');
  await click(find('.aw-sheet .aw-primary','发布 v1'));
  assert.equal(commands.at(-1).command,'publish_worker_template');assert.equal(commands.at(-1).payload.changelog,'TEST 首发');
  assert.match(sheet().textContent,/已招募的 Worker 仍固定在原版本/);
  await click(find('.aw-sheet .aw-primary','完成'));
  assert.equal(ledger().workerTemplates.find(t=>!t.builtin).published.version,1);

  // A newer version is offered, never applied. Scope stays what the owner already granted.
  await owner('upsert_worker_template',{...ledger().workerTemplates.find(t=>!t.builtin).draft,id:mine.id,tagline:'TEST 新一句话'});
  await owner('publish_worker_template',{templateId:mine.id,changelog:'TEST 小改'});
  await act(async()=>{refresh();await new Promise(r=>setTimeout(r,25));});
  await click(tab('招募'));
  assert.equal(document.querySelectorAll('.aw-badge-row').length,4,'a published maintainer Worker is listed beside the built-ins');
  await click(find('.aw-badge-row','TEST 调研员'));
  assert.match(document.querySelector('.aw-offer').textContent,/你的项目里有新版本/);
  await click(find('.aw-offer .aw-secondary','查看并升级'));
  assert.match(sheet().querySelector('h2').textContent,/升级到 v2/);
  assert.equal(checkByLabel('公开网页调研').checked,true,'what was already granted stays granted');
  await click(find('.aw-sheet .aw-primary','升级到 v2'));
  const upgrade=commands.at(-1);
  assert.deepEqual({command:upgrade.command,version:upgrade.payload.version,skills:upgrade.payload.grantedSkills,price:upgrade.payload.acceptPricing},{command:'upgrade_worker_hire',version:2,skills:['public_web_research'],price:undefined});
  await click(find('.aw-sheet .aw-primary','完成'));
  assert.equal(ledger().agentServices.find(a=>a.id===trial.id).workerTemplate.version,2);
  assert.equal(document.querySelector('.aw-offer'),null);

  // Pausing and retiring ask first and explain the consequence.
  await back();await click(tab('Worker'));
  await click(find('.aw-seat','维护者工作台'));
  await click(find('.aw-badge-row','TEST 调研员'));
  await click(find('.aw-actions .aw-secondary','暂停接单'));
  assert.match(sheet().textContent,/已招募的继续可用/);
  const before=commands.length;
  await click(sheet().querySelector('button[aria-label="关闭"]'));assert.equal(commands.length,before,'closing the confirmation changes nothing');
  await click(find('.aw-actions .aw-secondary','暂停接单'));
  await click(find('.aw-sheet .aw-primary','确认暂停接单'));
  assert.equal(ledger().workerTemplates.find(t=>!t.builtin).status,'paused');
  assert.equal(find('.aw-actions .aw-secondary','下架')!=null,true);

  console.log(JSON.stringify({ok:true,checks:['four-tab-navigation','builtin-catalog','search-and-category','honest-price-and-evidence','hire-with-starter-command','sheet-focus-and-dialog','hired-pin-shown','studio-create-and-save','trial-hire','publish-gate-and-changelog','version-offer-without-implicit-scope','confirm-before-pause','no-writes-while-browsing']}));
}finally{await act(async()=>root.unmount());controller.abort();for(const dispose of disposers.reverse())dispose();service.close();dom.window.close();for(const[k,d]of saved){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}
