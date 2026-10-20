// Harness plugin: serve the deployment-review snapshot that `wh review --out`
// produced. Read-only: it never writes, mounts nothing and never invents a verdict.
// A missing/stale/foreign file is reported as such instead of being hidden.
import { promises as fs } from 'node:fs';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { HarnessError, ERROR } from '../../../packages/harness-contracts/src/index.mjs';

const MAX_REVIEW_BYTES = 1024 * 1024;
const DAY_MS = 86_400_000;

const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

async function readReview(file) {
  let info;
  try { info = await fs.stat(file); }
  catch { return { state: 'missing', detail: 'review file not found' }; }
  if (!info.isFile()) return { state: 'invalid', detail: 'review path is not a file' };
  if (info.size > MAX_REVIEW_BYTES) return { state: 'invalid', detail: `review file exceeds ${MAX_REVIEW_BYTES} bytes` };
  let raw;
  try { raw = await fs.readFile(file, 'utf8'); }
  catch { return { state: 'invalid', detail: 'review file cannot be read' }; }
  let document;
  try { document = JSON.parse(raw); }
  catch { return { state: 'invalid', detail: 'review file is not valid JSON' }; }
  if (!isPlain(document) || typeof document.verdict !== 'string' || !isPlain(document.composition) || typeof document.composition.digest !== 'string')
    return { state: 'invalid', detail: 'review file does not look like a wh review document' };
  return { state: 'ok', document, generatedAt: typeof document.generatedAt === 'string' ? document.generatedAt : null, modifiedAt: info.mtime.toISOString() };
}

export async function apply(ctx, config = {}) {
  if (!ctx?.http?.route) throw new HarnessError(ERROR.pluginFailed, 'workspace-harness-review requires ctx.http.route.');
  if (typeof config.reviewFile !== 'string' || !config.reviewFile.trim())
    throw new HarnessError(ERROR.manifestInvalid, 'reviewFile is required.');
  if (config.maxAgeHours !== undefined && (!Number.isInteger(config.maxAgeHours) || config.maxAgeHours < 1 || config.maxAgeHours > 8760))
    throw new HarnessError(ERROR.manifestInvalid, 'maxAgeHours must be an integer between 1 and 8760.');
  const file = isAbsolute(config.reviewFile) ? config.reviewFile : resolvePath(process.cwd(), config.reviewFile);
  const maxAgeMs = (config.maxAgeHours ?? 24) * (DAY_MS / 24);

  const snapshot = async () => {
    const result = await readReview(file);
    if (result.state !== 'ok') return result;
    const generated = Date.parse(result.generatedAt ?? result.modifiedAt);
    if (Number.isFinite(generated) && Date.now() - generated > maxAgeMs)
      return { ...result, state: 'stale', detail: `review is older than ${config.maxAgeHours ?? 24}h` };
    return result;
  };
  // The kernel requires synchronous health checks, so the snapshot is read once at
  // mount (and refreshed on every request) and health reports that cached state.
  let cached = await snapshot();
  const healthView = () => {
    if (cached.state !== 'ok') {
      return { status: 'degraded', detail: { file, state: cached.state, reason: cached.detail } };
    }
    const generated = Date.parse(cached.generatedAt ?? cached.modifiedAt);
    if (Number.isFinite(generated) && Date.now() - generated > maxAgeMs)
      return { status: 'degraded', detail: { file, state: 'stale', reason: `review is older than ${config.maxAgeHours ?? 24}h` } };
    return { status: 'ok', detail: { file, verdict: cached.document.verdict, generatedAt: cached.generatedAt } };
  };

  ctx.http.route({
    method: 'GET', path: '/api/harness/review',
    handler: async (_req, _res, context) => {
      if (context?.actor?.role !== 'admin')
        throw new HarnessError(ERROR.toolRefused, 'admin role is required to read the deployment review.');
      cached = await snapshot();
      if (cached.state !== 'ok') {
        return {
          status: 503,
          body: { error: { code: 'HARNESS_REVIEW_UNAVAILABLE', message: cached.detail }, file, state: cached.state },
        };
      }
      return { status: 200, body: { review: cached.document, file, generatedAt: cached.generatedAt, state: 'ok' } };
    },
  });

  if (ctx.health?.register) ctx.health.register('harness-review', healthView);

  return async () => {};
}

export default { apply };
