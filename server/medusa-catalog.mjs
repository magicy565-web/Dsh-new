// Compatibility assembly; domain implementation belongs to the plugin.
import { ApiError } from './runtime.mjs';
import { createMedusaCatalogBackend } from '../plugins/workspace-medusa-catalog/src/backend.mjs';
const backend = createMedusaCatalogBackend({ ApiError });
export const { createMedusaCatalogConfiguration, medusaSourceHash, medusaDraftHandle } = backend;
export function createMedusaCatalogService(options = {}) {
  return backend.createMedusaCatalogService({ environment: process.env, ...options });
}
