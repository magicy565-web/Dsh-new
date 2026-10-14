// Explicit keyless model fixture. This registers a provider inside the real
// published pi-subagents runner; it does not implement an execution engine.
import { Type, fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { appendFileSync } from 'node:fs';
export default function (pi) {
  const marker = process.env.PI_COMMUNITY_CHILD_MARKER;
  const faux = fauxProvider({ api: 'faux', provider: 'community-keyless', models: [{ id: 'child', maxTokens: 1000 }] });
  faux.setResponses([
    context => {
      appendFileSync(marker, JSON.stringify({ pid: process.pid, phase: 'model', node: process.version }) + '\n');
      const text = JSON.stringify(context.messages);
      return fauxAssistantMessage(fauxToolCall(text.includes('CANCEL_FIXTURE') ? 'community_wait' : 'read',
        text.includes('CANCEL_FIXTURE') ? {} : { path: process.env.PI_COMMUNITY_PRODUCT_FILE }), { stopReason: 'toolUse' });
    },
    context => fauxAssistantMessage('KEYLESS_CHILD_READ_VERIFIED: ' + JSON.stringify(context.messages.at(-1).content) + '\n```acceptance-report\n' + JSON.stringify({
      criteriaSatisfied: [{ id: 'criterion-1', status: 'satisfied', evidence: 'Actual official Pi read tool returned the named public synthetic file.' }],
      manualNotes: 'Keyless synthetic model read the named public product fixture.', residualRisks: ['Synthetic data does not prove a real distributor or export lead.'],
      changedFiles: [], testsAddedOrUpdated: [], commandsRun: [], validationOutput: [], noStagedFiles: true,
    }) + '\n```'),
  ]);
  pi.registerProvider(faux.provider);
  pi.registerTool({ name: 'community_wait', label: 'Synthetic wait', description: 'Abortable synthetic wait for cancellation acceptance', parameters: Type.Object({}),
    execute: async (_id, _args, signal) => {
      appendFileSync(marker, JSON.stringify({ pid: process.pid, phase: 'waiting' }) + '\n');
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ content: [{ type: 'text', text: 'unexpected wait completion' }], details: {} }), 60000);
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Synthetic wait cancelled')); }, { once: true });
      });
    } });
}
