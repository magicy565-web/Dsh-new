/** Isolated local interaction preview. Scripted responses, no model or external calls.
 * Start only with the explicit test memory-store preload. Never a deployment entrypoint.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/index.mjs';
const directory = await mkdtemp(path.join(tmpdir(), 'workspace-control-preview-'));
const provider = {
  kind: 'deepseek-harness', provider: 'local-scripted-preview', model: 'preview-only', configured: true,
  complete({ signal }) {
    return new Promise((resolve, reject) => {
      const stop = () => { clearTimeout(timer); reject(new Error('Preview stopped')); };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', stop);
        resolve({ content: JSON.stringify({ done: true, content: '本地交互演示：这是一份示例交付，用于体验查看、验收和补充指令。没有调用真实模型或研究市场。' }), usage: { completionTokens: 12 } });
      }, 12000);
      if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true });
    });
  },
};
const app = await createApp({ dataDirectory: directory, capabilityEnvironment: {}, provider });
if (app.store.diagnostics().durability !== 'test-memory-only') { await app.close(); throw Error('This preview requires the explicit test memory-store preload.'); }
await app.runtime.updateSettings({ name: '本地交互预览' });
await app.runtime.createGoal({ title: '研究美国市场', description: '本地演示任务，可体验启动、暂停、继续和验收。' });
await app.runtime.createGoal({ title: '准备产品资料', description: '本地演示任务，可体验任务切换。' });
const address = await app.listen(0);
console.log(JSON.stringify({ url: `http://127.0.0.1:${address.port}`, mode: 'scripted-local-preview', persistence: 'memory-only', modelCalls: false }));
let closing = false;
async function close() {
  if (closing) return; closing = true;
  await app.close(); await rm(directory, { recursive: true, force: true }); process.exit(0);
}
process.once('SIGINT', () => void close()); process.once('SIGTERM', () => void close());
