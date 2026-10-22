export function apply(ctx) {
  const handler = () => ({ status: 200, body: { ok: true } });
  ctx.http.route({ method: 'GET', path: '/api/fixture/dup', handler });
  ctx.http.route({ method: 'GET', path: '/api/fixture/dup', handler });
}
