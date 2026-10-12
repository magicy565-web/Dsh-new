// Actual compiled Page/Client and original WXML/WXSS -> signed local HTTP.
// Chromium's limited source renderer is not WeChat Developer Tools or a device.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {intakeFixture} from './intake-http-support.mjs';
import {loadPage,until} from './support.mjs';
import {installSourceRenderer} from './source-renderer.mjs';
const out=new URL('../deliverables/readiness-checkpoint/',import.meta.url);mkdirSync(out,{recursive:true});
const domain='readiness-fixture.myshopify.com',info={shop:{id:'gid://shopify/Shop/9',name:'Local fixture',myshopifyDomain:domain,currencyCode:'USD'},currentAppInstallation:{accessScopes:[{handle:'read_products'}]}},state={calls:0,handler:async()=>new Response(JSON.stringify({data:info}))};
const f=await intakeFixture(null,{capabilityEnvironment:{WORKSPACE_SHOPIFY_SHOP_DOMAIN:domain,WORKSPACE_SHOPIFY_ADMIN_TOKEN:'synthetic-server-only-readiness-token'},shopifyFetch:async()=>{state.calls++;return state.handler();}}),client=f.client(),{page}=loadPage(client,f.platform);page.onShow();await until(()=>page.data.authenticated&&page.data.supplierAvailable);await page.beginSupplier();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']}),ui=await browser.newPage({viewport:{width:390,height:844}}),errors=[];ui.on('pageerror',e=>errors.push(e.message));
try{
 await ui.setContent('<html><head><meta charset="utf-8"></head><body><header style="font-size:11px;background:#ffeeb5;padding:6px">PR56 原客户端 · Chromium 本地签名 HTTP 运行 · Shopify 合成响应 · 非微信真机/开发者工具</header><main></main></body></html>');
 await ui.exposeFunction('pageEvent',async name=>{assert.ok(['showShopReadinessDetails','verifyShopReadiness'].includes(name));await page[name]();await ui.evaluate(value=>window.renderSource(value),page.data);});
 await installSourceRenderer(ui,{wxml:readFileSync(new URL('../src/pages/conversation/index.wxml',import.meta.url),'utf8'),css:['../src/app.wxss','../src/pages/conversation/index.wxss'].map(p=>readFileSync(new URL(p,import.meta.url),'utf8')).join('\n'),spirit:'data:image/png;base64,'+readFileSync(new URL('../src/assets/spirit.png',import.meta.url)).toString('base64')});
 await ui.evaluate(value=>window.renderSource(value),page.data);assert.equal(page.data.shopReadiness.kind,'not_checked');assert.equal(state.calls,0);
 await ui.getByRole('button',{name:'核验原店铺读取',exact:true}).click();await until(()=>page.data.shopReadiness?.kind==='readable_ready'&&!page.data.loading);await ui.evaluate(value=>window.renderSource(value),page.data);assert.equal(page.data.shopReadiness.kind,'readable_ready');assert.equal(state.calls,1);await ui.screenshot({path:new URL('readable-local-http.png',out).pathname,fullPage:true});
 await ui.getByRole('button',{name:'查看店铺接入依据',exact:true}).click();await until(()=>!!page.data.preview);assert.match(page.data.preview.content,/准确店铺身份及原商品读取授权范围/);assert.equal(page.data.preview.verified,false);page.setData({preview:null});
 state.handler=async()=>{throw new Error('Synthetic network loss');};await page.verifyShopReadiness();await ui.evaluate(value=>window.renderSource(value),page.data);assert.equal(page.data.shopReadiness.kind,'unknown');await ui.screenshot({path:new URL('unknown-local-http.png',out).pathname,fullPage:true});
 for(const width of [320,390]){await ui.setViewportSize({width,height:844});assert.equal(await ui.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 // Export a labelled read-only snapshot of the rendered original page.
 await ui.evaluate(()=>{for(const button of document.querySelectorAll('button'))button.disabled=true;});writeFileSync(new URL('current-interface.html',out),'<!doctype html>\n'+await ui.content());
 page.onHide();assert.equal(page.data.shopReadiness,null);assert.deepEqual(errors,[]);console.log(JSON.stringify({kind:'compiled original Page/Client plus original WXML/WXSS limited Chromium renderer -> signed local HTTP -> original Shopify adapter',states:['not_checked','readable_ready','unknown'],actualNativeCallbacks:true,shopifyReads:state.calls,noAutomaticProbe:true,networkClearsGreen:true,widths:[320,390],pageErrors:errors,liveShopify:false,realWeChat:false,deliverables:out.pathname}));
}finally{page.onUnload();await browser.close();await f.close();}
