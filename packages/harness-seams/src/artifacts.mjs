// Artifacts seam: private artifact storage backed by the existing
// `server/artifacts.mjs` service.
//
// The seam owns no artifact logic of its own. It adapts the frozen `ctx.storage`
// service (read/update/directory) to the store shape the repo's single artifact
// service already expects, mounts that service on its own private directory and
// publishes the `ctx.artifacts` provider contract:
//
//   create(body)             -> Promise<{ artifact, duplicate? }>
//   update(id, body)         -> Promise<{ artifact }>
//   read(id, options?)       -> Promise<{ artifact, version, encoding, content }>
//   download(id, options?)   -> Promise<{ artifact, version, bytes, filename, mimeType }>
//   inspect(id)              -> Promise<{ artifact, versions }>
//   list(filters?)           -> { artifacts }
//   get(id)                  -> { artifact }
//   close()                  -> Promise<void>
//   directory                -> canonical artifacts directory
//
// Dependency rule: the provider `requires` the `storage` service
// (`manifest.requires = ['storage']`). The kernel turns that into Cordis `inject`,
// so the plugin fiber only becomes active when a storage provider is mounted; in
// plain-object contexts `apply` refuses with HARNESS_PLUGIN_MISSING_DEPENDENCY.
//
// Directory rule (stated in the report):
//   * `config.directory` defaults to `<ctx.storage.directory>/artifacts`;
//   * a relative `config.directory` is resolved against `ctx.storage.directory`;
//   * an absolute `config.directory` is honoured only if it is inside
//     `ctx.storage.directory`;
//   * the storage directory itself, any path escaping it, and the repository root
//     are refused with HARNESS_STORAGE_INVALID before any I/O — artifacts never
//     live at (or outside) the repository root.
//
// Artifact records are committed through `ctx.storage.update`, i.e. they live in
// the same durable workspace snapshot the rest of the harness uses (that is what
// `createInquiryRecoveryService({ store, artifacts })` expects). Only the blob
// bytes live in the private artifacts directory, exactly as in the app server.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ARTIFACT_MAX_BYTES, createArtifactService } from '../../../server/artifacts.mjs';
import { ERROR, HarnessError, SERVICE } from '../../harness-contracts/src/index.mjs';
import { provideService, serviceFromContext } from './ctx.mjs';
import { REPO_ROOT } from './storage.mjs';

/** Published service name (`ctx.artifacts`); CONTRACT.md §5 names the others. */
export const ARTIFACTS_SERVICE = 'artifacts';
/** Default subdirectory of the storage state directory. */
export const DEFAULT_ARTIFACTS_DIRECTORY = 'artifacts';

/** Lightweight provider manifest (optional for the kernel; used for topo/list if honoured). */
export const manifest = Object.freeze({
  id: 'artifacts',
  version: '0.1.0',
  kind: 'provider',
  description: 'Private artifact store for generated files, persisted through ctx.storage',
  entry: './src/artifacts.mjs',
  requires: Object.freeze([SERVICE.storage]),
  provides: Object.freeze([ARTIFACTS_SERVICE]),
  configSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: Object.freeze({
      directory: Object.freeze({
        type: 'string',
        minLength: 1,
        description: 'Artifacts directory; relative paths resolve against the storage state directory.',
      }),
      maxBytes: Object.freeze({ type: 'integer', minimum: 1, maximum: ARTIFACT_MAX_BYTES }),
      maxTotalBytes: Object.freeze({ type: 'integer', minimum: 1 }),
      maxArtifacts: Object.freeze({ type: 'integer', minimum: 1, maximum: 10_000 }),
    }),
  }),
});

const isInside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

/**
 * Resolve and validate the directory an artifacts provider may open.
 * Pure path logic: throws HARNESS_STORAGE_INVALID for the same class of unsafe
 * directories the storage seam refuses (empty/non-string, state-directory root,
 * repository root, relative or absolute escapes), before any I/O.
 *
 * @param {string|undefined} directory `config.directory` (relative to the state directory).
 * @param {string} storageDirectory absolute `ctx.storage.directory`.
 * @returns {string} resolved, not-yet-canonical artifacts directory.
 */
export function resolveArtifactsDirectory(directory, storageDirectory) {
  if (typeof storageDirectory !== 'string' || !path.isAbsolute(storageDirectory))
    throw new HarnessError(
      ERROR.storageInvalid,
      'The storage service must expose an absolute state directory (ctx.storage.directory) before artifacts can mount.',
    );
  const base = path.resolve(storageDirectory);
  let requested;
  if (directory === undefined || directory === null) {
    requested = path.join(base, DEFAULT_ARTIFACTS_DIRECTORY);
  } else {
    if (typeof directory !== 'string' || !directory.trim())
      throw new HarnessError(ERROR.storageInvalid, `config.directory must be a non-empty string; got ${JSON.stringify(directory)}.`);
    requested = path.resolve(base, directory);
  }
  if (requested === base)
    throw new HarnessError(
      ERROR.storageInvalid,
      `config.directory must be a subdirectory of the storage directory, not the storage directory itself (${base}).`,
    );
  if (requested === path.resolve(REPO_ROOT))
    throw new HarnessError(ERROR.storageInvalid, 'config.directory must not be the repository root.');
  if (!isInside(base, requested))
    throw new HarnessError(
      ERROR.storageInvalid,
      `config.directory ${JSON.stringify(directory)} must stay inside the storage directory ${base}; artifacts live under harness state only.`,
    );
  return requested;
}

