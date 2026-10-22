// End-to-end smoke for the file surface.
//
// Uploads a text file and a PNG, then proves list, text preview and byte-for-byte
// download over the real artifacts seam. Filenames carry a suffix so repeated
// runs never compare against an older upload.
//
// Usage: node scripts/files-smoke.mjs
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { createHarness } from '../packages/harness-kernel/src/app.mjs';

const root = path.resolve(import.meta.dirname, '..');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) }); };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const suffix = Date.now().toString(36);

const composition = parse(await readFile(path.join(root, 'harness.local.yml'), 'utf8'));
composition.server = { host: '127.0.0.1', port: 0 };
const compositionPath = path.join(root, '.harness-files-smoke.yml');
await writeFile(compositionPath, stringify(composition), 'utf8');

const harness = await createHarness({ compositionPath, root, logger: { info() {}, warn() {}, error() {} } });
try {
  const { address } = await harness.start();
  const base = address.url;

  const textName = `冒烟-${suffix}.md`;
  const uploaded = await fetch(`${base}/api/artifacts`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename: textName, mimeType: 'text/markdown', content: `# 冒烟\n\n${suffix}\n` }),
  }).then(async response => ({ ok: response.ok, body: await response.json() }));
  check('a text file uploads', uploaded.ok && uploaded.body.artifact.filename === textName, uploaded.body.artifact?.filename);
  const textId = uploaded.body.artifact.id;

  const page = await fetch(`${base}/files`);
  const html = await page.text();
  check('the files page renders', page.status === 200 && html.includes('上传文件'), page.status);

  const listed = await fetch(`${base}/api/artifacts`).then(response => response.json());
  const items = listed.artifacts ?? listed.items ?? [];
  check('the uploaded file is listed', items.some(item => item.id === textId), { count: items.length, keys: Object.keys(listed) });

  const content = await fetch(`${base}/api/artifacts/${textId}/content`).then(response => response.json());
  check('the text preview matches', content.content.includes(suffix), String(content.content ?? '').slice(0, 40));

  const download = await fetch(`${base}/api/artifacts/${textId}/download`);
  const downloaded = await download.text();
  check('the text download matches', download.status === 200 && downloaded.includes(suffix), download.headers.get('content-type'));

  const binaryName = `像素-${suffix}.png`;
  const binary = await fetch(`${base}/api/artifacts`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename: binaryName, mimeType: 'image/png', base64: png.toString('base64') }),
  }).then(async response => ({ ok: response.ok, body: await response.json() }));
  check('a binary file uploads', binary.ok && binary.body.artifact.mimeType === 'image/png', binary.body.artifact?.size);

  const binaryDownload = await fetch(`${base}/api/artifacts/${binary.body.artifact.id}/download`);
  const binaryBytes = Buffer.from(await binaryDownload.arrayBuffer());
  check('the binary download is byte for byte',
    binaryDownload.headers.get('content-type') === 'image/png' && binaryBytes.equals(png), binaryBytes.length);

  const refused = await fetch(`${base}/api/artifacts`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename: 'x.txt', mimeType: 'text/plain', content: 'x', base64: png.toString('base64') }),
  });
  check('two payloads at once are refused', refused.status === 400, refused.status);
} finally {
  await Promise.race([harness.stop().catch(() => {}), new Promise(resolve => setTimeout(resolve, 3000))]);
  await unlink(compositionPath).catch(() => {});
}

const failed = results.filter(item => !item.ok);
for (const item of results) console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}${item.detail === undefined ? '' : ` (${JSON.stringify(item.detail)})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
