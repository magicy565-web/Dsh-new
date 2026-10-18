// OMP registration and native lifecycle; service logic is package-owned.
import { registerNativeContext } from './native-host.mjs';
import { createEnterpriseContextService, enterpriseContextToolDefinitions } from './service.mjs';
export { ENTERPRISE_CONTEXT_TOOLS, nativeDocumentParameterSchemas } from './service.mjs';

export function enterpriseContextExtension(options = {}) {
  const definitions = enterpriseContextToolDefinitions(options);
  const service = createEnterpriseContextService(options);
  return pi => definitions.forEach(({ method, ...definition }) => pi.registerTool({
    ...definition,
    async execute(_toolId, input, signal, _onUpdate, ctx) {
      const receipt = await service[method](input, signal, ctx?.model);
      return { content: [{ type: 'text', text: JSON.stringify(receipt) }], details: receipt,
        ...(['blocked', 'unconfigured', 'unavailable'].includes(receipt.status) ? { isError: true } : {}) };
    },
  }));
}
export default async function extension(pi) {let host;pi.events?.emit('workspace:plugin-host',{accept:value=>{host=value;}});return registerNativeContext(pi,host,enterpriseContextExtension);}
