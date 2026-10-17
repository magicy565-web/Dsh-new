import {createHash} from 'node:crypto';
import {ERP_FIELDS, TradeError, validateErpRead} from '@workspace-agent/pi-free-trade/adapters';

const prefixes = {Quotation:'quotation', 'Sales Order':'sales_order', 'Sales Partner':'sales_partner', 'Item Price':'item_price'};
// Exact scalar projection: no defaults, currency conversion, inferred prices or business rules.
export const ERP_ENTERPRISE_FIELD_MAP = Object.freeze(Object.fromEntries(Object.entries(ERP_FIELDS).map(([doctype, fields]) =>
  [doctype, Object.freeze(Object.fromEntries(fields.map(field => [field, `erpnext.${prefixes[doctype]}.${field}`])))])));
export class EnterpriseAdapterError extends Error {
  constructor(code, status='blocked') { super(code); this.name='EnterpriseAdapterError'; this.code=code; this.status=status; }
}
const fail=(code,status)=>{throw new EnterpriseAdapterError(code,status);};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function validateEmptyInput(input) {
  if(!plain(input)||Object.keys(input).length)fail('ERP_ADAPTER_INPUT_REFUSED');
}
const methods=['authorize','authorizeContext','seal','check','verifyBody'];

/** The original trusted Host supplies one fixed selection and its existing control.
 * No credentials, URL selection, HTTP implementation or authorization database here. */
export function createErpNextEnterpriseAdapter({enabled=false,control,selection}={}) {
  if(typeof enabled!=='boolean')fail('ERP_ADAPTER_CONFIGURATION_INVALID');
  const request=selection===undefined?null:validateErpRead(selection);
  const bound=control?.enterprise===true&&methods.every(key=>typeof control[key]==='function')
    &&typeof control?.erp?.read==='function'&&typeof control?.erp?.status==='function';
  let remembered=null,serialized=null,proof=null,upstream=null;
  function status() {
    const reason=!enabled?'ERP_ADAPTER_DISABLED':!request?'ERP_ADAPTER_SELECTION_REQUIRED':!bound?'ORIGINAL_REVIEWED_HOST_REQUIRED':
      control.erp.status()!=='configured_unverified'?'ERP_REVIEWED_CONNECTION_REQUIRED':null;
    return freeze({status:reason?'unconfigured':'configured_unverified',...(reason?{reason}:{}),
      enterpriseFactAuthority:'workspace-library',libraryMigration:'not_migrated',sourceSystem:'erpnext',externalWrites:false});
  }
  function ready(signal,receiver) {
    signal?.throwIfAborted();
    const state=status();if(state.status==='unconfigured')fail(state.reason,'unconfigured');
    if(!receiver)fail('EXACT_MODEL_RECEIVER_REQUIRED');
  }
  async function authorize(signal,receiver,phase) {
    ready(signal,receiver);
    await control.authorizeContext(signal,receiver,{phase});
    if(await control.authorize({tool:'workspace_erpnext_read',input:request},signal,receiver)!==true)fail('ORIGINAL_AUTHORIZATION_REFUSED');
    signal?.throwIfAborted();
  }
  return Object.freeze({status,
    async read(input,signal,receiver) {
      validateEmptyInput(input);await authorize(signal,receiver,'context');
      const result=await control.erp.read(request,signal,receiver);
      if(result?.status!=='ok'||result.doctype!==request.doctype||result.name!==request.name
        ||JSON.stringify(result.fields)!==JSON.stringify(request.fields)||!plain(result.record)
        ||JSON.stringify(Object.keys(result.record))!==JSON.stringify(request.fields)
        ||result.contentTrust!=='private_source_data'||result.externalWrites!==false)fail('ERP_ADAPTER_SOURCE_INVALID');
      let url;
      try {url=new URL(result.sourceUrl);}catch{fail('ERP_ADAPTER_SOURCE_INVALID');}
      // Verify the canonical exact-record source emitted by the existing client.
      if(url.username||url.password||url.hash||!['https:','http:'].includes(url.protocol)
        ||url.pathname!==`/api/resource/${encodeURIComponent(request.doctype)}`
        ||JSON.stringify([...url.searchParams.keys()])!==JSON.stringify(['fields','filters','limit_page_length','limit_start'])
        ||url.searchParams.get('fields')!==JSON.stringify([...new Set(['name',...request.fields])])
        ||url.searchParams.get('filters')!==JSON.stringify([[request.doctype,'name','=',request.name]])
        ||url.searchParams.get('limit_page_length')!=='1'||url.searchParams.get('limit_start')!=='0'
        ||JSON.stringify(result.sources)!==JSON.stringify([result.sourceUrl]))fail('ERP_ADAPTER_SOURCE_INVALID');
      for(const value of Object.values(result.record))if(value!==null&&(!['string','number','boolean'].includes(typeof value)
        ||typeof value==='string'&&value.length>2048||typeof value==='number'&&!Number.isFinite(value)))fail('ERP_ADAPTER_SOURCE_INVALID');
      const body={plugin:'workspace-free-trade',...result};
      const nextProof=await control.seal(request,body,signal,receiver);
      await control.verifyBody(nextProof,{...body,authorization:nextProof});
      await control.check(nextProof,signal,receiver);
      await authorize(signal,receiver,'context');
      if(remembered) {
        if(hash(body)!==hash(upstream))fail('ERP_ADAPTER_PROJECTION_CHANGED');
        return remembered;
      }
      const id=`erpnext:${hash([url.origin,request])}`;
      const receipt=freeze({plugin:'workspace-erpnext-enterprise',status:'ok',
        enterpriseFactAuthority:'workspace-library',libraryMigration:'not_migrated',contentTrust:'private_source_data',
        source:{id,system:'erpnext',sourceUrl:result.sourceUrl,origin:url.origin,doctype:request.doctype,name:request.name,
          fields:[...request.fields],retrievedAt:new Date().toISOString(),
          modified:request.fields.includes('modified')?result.record.modified:null,
          revisionEvidence:request.fields.includes('modified')?'authorized_modified_field':'no_revision_field_authorized',
          projectionSha256:hash(result.record)},
        facts:request.fields.map(field=>({key:ERP_ENTERPRISE_FIELD_MAP[request.doctype][field],value:result.record[field],sourceRef:{id,field}})),
        authorization:structuredClone(nextProof),persisted:false,externalWrites:false});
      // Retain a single immutable projection in this binding, never a durable store.
      remembered=receipt;serialized=JSON.stringify(receipt);proof=structuredClone(nextProof);upstream=structuredClone(body);
      return receipt;
    },
    async revalidateReceipt(receipt,signal,receiver,{phase='model:prepare'}={}) {
      ready(signal,receiver);
      if(!remembered||JSON.stringify(receipt)!==serialized)fail('ERP_ADAPTER_RECEIPT_UNKNOWN');
      await authorize(signal,receiver,phase);
      await control.verifyBody(proof,{...upstream,authorization:proof});
      await control.check(proof,signal,receiver,{refresh:true,phase});
      await authorize(signal,receiver,'context');
      return true;
    }
  });
}

