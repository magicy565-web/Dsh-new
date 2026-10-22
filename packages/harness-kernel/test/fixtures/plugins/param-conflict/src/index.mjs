export function apply(ctx) {
  ctx.http.route({ method: 'GET', path: '/api/conflict/leads/:id', handler: () => ({ status: 200, body: {} }) });
  // Same shape, different parameter name: this can match the same concrete path.
  // Registration must fail closed (startup failure), not silently shadow the first.
  ctx.http.route({ method: 'GET', path: '/api/conflict/leads/:leadId', handler: () => ({ status: 200, body: {} }) });
}
