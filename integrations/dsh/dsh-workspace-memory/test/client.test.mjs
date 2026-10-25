import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('memory client dictionaries cover visible keys and native slots are gated by their own declarations', async () => {
  let module;
  const code = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  vm.runInNewContext(code, { window: { __ModuleLoader__: { load({ factory }) { module = factory(() => ({})); } } } });
  const { zh, en } = module.dictionaries;
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  for (const match of code.matchAll(/\bt\('([^']+)'\)/gu)) assert.ok(match[1] in zh, 'Visible label: ' + match[1]);
  const effects = [], contributed = [];
  let slot;
  module.apply({ locale: { register: () => () => {}, bind: () => key => key }, effect(fn) { effects.push(fn()); }, slots: {
    inject(name, fn) { slot = name; const dispose = fn(); slot = undefined; return dispose; },
    register(options) { assert.equal(slot, options.name); contributed.push(options.name); return () => contributed.pop(); },
  } });
  assert.deepEqual(contributed, ['sidebar.panellist', 'main']);
  effects.reverse().forEach(dispose => dispose?.());
  assert.equal(contributed.length, 0);
});
