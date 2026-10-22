// OMP presentation adapter; service behavior is owned by this plugin package.
import { createMedusaCatalogService, medusaCatalogToolDefinitions } from './service.mjs';
export { MEDUSA_CATALOG_PLUGIN, MEDUSA_CATALOG_INPUTS, MEDUSA_CATALOG_METHODS,
  MEDUSA_CATALOG_TOOLS, MEDUSA_CATALOG_SAFE_REASONS, validateMedusaCatalogInput } from './service.mjs';

export function medusaCatalogExtension(options = {}) {
  const service = createMedusaCatalogService(options);
  return pi => medusaCatalogToolDefinitions({nativeContext:typeof options.client?.context==='function'}).forEach(({ method, ...definition }) => pi.registerTool({
    ...definition,
    async execute(_id, args, signal, _update, ctx) {
      const receipt = await service[method](args, signal, ctx?.model);
      return { content: [{ type: 'text', text: JSON.stringify(receipt) }], details: receipt,
        isError: ['blocked','unconfigured','unavailable'].includes(receipt.status) };
    },
  }));
}

export default function extension(pi){let host;pi.events?.emit('workspace:plugin-host',{accept:value=>{host=value;}});return medusaCatalogExtension({client:host?.medusaClient,authorize:host?.authorize})(pi);}

export { createMedusaApprovedSource, MedusaApprovedSourceError } from './approved-source.mjs';
