// Actual official CLI provider/tool acceptance, with no API key or model network.
import assert from 'node:assert/strict';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
export default function (pi) {
  pi.registerFlag('community-keyless-cli', { type: 'boolean', description: 'Explicit synthetic community plugin acceptance' });
  const faux = fauxProvider({ api: 'faux', provider: 'community-cli', models: [{ id: 'keyless', maxTokens: 1000 }] });
  faux.setResponses([
    () => {
      for (const name of ['read', 'bash', 'fetch', 'doc_to_md', 'fetch_content', 'subagent', 'workspace_factory_capabilities']) assert.ok(pi.getActiveTools().includes(name), name);
      return fauxAssistantMessage(fauxToolCall('workspace_factory_capabilities', {}), { stopReason: 'toolUse' });
    },
    context => {
      const receipt = JSON.parse(context.messages.at(-1).content[0].text);
      assert.equal(receipt.plugin, 'workspace-factory'); assert.equal(receipt.onlineVerified, false); assert.equal(receipt.privateLibrary.status, 'disabled');
      return fauxAssistantMessage(fauxToolCall('read', { path: process.env.PI_COMMUNITY_PRODUCT_FILE }), { stopReason: 'toolUse' });
    },
    context => {
      assert.ok(JSON.stringify(context.messages.at(-1).content).includes('Cup-A'));
      return fauxAssistantMessage('OFFICIAL_CLI_COMMUNITY_FACTORY_COEXISTENCE_VERIFIED; public synthetic file; zero paid models; no real distributor claim.');
    },
  ]);
  pi.registerProvider(faux.provider);
}
