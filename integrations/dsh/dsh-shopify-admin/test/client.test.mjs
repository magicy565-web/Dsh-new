import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';

test('native panel reports setup status, keeps Shopify links constrained, and discards responses from a previous session', async t => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'https://workspace.example.test/' });
  const saved = new Map();
  function expose(key, value) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'MouseEvent']) expose(key, dom.window[key]);
  expose('IS_REACT_ACT_ENVIRONMENT', true);
  let resolveAuthorization;
  let authorizationSignal;
  expose('fetch', async (path, options = {}) => {
    if (path.includes('/status?')) {
      const session = new URL(path, 'https://workspace.example.test').searchParams.get('sessionId');
      const value = session === 'session-connected'
        ? { status: 'connected', shop: 'example.myshopify.com', shopName: 'Example' }
        : session === 'session-suggested'
          ? { status: 'setup_required', suggestedShop: 'fixture-shop.myshopify.com' }
          : session === 'session-invalid'
          ? { status: 'connected', shop: 'example.myshopify.com.attacker.test' }
          : { status: session === 'session-pending' ? 'unbound' : 'setup_required' };
      return new Response(JSON.stringify({ ok: true, data: value }));
    }
    if (path.endsWith('/authorize')) {
      authorizationSignal = options.signal;
      return new Promise(resolve => { resolveAuthorization = resolve; });
    }
    throw new Error(`Unexpected request: ${path}`);
  });

  let plugin, Panel;
  window.__ModuleLoader__ = { load({ factory }) { plugin = factory(name => { assert.equal(name, 'react'); return React; }); } };
  vm.runInThisContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'));
  plugin.apply({
    effect: fn => fn(),
    locale: { register: () => () => {}, bind: () => key => key },
    sidebarRightTabs: { register: () => () => {} },
    slots: { inject: (_name, fn) => fn(), register: (_options, component) => { Panel = component; return () => {}; } },
  });
  const root = createRoot(document.getElementById('app'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  });
  const render = async sessionId => {
    await act(async () => { root.render(React.createElement(Panel, { sessionId })); });
  };

  await render('session-setup');
  assert.match(document.body.textContent, /准备连接商店/);
  assert.equal(document.querySelector('a').href, 'https://admin.shopify.com/');

  await render('session-suggested');
  assert.equal(document.querySelector('a').href, 'https://fixture-shop.myshopify.com/admin');
  assert.match(document.body.textContent, /准备连接商店/);

  await render('session-connected');
  const admin = document.querySelector('a');
  assert.equal(admin.href, 'https://example.myshopify.com/admin');
  assert.equal(admin.getAttribute('rel'), 'noopener noreferrer');

  await render('session-invalid');
  assert.equal(document.querySelector('a'), null, 'an invalid shop cannot create an Admin link');

  await render('session-pending');
  const input = document.querySelector('#shopify-domain');
  await act(async () => {
    Simulate.change(input, { target: { value: 'example.myshopify.com' } });
  });
  await act(async () => {
    input.form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
  assert.ok(resolveAuthorization);
  await render('session-setup');
  assert.equal(authorizationSignal.aborted, true);
  await act(async () => {
    resolveAuthorization(new Response(JSON.stringify({ ok: true, data: { authorizeUrl: 'https://example.myshopify.com/admin/oauth/authorize?state=synthetic' } })));
  });
  assert.equal(document.querySelectorAll('a').length, 1);
  assert.equal(document.querySelector('a').href, 'https://admin.shopify.com/', 'a prior session must not expose its authorization URL');
});
