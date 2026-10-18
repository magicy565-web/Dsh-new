/** Installation is inert unless the original trusted enterprise Host injects a
 * session-scoped client and current-session authorization. No direct API URLs. */
import {registerNativeContext} from './native-host.mjs';
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string', minLength: 1, maxLength: 128 };
const note = { type: 'string', minLength: 1, maxLength: 4000 };
const sha = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const toolSpecs = [
  ['status', obj({}), 'Check only the reviewed self-hosted connector availability; never discover credentials.'],
  ['structuredMemoryLookup', obj({subjectType:str,subjectId:str,factKey:str}), 'Reviewed exact-key original Library memory lookup; no semantic search.'],
  ['structuredMemoryRemember', obj({subjectType:str,subjectId:str,factKey:str,statement:note}), 'Reviewed source-bound internal memory from this original conversation turn.'],
  ['memorySearch', obj({ customerId: str, query: { type: 'string', minLength: 1, maxLength: 500 } }), 'OFF by default: Mem0 semantic/vector search requires a separate explicit owner decision, original Host approval and live per-source checks.'],
  ['memoryAdd', obj({ customerId: str, note, sourceRef: str, sourceVersion: { type: 'integer', minimum: 1 }, sourceSha256: sha }), 'OFF by default: Store a noncanonical note only after live source revision, SHA, customer grant and original Host approval.'],
  ['memoryHistory', obj({ customerId: str, memoryId: str }), 'OFF by default: Require current Library permission and provenance for every historical event, or deny all.'],
  ['parseUpload', obj({ artifactId: str, version: { type: 'integer', minimum: 1 }, sha256: sha }), 'Parse exact original host-authorized uploaded bytes with self-hosted Docling; never fetch arbitrary URLs.'],
];
export const ENTERPRISE_CONTEXT_TOOLS = Object.freeze([
  'workspace_enterprise_context_status',
  'workspace_enterprise_context_structured_memory_lookup', 'workspace_enterprise_context_structured_memory_remember',
  'workspace_enterprise_context_memory_search', 'workspace_enterprise_context_memory_add',
  'workspace_enterprise_context_memory_history', 'workspace_enterprise_context_parse_upload',
]);
// This projection is supplied only by the trusted original native handshake.
// Whole tuple alternatives preserve correlations; independent enums would
// accidentally advertise combinations that were never selected.
export function nativeDocumentParameterSchemas(capabilities) {
  const refuse=()=>{throw Error('OSS_NATIVE_DOCUMENT_CAPABILITIES_REFUSED');};
  const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
  const text=value=>typeof value==='string'&&value.length>0&&value.length<=128;
  const integer=value=>Number.isSafeInteger(value)&&value>0;
  const methods=['parseUpload','structuredMemoryLookup','structuredMemoryRemember'];
  if(!exact(capabilities,['schema','methods','sources','queries'])||capabilities.schema!=='workspace.native-document-capabilities.v1'
    ||!Array.isArray(capabilities.methods)||!capabilities.methods.length||new Set(capabilities.methods).size!==capabilities.methods.length
    ||capabilities.methods.some(method=>!methods.includes(method)))refuse();
  const {sources,queries}=capabilities;
  if(!Array.isArray(sources)||!sources.length||sources.length>8||!Array.isArray(queries)||!queries.length||queries.length>8)refuse();
  for(const source of sources)if(!exact(source,['documentId','revision','documentVersion','asset'])||!text(source.documentId)
    ||!integer(source.revision)||!integer(source.documentVersion)||!exact(source.asset,['artifactId','version','sha256'])
    ||!text(source.asset.artifactId)||!integer(source.asset.version)||!/^[a-f0-9]{64}$/.test(source.asset.sha256))refuse();
  for(const query of queries)if(!exact(query,['subjectType','subjectId','factKey'])
    ||Object.values(query).some(value=>typeof value!=='string'||!/^[A-Za-z0-9._@:+|/-]{1,128}$/.test(value)))refuse();
  const unique=rows=>[...new Map(rows.map(row=>[JSON.stringify(row),row])).values()];
  return Object.fromEntries(capabilities.methods.map(method=>{
    const base=toolSpecs.find(([name])=>name===method)[1],keys=method==='parseUpload'?['artifactId','version','sha256']:['subjectType','subjectId','factKey'];
    const tuples=unique(method==='parseUpload'?sources.map(source=>source.asset):queries);
    // Provider strict normalization closes each object branch separately. Keep
    // the complete contract (including a free statement) inside every branch,
    // then narrow only the selected tuple keys without mixing alternatives.
    return [method,{...structuredClone(base),oneOf:tuples.map(tuple=>({...structuredClone(base),properties:{...structuredClone(base.properties),...Object.fromEntries(keys.map(key=>[key,{...base.properties[key],const:tuple[key]}]))}}))}];
  }));
}
export function enterpriseContextExtension({ client, authorize, enabledMethods=null, nativeCapabilities=null } = {}) {
  const schemas=nativeCapabilities?nativeDocumentParameterSchemas(nativeCapabilities):null;
  if(schemas&&(!enabledMethods||JSON.stringify(enabledMethods)!==JSON.stringify(nativeCapabilities.methods)))throw Error('OSS_NATIVE_DOCUMENT_CAPABILITIES_REFUSED');
  return pi => {
    toolSpecs.forEach(([method, parameters, description], index) => {
      if(enabledMethods&&!enabledMethods.includes(method))return;pi.registerTool({
      name: ENTERPRISE_CONTEXT_TOOLS[index], label: 'Enterprise Context · ' + method, description, parameters: schemas?.[method]||parameters,
      async execute(_toolId, input, signal, _onUpdate, ctx) {
        let result;
        try {
          const configured = typeof authorize === 'function' && toolSpecs.filter(([k])=>!enabledMethods||enabledMethods.includes(k)).every(([k]) => typeof client?.[k] === 'function');
          if (!configured) result = { status: 'unconfigured', reason: 'ORIGINAL_ENTERPRISE_SESSION_INJECTION_REQUIRED' };
          else if (!ctx?.model || !input || Array.isArray(input) || typeof input !== 'object'
            || Object.keys(input).some(key => !Object.keys(parameters.properties).includes(key))
            || parameters.required.some(key => !(key in input))) throw Error('Tool contract refused');
          else {
            signal?.throwIfAborted();
            if (await authorize(signal, ctx.model) !== true) throw Error('Authorization refused');
            try { result = await client[method](input, signal, ctx.model); }
            finally { if (await authorize(signal, ctx.model) !== true) throw Error('Authorization revoked'); signal?.throwIfAborted(); }
          }
        } catch(error) { result = { status: /^DOCLING_[A-Z_]+$/.test(error.code||'')?'unavailable':'blocked',reason:/^(?:OSS|DOCLING)_[A-Z_]+$/.test(error.code||'')?error.code:'ENTERPRISE_CONTEXT_AUTHORIZATION_REFUSED' }; }
        const receipt = { ...result, plugin: 'workspace-enterprise-context-oss', visibility: 'internal',
          canonicalFacts: 'Workspace Library', externalActions: false };
        return { content: [{ type: 'text', text: JSON.stringify(receipt) }], details: receipt,
          ...(['blocked', 'unconfigured','unavailable'].includes(receipt.status) ? { isError: true } : {}) };
      },
    });});
  };
}
export default async function extension(pi) {let host;pi.events?.emit('workspace:plugin-host',{accept:value=>{host=value;}});return registerNativeContext(pi,host,enterpriseContextExtension);}
