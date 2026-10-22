import { HarnessError, ERROR } from '../../../lib.mjs';

export function apply(ctx) {
  ctx.http.route({
    method: 'GET',
    path: '/api/fixture/hello',
    handler: async () => ({ status: 200, body: { hello: 'world' } }),
  });
  ctx.http.route({
    method: 'GET',
    path: '/api/fixture/whoami',
    handler: (req, res, context) => ({ status: 200, body: context.actor }),
  });
  ctx.http.route({
    method: 'POST',
    path: '/api/fixture/echo',
    handler: (req, res, context) => ({
      status: 201,
      body: { method: context.method, query: context.query, params: context.params, body: context.body },
    }),
  });
  ctx.http.route({
    method: 'GET',
    path: '/api/fixture/boom',
    handler: () => {
      throw new HarnessError(ERROR.approvalRequired, 'fixture approval required');
    },
  });
  ctx.http.route({
    method: 'GET',
    path: '/api/fixture/crash',
    handler: () => {
      throw new Error('secret internal detail that must not leak');
    },
  });
  ctx.http.health('routes-ok', () => ({ status: 'ok', detail: 'fixture healthy' }));
}
