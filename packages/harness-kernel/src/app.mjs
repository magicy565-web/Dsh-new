// Workspace Harness kernel: bootstrap a Cordis context from a YAML composition,
// mount plugins in dependency order, fail closed with rollback, and serve HTTP.
import { Context, FiberState } from 'cordis';
import { appendFile } from 'node:fs/promises';
import {
  ERROR,
  HarnessError,
  validateComposition,
  validateConfig,
} from '../../harness-contracts/src/index.mjs';
import { KERNEL_SERVICES, readComposition, resolveRows } from './resolve.mjs';
import { applyPatches, digestComposition, readPatch, validatePatch } from './patch.mjs';
import { HttpKernel } from './http.mjs';

function logError(logger, ...args) {
  try {
    logger?.error?.(...args);
  } catch {
    // A broken logger must never break shutdown.
  }
}

function dependencyError(entry, service, reason) {
  return new HarnessError(
    ERROR.pluginMissingDependency,
    `plugin "${entry.row.id}" requires service "${service}", but ${reason}`,
    { pluginId: entry.row.id, service },
  );
}

/** Stable topological sort by declared `requires` (composition order breaks ties). */
function sortByRequires(entries, providers) {
  const enabled = new Map(entries.map(entry => [entry.row.id, entry]));
  const dependents = new Map();
  const indegree = new Map();
  for (const entry of entries) {
    const deps = new Set();
    for (const service of entry.manifest.requires) {
      if (KERNEL_SERVICES.includes(service)) continue;
      const providerId = providers.get(service);
      if (!providerId) throw dependencyError(entry, service, 'no enabled plugin provides it.');
      if (providerId === entry.row.id) continue; // a plugin may declare its own service
      if (enabled.has(providerId)) deps.add(providerId);
    }
    indegree.set(entry.row.id, deps.size);
    for (const providerId of deps) {
      if (!dependents.has(providerId)) dependents.set(providerId, []);
      dependents.get(providerId).push(entry.row.id);
    }
  }
  const ordered = [];
  const remaining = entries.map(entry => entry.row.id);
  while (remaining.length) {
    const index = remaining.findIndex(id => (indegree.get(id) ?? 0) === 0);
    if (index < 0) {
      throw new HarnessError(
        ERROR.pluginMissingDependency,
        `dependency cycle detected among: ${remaining.join(', ')}.`,
        { plugins: remaining },
      );
    }
    const [id] = remaining.splice(index, 1);
    ordered.push(enabled.get(id));
    for (const dependentId of dependents.get(id) ?? []) {
      indegree.set(dependentId, (indegree.get(dependentId) ?? 1) - 1);
    }
  }
  return ordered;
}

function toCordisPlugin(entry) {
  const id = entry.row.id;
  const descriptor = entry.plugin;
  if (!descriptor) {
    throw new HarnessError(ERROR.pluginFailed, `plugin "${id}" has no importable apply/factory export.`);
  }
  // Cordis only exposes a sibling plugin's service to a fiber that declares it via
  // `inject` (CONTRACT §3 "requires"). Kernel services are provided on the root
  // context and are already visible to every plugin.
  const inject = {};
  for (const service of entry.manifest.requires ?? []) {
    if (KERNEL_SERVICES.includes(service)) continue;
    if ((entry.manifest.provides ?? []).includes(service)) continue;
    inject[service] = null;
  }
  if (descriptor.kind === 'apply') {
    const { fn, thisArg } = descriptor;
    return {
      name: id,
      inject,
      apply: (ctx, config) => fn.call(thisArg, ctx, config),
    };
  }
  if (descriptor.kind === 'factory') {
    const { factory, factoryName } = descriptor;
    return {
      name: id,
      inject,
      apply: async (ctx, config) => {
        let instance;
        try {
          instance = await factory(config);
        } catch (error) {
          throw new Error(`factory ${factoryName}() failed: ${error?.message ?? error}`);
        }
        if (typeof instance === 'function') return instance(ctx, config);
        if (instance && typeof instance.apply === 'function') return instance.apply(ctx, config);
        throw new Error(`factory ${factoryName}() must return { apply(ctx, config) } or a plugin function.`);
      },
    };
  }
  throw new HarnessError(ERROR.pluginFailed, `plugin "${id}" has an unsupported module shape.`);
}

