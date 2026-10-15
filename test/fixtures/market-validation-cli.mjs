// Finite provider for the real OMP CLI plugin manifest/Skill loading checks.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const names = ['workspace_market_validation_product', 'workspace_market_validation_plan_save'];
export default async pi => {
  const disabled = process.env.MARKET_PLAN_EXPECT === 'absent';
  const { AssistantMessageEventStream } = await import(pathToFileURL(path.join(process.env.MARKET_PLAN_OMP_ROOT, '../pi-ai/src/utils/event-stream.ts')).href);
  pi.registerTool({ name: 'market_other_plugin', label: 'Synthetic other plugin', description: 'Coexistence test.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => ({ content: [{ type: 'text', text: '{"otherPlugin":true}' }] }) });
  let calls = 0;
  pi.registerProvider('market-plan-cli-faux', { api: 'market-plan-cli-explicit-faux', apiKey: 'explicit-keyless-fixture', baseUrl: 'https://synthetic.invalid',
    models: [{ id: 'finite', name: 'Finite CLI test', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 256 }],
    streamSimple(model, context) {
      const stream = new AssistantMessageEventStream();
      try {
        assert.equal(JSON.stringify(context).includes('Compose an editable seven-day B2B/B2C market validation plan'), !disabled);
        for (const name of names) assert.equal(pi.getActiveTools().includes(name), !disabled, name);
        assert.ok(pi.getActiveTools().includes('read')); assert.ok(pi.getActiveTools().includes('bash'));
        const step = ++calls; assert.ok(step <= 4, 'Finite provider exhausted');
        const steps = disabled ? ['other', 'done'] : ['read', 'other', 'done'];
        if (step > 1) {
          const value = JSON.parse(context.messages.at(-1).content.filter(b => b.type === 'text').map(b => b.text).join('\n'));
          if (steps[step - 2] === 'read') { assert.equal(value.status, 'unconfigured'); assert.deepEqual(value.sources, []); }
          else assert.equal(value.otherPlugin, true);
        }
        const action = steps[step - 1], content = action === 'done' ? [{ type: 'text', text: disabled ? 'MARKET_PLAN_ABSENT_VERIFIED' : 'MARKET_PLAN_MANIFEST_SKILL_UNCONFIGURED_VERIFIED' }]
          : [{ type: 'toolCall', id: 'market-cli-' + step, name: action === 'read' ? names[0] : 'market_other_plugin',
            arguments: action === 'read' ? { productId: '11111111-1111-4111-8111-111111111111', documents: [] } : {} }];
        const message = { role: 'assistant', content, stopReason: action === 'done' ? 'stop' : 'toolUse', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        stream.push({ type: 'start', partial: message });
        content.forEach((block, contentIndex) => stream.push(block.type === 'toolCall' ? { type: 'toolcall_end', contentIndex, toolCall: block, partial: message }
          : { type: 'text_end', contentIndex, content: block.text, partial: message }));
        stream.push({ type: 'done', reason: message.stopReason, message });
      } catch (error) { stream.fail(error); }
      return stream;
    } });
};
