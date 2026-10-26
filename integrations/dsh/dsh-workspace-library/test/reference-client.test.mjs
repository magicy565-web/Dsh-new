import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const id = 'doc_11111111-1111-4111-8111-111111111111';
const pin = { documentId: id, version: 1, sha256: 'a'.repeat(64) };
const code = await readFile(new URL('../client.js', import.meta.url), 'utf8');
function load(fetch, sourceCode = code) {
  let exported;
  const sandbox = {
    URL, URLSearchParams, Response, fetch, AbortController,
    setTimeout: () => 1, clearTimeout() {},
    window: { __ModuleLoader__: { load({ factory }) {
      exported = factory(name => {
        assert.equal(name, 'react');
        // This suite exercises reference serialization, not rendered surfaces.
        return { createContext: () => ({}), forwardRef: render => render,
          createElement: (type, props, ...children) => ({ type, props, children }) };
      });
    } } },
  };
  vm.runInNewContext(sourceCode, sandbox);
  return exported;
}
const json = value => new Response(JSON.stringify({ ok: true, data: value }), { headers: { 'content-type': 'application/json' } });

test('native @ candidates become fixed-version chips and serialize pins without document contents', async () => {
  const calls = [];
  const module = load(async (path, init) => {
    calls.push({ path, init });
    return path.includes('/references/check') ? json({ references: [pin] })
      : json({ items: [{ ...pin, title: '供货政策', fileName: 'policy.md', reviewState: 'unreviewed' }] });
  });
  const source = module.createReferenceSource(key => key);
  const signal = new AbortController().signal;
  const candidates = await source.candidates({ sessionId: 'session-one' }, { query: '供货', signal });
  assert.equal(calls[0].init.signal, signal);
  assert.match(calls[0].path, /references\?q=/u);
  const choice = source.onPick({ candidate: candidates[0] }).insert;
  assert.equal(choice.source, 'workspace-library');
  assert.match(choice.label, /v1/u);
  assert.deepEqual(JSON.parse(choice.ref), pin);
  assert.equal(source.codec.clipboardText(choice.ref), choice.clipboardText);
  const modelText = await source.codec.serialize(choice.ref, signal);
  assert.deepEqual(JSON.parse(calls[1].init.body), { references: [pin] });
  assert.match(modelText, /workspace_library_references/u);
  assert.match(modelText, new RegExp(pin.sha256, 'u'));
  assert.equal(modelText.includes('supply content'), false);
});

test('both client panels wait for the slot they contribute to, regardless of host activation order', async () => {
  const space = await readFile(new URL('../../dsh-space-workspace/client.js', import.meta.url), 'utf8');
  for (const sourceCode of [code, space]) {
    const contributions = [];
    let owner;
    load(async () => json({}), sourceCode).apply({
      effect: fn => fn(),
      locale: { register: () => () => {}, bind: () => key => key },
      inputTriggers: { registerSource: () => () => {} },
      uiSession: { provide: () => () => {} },
      slots: {
        inject(name, fn) { owner = name; const dispose = fn(); owner = undefined; return dispose; },
        register(options) {
          assert.equal(owner, options.name, 'register only after that exact slot is declared');
          contributions.push(options.name);
          return () => {};
        },
      },
    });
    assert.ok(contributions.includes('sidebar.panellist'));
    assert.ok(contributions.includes('main'));
  }
});

test('stale pins block native submission instead of falling back to clipboard text', async () => {
  const module = load(async () => new Response(JSON.stringify({ ok: false, error: { code: 'REFERENCE_ARCHIVED', message: 'Archived' } }), { status: 409 }));
  const source = module.createReferenceSource(key => key);
  await assert.rejects(() => source.codec.serialize(JSON.stringify(pin), new AbortController().signal), { code: 'REFERENCE_ARCHIVED' });
  const abort = new AbortController();
  abort.abort();
  const cancelled = load(async (_path, init) => { init.signal.throwIfAborted(); }).createReferenceSource(key => key);
  await assert.rejects(() => cancelled.codec.serialize(JSON.stringify(pin), abort.signal), { name: 'AbortError' });
});

test('native source launcher preserves the guarded selection without injecting a literal @ or moving the caret', () => {
  const module = load(async () => json({ items: [] }));
  const registered = new Map();
  let source, provider, disposed = false, providerDisposed = false;
  const launches = [], binding = { ctx: {} };
  const effects = [];
  const ctx = {
    effect: fn => { const dispose = fn(); effects.push(dispose); return dispose; },
    locale: { register: () => () => {}, bind: () => key => key },
    inputTriggers: {
      registerSource(value) { source = value; return () => { disposed = true; }; },
      sessionOf(scope) { assert.equal(scope, binding.ctx); return { toggleSource: (name, hit) => launches.push({ name, hit }) }; },
    },
    uiSession: { provide(value) { provider = value; return () => { providerDisposed = true; }; } },
    slots: {
      inject: (_name, fn) => fn(),
      register(options, component) { registered.set(`${options.name}:${options.id ?? options.key}`, component); return () => {}; },
    },
  };
  module.apply(ctx);
  assert.equal(source.name, 'workspace-library');
  const Button = registered.get('conversation.input.left:workspace-library');
  const span = { start: 3, end: 3, draftRev: 7 };
  const button = Button({ t: key => key, useInput: fn => fn({ draft: 'abc', phase: 'plain' }), inputActions: {
    captureInsertion: () => span,
    insertText: () => { throw new Error('The menu launcher must not mutate the draft.'); },
  }, ...provider.resolve(binding).props });
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  assert.equal(launches[0].name, 'workspace-library');
  assert.equal(launches[0].hit.span, span);
  assert.equal(launches[0].hit.position, 'inline');
  assert.equal(launches[0].hit.trigger, '@');
  assert.equal(Button({ t: key => key, useInput: fn => fn({ phase: 'submitting' }) }).props.disabled, true);
  effects.reverse().forEach(dispose => dispose?.());
  assert.equal(disposed, true);
  assert.equal(providerDisposed, true);
});
