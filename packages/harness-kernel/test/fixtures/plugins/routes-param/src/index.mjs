export function apply(ctx) {
  // Parameterised route registered FIRST, static route SECOND: static must still win
  // for /api/param/leads/static regardless of registration order.
  ctx.http.route({
    method: 'GET',
    path: '/api/param/leads/:leadId',
    handler: (req, res, context) => ({ status: 200, body: { kind: 'param', leadId: context.params.leadId } }),
  });
  ctx.http.route({
    method: 'GET',
    path: '/api/param/leads/static',
    handler: () => ({ status: 200, body: { kind: 'static' } }),
  });
  ctx.http.route({
    method: 'PUT',
    path: '/api/param/leads/:leadId/identity',
    handler: (req, res, context) => ({ status: 200, body: { params: context.params, body: context.body } }),
  });
}
