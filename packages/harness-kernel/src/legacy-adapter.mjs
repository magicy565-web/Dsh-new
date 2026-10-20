// Legacy adapter: expose harness seams through the service shapes the existing
// enterprise server already passes around (`store`, `artifacts`, `approval`,
// `tools`, `audit`, `workspace`). This is the primitive P1 needs: legacy modules
// keep their signatures while the harness composition supplies the services.
//
// Nothing here reaches a network, reads files or creates a second store; every
// accessor resolves the live service from the mounted Cordis context.
import { ERROR, HarnessError, SERVICE } from '../../harness-contracts/src/index.mjs';

const fail = message => { throw new HarnessError(ERROR.pluginMissingDependency, message); };

/** Read a service from a harness object (`{ctx}`) or a bare context. */
export function resolveService(source, name) {
  const ctx = source?.ctx && typeof source.ctx === 'object' ? source.ctx : source;
  if (!ctx || typeof ctx !== 'object') throw new TypeError('legacy adapter requires a harness or a kernel context.');
  try {
    const direct = ctx[name];
    if (direct !== undefined && direct !== null) return direct;
  } catch {
    // A Cordis property that is neither declared nor injected throws; fall through.
  }
  try {
    const reflected = ctx.reflect?.get?.(name, false);
    if (reflected !== undefined && reflected !== null) return reflected;
  } catch {
    // No reflection service, or the service is absent.
  }
  return undefined;
}

/**
 * Build the legacy service map from a mounted harness.
 * `storage` is required (the original server cannot start without it); the other
 * seams are optional and surface as `null` when the composition does not mount them.
 */
export function createLegacyServices(source, { requireStorage = true } = {}) {
  const storage = resolveService(source, SERVICE.storage);
  if (requireStorage && !storage) fail('the composition does not mount ctx.storage; the legacy runtime cannot start.');
  return Object.freeze({
    store: storage ?? null,
    artifacts: resolveService(source, SERVICE.artifacts) ?? null,
    approval: resolveService(source, SERVICE.approval) ?? null,
    tools: resolveService(source, SERVICE.tools) ?? null,
    audit: resolveService(source, SERVICE.audit) ?? null,
    workspace: resolveService(source, SERVICE.workspace) ?? null,
    inbound: {
      // The legacy server expects `store.read()` / `store.update(fn)`; the storage
      // seam already has exactly that shape, so no wrapping is required.
      store: storage ?? null,
    },
  });
}

/**
 * Create the inquiry recovery domain service on top of harness seams. The domain
 * package is intentionally host-agnostic (store + optional artifacts + actor), so
 * the legacy server and the harness plugin share this exact code path.
 */
export async function createLegacyInquiryRecovery(source, options = {}) {
  const { createInquiryRecoveryService } = await import('../../domain-inquiry-recovery/src/index.mjs');
  const services = createLegacyServices(source, { requireStorage: true });
  return createInquiryRecoveryService({
    store: services.store,
    artifacts: services.artifacts,
    workspaceId: options.workspaceId ?? 'local',
    staleDays: options.staleDays ?? 7,
    ...(options.clock ? { clock: options.clock } : {}),
  });
}
