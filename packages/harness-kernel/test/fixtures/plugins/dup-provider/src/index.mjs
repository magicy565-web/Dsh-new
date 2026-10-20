// Two providers for the same service: the kernel must reject this at bootstrap.
export const provides = ['alpha'];

export async function apply(ctx) {
  ctx.provide('alpha', { name: 'alpha', from: 'dup-provider' });
}
