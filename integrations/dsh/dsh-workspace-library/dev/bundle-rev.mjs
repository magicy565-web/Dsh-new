// Development helper: print the served client-bundle revision and probe it.
//
// The Harness serves plugin client bundles from an immutable revision URL
// (/plugins/??<package>/client.js&rev=<rev>). The revision is derived from the
// file's mtime/ctime/size, so it changes on every save; a page refresh only
// picks up the new code when this rev matches the server's composed graph.
//
// Usage: node dev/bundle-rev.mjs [http://127.0.0.1:59355]
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, '..', 'client.js');
const stat = statSync(file);

const hash = createHash('sha1').update('plugin-artifact').update('\0');
for (const part of [String(stat.mtimeMs), String(stat.ctimeMs), String(stat.size)]) {
  hash.update(`${Buffer.byteLength(part)}:`).update(part);
}
const rev = hash.digest('hex').slice(0, 12);

const base = (process.argv[2] || 'http://127.0.0.1:59355').replace(/\/+$/u, '');
const url = `${base}/plugins/??dsh-workspace-library/client.js&rev=${rev}`;
const response = await fetch(url);
const text = await response.text();

console.log(`client.js  ${stat.size} bytes  mtime ${new Date(stat.mtimeMs).toISOString()}`);
console.log(`served rev ${rev}  status ${response.status}  bytes ${text.length}`);

const markers = {
  'layout (wl-library-title)': 'wl-library-title',
  'api base': '/workspace-library-api',
  'sidebar registration': 'sidebar.panellist',
  'page route switch': "case 'product'",
};
let missing = response.status !== 200;
for (const [label, marker] of Object.entries(markers)) {
  const present = text.includes(marker);
  if (!present) missing = true;
  console.log(`${present ? 'ok  ' : 'MISS'} ${label}`);
}
if (missing) {
  console.error('\nThe served bundle is not the current one, or a marker is missing.');
  process.exitCode = 1;
}
