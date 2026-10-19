// Original Host assembly. No arbitrary module URL or replacement OMP loader.
import { createPluginLibraryModule } from './plugin-library/http.mjs';
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

// Compatibility export retained for the original createApp call site. When the
// separately reviewed plugin-library option is enabled, this existing assembly
// seam also contributes its authenticated routes. Management does not depend on
// Medusa being installed/enabled; it never supplies a fake Medusa service.
export async function mountMedusaBackend(selection, dependencies) {
  let medusa = null, library = null;
  try {
    if (selection.enabled('workspace-medusa-catalog')) {
      let module;
      try { module = await import('../plugins/workspace-medusa-catalog/src/module.mjs'); }
      catch (cause) {
        throw Object.assign(Error('Selected Medusa backend is missing or cannot load; restore its package or explicitly disable the backend.'),
          { code: 'BACKEND_PLUGIN_REQUIRED', pluginId: 'workspace-medusa-catalog', cause });
      }
      medusa = module.createMedusaBackendModule(dependencies);
    }
    library = await createPluginLibraryModule({
      ApiError: dependencies.ApiError, workspaceId: dependencies.workspaceId,
      environment: dependencies.environment || {}, backendSelection: selection,
    });
  } catch (error) { await medusa?.close(); throw error; }
  // Preserve the exact old result when plugin administration was not selected.
  if (!library) return medusa;
  let closing;
  return Object.freeze({
    service: medusa?.service,
    async handle(request) {
      if (await library.handle(request)) return true;
      return medusa ? medusa.handle(request) : false;
    },
    close() {
      if (!closing) closing = Promise.all([library.close(), medusa?.close()]).then(() => undefined);
      return closing;
    },
  });
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
