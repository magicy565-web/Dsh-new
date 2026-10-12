// Preflight only: actual compiled Component and original WXML/WXSS, actual
// backend preview core. No service HTTP/Pi/Shopify/device acceptance claim.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { chromium } from 'playwright';
import { normalizeSupplierProfile, supplierListingPreview } from '../../server/supplier-profile.mjs';
import { installSourceRenderer } from './source-renderer.mjs';
import { until } from './support.mjs';
const output = new URL('../evidence/supplier/preflight/', import.meta.url); await fs.mkdir(output, {recursive:true});
const profile=normalizeSupplierProfile({name:'轻棉日常 T 恤（本地业务 fixture）',description:'用户明确提供：棉质，日常穿着，圆领短袖。',targetMarket:'US',currency:'USD',skuCode:'SUPPLIER-FIXTURE-TEE',supplierUnit:'件',supplierMoq:300,wholesaleUnitPrice:'3.20',wholesaleCurrency:'USD',recommendedRetailPrice:'18.00',productionDays:15,retailUnit:'件',unitsPerPack:1,consumerPrice:'12.30',handlingDays:2,shippingDays:7,images:[{kind:'public_url',url:'https://example.com/tee.jpg',sourceNote:'供应商给出的公开图片地址，尚未授权观察可用性'}]});
function component(name) {
 const file=new URL(`../../release/miniprogram/components/${name}/index.js`,import.meta.url);let options;
 return fs.readFile(file,'utf8').then(code=>{vm.runInNewContext(code,{exports:{},require:createRequire(file),Component(value){options=value;},WeakMap,JSON,Number,Error});
 const events=[],value={data:{...options.data,busy:false,uncertain:false,serverError:''},setData(update){Object.assign(this.data,structuredClone(update));},triggerEvent(name,data){events.push({name,data:structuredClone(data??null)});}};
 Object.assign(value,options.methods);return{value,events,load(property,raw){options.properties[property].observer.call(value,raw);}};});
}
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']}),ui=await browser.newPage({viewport:{width:390,height:844}}),errors=[];ui.on('pageerror',error=>errors.push(error.message));
let active,interactions=0;const render=()=>ui.evaluate(state=>window.renderSource(state),active.value.data);
await ui.exposeFunction('pageEvent',async(handler,dataset,value)=>{await active.value[handler]({currentTarget:{dataset},detail:{value}});await render();interactions++;});
const shared=(await Promise.all(['../src/app.wxss','../src/pages/conversation/index.wxss'].map(name=>fs.readFile(new URL(name,import.meta.url),'utf8')))).join('\n');
async function install(name) {
 active=await component(name);await ui.setContent('<!doctype html><html lang="zh"><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><header>小程序组件 Chromium 模拟 · 原预览核心 · 非微信/HTTP闭环</header><main></main></body></html>');
 const wxml=await fs.readFile(new URL(`../src/components/${name}/index.wxml`,import.meta.url),'utf8'),css=shared+'\n'+await fs.readFile(new URL(`../src/components/${name}/index.wxss`,import.meta.url),'utf8');await installSourceRenderer(ui,{wxml:'<view class="conversation">'+wxml+'</view>',css,spirit:''});
}
try {
 await install('supplier-listing-preview');active.load('preview',supplierListingPreview(profile,['name','description','skuCode','retailUnit','unitsPerPack','consumerPrice','handlingDays','shippingDays','images']));await render();
 assert.match(await ui.locator('main').innerText(),/12.30 USD/);assert.match(await ui.locator('main').innerText(),/尚未创建或发布/);assert.match(await ui.locator('main').innerText(),/图片可用性尚未核验/);assert.ok(!(await ui.locator('main').innerText()).includes('3.20'));
 await ui.screenshot({path:new URL('server-core-preview-390.png',output).pathname});
 await install('supplier-public-review');active.load('scope',{id:'preflight-component-target-only',revision:1,profile});await render();assert.equal(await ui.locator('input:checked').count(),0);await ui.screenshot({path:new URL('unselected-exact-scope-390.png',output).pathname});
 for(const field of ['name','description','consumerPrice']){const before=interactions;await ui.locator(`input[value="${field}"]`).check();await until(()=>interactions>before);}
 const before=interactions;await ui.getByRole('button',{name:'确认本次预览范围',exact:true}).click();await until(()=>interactions>before);assert.equal(active.events[0].name,'preview');assert.deepEqual(active.events[0].data.publicFields,['name','description','consumerPrice']);
 await ui.setViewportSize({width:320,height:740});await render();assert.equal(await ui.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await ui.screenshot({path:new URL('compact-scope-320.png',output).pathname});assert.deepEqual(errors,[]);
 const result={evidenceKind:'Actual compiled supplier Component + original WXML/WXSS in limited Chromium; actual backend preview core, not HTTP/Pi/Shopify/WeChat acceptance',backend:'0f12d2ac11eae48d490cdb639bbf3fe60dc3d4b7',chromium:browser.version(),checks:['Explicit retail facts display','Supply price absent from retail preview','Unobserved image unknown','Preview not publication','All preview checks initially empty','Exact selected fields emitted','320px no horizontal overflow'],pageErrors:errors,generatedAt:new Date().toISOString()};await fs.writeFile(new URL('acceptance.json',output),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {await browser.close();}