function mountError(id, error) {
  if (error instanceof HarnessError && error.code === ERROR.pluginDuplicate) return error;
  const message = error?.message ?? String(error);
  const duplicate = /service "([^"]+)" has been registered/u.exec(message);
  if (duplicate) {
    return new HarnessError(
      ERROR.pluginDuplicate,
      `plugin "${id}" provides service "${duplicate[1]}", which is already registered: ${message}`,
      { pluginId: id },
    );
  }
  const wrapped = new HarnessError(ERROR.pluginFailed, `plugin "${id}" failed to apply: ${message}`, { pluginId: id });
  if (error !== undefined) wrapped.cause = error;
  return wrapped;
}

function contextForRow(ctx, row) {
  const services = Object.keys(row.isolate ?? {});
  if (!services.length) return ctx;
  const tag = JSON.stringify(row.isolate, [...services].sort());
  let scoped = ctx;
  for (const service of services) {
    scoped = scoped.isolate(service, Symbol.for(`harness.isolate.${tag}.${service}`));
  }
  return scoped;
}

/**
 * Create a harness from a composition file or an already-composed composition.
 *
 * Mounting happens eagerly (fail closed with reverse-order rollback); the HTTP server
 * only starts on `start()`.
 *
 * @param {{compositionPath?: string, composition?: object, preset?: object, patchPaths?: string[], patches?: object[], auditPath?: string, root?: string, logger?: object}} options
 */
