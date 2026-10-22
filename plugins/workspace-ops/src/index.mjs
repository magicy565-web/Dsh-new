// Harness plugin: operational status and reviewed backups.
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ERROR, HarnessError } from '../../../packages/harness-contracts/src/index.mjs';
import { OPS_PAGE } from './area.mjs';
import { OPS_LIMITS, OpsError, createOpsService, summarize } from './domain.mjs';

export const PLUGIN_ID = 'workspace-ops';
const BASE = '/api/ops';
const BACKUP_FILE = /^backup-[0-9A-Za-z._-]+\.json$/u;

export const ROUTES = Object.freeze([
  ['GET', `${BASE}/status`],
  ['GET', `${BASE}/backups`],
  ['POST', `${BASE}/backups`],
  ['POST', `${BASE}/restore`],
  ['GET', '/ops'],
]);

const missing = service => new HarnessError(ERROR.pluginMissingDependency, `${PLUGIN_ID} requires ctx.${service}.`);

function asHarnessError(error) {
  if (error instanceof HarnessError) return error;
  if (error instanceof OpsError) {
    const wrapped = new HarnessError(error.code, error.message);
    wrapped.status = error.status;
    return wrapped;
  }
  return error;
}

export async function apply(ctx, config = {}) {
  if (!ctx?.http?.route) throw missing('http');
  if (!ctx?.storage?.read || !ctx?.storage?.update) throw missing('storage');
  if (config === null || typeof config !== 'object' || Array.isArray(config))
    throw new HarnessError(ERROR.manifestInvalid, `${PLUGIN_ID} config must be an object.`);
  if (Object.keys(config).some(key => !['backupDirectory', 'version'].includes(key)))
    throw new HarnessError(ERROR.manifestInvalid, `${PLUGIN_ID} config has an unsupported field.`);
  if (config.backupDirectory !== undefined && (typeof config.backupDirectory !== 'string' || !path.isAbsolute(config.backupDirectory)))
    throw new HarnessError(ERROR.manifestInvalid, 'config.backupDirectory must be an absolute path.');
  const backupDirectory = config.backupDirectory
    ?? (typeof ctx.storage.directory === 'string' ? path.join(ctx.storage.directory, 'backups') : null);
  if (backupDirectory === null)
    throw new HarnessError(ERROR.manifestInvalid, 'config.backupDirectory is required when storage has no directory.');

  const service = createOpsService({
    storage: ctx.storage,
    version: config.version ?? '0.0.0',
    startedAt: Date.now(),
  });
  const call = handler => async (_req, _res, context) => {
    try { return await handler(context ?? {}); }
    catch (error) { throw asHarnessError(error); }
  };

  async function listBackups() {
    let names;
    try { names = await readdir(backupDirectory); }
    catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const items = [];
    for (const name of names) {
      if (!BACKUP_FILE.test(name)) continue;
      if (items.length >= OPS_LIMITS.backups) break;
      const info = await stat(path.join(backupDirectory, name));
      items.push({ id: name.replace(/^backup-/u, '').replace(/\.json$/u, ''), file: name, bytes: info.size, createdAt: info.mtime.toISOString() });
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  ctx.http.route({
    method: 'GET', path: '/ops',
    handler: () => new Response(OPS_PAGE, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      },
    }),
  });

  ctx.http.route({ method: 'GET', path: `${BASE}/status`, handler: call(context => ({ status: 200, body: service.status(context) })) });

  ctx.http.route({
    method: 'GET', path: `${BASE}/backups`,
    handler: call(async context => {
      service.status(context); // authorisation only
      return { status: 200, body: { directory: backupDirectory, total: (await listBackups()).length, items: await listBackups() } };
    }),
  });

  ctx.http.route({
    method: 'POST', path: `${BASE}/backups`,
    handler: call(async context => {
      service.status(context); // authorisation only
      const state = ctx.storage.read() ?? {};
      const text = JSON.stringify(state);
      if (Buffer.byteLength(text, 'utf8') > OPS_LIMITS.backupBytes)
        throw Object.assign(new HarnessError('OPS_BACKUP_TOO_LARGE', 'The state is too large to back up here.'), { status: 413 });
      await mkdir(backupDirectory, { recursive: true });
      const id = new Date().toISOString().replace(/[:.]/gu, '-');
      const file = `backup-${id}.json`;
      await writeFile(path.join(backupDirectory, file), text, 'utf8');
      return { status: 201, body: { backup: { id, file, bytes: Buffer.byteLength(text, 'utf8'), createdAt: new Date().toISOString() } } };
    }),
  });

  ctx.http.route({
    method: 'POST', path: `${BASE}/restore`,
    handler: call(async context => {
      const body = context.body ?? {};
      const id = body.backupId;
      if (typeof id !== 'string' || !/^[0-9A-Za-z._-]+$/u.test(id))
        throw Object.assign(new HarnessError('OPS_INPUT', 'backupId is required.'), { status: 400 });
      service.status(context); // authorisation only
      const file = path.join(backupDirectory, `backup-${id}.json`);
      let text;
      try { text = await readFile(file, 'utf8'); }
      catch { throw Object.assign(new HarnessError('OPS_BACKUP_NOT_FOUND', 'No such backup.'), { status: 404 }); }
      const value = JSON.parse(text);
      const result = await service.restore(context, { backupId: id, confirm: body.confirm, value });
      if (ctx.audit?.record) await ctx.audit.record({ kind: 'ops', action: 'ops.restore', actor: context.actor?.subject, ref: id });
      return { status: 200, body: result };
    }),
  });

  let disposeService = null;
  if (typeof ctx.provide === 'function') disposeService = ctx.provide('ops', { ...service, listBackups, backupDirectory });
  if (ctx.health?.register) {
    ctx.health.register('ops', () => {
      const state = ctx.storage.read() ?? {};
      return { status: 'ok', detail: { counts: summarize(state) } };
    });
  }
  return async () => { if (typeof disposeService === 'function') await disposeService(); };
}

export { OPS_LIMITS, summarize, validateBackup, createOpsService } from './domain.mjs';
export default { apply };
