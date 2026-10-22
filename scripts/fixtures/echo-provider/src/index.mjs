// Smoke-only provider: registers the harness echo provider so the run loop can
// be exercised over real HTTP without a credential or a network call.
import { createEchoProvider } from '../../../../packages/harness-seams/src/llm.mjs';

export function apply(ctx) {
  const unregister = ctx.llm.register(createEchoProvider({ id: 'smoke-echo', model: 'echo-1' }));
  return () => unregister();
}

export default { apply };
