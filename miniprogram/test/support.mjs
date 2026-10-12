import assert from 'node:assert/strict';
import { promises as fs, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { createApp } from '../../server/index.mjs';
import { createPiProvider } from '../../server/pi-provider.mjs';
const require = createRequire(import.meta.url);
export const { WorkspaceClient, conversationView } = require('../../release/miniprogram/shared/client.js');
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const until = async check => { for (let i = 0; i < 500; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('Client fixture did not settle'); };
export const memoryJournal = () => { let saved = null; const records = new Map(); return { read: (owner, baseUrl) => structuredClone(owner ? records.get(JSON.stringify([baseUrl, owner])) || null : saved), write: value => { saved = structuredClone(value); records.set(JSON.stringify([value.baseUrl, value.owner]), saved); } }; };
export function loadPage(client, platform) {
  const filename = new URL('../../release/miniprogram/pages/conversation/index.js', import.meta.url);
  let page; const timers = new Map(); let serial = 0;
  vm.runInNewContext(readFileSync(filename, 'utf8'), { exports: {}, require: createRequire(filename), Page(value) { page = value; }, getApp: () => ({ globalData: { client } }), wx: platform, setTimeout(fn) { timers.set(++serial, fn); return serial; }, clearTimeout(id) { timers.delete(id); }, Date, Error }, { filename: filename.pathname });
  page.data = structuredClone(page.data);
  page.setData = function(values) { Object.assign(this.data, structuredClone(values)); };
  return { page, timers };
}
export async function fixture(t) {
  const directory = await fs.mkdtemp('/tmp/wechat-lifecycle-');
  const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
  const provider = () => createPiProvider({ models, providerId: 'faux', model: 'faux-1' });
  let app = await createApp({ dataDirectory: directory, provider: provider() });
  const address = await app.listen(0); let base = `http://127.0.0.1:${address.port}`;
  const journal = memoryJournal(), requests = [], downloads = [], previews = [];
  let lose = false, offline = false, corrupt = false, held = false, holds = [];
  const platform = {
    request(options) {
      requests.push({ url: options.url, method: options.method, data: structuredClone(options.data), header: structuredClone(options.header) });
      const run = async () => {
        if (offline) { options.fail({ errMsg: 'offline fixture' }); return; }
        try {
          const response = await fetch(options.url, { method: options.method, headers: options.header, body: options.data ? JSON.stringify(options.data) : undefined });
          const data = await response.json();
          if (lose && options.method === 'POST') { lose = false; options.fail({ errMsg: 'lost response fixture' }); }
          else options.success({ statusCode: response.status, data });
        } catch (error) { options.fail(error); }
      };
      if (held) holds.push(run); else void run();
      return { abort() {} };
    },
    downloadFile(options) {
      downloads.push(options.url);
      void fetch(options.url, { headers: options.header }).then(async response => {
        const tempFilePath = `${directory}/download-${downloads.length}`; await fs.writeFile(tempFilePath, Buffer.from(await response.arrayBuffer())); options.success({ statusCode: response.status, tempFilePath });
      }).catch(options.fail);
    },
    getFileSystemManager() { return {
      readFile(options) { void fs.readFile(options.filePath).then(bytes => options.success({ data: bytes.toString(options.encoding) })).catch(options.fail); },
      getFileInfo(options) { assert.equal(options.digestAlgorithm, 'sha256'); void fs.readFile(options.filePath).then(bytes => options.success({ digest: corrupt ? '0'.repeat(64) : digest(bytes), size: bytes.length })).catch(options.fail); },
    }; },
    login() { assert.fail('No real WeChat account in fixture'); },
    showModal(options) { options.success({ confirm: true, cancel: false }); },
    previewImage(options) { previews.push({ type: 'image', path: options.urls[0] }); options.success?.({}); },
    openDocument(options) { previews.push({ type: 'pdf', path: options.filePath }); options.success?.({}); },
  };
  const options = () => ({ baseUrl: base, allowLoopback: true, journal });
  const newClient = () => new WorkspaceClient(platform, options());
  const client = newClient();
  t?.after?.(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { get app() { return app; }, client, faux, directory, journal, platform, requests, downloads, previews, newClient, options,
    loseNext() { lose = true; }, offline(value = true) { offline = value; }, corrupt(value = true) { corrupt = value; }, hold() { held = true; }, release() { held = false; const list = holds; holds = []; list.forEach(run => void run()); },
    async reopen() { const port = new URL(base).port; await app.close(); app = await createApp({ dataDirectory: directory, provider: provider() }); await app.listen(Number(port)); },
    async close() { await app.close(); await fs.rm(directory, { recursive: true, force: true }); },
  };
}
