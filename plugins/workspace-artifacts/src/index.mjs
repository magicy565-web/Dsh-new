// Harness plugin: the file surface for a single workspace.
//
// It exposes the artifacts seam over HTTP so a person can bring a text file
// into a conversation: upload, list, read metadata and read the text back.
// Binary files are accepted for storage but cannot be attached to a model run,
// which the runner enforces separately.
import { ERROR, HarnessError } from '../../../packages/harness-contracts/src/index.mjs';
import { FILES_PAGE } from './area.mjs';

export const PLUGIN_ID = 'workspace-artifacts';
const BASE = '/api/artifacts';
const MAX_TEXT_BYTES = 512 * 1024;
const MAX_BINARY_BYTES = 5 * 1024 * 1024;
const TEXT_TYPES = Object.freeze(['text/plain', 'text/markdown', 'text/csv', 'application/json']);
const BINARY_TYPES = Object.freeze([
  'image/png', 'image/jpeg', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream',
]);

export const ROUTES = Object.freeze([
  ['POST', BASE],
  ['GET', BASE],
  ['GET', `${BASE}/:id`],
  ['GET', `${BASE}/:id/content`],
  ['GET', `${BASE}/:id/download`],
  ['GET', '/files'],
]);

const manifestError = message => new HarnessError(ERROR.manifestInvalid, message);
const missing = service => new HarnessError(ERROR.pluginMissingDependency, `${PLUGIN_ID} requires ctx.${service}.`);
const invalid = message => { const error = new HarnessError('ARTIFACT_INVALID', message); error.status = 400; return error; };
const forbidden = message => { const error = new HarnessError('HARNESS_FORBIDDEN', message); error.status = 403; return error; };

function asHarnessError(error) {
  if (error instanceof HarnessError) return error;
  if (error && typeof error.code === 'string' && Number.isInteger(error.status)) {
    const wrapped = new HarnessError(error.code, error.message);
    wrapped.status = error.status;
    return wrapped;
  }
  return error;
}

function isPlain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function uploadMeta(body) {
  return {
    filename: body.filename,
    ...(body.title === undefined ? {} : { title: body.title }),
    ...(body.description === undefined ? {} : { description: body.description }),
    ...(body.requestId === undefined ? {} : { requestId: body.requestId }),
  };
}

async function uploadText(ctx, body) {
  if (typeof body.content !== 'string') throw invalid('content must be a string for a text upload.');
  const bytes = Buffer.byteLength(body.content, 'utf8');
  if (bytes > MAX_TEXT_BYTES) throw invalid(`The file exceeds ${MAX_TEXT_BYTES} bytes.`);
  const mimeType = body.mimeType ?? 'text/plain';
  if (!TEXT_TYPES.includes(mimeType)) throw invalid(`mimeType must be one of ${TEXT_TYPES.join(', ')}.`);
  return ctx.artifacts.create({ ...uploadMeta(body), content: body.content, mimeType });
}

async function uploadBinary(ctx, body) {
  if (typeof body.base64 !== 'string' || !body.base64) throw invalid('base64 must be non-empty text.');
  let buffer;
  try { buffer = Buffer.from(body.base64, 'base64'); } catch { throw invalid('base64 is not valid.'); }
  if (buffer.length === 0) throw invalid('base64 decodes to an empty file.');
  if (buffer.length > MAX_BINARY_BYTES) throw invalid(`The file exceeds ${MAX_BINARY_BYTES} bytes.`);
  if (!BINARY_TYPES.includes(body.mimeType))
    throw invalid(`mimeType must be one of ${BINARY_TYPES.join(', ')} for a binary upload.`);
  return ctx.artifacts.create({ ...uploadMeta(body), base64: body.base64, mimeType: body.mimeType });
}

/**
 * @param {object} ctx Cordis context with http/artifacts/workspace
 * @param {{workspaceId?: string}} [config]
 */
