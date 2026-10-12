// Actual signed enterprise HTTP/Pi SDK/Store; memory-only ingress and official
// faux model fixture. No real WeChat, Shopify, paid model or production.
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { intakeFixture, actor } from './intake-http-support.mjs';
import { until } from './support.mjs';
export const supplierFacts={name:'轻棉日常 T 恤（本地业务 fixture）',description:'棉质，圆领短袖，日常穿着。',targetMarket:'US',currency:'USD',skuCode:'SUPPLIER-CLIENT-FIXTURE',supplierUnit:'件',supplierMoq:300,wholesaleUnitPrice:'3.20',wholesaleCurrency:'USD',recommendedRetailPrice:'18.00',productionDays:15};
export const retailFacts={retailUnit:'件',unitsPerPack:1,consumerPrice:'12.30',handlingDays:2,shippingDays:7};
const quotedLabels={skuCode:'SKU',wholesaleUnitPrice:'批发价',recommendedRetailPrice:'建议零售价'};
export const factText=facts=>Object.entries(facts).map(([field,value])=>`${quotedLabels[field]||field}: ${value}`).join('; ');
export const event=(id,kind)=>({currentTarget:{dataset:{id,...(kind?{kind}:{})}}});
export async function supplierFixture(t,overrides={}){
 const f=await intakeFixture(t,overrides);
 return {...f,get app(){return f.app;},actor,respond(facts,suggestions=[]){f.faux.setResponses([()=>{const request=f.requests.filter(item=>item.method==='POST'&&(item.path.endsWith('/supplier-services')||item.path.includes('/supplier-services/')&&item.path.endsWith('/messages'))).at(-1);return fauxAssistantMessage(fauxToolCall('workspace_propose_supplier_profile',{facts,sources:Object.keys(facts).map(field=>({field,kind:'message',requestId:request.body.requestId,quote:request.body.content})),suggestions}),{stopReason:'toolUse'});}]);},
 async settle(client){let values;await until(async()=>{values=await client.supplierServices(actor.nativeAgentId);return values.length&&values.every(item=>item.phase!=='pending');});return values.at(-1);}};
}
