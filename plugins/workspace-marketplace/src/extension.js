const string = maxLength => ({ type: 'string', minLength: 1, maxLength });
const schema = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const definitions = [
  ['workspace_marketplace_status', 'Marketplace 状态', 'Read configuration only; do not start a model or task.', schema({}), 'status'],
  ['workspace_marketplace_find', '寻找第三方 Worker', 'Read published services, exact offered prices and verified availability.', schema({query:{type:'string',maxLength:120}},[]), 'catalog'],
  ['workspace_marketplace_propose', '提出一次性委托', 'Save a LOCAL DRAFT only. Human must inspect complete task inputs and explicitly confirm/checkout. Never send private materials or approve a purchase.', schema({listingId:string(128),revision:{type:'integer',minimum:1},priceId:string(128),budgetMinor:{type:'integer',minimum:1,maximum:100000000},product:string(240),market:string(100),objective:string(2500),deadlineAt:string(40),requestId:string(128),publicDataConfirmed:{type:'boolean',const:true}},['listingId','revision','priceId','product','market','objective','deadlineAt','requestId','publicDataConfirmed']), 'createOrder'],
  ['workspace_marketplace_order', '读取委托成果', 'Read the original saved task status and submitted deliverables for an owned order. This does not poll, approve, accept or pay.', schema({orderId:string(128)}), 'getOrder'],
];
/** Host supplies the EXISTING authenticated buyer binding on each call. */
export function createMarketplaceExtension({ marketplace = null, readActor = null } = {}) {
  return function extension(pi) {
    for (const [name,label,description,parameters,method] of definitions) pi.registerTool({name,label,description,parameters,
      async execute(_callId,args,signal) {
        try {
          if (signal?.aborted) throw new Error('CANCELLED');
          if (!marketplace || typeof readActor !== 'function') throw new Error('MARKETPLACE_UNCONFIGURED');
          const bound = await readActor();
          if (!bound || bound.kind !== 'buyer') throw new Error('BUYER_BINDING_REQUIRED');
          const actor = {...bound,human:false}; // model output never supplies approval
          let result;
          if (method === 'status') { marketplace.catalog(actor,''); result=marketplace.status(); }
          else if (method === 'catalog') result=marketplace.catalog(actor,args.query||'');
          else if (method === 'getOrder') result=marketplace.getOrder(actor,args.orderId);
          else result=await marketplace.createOrder(actor,args);
          return {content:[{type:'text',text:JSON.stringify(result)}],details:result};
        } catch (error) {
          const code = typeof error?.code === 'string' ? error.code : ['CANCELLED','MARKETPLACE_UNCONFIGURED','BUYER_BINDING_REQUIRED'].includes(error?.message) ? error.message : 'MARKETPLACE_ERROR';
          return {content:[{type:'text',text:code}],details:{code},isError:true};
        }
      }
    });
  };
}
// Ordinary installation deliberately has no Host, account or spending rights.
export default createMarketplaceExtension();
