import { trace } from '../../../lib.mjs';

export const provides = ['beta'];
export const requires = ['alpha'];

export async function apply(ctx, config = {}) {
  if (!ctx.alpha || ctx.alpha.name !== 'alpha') throw new Error('trace-consumer could not see ctx.alpha (ordering violation)');
  trace('apply', 'trace-consumer', config.label);
  ctx.provide('beta', { name: 'beta' });
  return async () => {
    trace('dispose', 'trace-consumer', config.label);
  };
}
