// Official CLI loading acceptance: finite keyless provider, no Library client.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const names = ['workspace_factory_materials_status', 'workspace_factory_materials', 'workspace_factory_document'];
const disabled = process.env.FACTORY_MATERIALS_EXPECT === 'absent';
const documentId = '11111111-1111-4111-8111-111111111111';
export default async pi => {
  pi.registerTool({ name: 'materials_other_plugin', label: 'Other plugin', description: 'Explicit coexistence fixture.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => ({ content: [{ type: 'text', text: '{"otherPlugin":true}' }], details: {} }) });
  let calls = 0;
  const steps = disabled ? [['materials_other_plugin', {}]] : [[names[0], {}], [names[1], { limit: 1 }],
    [names[2], { documentId, documentVersion: 1 }], ['materials_other_plugin', {}]];
  const next = context => {
    assert.equal(JSON.stringify(context).includes('Read explicitly authorized original factory product and document receipts'), !disabled,
      'The official manifest Skill follows package enable/disable state');
    assert.ok(pi.getActiveTools().includes('read'));
    assert.ok(pi.getActiveTools().includes('bash'));
    for (const name of names) assert.equal(pi.getActiveTools().includes(name), !disabled, name);
    if (calls > 0) {
      const receipt = JSON.parse(context.messages.at(-1).content.filter(block => block.type === 'text').map(block => block.text).join('\n'));
      if (steps[calls - 1][0] === 'materials_other_plugin') assert.equal(receipt.otherPlugin, true);
      else { assert.equal(receipt.plugin, 'workspace-factory-materials'); assert.equal(receipt.status, 'unconfigured'); assert.deepEqual(receipt.sources, []); }
    }
    const step = steps[calls++];
    assert.ok(calls <= steps.length + 1, 'Finite CLI fixture exhausted; no fallback');
    return step ? { content: [{ type: 'toolCall', id: `materials-cli-${calls}`, name: step[0], arguments: step[1] }], stopReason: 'toolUse' }
      : { content: [{ type: 'text', text: disabled ? 'FACTORY_MATERIALS_ABSENT_AND_OTHER_PLUGIN_VERIFIED' : 'FACTORY_MATERIALS_MANIFEST_UNCONFIGURED_AND_NATIVE_COEXISTENCE_VERIFIED' }], stopReason: 'stop' };
  };
  if (!globalThis.Bun) {
    const { fauxProvider, fauxAssistantMessage } = await import(process.env.FACTORY_MATERIALS_PI_AI);
    const faux = fauxProvider({ api: 'faux', provider: 'factory-materials-cli-faux', models: [{ id: 'finite', maxTokens: 256 }] });
    faux.setResponses(Array.from({ length: steps.length + 1 }, () => context => {
      const spec = next(context); return fauxAssistantMessage(spec.content, { stopReason: spec.stopReason });
    }));
    pi.registerProvider(faux.provider);
  } else {
    assert.equal(Bun.version, '1.3.14');
    const { AssistantMessageEventStream } = await import(pathToFileURL(path.join(process.env.FACTORY_MATERIALS_OMP_ROOT, '../pi-ai/src/utils/event-stream.ts')).href);
    pi.registerProvider('factory-materials-cli-faux', { api: 'factory-materials-cli-explicit-faux', apiKey: 'explicit-keyless-fixture', baseUrl: 'https://synthetic.invalid',
      models: [{ id: 'finite', name: 'Explicit finite fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 256 }],
      streamSimple(model, context) {
        const stream = new AssistantMessageEventStream();
        try {
          const spec = next(context), message = { role: 'assistant', ...spec, api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
            usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
          stream.push({ type: 'start', partial: message });
          spec.content.forEach((block, contentIndex) => stream.push(block.type === 'toolCall'
            ? { type: 'toolcall_end', contentIndex, toolCall: block, partial: message }
            : { type: 'text_end', contentIndex, content: block.text, partial: message }));
          stream.push({ type: 'done', reason: spec.stopReason, message });
        } catch (error) { stream.fail(error); }
        return stream;
      } });
  }
};