/**
 * Open the artifact service directly (tests and embedders).
 * `store` is any service exposing the frozen `ctx.storage` shape
 * (`read()`, `update(fn)`, `directory`); the real storage seam is passed in tests.
 *
 * @param {{store: {read: Function, update: Function, directory: string},
 *   directory?: string, maxBytes?: number, maxTotalBytes?: number, maxArtifacts?: number}} options
 * @returns {Promise<object>} the published `ctx.artifacts` service.
 */
export async function createArtifacts({ store, directory, maxBytes, maxTotalBytes, maxArtifacts } = {}) {
  if (!store || typeof store.read !== 'function' || typeof store.update !== 'function')
    throw new TypeError('The artifacts seam requires an open storage service (ctx.storage with read() and update(fn)).');
  const requested = resolveArtifactsDirectory(directory, store.directory);
  // Adapt the frozen storage service to the store shape `createArtifactService`
  // expects; persistence, locking, quotas and integrity checks stay in
  // server/artifacts.mjs and server/store.mjs. Nothing is duplicated here.
  const adapter = {
    directory: store.directory,
    read: () => store.read(),
    update: callback => store.update(callback),
  };
  const service = await createArtifactService({ store: adapter, directory: requested, maxBytes, maxTotalBytes, maxArtifacts });
  const canonical = await fs.realpath(requested);
  // Publish exactly the seam contract; `delete`/`export`/admission-only entry
  // points stay available to the app server, not to harness plugins.
  return Object.freeze({
    directory: canonical,
    create: body => service.create(body),
    update: (id, body) => service.update(id, body),
    read: (id, options) => service.read(id, options),
    download: (id, options) => service.download(id, options),
    inspect: id => service.inspect(id),
    list: filters => service.list(filters ?? {}),
    get: id => service.get(id),
    close: () => service.close(),
  });
}

/**
 * Mountable provider: `createArtifactsProvider({ directory, maxBytes, maxTotalBytes, maxArtifacts }).apply(ctx)`.
 * Requires `ctx.storage`; publishes `ctx.artifacts` (via `ctx.provide` on Cordis)
 * and returns an async disposer that closes the artifact service. The storage
 * service itself is never closed here: its own provider owns its lifecycle.
 */
export function createArtifactsProvider(options = {}) {
  let service;
  let registration;
  let disposer;
  const apply = async (ctx, config = {}) => {
    if (!ctx || typeof ctx !== 'object') throw new TypeError('The artifacts provider requires a kernel context object.');
    if (!registration) {
      const existing = serviceFromContext(ctx, ARTIFACTS_SERVICE);
      if (existing !== undefined && existing !== service)
        throw new HarnessError(ERROR.pluginDuplicate, 'ctx.artifacts is already registered by another provider.', {
          service: ARTIFACTS_SERVICE,
        });
    }
    if (!service) {
      const storage = options.storage ?? serviceFromContext(ctx, SERVICE.storage);
      if (!storage || typeof storage.read !== 'function' || typeof storage.update !== 'function')
        throw new HarnessError(
          ERROR.pluginMissingDependency,
          'The artifacts provider requires ctx.storage (read/update/directory); mount the storage seam first.',
          { service: SERVICE.storage },
        );
      service = await createArtifacts({
        store: storage,
        directory: options.directory ?? config?.directory,
        maxBytes: options.maxBytes ?? config?.maxBytes,
        maxTotalBytes: options.maxTotalBytes ?? config?.maxTotalBytes,
        maxArtifacts: options.maxArtifacts ?? config?.maxArtifacts,
      });
    }
    if (!registration) registration = provideService(ctx, ARTIFACTS_SERVICE, service);
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
// `import * as artifacts from '.../artifacts.mjs'; await artifacts.apply(ctx, row.config)`.
const providers = new WeakMap();
export async function apply(ctx, config = {}) {
  if (!ctx || typeof ctx !== 'object') throw new TypeError('The artifacts provider requires a kernel context object.');
  let provider = providers.get(ctx);
  if (!provider) {
    provider = createArtifactsProvider(config ?? {});
    providers.set(ctx, provider);
  }
  return provider.apply(ctx, config);
}

export default {
  createArtifacts,
  createArtifactsProvider,
  resolveArtifactsDirectory,
  apply,
  manifest,
  ARTIFACTS_SERVICE,
  DEFAULT_ARTIFACTS_DIRECTORY,
};
