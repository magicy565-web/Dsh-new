import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Code/build identity only. Never reads runtime data, environment or credentials. */
export async function sourceFingerprint(directory = root) {
  const hash = createHash('sha256');
  for (const file of ['package.json', 'package-lock.json']) { hash.update(file); hash.update('\0'); hash.update(await fs.readFile(path.join(directory, file))); hash.update('\0'); }
  for (const folder of ['server', 'src', 'dist', 'vendor', 'scripts']) {
    async function visit(current) { for (const entry of (await fs.readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) { const file = path.join(current, entry.name); if (entry.isDirectory()) await visit(file); else if (entry.isFile()) { hash.update(path.relative(directory, file)); hash.update('\0'); hash.update(await fs.readFile(file)); hash.update('\0'); } } }
    await visit(path.join(directory, folder));
  }
  return hash.digest('hex');
}
