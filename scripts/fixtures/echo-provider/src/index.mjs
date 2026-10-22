// Smoke-only provider. Two modes:
//  - a message starting with 记住： asks for the real business_memory_propose
//    tool, so the guarded execution path (approval -> ticket -> execute) runs
//    against the real tools and memory plugins;
//  - anything else is echoed, and after a tool result it acknowledges.
import { randomUUID } from 'node:crypto';

const MARKER = '记住：';

function lastUser(messages) {
  return [...messages].reverse().find(message => message.role === 'user');
}

function proposalFor(text) {
  return {
    requestId: randomUUID(),
    subjectType: 'customer',
    subjectId: 'customer-haiqi',
    subjectLabel: '海祺贸易',
    factKey: 'moq',
    kind: 'fact',
    statement: text.slice(text.indexOf(MARKER) + MARKER.length).trim(),
    source: { kind: 'operator', basis: 'guarded smoke', label: '冒烟记录' },
  };
}

async function complete(request) {
  const messages = request.messages ?? [];
  const user = lastUser(messages);
  const text = user?.content ?? '';
  if (messages.some(message => message.role === 'tool')) {
    return { text: '已提交经营记忆候选，等待人工审核。', toolCalls: [], usage: { outputTokens: 12 } };
  }
  if (text.startsWith(MARKER)) {
    return { text: '', toolCalls: [{ name: 'business_memory_propose', arguments: proposalFor(text) }], usage: {} };
  }
  return { text, toolCalls: [], usage: {} };
}

export function apply(ctx) {
  const provider = {
    id: 'smoke-echo',
    model: 'echo-1',
    label: 'Smoke echo',
    complete,
    async *stream(request) {
      const answer = (lastUser(request.messages ?? [])?.content ?? '');
      for (let index = 0; index < answer.length; index += 6) {
        yield { delta: answer.slice(index, index + 6) };
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      yield { usage: { outputTokens: Math.ceil(answer.length / 6) } };
    },
  };
  const unregister = ctx.llm.register(provider);
  return () => unregister();
}

export default { apply };
