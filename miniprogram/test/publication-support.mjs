// Compiled native Component callbacks plus real local signed HTTP/Store and
// original Shopify adapter routed entirely into the shared local HTTP fixture.
// Never WeChat/device/live Shopify/credential/permission evidence.
import {createRequire} from 'node:module';
import {readFileSync,promises as fs} from 'node:fs';
import vm from 'node:vm';
import {fakeShopify} from '../../test/fixtures/supplier-shopify-http.mjs';
import {supplierFixture,supplierFacts,retailFacts,factText,event} from './supplier-http-support.mjs';
import {loadPage,until} from './support.mjs';
export {event,until};
export function reviewComponent(page){
 const file=new URL('../../release/miniprogram/components/shopify-operation-review/index.js',import.meta.url);let options,events=Promise.resolve();
 vm.runInNewContext(readFileSync(file,'utf8'),{exports:{},require:createRequire(file),Component(value){options=value;},WeakMap,JSON,Error});
 const component={data:{...options.data,busy:false,uncertain:false,serverError:''},setData(value){Object.assign(this.data,structuredClone(value));},triggerEvent(name,detail){events=events.then(()=>name==='close'?page.closeShopifyReview():name==='deny'?page.denyShopifyReview({detail}):page.confirmShopifyReview({detail}));}};
 Object.assign(component,options.methods);
 const sync=()=>{Object.assign(component.data,{busy:page.data.loading,uncertain:page.data.uncertain&&page.data.shopifyReview?.stage!=='retry',serverError:page.data.error});options.properties.review.observer.call(component,page.data.shopifyReview);};
 return{component,sync,async confirm(values){sync();component.consent({detail:{value:values}});component.confirm();await events;sync();},async deny(){sync();component.deny();await events;sync();},async close(){sync();component.close();await events;sync();}};
}
export async function publicationFixture(t,{configured=true,...overrides}={}){
 const callbacks=[],holder=t||{after(fn){callbacks.push(fn);}},remote=await fakeShopify(holder),environment=configured?{WORKSPACE_SHOPIFY_SHOP_DOMAIN:'supplier-fixture.myshopify.com',WORKSPACE_SHOPIFY_ADMIN_TOKEN:'LOCAL-SYNTHETIC-SHOPIFY-CREDENTIAL',WORKSPACE_SUPPLIER_SHOPIFY_WRITES_ENABLED:'1'}:{};
 const f=await supplierFixture(t,{...overrides,capabilityEnvironment:environment,shopifyFetch:remote.fetchImpl});
 if(configured){await f.app.supplierPublication.ensureConnector();await f.app.capabilities.updateConnector(f.app.supplierPublication.connectorId,{enabled:true});}
 const attempts=[],original=f.platform.request.bind(f.platform);let beforeExecute=false;
 f.platform.request=options=>{const path=new URL(options.url).pathname.slice(4);attempts.push({path,method:options.method,body:structuredClone(options.data)});if(beforeExecute&&path.endsWith('/shopify-execute')){beforeExecute=false;options.fail({errMsg:'Local fixture disconnected before original execution admission'});return{abort(){}};}return original(options);};
 const open=async()=>{const client=f.client(),{page}=loadPage(client,f.platform);page.onShow();await until(()=>page.data.supplierAvailable);await page.beginSupplier();await until(()=>!page.data.supplierReadError);return{client,page,review:reviewComponent(page)};};
 const ready=async(page,client)=>{f.respond({...supplierFacts,...retailFacts});page.draft({detail:{value:factText({...supplierFacts,...retailFacts})}});await page.send();await f.settle(client);await page.refresh();let service=page.data.supplierServices[0];const image=new URL('../src/assets/spirit.png',import.meta.url).pathname;await page.attach('明确原图片-fixture.png',image,(await fs.stat(image)).size);page.supplierAction(event(service.id,'images'));await page.confirmSupplierReview();service=page.data.supplierServices[0];await page.confirmSupplierPreview({detail:{id:service.id,expectedRevision:service.revision,confirmed:true,publicFields:['name','description','skuCode','retailUnit','unitsPerPack','consumerPrice','handlingDays','shippingDays','images']}});return page.data.supplierServices[0];};
 return{...f,get app(){return f.app;},remote,attempts,open,ready,disconnectBeforeExecute(){beforeExecute=true;},async close(){await f.close();for(const fn of callbacks.reverse())await fn();}};
}
