// Optional native Pi/OMP skill tools. Host-supplied original authorization only;
// ordinary plugin installation never discovers Medusa credentials or Library data.
export const MEDUSA_CATALOG_PLUGIN = 'workspace-medusa-catalog';
const uuid = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$', minLength: 36, maxLength: 36 };
const object = fields => ({ type: 'object', properties: fields, required: Object.keys(fields), additionalProperties: false });
export const MEDUSA_CATALOG_INPUTS = Object.freeze({
  status: object({}), preview: object({ productId: uuid }), reconcile: object({ productId: uuid }),
});
export const MEDUSA_CATALOG_METHODS = Object.freeze(Object.keys(MEDUSA_CATALOG_INPUTS));
export const MEDUSA_CATALOG_TOOLS = Object.freeze(MEDUSA_CATALOG_METHODS.map(name => 'workspace_medusa_' + name));
export const MEDUSA_CATALOG_SAFE_REASONS = Object.freeze([
  'ORIGINAL_REVIEWED_HOST_REQUIRED', 'MEDUSA_UNCONFIGURED', 'MEDUSA_PRODUCT_ID_INVALID',
  'MEDUSA_ROLE_REQUIRED', 'MEDUSA_ORIGINAL_SELECTION_REQUIRED', 'MEDUSA_SOURCE_CHANGED',
  'MEDUSA_TRANSPORT_UNCERTAIN', 'MEDUSA_REMOTE_REFUSED', 'MEDUSA_INVALID_RESPONSE',
  'MEDUSA_RESPONSE_LIMIT', 'MEDUSA_HANDLE_AMBIGUOUS', 'MEDUSA_REMOTE_CONFLICT',
  'MEDUSA_NOT_ELIGIBLE', 'ORIGINAL_MEDUSA_OPERATION_REFUSED',
]);
export function validateMedusaCatalogInput(method, input) {
  if (!Object.hasOwn(MEDUSA_CATALOG_INPUTS, method)) throw Error('Unknown admitted Medusa tool.');
  const keys = method === 'status' ? [] : ['productId'];
  if (!input || Array.isArray(input) || typeof input !== 'object'
    || Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))
    || keys.length && (typeof input.productId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(input.productId)))
    throw Error('Only an exact original product ID and reviewed input shape is admitted.');
  return structuredClone(input);
}
const descriptions = {
  status: 'Read the optional Medusa internal draft connection status. No credential discovery, authorization or changes.',
  preview: 'Read only a currently authorized original Library product revision for Medusa draft preview. Does not send data to Medusa or publish anything.',
  reconcile: 'Read back an exact originally selected product handle from the explicitly configured Medusa instance. No mutations, retries or publishing.',
};
export function medusaCatalogExtension({ client, authorize } = {}) {
  return pi => MEDUSA_CATALOG_METHODS.forEach((method, index) => pi.registerTool({
    name: MEDUSA_CATALOG_TOOLS[index], label: 'Medusa catalog ' + method,
    description: descriptions[method], parameters: MEDUSA_CATALOG_INPUTS[method], approval: 'read',
    async execute(_id, args, signal, _update, ctx) {
      let receipt;
      try {
        signal?.throwIfAborted();
        const input = validateMedusaCatalogInput(method, args);
        if (!client?.[method] || typeof authorize !== 'function') receipt = {
          plugin: MEDUSA_CATALOG_PLUGIN, status: 'unconfigured', reason: 'ORIGINAL_REVIEWED_HOST_REQUIRED', sources: [],
        };
        else {
          if (!ctx?.model) throw Error('Exact selected model is required.');
          await authorize(signal, ctx.model); signal?.throwIfAborted();
          try { receipt = await client[method](input, signal, ctx.model); }
          finally { await authorize(signal, ctx.model); signal?.throwIfAborted(); }
          if (receipt?.plugin !== MEDUSA_CATALOG_PLUGIN) throw Error('Original Medusa host receipt required.');
        }
      } catch (error) {
        receipt = { plugin: MEDUSA_CATALOG_PLUGIN,
          status: error?.code === 'MEDUSA_UNCONFIGURED' ? 'unconfigured' : 'blocked',
          reason: MEDUSA_CATALOG_SAFE_REASONS.includes(error?.code) ? error.code : 'ORIGINAL_MEDUSA_OPERATION_REFUSED', sources: [] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(receipt) }], details: receipt,
        isError: ['blocked','unconfigured','unavailable'].includes(receipt.status) };
    },
  }));
}

export default function extension(pi){let host;pi.events?.emit('workspace:plugin-host',{accept:value=>{host=value;}});return medusaCatalogExtension({client:host?.medusaClient,authorize:host?.authorize})(pi);}
