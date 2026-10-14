// Official CLI acceptance only: no credential store or network model.
import assert from 'node:assert/strict';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
export default function extension(pi) {
  pi.registerFlag('synthetic-procurement-coexist', { type: 'boolean', description: 'Keyless standalone procurement CLI acceptance fixture' });
  const faux = fauxProvider({ api: 'faux', provider: 'workspace-agent-test-faux', models: [{ id: 'workspace-agent-test', maxTokens: 1000 }] });
  faux.setResponses([
    () => {
      for (const name of ['read', 'bash', 'other_plugin_tool', 'workspace_procurement_capabilities']) assert.ok(pi.getActiveTools().includes(name), name);
      return fauxAssistantMessage(fauxToolCall('workspace_procurement_capabilities', {}), { stopReason: 'toolUse' });
    },
    context => {
      const receipt = JSON.parse(context.messages.at(-1).content[0].text);
      assert.equal(receipt.configuration, 'unconfigured'); assert.equal(receipt.privateLibrary.status, 'disabled');
      return fauxAssistantMessage(fauxToolCall('other_plugin_tool', {}), { stopReason: 'toolUse' });
    },
    context => {
      assert.equal(JSON.parse(context.messages.at(-1).content[0].text).otherPlugin, true);
      return fauxAssistantMessage('SYNTHETIC_CLI_PACKAGE_AND_OTHER_PLUGIN_VERIFIED; private Library disabled; existing binding unconfigured; no paid model or service calls.');
    },
  ]);
  pi.registerProvider(faux.provider);
}