// Only reviewed error codes cross the tool boundary; raw exception messages never do.
const remoteCodes=new Set(['ERP_REVIEWED_CONNECTION_REQUIRED','EXACT_MODEL_RECEIVER_REQUIRED','ORIGINAL_AUTHORIZATION_REFUSED',
  'OPERATION_CANCELLED','RATE_LIMITED','REDIRECT_REFUSED','REMOTE_AUTHORIZATION_REFUSED','REMOTE_HTTP_ERROR','REMOTE_NOT_JSON',
  'RESPONSE_TOO_LARGE','EMPTY_RESPONSE','REMOTE_SCHEMA_INVALID','REQUEST_TIMEOUT','NETWORK_UNAVAILABLE','ERP_RECORD_MISMATCH',
  'ERP_FIELD_SHAPE_INVALID','SECRET_ECHO_REFUSED','FREE_TRADE_PRIVATE_READ_CAPACITY','FREE_TRADE_RECEIVER_OR_SCOPE_CHANGED',
  'FREE_TRADE_SESSION_REVOKED','FREE_TRADE_RECORD_SCOPE_REVOKED','FREE_TRADE_ERP_PROJECTION_CHANGED',
  'FREE_TRADE_PRIVATE_RECEIPT_INVALID','FREE_TRADE_PRIVATE_READ_LIMIT','FREE_TRADE_PRIVATE_CACHED_BODY_CHANGED']);
export function safeAdapterFailure(error,signal) {
  const reviewed=error instanceof EnterpriseAdapterError||error instanceof TradeError||remoteCodes.has(error?.code);
  return {plugin:'workspace-erpnext-enterprise',status:reviewed&&['blocked','unavailable','unconfigured'].includes(error.status)?error.status:'blocked',
    reason:signal?.aborted?'OPERATION_CANCELLED':reviewed?error.code:'ERP_ADAPTER_OPERATION_REFUSED',externalWrites:false};
}
