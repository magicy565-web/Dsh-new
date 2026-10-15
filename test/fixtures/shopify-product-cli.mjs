// Official package loader acceptance. No Host injection or real model.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const methods = ['status', 'read', 'readiness', 'image', 'propose', 'review', 'execute', 'reconcile', 'result'];
const names = methods.map(k => 'workspace_shopify_product_' + k), disabled = process.env.SHOPIFY_PRODUCT_EXPECT === 'absent';
const id = '11111111-1111-4111-8111-111111111111', hash = 'a'.repeat(64);
const inputs = [{}, { productId: id }, { productId: id }, { productId: id, imageId: id },
  { productId: id, sourceHash: hash, requestId: 'finite', draft: { title: 'Synthetic title', description: 'Finite model prose', targetMarket: 'US', currency: 'USD',
    retailUnit: 'piece', unitsPerPack: 1, consumerPrice: '1.00', handlingDays: 1, shippingDays: 1, skuCode: null, imageIds: [id] } },
  { serviceId: id, requestId: 'finite', action: 'draft' }, ...[1, 2].map(() => ({ serviceId: id, operationId: id, expectedScopeHash: hash, requestId: 'finite' })), { serviceId: id }];
export default async pi => {
  pi.registerTool({ name: 'ingestion_other_plugin', label: 'Other plugin', description: 'Explicit coexistence fixture.', parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => ({ content: [{ type: 'text', text: '{"otherPlugin":true}' }], details: {} }) });
  let calls = 0; const steps = [...disabled ? [] : names.map((name, i) => [name, inputs[i]]), ['ingestion_other_plugin', {}]];
  const next = context => {
    assert.equal(JSON.stringify(context).includes('Choose original authorized product/image reads'), !disabled, 'Official manifest loads/unloads the Skill');
    for (const name of ['read', 'bash', 'ingestion_other_plugin']) assert.ok(pi.getActiveTools().includes(name));
    for (const name of names) assert.equal(pi.getActiveTools().includes(name), !disabled, name);
    if (calls > 0) {
      const receipt = JSON.parse(context.messages.at(-1).content.filter(b => b.type === 'text').map(b => b.text).join('\n'));
      if (steps[calls - 1][0] === 'ingestion_other_plugin') assert.equal(receipt.otherPlugin, true);
      else { assert.equal(receipt.plugin, 'workspace-shopify-product'); assert.equal(receipt.status, 'unconfigured'); }
    }
    const step = steps[calls++]; assert.ok(calls <= steps.length + 1, 'Finite fixture exhausted; no fallback');
    return step ? { content: [{ type: 'toolCall', id: `product-cli-${calls}`, name: step[0], arguments: step[1] }], stopReason: 'toolUse' }
      : { content: [{ type: 'text', text: disabled ? 'SHOPIFY_PRODUCT_ABSENT_AND_OTHER_PLUGIN_VERIFIED' : 'SHOPIFY_PRODUCT_MANIFEST_UNCONFIGURED_AND_NATIVE_COEXISTENCE_VERIFIED' }], stopReason: 'stop' };
  };
  if (!globalThis.Bun) {
    const { fauxProvider, fauxAssistantMessage } = await import(process.env.SHOPIFY_PRODUCT_PI_AI);
    const faux = fauxProvider({ api: 'faux', provider: 'shopify-product-cli-faux', models: [{ id: 'finite', maxTokens: 256 }] });
    faux.setResponses(Array.from({ length: steps.length + 1 }, () => context => { const spec = next(context); return fauxAssistantMessage(spec.content, { stopReason: spec.stopReason }); }));
    pi.registerProvider(faux.provider);
  } else {
    assert.equal(Bun.version, '1.3.14');
    const { AssistantMessageEventStream } = await import(pathToFileURL(path.join(process.env.SHOPIFY_PRODUCT_OMP_ROOT, '../pi-ai/src/utils/event-stream.ts')).href);
    pi.registerProvider('shopify-product-cli-faux', { api: 'product-cli-explicit-faux', apiKey: 'explicit-keyless-fixture', baseUrl: 'https://synthetic.invalid',
      models: [{ id: 'finite', name: 'Explicit finite fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 256 }],
      streamSimple(model, context) {
        const stream = new AssistantMessageEventStream();
        try {
          const spec = next(context), message = { role: 'assistant', ...spec, api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
            usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
          stream.push({ type: 'start', partial: message });
          spec.content.forEach((b, contentIndex) => stream.push(b.type === 'toolCall' ? { type: 'toolcall_end', contentIndex, toolCall: b, partial: message } : { type: 'text_end', contentIndex, content: b.text, partial: message }));
          stream.push({ type: 'done', reason: spec.stopReason, message });
        } catch (error) { stream.fail(error); } return stream;
      } });
  }
};
