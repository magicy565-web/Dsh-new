// Tenant-scoped storage views.
//
// `scopeStorage(storage, workspaceId)` returns a store-shaped view whose reads and
// updates go to `state.workspaces[workspaceId]` instead of the top-level state.
// Two workspaces therefore never share business records, while the storage seam
// keeps one durable file and one lock. Keys are validated; a missing partition is
// created on first update and read as an empty object.
import { ERROR, HarnessError } from '../../harness-contracts/src/index.mjs';

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const ROOT_KEY = 'workspaces';

export function scopeStorage(storage, workspaceId, { rootKey = ROOT_KEY } = {}) {
  if (!storage || typeof storage.read !== 'function' || typeof storage.update !== 'function')
    throw new TypeError('scopeStorage requires a storage service with read() and update().');
  if (typeof workspaceId !== 'string' || !ID.test(workspaceId))
    throw new HarnessError(ERROR.workspaceInvalid, `Cannot scope storage to ${JSON.stringify(workspaceId)}.`);
  if (typeof rootKey !== 'string' || !ID.test(rootKey))
    throw new TypeError('scopeStorage rootKey must be a bounded identifier.');

  const partition = root => {
    const bucket = root[rootKey];
    return bucket && typeof bucket === 'object' ? bucket[workspaceId] : undefined;
  };

  return Object.freeze({
    workspaceId,
    rootKey,
    read() {
      const value = partition(storage.read());
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    },
    async update(mutator) {
      if (typeof mutator !== 'function') throw new TypeError('scopeStorage.update requires a function.');
      return await storage.update(root => {
        root[rootKey] ??= {};
        if (typeof root[rootKey] !== 'object' || Array.isArray(root[rootKey]))
          throw new HarnessError(ERROR.storageInvalid, `storage.${rootKey} must be an object of tenant partitions.`);
        root[rootKey][workspaceId] ??= {};
        if (typeof root[rootKey][workspaceId] !== 'object' || Array.isArray(root[rootKey][workspaceId]))
          throw new HarnessError(ERROR.storageInvalid, `storage.${rootKey}.${workspaceId} must be an object.`);
        return mutator(root[rootKey][workspaceId]);
      });
    },
    /** Read-only root access for callers that need shared (non-tenant) state. */
    root() { return storage.read(); },
  });
}
