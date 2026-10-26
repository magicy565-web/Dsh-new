// Creates native installable bundles only. Does not install, start, or publish.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.argv[2]) throw new Error('Usage: node scripts/package-erp-admin.mjs /absolute/output-directory-outside-repository');
const out = resolve(process.argv[2]), rel = relative(root, out);
if (!rel.startsWith('..') || rel === '..') throw new Error('Choose an output directory outside the repository.');
// Rebuild the checked-in native Client before packing edited source.
execFileSync(process.execPath, [join(root,'scripts/build-erp-client.mjs')], { cwd:root, stdio:'inherit' });
await mkdir(out, { recursive: true });
const bundles = [];
for (const name of ['dsh-workspace-library', 'dsh-mini-erp']) {
  const cwd = join(root, 'integrations/dsh', name), manifest = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
  const filename = `${name}-${manifest.version}.tgz`;
  // npm pack respects the package files allowlist and runs no lifecycle script.
  const result = JSON.parse(execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', out], { cwd, encoding: 'utf8' }))[0];
  if (result.filename !== filename || !result.files.some(f => f.path === 'cordis.patch.yml') || !result.files.some(f => f.path === 'client.js')) throw new Error(`Incomplete native bundle: ${name}`);
  bundles.push({name, version:manifest.version, file:filename, bytes:result.size, sha256:createHash('sha256').update(await readFile(join(out, filename))).digest('hex')});
}
await writeFile(join(out, 'manifest.json'), JSON.stringify({host:'DeepSeek Harness', testedHostVersion:'0.2.1-rc.2', node:'>=24', bundles},null,2)+'\n');
await writeFile(join(out, 'INSTALL.md'), `# Agentive native plugin package\n\nRequires Node 24+ and DeepSeek Harness Web with its native workspace, attachment and authentication services. No separate server or frontend build is needed.\n\nIn the DSH plugin manager, install these local bundle targets in order:\n\n${bundles.map(b=>`- ${b.file}`).join('\n')}\n\nUse the absolute path to each .tgz as plugin_manager install_bundle target. Follow the native manager's restart-required result when present, then reload the browser and open Agentive. Existing source-directory installations can instead update their checkout and restart DSH. Do not remove existing data.\n\nModule assistants prepare contextual tasks for fresh native DSH sessions. Goals and instructions are saved per module in the current browser; model credentials must be configured in DSH. Execution uses native chat and permissions. The UI retains the navigation/page structure with existing product, customer, file, company, reservation and allocation capabilities. Unimplemented services display unconnected states. No payment, fulfillment, public storefront or Shopify account integration is included. No credentials or business data are packaged.\n`);
console.log(JSON.stringify({directory:out,bundles},null,2));
