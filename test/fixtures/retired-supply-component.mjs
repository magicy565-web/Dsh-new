import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
let scriptPromise;

// The retired panel still has a component/API contract. Compile that original
// component only for this test; it is not mounted at any production route.
// This adapter records its onDirty callback and does not recreate App navigation.
export function retiredSupplyComponentScript() {
  return scriptPromise ||= (async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workspace-retired-supply-bundle-'));
    try {
      const entry = join(directory, 'entry.mjs');
      await writeFile(entry, `
import React from ${JSON.stringify(require.resolve('react'))};
import { createRoot } from ${JSON.stringify(require.resolve('react-dom/client'))};
import SupplyNetworkPanel from ${JSON.stringify(join(root, 'src/commerce/SupplyNetworkPanel.tsx'))};
const root = createRoot(document.getElementById('root'));
window.__retiredSupplyDirty = false;
window.__unmountRetiredSupply = () => root.unmount();
root.render(React.createElement(SupplyNetworkPanel, {
  readOnly: false, isAdmin: false, shopify: undefined,
  onDirty: value => { window.__retiredSupplyDirty = value; },
}));
`);
      const result = await build({ configFile: false, root, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' }, build: {
        write: false, minify: false, target: 'es2022',
        lib: { entry, name: 'RetiredSupplyContract', formats: ['iife'] },
      } });
      const output = (Array.isArray(result) ? result : [result]).flatMap(value => value.output);
      const chunks = output.filter(value => value.type === 'chunk');
      assert.equal(chunks.length, 1, 'one test-only component bundle');
      return chunks[0].code;
    } finally {
      assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
      assert.ok(directory.startsWith(join(tmpdir(), 'workspace-retired-supply-bundle-')));
      await rm(directory, { recursive: true, force: true });
    }
  })();
}
