// Storage seam: durable harness state backed by the existing `server/store.mjs`.
//
// The seam owns no persistence format of its own. It resolves the directory the
// composition asked for, opens the repo's single-writer store and exposes the
// frozen `ctx.storage` contract from packages/harness-contracts/CONTRACT.md §5:
//
//   read()            -> state (detached snapshot)
//   update(fn)        -> Promise<result> (fn(state) mutates synchronously, atomic commit)
//   close()           -> Promise<void>
//   directory         -> canonical storage directory
//
// Directory rule (chosen, stated in the report):
//   * a relative `config.directory` is resolved against the repository root
//     (default `process.cwd()`) and MUST stay inside it;
//   * an absolute `config.directory` is honoured as explicit operator intent
//     (this is how tests, CI and dedicated volumes mount the store);
//   * the repository root itself and the live Workspace data directory
//     (`<root>/.data`, see server/index.mjs) are always refused: the harness
//     gets its own directory and never writes existing Workspace data.
//
// Store failures are propagated unchanged (e.g. WORKSPACE_DATA_INVALID for a
// damaged `workspace.json`); only seam-level configuration errors are wrapped in
// `HARNESS_STORAGE_INVALID`, so a damaged state is refused exactly like the
// original store refuses it.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../../../server/store.mjs';
import { ERROR, HarnessError, SERVICE } from '../../harness-contracts/src/index.mjs';
import { provideService, serviceFromContext } from './ctx.mjs';

/** Default harness data directory; deliberately different from the app's `.data`. */
export const DEFAULT_DIRECTORY = '.harness-data';
/**
 * This checkout's root: the boundary for relative storage directories. Derived
 * from the module location so it does not depend on the launch cwd.
 */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
/** The running application's live data directory (server/index.mjs → `.data`). */
const WORKSPACE_DATA_DIRECTORY = '.data';

/** Lightweight provider manifest (optional for the kernel; used for topo/list if honoured). */
export const manifest = Object.freeze({
  id: 'storage',
  version: '0.1.0',
  kind: 'provider',
  description: 'Durable harness state on the existing workspace store',
  entry: './src/storage.mjs',
  requires: Object.freeze([]),
  provides: Object.freeze([SERVICE.storage]),
});

const isInside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

/**
 * Resolve and validate the directory a storage provider may open.
 * Throws HARNESS_STORAGE_INVALID for paths the seam refuses, before any I/O.
 */
export function resolveStorageDirectory(directory = DEFAULT_DIRECTORY, root = REPO_ROOT) {
  if (typeof directory !== 'string' || !directory.trim())
    throw new HarnessError(ERROR.storageInvalid, `config.directory must be a non-empty string; got ${JSON.stringify(directory)}.`);
  if (typeof root !== 'string' || !path.isAbsolute(root))
    throw new HarnessError(ERROR.storageInvalid, 'The storage root must be an absolute directory path.');
  const base = path.resolve(root);
  const requested = path.resolve(base, directory);
  if (requested === base)
    throw new HarnessError(ERROR.storageInvalid, `config.directory must be a subdirectory, not the directory root ${base}.`);
  if (!path.isAbsolute(directory) && !isInside(base, requested))
    throw new HarnessError(
      ERROR.storageInvalid,
      `Relative config.directory ${JSON.stringify(directory)} must stay inside the repository root ${base}.`,
    );
  const workspaceData = path.join(base, WORKSPACE_DATA_DIRECTORY);
  if (isInside(workspaceData, requested))
    throw new HarnessError(
      ERROR.storageInvalid,
      `config.directory must not be the live Workspace data directory (${workspaceData}); the harness uses its own directory.`,
    );
  return requested;
}

/**
 * Open the durable storage service directly (tests and embedders).
 * @returns {Promise<{directory: string, read(): object, update(fn: Function): Promise<any>, close(): Promise<void>}>}
 */
export async function createStorage({ directory = DEFAULT_DIRECTORY, root = REPO_ROOT } = {}) {
  const resolved = resolveStorageDirectory(directory, root);
  // openStore errors (damaged/unsupported/unsafe state) intentionally escape
  // unwrapped: callers must observe the store's own codes and messages.
  const store = await openStore(resolved);
  let closed = false;
  const service = {
    directory: store.directory,
    read: () => store.read(),
    update: callback => {
      if (typeof callback !== 'function')
        return Promise.reject(new TypeError('storage.update requires a synchronous state-mutating callback.'));
      if (closed) return Promise.reject(new Error('The harness storage service is closed.'));
      return store.update(callback);
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await store.close();
    },
  };
  return Object.freeze(service);
}

/**
 * Mountable provider: `createStorageProvider({ directory, root }).apply(ctx)`.
 * Registers `ctx.storage` (via `ctx.provide` on Cordis) and returns an async
 * disposer that closes the store.
 */
export function createStorageProvider(options = {}) {
  let service;
  let registration;
  let disposer;
  const apply = async (ctx, config = {}) => {
    if (!ctx || typeof ctx !== 'object') throw new TypeError('The storage provider requires a kernel context object.');
    if (!registration) {
      const existing = serviceFromContext(ctx, SERVICE.storage);
      if (existing !== undefined && existing !== service)
        throw new HarnessError(ERROR.pluginDuplicate, 'ctx.storage is already registered by another provider.', { service: SERVICE.storage });
    }
    if (!service) {
      const directory = options.directory ?? config?.directory ?? DEFAULT_DIRECTORY;
      const root = options.root ?? config?.root ?? REPO_ROOT;
      service = await createStorage({ directory, root });
    }
    if (!registration) registration = provideService(ctx, SERVICE.storage, service);
    if (!disposer) {
      let disposed = false;
      disposer = async () => {
        if (disposed) return;
        disposed = true;
        try {
          if (registration) await registration.dispose();
        } finally {
          await service.close();
        }
      };
    }
    return disposer;
  };
  return { apply };
}

// Fallback for loaders that import the module instead of calling the factory:
// `import * as storage from '.../storage.mjs'; await storage.apply(ctx, row.config)`.
const providers = new WeakMap();
export async function apply(ctx, config = {}) {
  if (!ctx || typeof ctx !== 'object') throw new TypeError('The storage provider requires a kernel context object.');
  let provider = providers.get(ctx);
  if (!provider) {
    provider = createStorageProvider(config ?? {});
    providers.set(ctx, provider);
  }
  return provider.apply(ctx, config);
}

export default { createStorage, createStorageProvider, resolveStorageDirectory, apply, manifest, DEFAULT_DIRECTORY };
