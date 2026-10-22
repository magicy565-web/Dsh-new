// Smoke-only provider. Three modes:
//  - a message starting with 记住： asks for the real business_memory_propose
//    tool, so the guarded execution path (approval -> ticket -> execute) runs
//    against the real tools and memory plugins;
//  - a message starting with 询盘： asks for the real factory_rfq_capture tool,
//    so a read-only business tool runs through the real tool loop;
//  - anything else is echoed, and after a tool result it acknowledges.
import { randomUUID } from 'node:crypto';

const MEMORY_MARKER = '记住：';
const RFQ_MARKER = '询盘：';
const QUOTE_MARKER = '报价：';

function lastUser(messages) {
  return [...messages].reverse().find(message => message.role === 'user');
}

function toolText(message) {
  if (typeof message?.content === 'string') return message.content;
  try { return JSON.stringify(message?.content ?? ''); } catch { return ''; }
}

function proposalFor(text) {
  return {
    requestId: randomUUID(),
    subjectType: 'customer',
    subjectId: 'customer-haiqi',
    subjectLabel: '海祺贸易',
    factKey: 'moq',
    kind: 'fact',
    statement: text.slice(text.indexOf(MEMORY_MARKER) + MEMORY_MARKER.length).trim(),
    source: { kind: 'operator', basis: 'guarded smoke', label: '冒烟记录' },
  };
}

function rfqFor(text) {
  const body = text.slice(text.indexOf(RFQ_MARKER) + RFQ_MARKER.length).trim();
  return { product: body.slice(0, 60), quantity: 500, target_market: '德国' };
}

async function complete(request) {
  const messages = request.messages ?? [];
  const user = lastUser(messages);
  const text = user?.content ?? '';
  const tools = messages.filter(message => message.role === 'tool');
  if (tools.length > 0) {
    if (text.startsWith(MEMORY_MARKER)) {
      return { text: '已提交经营记忆候选，等待人工审核。', toolCalls: [], usage: { outputTokens: 12 } };
    }
    return { text: `草稿已生成：${toolText(tools[tools.length - 1]).slice(0, 1600)}`, toolCalls: [], usage: { outputTokens: 12 } };
  }
  if (text.startsWith(MEMORY_MARKER)) {
    return { text: '', toolCalls: [{ name: 'business_memory_propose', arguments: proposalFor(text) }], usage: {} };
  }
  if (text.startsWith(QUOTE_MARKER)) {
    return {
      text: '',
      toolCalls: [{
        name: 'procurement_compare',
        arguments: {
          quotes: [
            { supplier: '甲公司', spec: 'DN50', currency: 'CNY', trade_term: 'FOB', unit_price: 12.5 },
            { supplier: '乙公司', spec: 'DN50', currency: 'CNY', trade_term: 'FOB', unit_price: 13 },
          ],
        },
      }],
      usage: {},
    };
  }
  if (text.startsWith(RFQ_MARKER)) {
    return { text: '', toolCalls: [{ name: 'factory_rfq_capture', arguments: rfqFor(text) }], usage: {} };
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
