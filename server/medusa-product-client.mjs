// Compatibility assembly; same original Host error and disclosure contracts.
import { ApiError } from './runtime.mjs';
import { createMedusaProductClientFactory } from '../plugins/workspace-medusa-catalog/src/product-client.mjs';
export const createMedusaProductClient = createMedusaProductClientFactory({ ApiError });
