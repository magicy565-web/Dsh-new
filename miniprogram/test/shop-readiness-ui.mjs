// Pre-contract UI slot verification. Local presentation inputs only, no API
// assumptions, shop observation, identity, connection or grant creation.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {loadPage} from './support.mjs';
import {installSourceRenderer} from './source-renderer.mjs';
const require=createRequire(import.meta.url),{presentShopReadiness}=require('../../release/miniprogram/shared/shop-readiness-view.js');
const {page}=loadPage({},{}),browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']}),ui=await browser.newPage({viewport:{width:390,height:844}}),errors=[];ui.on('pageerror',e=>errors.push(e.message));
try{
 await ui.setContent('<html><head></head><body><header>UI slot test only · no backend contract/live shop</header><main></main></body></html>');
 await ui.exposeFunction('pageEvent',async name=>{assert.equal(name,'showShopReadinessDetails');page[name]();await ui.evaluate(state=>window.renderSource(state),page.data);});
 await installSourceRenderer(ui,{wxml:readFileSync(new URL('../src/pages/conversation/index.wxml',import.meta.url),'utf8'),css:['../src/app.wxss','../src/pages/conversation/index.wxss'].map(p=>readFileSync(new URL(p,import.meta.url),'utf8')).join('\n'),spirit:'data:image/png;base64,'+readFileSync(new URL('../src/assets/spirit.png',import.meta.url)).toString('base64')});
 page.setData({authenticated:true,supplierMode:true});await ui.evaluate(state=>window.renderSource(state),page.data);assert.equal(await ui.getByRole('button',{name:'查看店铺接入依据',exact:true}).count(),0);
 for(const kind of ['unconfigured','insufficient_permissions','store_mismatch','authorization_expired','readable_ready']){
  const presentation=presentShopReadiness({kind,readConfirmed:kind==='readable_ready',shopDomain:kind==='readable_ready'?'supplier-fixture.myshopify.com':null,detail:'本地UI输入，非后端/商店观测'});page.setData({shopReadiness:presentation,preview:null});await ui.evaluate(state=>window.renderSource(state),page.data);assert.equal(await ui.getByText(presentation.title,{exact:true}).count(),1);await ui.getByRole('button',{name:'查看店铺接入依据',exact:true}).click();assert.equal(page.data.preview.content,presentation.detail);assert.equal(page.data.preview.verified,false);assert.match(page.data.preview.content,/本地UI输入/);
 }
 await ui.setViewportSize({width:320,height:740});await ui.evaluate(state=>window.renderSource(state),page.data);assert.equal(await ui.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);page.onHide();assert.equal(page.data.shopReadiness,null);await ui.evaluate(state=>window.renderSource(state),page.data);assert.equal(await ui.getByRole('button',{name:'查看店铺接入依据',exact:true}).count(),0);page.setData({shopReadiness:presentShopReadiness({kind:'readable_ready',readConfirmed:true,shopDomain:'supplier-fixture.myshopify.com'})});page.onUnload();assert.equal(page.data.shopReadiness,null);assert.deepEqual(errors,[]);console.log(JSON.stringify({kind:'pre-contract original WXML/WXSS/compiled Page slot test',states:5,nullSlotHidden:true,actualNativeHandler:true,navigationClearsCachedReady:true,cloudCancellationCalled:false,pageErrors:errors,liveShopify:false,backendContractAssumed:false}));
}finally{await browser.close();}
