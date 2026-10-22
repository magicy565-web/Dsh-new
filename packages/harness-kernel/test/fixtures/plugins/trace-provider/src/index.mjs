import { trace } from '../../../lib.mjs';

export const provides = ['alpha'];
export const requires = [];

export async function apply(ctx, config = {}) {
  trace('apply', 'trace-provider', config.label);
  ctx.provide('alpha', { name: 'alpha', label: config.label ?? null });
  return async () => {
    trace('dispose', 'trace-provider', config.label);
  };
}
