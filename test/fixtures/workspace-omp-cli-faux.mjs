import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export default async pi => {
  const { AssistantMessageEventStream } = await import(pathToFileURL(path.join(process.env.WORKSPACE_OMP_PACKAGE_ROOT, '../pi-ai/src/utils/event-stream.ts')).href);
  let calls = 0;
  pi.registerProvider('workspace-omp-standalone', { api: 'workspace-omp-cli-explicit-faux', apiKey: 'explicit-keyless-cli-fixture', baseUrl: 'https://synthetic.invalid',
    models: [{ id: 'finite', name: 'Explicit finite CLI fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 400 }],
    streamSimple(model, context) {
      const stream = new AssistantMessageEventStream();
      void (async () => {
        for (const name of ['read', 'bash', 'workspace_factory_capabilities', 'workspace_business_tasks', 'workspace_business_result']) assert.ok(pi.getActiveTools().includes(name), name);
        assert.ok(!pi.getActiveTools().includes('workspace_products')); assert.ok(!pi.getActiveTools().includes('workspace_procurement_compare'));
        calls++; let content, stopReason;
        if (calls === 1) { content = [{ type: 'toolCall', id: 'standalone-caps', name: 'workspace_factory_capabilities', arguments: {} }]; stopReason = 'toolUse'; }
        else if (calls === 2) {
          const receipt = JSON.parse(context.messages.at(-1).content[0].text); assert.equal(receipt.privateLibrary.status, 'disabled');
          content = [{ type: 'toolCall', id: 'standalone-read', name: 'read', arguments: { path: process.env.WORKSPACE_OMP_PUBLIC_FIXTURE } }]; stopReason = 'toolUse';
        } else if (calls === 3) {
          assert.match(JSON.stringify(context.messages.at(-1).content), /Public synthetic factory cup/);
          content = [{ type: 'text', text: 'OMP_STANDARD_FACTORY_ENTRY_AND_NATIVE_READ_VERIFIED; finite keyless fixture, no real lead or paid model.' }]; stopReason = 'stop';
        } else throw new Error('Finite fixture exhausted; no fallback.');
        const message = { role: 'assistant', content, stopReason, api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        stream.push({ type: 'start', partial: message });
        for (let i = 0; i < content.length; i++) stream.push(content[i].type === 'toolCall'
          ? { type: 'toolcall_end', contentIndex: i, toolCall: content[i], partial: message }
          : { type: 'text_end', contentIndex: i, content: content[i].text, partial: message });
        stream.push({ type: 'done', reason: stopReason, message });
      })().catch(error => stream.fail(error));
      return stream;
    },
  });
};
