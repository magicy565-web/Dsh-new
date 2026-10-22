export function apply(ctx) {
  ctx.http.health('degraded-health', () => ({ status: 'degraded', detail: 'fixture wants attention' }));
}