export async function apply(ctx, config = {}) {
  if (!ctx?.http?.route) throw missing('http');
  if (!ctx?.artifacts?.create || !ctx?.artifacts?.read) throw missing('artifacts');
  if (config === null || typeof config !== 'object' || Array.isArray(config))
    throw manifestError(`${PLUGIN_ID} config must be an object.`);
  if (Object.keys(config).some(key => !['workspaceId'].includes(key)))
    throw manifestError(`${PLUGIN_ID} config has an unsupported field.`);
  if (config.workspaceId !== undefined && (typeof config.workspaceId !== 'string' || !config.workspaceId))
    throw manifestError('config.workspaceId must be a non-empty string.');
  const workspaceId = config.workspaceId ?? 'local';
  const resolveWorkspace = typeof ctx.workspace?.resolve === 'function'
    ? actor => ctx.workspace.resolve(actor)
    : null;

  function actorOf(context) {
    const input = context?.actor ?? { subject: 'local-operator', role: 'admin', workspaceId };
    if (!isPlain(input) || typeof input.subject !== 'string' || !input.subject
      || !['admin', 'operator', 'viewer'].includes(input.role))
      throw forbidden('A current harness actor is required.');
    if (resolveWorkspace) {
      const resolved = resolveWorkspace(input);
      return { workspaceId: resolved.workspaceId, subject: resolved.subject, role: resolved.role };
    }
    if ((input.workspaceId ?? workspaceId) !== workspaceId)
      throw forbidden('This file set belongs to another workspace.');
    return { workspaceId, subject: input.subject, role: input.role };
  }

  const writer = context => {
    const actor = actorOf(context);
    if (actor.role === 'viewer') throw forbidden('A viewer cannot upload files.');
    return actor;
  };

  ctx.http.route({
    method: 'POST', path: BASE,
    handler: async (_req, _res, context) => {
      try {
        const actor = writer(context ?? {});
        const body = context?.body ?? {};
        if (!isPlain(body)) throw invalid('An upload must be an object.');
        if (Object.keys(body).some(key => !['filename', 'content', 'base64', 'mimeType', 'title', 'description', 'requestId'].includes(key)))
          throw invalid('An upload has an unsupported field.');
        if (typeof body.filename !== 'string' || !body.filename.trim() || body.filename.length > 200)
          throw invalid('filename must be non-empty text of at most 200 characters.');
        if (body.content !== undefined && body.base64 !== undefined)
          throw invalid('Send either content or base64, not both.');
        const created = body.base64 !== undefined
          ? await uploadBinary(ctx, body)
          : await uploadText(ctx, body);
        if (ctx.audit?.record) {
          await ctx.audit.record({ kind: 'artifacts', action: 'artifacts.upload', actor: actor.subject, ref: created.artifact.id })
            .catch(() => {});
        }
        return { status: 201, body: { artifact: created.artifact, duplicate: Boolean(created.duplicate) } };
      } catch (error) { throw asHarnessError(error); }
    },
  });

  ctx.http.route({
    method: 'GET', path: BASE,
    handler: call(context => {
      const actor = actorOf(context ?? {});
      const query = context?.query ?? {};
      const q = query.q === undefined ? undefined : String(query.q);
      if (q !== undefined && q.length > 200) throw invalid('q must be at most 200 characters.');
      const result = ctx.artifacts.list(q === undefined ? {} : { q });
      return { status: 200, body: { workspaceId: actor.workspaceId, items: result.artifacts ?? [] } };
    }),
  });

  ctx.http.route({
    method: 'GET', path: `${BASE}/:id`,
    handler: call(context => {
      actorOf(context ?? {});
      const id = context?.params?.id;
      const result = ctx.artifacts.get(id);
      return { status: 200, body: { artifact: result.artifact } };
    }),
  });

  ctx.http.route({
    method: 'GET', path: `${BASE}/:id/content`,
    handler: async (_request, _response, context) => {
      try {
        actorOf(context ?? {});
        const result = await ctx.artifacts.read(context?.params?.id);
        if (result?.encoding !== 'utf8' || typeof result?.content !== 'string') {
          const error = new HarnessError('ARTIFACT_NOT_TEXT', 'Only text files can be previewed here.');
          error.status = 415;
          throw error;
        }
        return { status: 200, body: { artifact: result.artifact, version: result.version, content: result.content } };
      } catch (error) { throw asHarnessError(error); }
    },
  });

  ctx.http.route({
    method: 'GET', path: '/files',
    handler: () => new Response(FILES_PAGE, {
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

  ctx.http.route({
    method: 'GET', path: `${BASE}/:id/download`,
    handler: async (_request, _response, context) => {
      try {
        actorOf(context ?? {});
        const file = await ctx.artifacts.download(context?.params?.id);
        const bytes = Buffer.isBuffer(file.bytes) ? file.bytes : Buffer.from(file.bytes ?? '');
        const filename = file.filename ?? file.version?.filename ?? 'download.bin';
        return new Response(bytes, {
          status: 200,
          headers: {
            'content-type': file.mimeType ?? 'application/octet-stream',
            'content-length': String(bytes.length),
            'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          },
        });
      } catch (error) { throw asHarnessError(error); }
    },
  });
  // A model-facing writer: the only way a run can produce a file. It is a
  // side effect, so the tools seam requires a one-shot approval ticket before
  // the handler runs; the runner then pins the artifact on the run.
  if (ctx.tools?.register) {
    ctx.tools.register({
      name: 'artifact_write',
      description: 'Save a UTF-8 text document (report, note, table, draft) as a workspace file the user can open and download later. Use it only when the user asked for a file, or when the result is a document rather than chat text.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', maxLength: 200, description: 'File name with extension, for example 报价单.md' },
          content: { type: 'string', maxLength: MAX_TEXT_BYTES },
          mimeType: { type: 'string', enum: [...TEXT_TYPES] },
        },
        required: ['filename', 'content'],
        additionalProperties: false,
      },
      approval: 'always',
      readOnly: false,
      authority: 'workspace',
      handler: async (args, execution) => {
        const filename = args?.filename;
        const content = args?.content;
        if (typeof filename !== 'string' || !filename.trim() || filename.length > 200) throw invalid('filename must be non-empty text of at most 200 characters.');
        if (typeof content !== 'string') throw invalid('content must be text.');
        if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES) throw invalid(`The file exceeds ${MAX_TEXT_BYTES} bytes.`);
        const mimeType = args?.mimeType ?? 'text/plain';
        if (!TEXT_TYPES.includes(mimeType)) throw invalid(`mimeType must be one of ${TEXT_TYPES.join(', ')}.`);
        const created = await ctx.artifacts.create({ filename, content, mimeType });
        if (ctx.audit?.record) {
          const subject = typeof execution?.actor === 'string' ? execution.actor : execution?.actor?.subject;
          await ctx.audit.record({ kind: 'artifacts', action: 'artifacts.write', actor: subject, ref: created.artifact.id }).catch(() => {});
        }
        return { artifact: created.artifact };
      },
    });
  }
  if (ctx.health?.register) ctx.health.register('artifacts-api', () => ({ status: 'ok', detail: { routes: ROUTES.length } }));
  return async () => {};
}

function call(handler) {
  return async (_req, _res, context) => {
    try { return await handler(context ?? {}); }
    catch (error) { throw asHarnessError(error); }
  };
}

export default { apply };
