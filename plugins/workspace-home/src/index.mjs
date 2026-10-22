// Harness plugin: the product's front door.
import { ERROR, HarnessError } from '../../../packages/harness-contracts/src/index.mjs';
import { HOME_PAGE } from './area.mjs';

export const PLUGIN_ID = 'workspace-home';
export const ROUTES = Object.freeze([['GET', '/home']]);

const missing = service => new HarnessError(ERROR.pluginMissingDependency, `${PLUGIN_ID} requires ctx.${service}.`);

export async function apply(ctx, config = {}) {
  if (!ctx?.http?.route) throw missing('http');
  if (config === null || typeof config !== 'object' || Array.isArray(config))
    throw new HarnessError(ERROR.manifestInvalid, `${PLUGIN_ID} config must be an object.`);
  if (Object.keys(config).length > 0)
    throw new HarnessError(ERROR.manifestInvalid, `${PLUGIN_ID} config has an unsupported field.`);

  ctx.http.route({
    method: 'GET', path: '/home',
    handler: () => new Response(HOME_PAGE, {
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

  if (ctx.health?.register) ctx.health.register('home', () => ({ status: 'ok', detail: { route: '/home' } }));
  return async () => {};
}

export default { apply };
