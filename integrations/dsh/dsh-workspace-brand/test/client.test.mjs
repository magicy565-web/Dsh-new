import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

async function load() {
  let plugin;
  const context = vm.createContext({ window: { __ModuleLoader__: { load(entry) {
    plugin = entry.factory(name => {
      assert.equal(name, 'react', 'A visual bundle only consumes the native React module');
      return React;
    });
  } } } });
  vm.runInContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), context);
  return plugin;
}

function host() {
  const effects = [], waiting = new Set();
  const native = () => React.createElement('span', null, 'native');
  const entries = [
    { name: 'sidebar.brand.mark', priority: 0, Component: native },
    { name: 'sidebar.brand.name', priority: 0, Component: native },
  ];
  const layers = new Map([['other-extension', { preserved: true }]]);
  const ctx = {
    effect(callback) { effects.push(callback()); },
    theme: { overrideTokens(source, tokens) { layers.set(source, tokens); return () => layers.delete(source); } },
    slots: {
      inject(name, callback) {
        const pending = { name, callback, stop: undefined };
        waiting.add(pending);
        return () => { waiting.delete(pending); pending.stop?.(); };
      },
      register(options, Component) {
        const entry = { ...options, Component }; entries.push(entry);
        return () => entries.splice(entries.indexOf(entry), 1);
      },
    },
  };
  return { ctx, entries, layers,
    activate() { for (const entry of waiting) { entry.stop = entry.callback(); } },
    dispose() { for (const stop of effects.reverse()) stop?.(); },
    selected(name) { return entries.filter(entry => entry.name === name).sort((a, b) => a.priority - b.priority)[0]; },
  };
}

test('native branding shadows official seats and restores them on unload', async () => {
  const plugin = await load(), native = host();
  plugin.apply(native.ctx);
  assert.equal(native.entries.length, 2, 'Wait for the native parent to declare its seats');
  native.activate();
  assert.equal(native.selected('sidebar.brand.name').priority, -50);
  assert.equal(native.layers.size, 2, 'Preserve other theme extensions');
  const name = renderToStaticMarkup(React.createElement(native.selected('sidebar.brand.name').Component));
  assert.match(name, /Workspace/);
  assert.match(name, /DSH/);
  const mark = renderToStaticMarkup(React.createElement(native.selected('conversation.hero.brand.mark').Component, { size: 34, className: 'native-mark' }));
  assert.match(mark, /width="34"/);
  assert.match(mark, /class="native-mark"/);
  native.dispose();
  assert.equal(native.layers.size, 1);
  assert.equal(native.layers.has('other-extension'), true);
  assert.equal(native.entries.length, 2);
  assert.equal(native.selected('sidebar.brand.name').priority, 0);
});

test('unloading before native seats exist prevents late registrations', async () => {
  const plugin = await load(), native = host();
  plugin.apply(native.ctx);
  native.dispose();
  native.activate();
  assert.equal(native.entries.length, 2);
  assert.equal(native.layers.has('dsh-workspace-brand'), false);
});

test('visual bundle registers no host capabilities', async () => {
  const { apply } = await import('../index.js');
  assert.doesNotThrow(() => apply(new Proxy({}, { get() { throw new Error('Host capability access'); } })));
});
