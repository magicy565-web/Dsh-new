import {marketplaceGap} from './contract.js';
const string = maxLength => ({ type: 'string', minLength: 1, maxLength });
const schema = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const definitions = [
  ['workspace_marketplace_status', 'Marketplace 状态', 'Read configuration only; do not start a model or task.', schema({}), 'status'],
  ['workspace_marketplace_find', '寻找第三方 Worker', 'Read published services, exact offered prices and verified availability.', schema({query:{type:'string',maxLength:120}},[]), 'catalog'],
  ['workspace_marketplace_propose', '提出一次性委托', 'Save a LOCAL DRAFT only. Human must inspect complete task inputs and explicitly confirm/checkout. Never send private materials or approve a purchase.', schema({listingId:string(128),revision:{type:'integer',minimum:1},priceId:string(128),budgetMinor:{type:'integer',minimum:1,maximum:100000000},product:string(240),market:string(100),objective:string(2500),deadlineAt:string(40),requestId:string(128),publicDataConfirmed:{type:'boolean',const:true}},['listingId','revision','priceId','product','market','objective','deadlineAt','requestId','publicDataConfirmed']), 'createOrder'],
  ['workspace_marketplace_order', '读取委托状态', 'Read only current Host-reviewed status fields for an owned order. No task inputs, delivery bodies, error details, polling, approval, acceptance or payment.', schema({orderId:string(128)}), 'getOrder'],
];
/** Native Host supplies a reviewed client and a mandatory journal guard. */
export const MARKETPLACE_TOOLS=Object.freeze(definitions.map(row=>row[0]));
export function createMarketplaceExtension({client=null,registerContextGuard=null}={}){
 return pi=>{
  let configured=false;
  if(client&&typeof registerContextGuard==='function'){
   if(registerContextGuard({validateReceipt:client.revalidateReceipt})!==true)throw Error('MARKETPLACE_CONTEXT_GUARD_REQUIRED');configured=true;
  }
  for(const [name,label,description,parameters,method] of definitions)pi.registerTool({name,label,description,parameters,
   annotations:{readOnlyHint:method!=='createOrder',destructiveHint:false,openWorldHint:false},
   async execute(_callId,args,signal,_onUpdate,ctx){
    let result;
    try{
     signal?.throwIfAborted();
     if(!configured)result=marketplaceGap('MARKETPLACE_UNCONFIGURED');
     else result=await client[{status:'status',catalog:'find',getOrder:'order',createOrder:'propose'}[method]](args,signal,ctx?.model);
    }catch(error){result=marketplaceGap(signal?.aborted?'MARKETPLACE_CANCELLED':error?.code,method==='createOrder'&&configured);}
    return {content:[{type:'text',text:JSON.stringify(result)}],details:result,...(['blocked','unconfigured'].includes(result.status)?{isError:true}:{})};
   }
  });
 };
}
// Raw legacy Marketplace/actor injection cannot authorize private model data.
export default function extension(pi){let host;pi.events?.emit('workspace:plugin-host',{accept:value=>{host=value;}});return createMarketplaceExtension({client:host?.marketplaceClient,registerContextGuard:host?.registerMarketplaceContextGuard})(pi);}
