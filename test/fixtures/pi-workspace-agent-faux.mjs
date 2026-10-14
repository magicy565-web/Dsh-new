// Explicit test transport only. Never read ambient credentials or call a live model.
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';

export const BUSINESS_TOOL_NAMES = ['workspace_business_presets', 'workspace_business_task', 'workspace_business_status',
  'workspace_company_profile', 'workspace_products', 'workspace_product', 'workspace_business_tasks', 'workspace_business_result'];
export const PUBLIC_PROCUREMENT = Object.freeze({ type: 'procurement', title: 'Public synthetic agent procurement',
  input: { product: 'Public synthetic cup', spec: 'Public synthetic specification', quantity: 10 }, requestId: 'agent-public-procurement' });

export async function syntheticFrontend(responses = []) {
  const faux = fauxProvider({ api: 'faux', provider: 'workspace-agent-test-faux',
    models: [{ id: 'workspace-agent-test', name: 'Explicit synthetic frontend (no model account)', maxTokens: 4000 }] });
  faux.setResponses(responses);
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null,
    refreshOnCreate: false, allowModelNetwork: false });
  modelRuntime.registerNativeProvider(faux.provider);
  return { faux, modelRuntime, model: faux.getModel() };
}

export const callBusinessTool = (name, input) => fauxAssistantMessage(fauxToolCall(name, input), { stopReason: 'toolUse' });
export function actualToolReceipt(context) {
  const last = context.messages.at(-1);
  if (last?.role !== 'toolResult') throw new Error('Synthetic fixture expected the actual official tool result.');
  const text = last.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
  let summary = '';
  try {
    const value = JSON.parse(text);
    if (value.task) summary = '\nOriginal receipt fields: ' + JSON.stringify({ taskId: value.task.taskId, status: value.task.status,
      completion: value.task.result?.completion, businessGoalAchieved: value.task.result?.businessGoalAchieved,
      artifacts: value.artifacts?.map(row => ({ name: row.name, status: row.status })) });
  } catch { /* Original tool errors remain visible as returned. */ }
  return fauxAssistantMessage('Explicit synthetic frontend; original HTTP receipt follows:\n' + text + summary);
}
