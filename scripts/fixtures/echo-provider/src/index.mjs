// Smoke-only provider: registers an offline echo provider that streams in
// small chunks, so the run loop and SSE deltas can be exercised over real HTTP
// without a credential or a network call.
export function apply(ctx) {
  const provider = {
    id: 'smoke-echo',
    model: 'echo-1',
    label: 'Smoke echo',
    async complete(request) {
      const last = [...request.messages].reverse().find(message => message.role === 'user');
      return { text: last?.content ?? '', toolCalls: [], usage: {} };
    },
    async *stream(request) {
      const last = [...request.messages].reverse().find(message => message.role === 'user');
      const text = last?.content ?? '';
      for (let index = 0; index < text.length; index += 6) {
        yield { delta: text.slice(index, index + 6) };
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      yield { usage: { outputTokens: Math.ceil(text.length / 6) } };
    },
  };
  const unregister = ctx.llm.register(provider);
  return () => unregister();
}

export default { apply };
