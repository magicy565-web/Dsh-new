// Focused normal product-edit business check, not independent security review.
import { supplierFixture,supplierFacts,retailFacts,factText,event } from './supplier-http-support.mjs';
import {loadPage,until} from './support.mjs';
const f=await supplierFixture(),client=f.client(),{page}=loadPage(client,f.platform);
try{
 page.onShow();await until(()=>page.data.supplierAvailable);await page.beginSupplier();f.respond({...supplierFacts,...retailFacts});page.draft({detail:{value:factText({...supplierFacts,...retailFacts})}});await page.send();await f.settle(client);await page.refresh();let service=page.data.supplierServices[0];
 page.supplierAction(event(service.id,'save-product'));await page.confirmSupplierReview();const first=page.data.supplierServices[0].productReference;
 f.respond({consumerPrice:'13.30'});page.draft({detail:{value:factText({consumerPrice:'13.30'})}});await page.send();await f.settle(client);await page.refresh();service=page.data.supplierServices[0];
 let outcome;try{outcome=await client.supplierOperation(page.data.conversationId,service.id,'save-product',{expectedRevision:service.revision,confirmed:true},'明确确认保存已修改的同一原产品');console.log(JSON.stringify({backend:'b210576438f72ee7683e736aa17452a3097a33cf',operation:'edit facts then save existing original library product',pass:true,first,product:outcome.product?.id}));}
 catch(error){console.log(JSON.stringify({backend:'b210576438f72ee7683e736aa17452a3097a33cf',operation:'edit facts then save existing original library product',pass:false,code:error.code,status:error.status,message:error.message,first,currentServiceRevision:service.revision,knownConsumerPrice:service.profile.consumerPrice,products:(await client.library()).products.length,modelFixture:'official Pi faux; no real model/Shopify/production'}));}
}finally{page.onUnload();await f.close();}
