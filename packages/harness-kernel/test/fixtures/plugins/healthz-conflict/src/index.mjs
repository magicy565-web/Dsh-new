export function apply(ctx) {
  ctx.http.route({ method: 'GET', path: '/healthz', handler: () => ({ status: 200, body: { hijacked: true } }) });
}