export async function createHarness({ compositionPath, composition: composed, preset = null, patchPaths = [], patches = [], auditPath = null, root = process.cwd(), logger = console } = {}) {
  const effectiveLogger = logger ?? console;
  let file = null;
  let composition;
  if (composed !== undefined && composed !== null) {
    composition = validateComposition(composed);
  } else {
    const loaded = await readComposition(compositionPath, { root });
    file = loaded.file;
    composition = loaded.composition;
  }
  let patchInfo = Object.freeze({ applied: Object.freeze([]), files: Object.freeze([]), digest: digestComposition(composition) });
  if (patchPaths.length || patches.length) {
    const layers = [];
    for (const path of patchPaths) layers.push((await readPatch(path, { root })).patch);
    for (const document of patches) layers.push(validatePatch(document));
    const applied = applyPatches(composition, layers);
    composition = applied.composition;
    patchInfo = Object.freeze({ applied: applied.applied, files: applied.files, digest: digestComposition(composition) });
  }
  const resolved = await resolveRows(composition.rows, { root, compositionFile: file });
  const enabled = resolved.filter(entry => !entry.row.disabled);

  // Fail closed before mounting anything when an entry cannot be resolved/imported.
  for (const entry of enabled) {
    if (entry.status === 'resolved') continue;
    const detail = entry.error?.message ?? `plugin entry is ${entry.status}.`;
    if (entry.error instanceof HarnessError) {
      throw new HarnessError(entry.error.code, `plugin row "${entry.row.id}" (${entry.row.name}): ${detail}`, {
        pluginId: entry.row.id,
        entry: entry.entry ?? null,
      });
    }
    throw new HarnessError(ERROR.pluginFailed, `plugin row "${entry.row.id}" (${entry.row.name}): ${detail}`, {
      pluginId: entry.row.id,
      entry: entry.entry ?? null,
    });
  }

  // Validate row config against the manifest configSchema (small JSON-Schema subset).
  for (const entry of enabled) {
    try {
      validateConfig(entry.manifest.configSchema, entry.row.config, `plugin "${entry.row.id}" config`);
    } catch (error) {
      if (error instanceof HarnessError) {
        throw new HarnessError(error.code, `plugin row "${entry.row.id}": ${error.message}`, {
          pluginId: entry.row.id,
        });
      }
      throw error;
    }
  }

  // Duplicate service providers are a composition error (CONTRACT §3).
  const providers = new Map(KERNEL_SERVICES.map(service => [service, null]));
  for (const entry of enabled) {
    for (const service of entry.manifest.provides) {
      const existing = providers.get(service);
      if (existing !== undefined && existing !== null) {
        throw new HarnessError(
          ERROR.pluginDuplicate,
          `service "${service}" is provided by both plugin "${existing}" and plugin "${entry.row.id}".`,
          { service, plugins: [existing, entry.row.id] },
        );
      }
      if (KERNEL_SERVICES.includes(service)) {
        throw new HarnessError(
          ERROR.pluginDuplicate,
          `plugin "${entry.row.id}" cannot provide kernel service "${service}".`,
          { service, pluginId: entry.row.id },
        );
      }
      providers.set(service, entry.row.id);
    }
  }

  // Missing dependencies + deterministic topological order.
  const order = sortByRequires(enabled, providers);

  const ctx = new Context();
  let server = null;
  let address = null;
  let stopped = false;
  const plugins = new Map();
  const mounted = [];
  const kernelDisposers = [];

  let http;
  const healthz = () => {
    const pluginReport = [...plugins.values()].map(record => {
      const state = record.fiber?.state;
      const ok = !record.disposed && state === FiberState.ACTIVE;
      const item = { id: record.id, status: ok ? 'ok' : 'failed' };
      if (!ok) item.error = record.error ?? (record.disposed ? 'plugin disposed' : 'plugin is not active');
      return item;
    });
    const checks = http ? http.healthChecks() : [];
    const pluginsOk = pluginReport.every(item => item.status === 'ok');
    const checksOk = checks.every(item => item.status === 'ok');
    return {
      status: pluginsOk && checksOk ? 'ok' : 'degraded',
      plugins: pluginReport,
      checks,
    };
  };

  http = new HttpKernel({ logger: effectiveLogger, getHealthz: healthz });
  const httpService = {
    route: definition => http.route(definition),
    health: (name, fn) => http.health(name, fn),
    list: () => http.routeList(),
    setActorResolver: resolver => http.setActorResolver(resolver),
  };
  const healthService = {
    register: (name, fn) => http.health(name, fn),
    list: () => http.healthChecks(),
  };

  try {
    kernelDisposers.push(ctx.provide('http', httpService));
    kernelDisposers.push(ctx.provide('health', healthService));
    // Forward Cordis' own lifecycle warnings/errors to the harness logger (errors are
    // message-only: stack traces belong to the thrown HarnessError, not this log sink).
    kernelDisposers.push(
      ctx.logger.exporter({
        export(message) {
          const sink = effectiveLogger?.[message.type];
          if (typeof sink !== 'function') return;
          const args = message.args.map(argument => (argument instanceof Error ? argument.message : argument));
          sink.call(effectiveLogger, `[cordis:${message.name}]`, ...args);
        },
      }),
    );
  } catch (error) {
    throw error instanceof HarnessError
      ? error
      : new HarnessError(ERROR.pluginFailed, `cannot initialise kernel services: ${error?.message ?? error}`);
  }

  const disposeKernel = async () => {
    while (kernelDisposers.length) {
      const dispose = kernelDisposers.pop();
      try {
        await dispose();
      } catch (error) {
        logError(effectiveLogger, `[harness] kernel service dispose failed: ${error?.message ?? error}`);
      }
    }
  };

  const disposeRecord = async record => {
    if (record.disposed) return;
    record.disposed = true;
    http.removePlugin(record.id);
    try {
      await record.fiber?.dispose();
      record.status = 'disposed';
    } catch (error) {
      record.status = 'failed';
      record.error = error?.message ?? String(error);
      logError(effectiveLogger, `[harness] plugin "${record.id}" dispose failed: ${record.error}`);
    }
  };

  const rollback = async records => {
    for (const record of [...records].reverse()) await disposeRecord(record);
  };

  try {
    for (const entry of order) {
      const id = entry.row.id;
      const record = {
        id,
        row: entry.row,
        manifest: entry.manifest,
        entry: entry.entry ?? null,
        entryPath: entry.entryPath ?? null,
        fiber: null,
        status: 'loading',
        disposed: false,
        error: undefined,
        dispose: async () => disposeRecord(record),
      };
      http.beginPlugin(id);
      let fiber;
      try {
        fiber = await contextForRow(ctx, entry.row).plugin(toCordisPlugin(entry), entry.row.config);
        if (fiber.state !== FiberState.ACTIVE) {
          throw new Error(
            `plugin did not become active (state ${fiber.state}); declared requires [${entry.manifest.requires.join(', ')}] were not all provided.`,
          );
        }
      } catch (error) {
        http.removePlugin(id);
        record.status = 'failed';
        record.error = error?.message ?? String(error);
        const wrapped = mountError(id, error);
        await rollback(mounted);
        await disposeKernel();
        throw wrapped;
      } finally {
        http.endPlugin(id);
      }
      record.fiber = fiber;
      record.status = 'ok';
      plugins.set(id, record);
      mounted.push(record);
    }
  } catch (error) {
    // `rollback`/`disposeKernel` already ran for mount failures; make sure the root
    // context does not keep serving if an unexpected error escapes.
    if (!(error instanceof HarnessError)) {
      await rollback(mounted);
      await disposeKernel();
      throw new HarnessError(ERROR.pluginFailed, `kernel bootstrap failed: ${error?.message ?? error}`);
    }
    throw error;
  }

  const auditEntry = async (event, extra = {}) => {
    if (!auditPath) return;
    try {
      const line = JSON.stringify({
        at: new Date().toISOString(),
        event,
        composition: { file, name: composition.name, digest: digestComposition(composition) },
        patches: { files: patchInfo.files, digest: patchInfo.digest, applied: patchInfo.applied },
        preset: preset?.name ?? null,
        plugins: [...plugins.keys()],
        ...extra,
      });
      await appendFile(auditPath, `${line}\n`, { mode: 0o600 });
    } catch (error) {
      logError(effectiveLogger, `[harness] audit append failed: ${error?.message ?? error}`);
    }
  };
  await auditEntry('harness.mount');

  const start = async () => {
    if (stopped) throw new HarnessError(ERROR.pluginFailed, 'harness has been stopped; create a new harness.');
    if (server) return { server, address };
    const result = await http.start({ host: composition.server.host, port: composition.server.port });
    server = result.server;
    address = result.address;
    await auditEntry('harness.start', { address: address?.url ?? null });
    return result;
  };

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try {
      await http.stop();
    } catch (error) {
      logError(effectiveLogger, `[harness] HTTP server stop failed: ${error?.message ?? error}`);
    }
    await rollback(mounted);
    await disposeKernel();
    await auditEntry('harness.stop');
  };

  return {
    ctx,
    rows: composition.rows,
    plugins,
    start,
    stop,
    healthz,
    // Extra, non-contractual introspection used by the CLI and tests.
    composition: { file, name: composition.name, server: composition.server, digest: digestComposition(composition) },
    preset,
    patches: patchInfo,
    // Capability declarations of the mounted rows (no values, no secrets).
    manifests: resolved.map(entry => Object.freeze({
      pluginId: entry.row.id,
      manifestId: entry.manifest?.id ?? null,
      env: Object.freeze(entry.manifest ? [...entry.manifest.env] : []),
    })),
    http,
  };
}
