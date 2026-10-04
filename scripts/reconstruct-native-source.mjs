import { createReadStream } from 'node:fs';
import { readFile, mkdir, link, unlink, stat, open } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const partsDirectory = path.resolve(process.argv[2] || path.join(root, 'backend/source-parts'));
const output = path.resolve(process.argv[3] || path.join(root, 'backend/deepseek-harness-source.tar.gz'));
const manifest = JSON.parse(await readFile(path.join(root, 'backend/SOURCE-PARTS.json'), 'utf8'));
if (!/^[a-f0-9]{64}$/.test(manifest.sha256) || !Array.isArray(manifest.parts) || !manifest.parts.length || manifest.parts.length > 20 || manifest.parts.some(part => !/^deepseek-harness-source\.part\d{2}$/.test(part.filename) || !/^[a-f0-9]{64}$/.test(part.sha256) || !Number.isSafeInteger(part.bytes) || part.bytes < 1 || part.bytes > 7_000_000)) throw new Error('Invalid source-part manifest.');
const hashFile = async filename => { const digest = createHash('sha256'); for await (const chunk of createReadStream(filename)) digest.update(chunk); return digest.digest('hex'); };
try {
  const existing = await stat(output);
  if (existing.size === manifest.bytes && await hashFile(output) === manifest.sha256) { console.log('Native source already reconstructed and verified.'); process.exit(0); }
  throw new Error('Output exists but does not match. Choose a new output filename; existing data was not changed.');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const part of manifest.parts) {
  const filename = path.join(partsDirectory, part.filename); const info = await stat(filename);
  if (info.size !== part.bytes || await hashFile(filename) !== part.sha256) throw new Error(`Part verification failed: ${part.filename}`);
}
await mkdir(path.dirname(output), { recursive: true });
const temporary = `${output}.reconstruct-${randomUUID()}.tmp`;
const writer = await open(temporary, 'wx', 0o600);
try {
  for (const part of manifest.parts) for await (const chunk of createReadStream(path.join(partsDirectory, part.filename))) await writer.writeFile(chunk);
  await writer.sync(); await writer.close();
  if (await hashFile(temporary) !== manifest.sha256) throw new Error('Reconstructed source digest mismatch.');
  await link(temporary, output); await unlink(temporary);
  console.log(`Verified source archive: ${output}\nSHA-256: ${manifest.sha256}`);
} catch (error) { await writer.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error; }
