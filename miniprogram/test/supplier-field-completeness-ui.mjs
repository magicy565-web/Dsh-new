// Original listing component; explicit original-DTO local inputs. No new UI or
// backend endpoint, parsed image claim, external product or account execution.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {chromium} from 'playwright';
import {installSourceRenderer} from './source-renderer.mjs';
const file=new URL('../../release/miniprogram/components/supplier-listing-preview/index.js',import.meta.url);let options;vm.runInNewContext(readFileSync(file,'utf8'),{exports:{},require:createRequire(file),Component(v){options=v;},Error});
const c={data:{...options.data},setData(v){Object.assign(this.data,structuredClone(v));}},preview={schema:'workspace.supplier-listing.v1',phase:'preview_ready',missingFields:[],market:{countryCode:'US',currency:'USD'},saleUnit:{unit:'件',unitsPerPack:1,consumerPrice:'12.30'},product:{title:'本地原字段测试',descriptionHtml:'明确商品描述',status:'DRAFT'},variants:[{sku:'LOCAL-SKU',price:'12.30'}],fulfillment:{handlingDays:2,shippingDays:7},images:[],display:{title:'本地原字段测试',paragraphs:['商品描述，无发货期段落'],imageStatus:'unknown'},externalStatus:'preview',published:false,shopifyProductId:null,publicFields:['name','description','skuCode','retailUnit','unitsPerPack','consumerPrice','handlingDays','shippingDays']};
options.properties.preview.observer.call(c,preview);
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']}),ui=await browser.newPage({viewport:{width:390,height:844}}),errors=[];ui.on('pageerror',e=>errors.push(e.message));
try{
 await ui.setContent('<html><head></head><body><main></main></body></html>');await installSourceRenderer(ui,{wxml:readFileSync(new URL('../src/components/supplier-listing-preview/index.wxml',import.meta.url),'utf8'),css:readFileSync(new URL('../src/app.wxss',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../src/components/supplier-listing-preview/index.wxss',import.meta.url),'utf8'),spirit:''});await ui.evaluate(state=>window.renderSource(state),c.data);
 for(const text of ['本地原字段测试','12.30 USD','1 件 / 包 · 销售国家 US','SKU LOCAL-SKU','处理及发货 2 天 · 运输 7 天','服务端商品预览 · 尚未创建或发布到 Shopify'])assert.equal(await ui.getByText(text,{exact:true}).count(),1,text);
 preview.fulfillment={handlingDays:null,shippingDays:null};options.properties.preview.observer.call(c,preview);await ui.evaluate(state=>window.renderSource(state),c.data);assert.equal(await ui.getByText('处理及发货 尚未提供 天 · 运输 尚未提供 天',{exact:true}).count(),1);assert.deepEqual(errors,[]);console.log(JSON.stringify({originalComponent:true,explicitFieldsVisible:['name','description','market','retailUnit','unitsPerPack','consumerPrice','sku','handlingDays','shippingDays'],missingPeriodRemainsUnknown:true,paragraphIndependent:true,pageErrors:errors,liveSource:false}));
}finally{await browser.close();}
