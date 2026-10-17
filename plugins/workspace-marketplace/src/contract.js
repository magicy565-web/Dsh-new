export const MARKETPLACE_PLUGIN='workspace-marketplace';
export const MARKETPLACE_PURPOSE='marketplace-local-planning-status-v1';
const codes=['MARKETPLACE_UNCONFIGURED','MARKETPLACE_SCOPE_REQUIRED','MARKETPLACE_INPUT_INVALID','MARKETPLACE_SOURCE_CHANGED','MARKETPLACE_CANCELLED','MARKETPLACE_OPERATION_REFUSED'];
export function marketplaceGap(code,write=false){return {plugin:MARKETPLACE_PLUGIN,status:code==='MARKETPLACE_UNCONFIGURED'?'unconfigured':'blocked',code:codes.includes(code)?code:'MARKETPLACE_OPERATION_REFUSED',...(write?{writeOutcome:'unknown',retryWithNewRequest:false}:{})};}
export function isMarketplaceGap(value){return value?.plugin===MARKETPLACE_PLUGIN&&['blocked','unconfigured'].includes(value.status)&&codes.includes(value.code)
 && Object.keys(value).every(k=>['plugin','status','code','writeOutcome','retryWithNewRequest'].includes(k))
 && (!Object.hasOwn(value,'writeOutcome')||value.writeOutcome==='unknown'&&value.retryWithNewRequest===false)
 && (!Object.hasOwn(value,'retryWithNewRequest')||value.retryWithNewRequest===false);}
export function marketplaceMessageReceipt(message){
 if(!Array.isArray(message?.content)||message.content.length!==1||message.content[0]?.type!=='text'||typeof message.content[0].text!=='string'||message.content[0].text.length>120000)throw Error('MARKETPLACE_SOURCE_CHANGED');
 const receipt=JSON.parse(message.content[0].text);
 if(receipt?.plugin!==MARKETPLACE_PLUGIN||message.details!==undefined&&JSON.stringify(message.details)!==JSON.stringify(receipt))throw Error('MARKETPLACE_SOURCE_CHANGED');
 return receipt;
}
