import {createErpNextEnterpriseAdapter,EnterpriseAdapterError,safeAdapterFailure,validateEmptyInput} from './adapter.mjs';
const empty=Object.freeze({type:'object',properties:{},additionalProperties:false});
const guardId='workspace-erpnext-enterprise-v1';
const fail=code=>{throw new EnterpriseAdapterError(code);};
const privateReceipt=message=>message?.role==='toolResult'&&message.toolName==='workspace_erpnext_enterprise_read'
  &&(!message.isError||message.details?.status==='ok'||message.details?.authorization);
function validateFailure(message){
  const receipt=message.details;
  if(!receipt||receipt.plugin!=='workspace-erpnext-enterprise'||!['blocked','unavailable','unconfigured'].includes(receipt.status)
    ||receipt.externalWrites!==false||typeof receipt.reason!=='string'||!/^[A-Z][A-Z0-9_]{0,80}$/.test(receipt.reason)
    ||Object.keys(receipt).some(key=>!['plugin','status','reason','externalWrites'].includes(key))
    ||message.content?.length!==1||message.content[0].type!=='text'||message.content[0].text!==JSON.stringify(receipt))
    fail('ERP_ADAPTER_PRIVATE_HISTORY_REFUSED');
}

/** Private activation is a trusted in-process composition, never a model input.
 * This package does not add a Host profile/RPC/journal admission or restore path. */
export function erpNextEnterpriseExtension({adapter=createErpNextEnterpriseAdapter(),host}={}) {
  return pi=>{
    const configured=adapter.status().status==='configured_unverified';
    const gated=configured&&typeof host?.addDisclosureGuard==='function'&&typeof host?.getModel==='function';
    // A new instance cannot establish the provenance of prior private results.
    if(host?.history?.some(privateReceipt))fail('ERP_ADAPTER_PRIVATE_RESTORE_UNSUPPORTED');
    let observed=null;
    if(gated)host.addDisclosureGuard(async({phase='model:prepare'}={})=>{
      if(observed)await adapter.revalidateReceipt(observed,host.signal,host.getModel(),{phase});
    },guardId);
    pi.on('context',async event=>{
      for(const message of event.messages||[])if(message?.role==='toolResult'&&message.toolName==='workspace_erpnext_enterprise_read'){
        if(!privateReceipt(message)){validateFailure(message);continue;}
        if(!gated||!observed||message.content?.length!==1||message.content[0].type!=='text'
          ||message.content[0].text!==JSON.stringify(message.details)
          ||JSON.stringify(message.details)!==JSON.stringify(observed))fail('ERP_ADAPTER_PRIVATE_HISTORY_REFUSED');
        await adapter.revalidateReceipt(message.details,host.signal,host.getModel(),{phase:'context'});
      }
    });
    for(const [name,label]of [['workspace_erpnext_enterprise_status','ERPNext enterprise adapter status'],
      ['workspace_erpnext_enterprise_read','Read host-selected ERPNext enterprise fields']])pi.registerTool({name,label,parameters:empty,approval:'read',
      description:name.endsWith('_status')?'Configuration state only; Library remains the enterprise fact authority.':
        'Read only the original Host-selected exact record and fields with ERPNext citations. No search, pricing, writes or Library migration. Arguments must be empty.',
      async execute(_id,input,signal,_update,ctx){
        let receipt;
        try {
          validateEmptyInput(input);signal?.throwIfAborted();
          if(name.endsWith('_status'))receipt={plugin:'workspace-erpnext-enterprise',...adapter.status(),
            ...(configured&&!gated?{status:'unconfigured',reason:'ORIGINAL_DISCLOSURE_GUARD_REQUIRED'}:{})};
          else {
            if(configured&&!gated)throw new EnterpriseAdapterError('ORIGINAL_DISCLOSURE_GUARD_REQUIRED','unconfigured');
            if(gated&&ctx?.model!==host.getModel())fail('EXACT_MODEL_RECEIVER_REQUIRED');
            const combined=AbortSignal.any([...(signal?[signal]:[]),...(host?.signal?[host.signal]:[])]);
            receipt=await adapter.read(input,combined,ctx?.model);
            observed=receipt;
          }
        }catch(error){receipt=safeAdapterFailure(error,signal?.aborted?signal:host?.signal);}
        const encoded=JSON.stringify(receipt);
        if(Buffer.byteLength(encoded)>65536)receipt={plugin:'workspace-erpnext-enterprise',status:'blocked',reason:'TOOL_OUTPUT_TOO_LARGE',externalWrites:false};
        return {content:[{type:'text',text:JSON.stringify(receipt)}],details:receipt,
          ...(['blocked','unavailable','unconfigured'].includes(receipt.status)?{isError:true}:{})};
      }});
  };
}
export default function extension(pi){return erpNextEnterpriseExtension()(pi);}
