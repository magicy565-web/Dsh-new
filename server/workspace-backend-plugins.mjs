// Explicit composition for the two existing backends. No arbitrary module URL,
// permission manifest, new loader, new persistence or runtime business discovery.
const ids = Object.freeze(['workspace-medusa-catalog', 'workspace-enterprise-context']);
export function backendPluginSelection(configuration = { disabled: [] }) {
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)
    || Object.keys(configuration).some(key => key !== 'disabled') || !Array.isArray(configuration.disabled)
    || new Set(configuration.disabled).size !== configuration.disabled.length
    || configuration.disabled.some(id => !ids.includes(id)))
    throw TypeError('Use only the existing backend plugin disabled IDs.');
  const disabled = new Set(configuration.disabled);
  return Object.freeze({ enabled: id => ids.includes(id) && !disabled.has(id) });
}
export async function mountMedusaBackend(selection, dependencies) {
  if (!selection.enabled('workspace-medusa-catalog')) return null;
  let module;
  try { module = await import('../plugins/workspace-medusa-catalog/src/module.mjs'); }
  catch (cause) {
    throw Object.assign(Error('Selected Medusa backend is missing or cannot load; restore its package or explicitly disable the backend.'),
      { code: 'BACKEND_PLUGIN_REQUIRED', pluginId: 'workspace-medusa-catalog', cause });
  }
  return module.createMedusaBackendModule(dependencies);
}

export function backendPluginsFromEnvironment(environment = {}) {
  const raw = environment.WORKSPACE_BACKEND_DISABLED_PLUGINS_JSON;
  if (raw === undefined) return { disabled: [] };
  if (typeof raw !== 'string' || raw.length > 4096) throw TypeError('Backend disabled plugins require a bounded JSON array.');
  let disabled;
  try { disabled = JSON.parse(raw); } catch { throw TypeError('Backend disabled plugins require valid JSON.'); }
  const configuration = { disabled };
  backendPluginSelection(configuration);
  return configuration;
}
