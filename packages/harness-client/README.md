# @workspace-harness/client

Browser-side slot layer for the Workspace Harness. It is the client counterpart of
the backend `packages/harness-*` contract: a business plugin may contribute small
UI blocks to a small, frozen set of extension points instead of the shell hard-coding
each feature.

- `src/index.mjs` - framework-agnostic registry (no React import). Used in Node tests.
- `src/index.d.mts` - hand-written types for the ESM registry.

The slot names are frozen in `packages/harness-contracts/src/index.mjs` (`SLOT`):

| Slot | Rendered where |
| --- | --- |
| `home.cards` | the business home page (`src/experience/BusinessBrainHome.tsx`) |
| `page.body` | reserved by the contract, not mounted by the current shell |
| `session.header` | reserved by the contract, not mounted by the current shell |
| `settings.section` | reserved by the contract, not mounted by the current shell |

## Registering a slot occupant from a plugin

1. Add the client entry to the plugin manifest (declarative metadata for humans and
   tooling; the actual discovery is the Vite glob described below):

   ```json
   {
     "id": "workspace-inquiry-recovery",
     "entry": "./src/index.mjs",
     "client": "./client/index.tsx"
   }
   ```

2. Create `plugins/<plugin-id>/client/index.tsx`. It must default-export a client
   plugin object:

   ```tsx
   import type { ClientPlugin } from '../../../packages/harness-client/src/index.mjs';

   function MyCard({ onOpenRecovery }: { onOpenRecovery?: () => void }) {
     return <button type="button" onClick={() => onOpenRecovery?.()}>打开功能</button>;
   }

   const plugin: ClientPlugin = {
     id: 'my-plugin',                                  // must match harness.plugin.json id
     slots: { 'home.cards': MyCard },                  // one render function per slot
     // activate?(ctx) {}                              // optional, called once by the host
     // dispose?() {}                                  // optional, called on unregister
   };
   export default plugin;
   ```

3. Ship the plugin's styles with the plugin (for example `./client/client.css`,
   imported from the entry). Use the existing theme tokens (`var(--harness-ink)`,
   `var(--harness-line)`, `var(--harness-accent)`), 44px minimum interactive targets
   and mobile-first layout. Reuse the existing `src/api.ts` helpers for HTTP.

### Discovery

`src/harness/pluginHost.tsx` boots once per page load and discovers every
`plugins/*/client/index.tsx` with

```ts
import.meta.glob('../../plugins/*/client/index.tsx', { eager: true });
```

Vite turns that into static imports at build time, so no plugin is loaded over the
network and `src/App.tsx` never gains a per-feature import or a plugin list. The host
registers each module's default export into one registry and calls `activate(ctx)`.

Occupants render inside a per-plugin error boundary. If a plugin throws while
rendering (or fails `activate`), it is isolated: it renders nothing, the host logs
one explicit error, and the rest of the page keeps working.

Each plugin is wrapped in `<div class="plugin-slot-item" data-plugin="<id>">` inside
`<div class="plugin-slot" data-slot="<name>">`, in deterministic plugin-id order.

## Registry API

```js
const registry = createSlotRegistry({ logger }?);
registry.register(plugin);       // validates; duplicate plugin id -> HARNESS_PLUGIN_DUPLICATE
registry.unregister(pluginId);   // calls plugin.dispose(), notifies subscribers
registry.activate(ctx);          // calls plugin.activate(ctx); failures are excluded fail-closed
registry.slots('home.cards');    // [{ pluginId, render }, ...] ordered by plugin id
registry.list();                 // [{ id, slots: ['home.cards'] }, ...] ordered by plugin id
registry.subscribe(listener);    // returns unsubscribe; used by <PluginSlot>
```

Validation, exactly as the frozen contract requires:

- a plugin's slot keys must be one of the four `SLOT` names;
- each slot value must be a render function;
- a duplicate plugin **id** is refused (`HARNESS_PLUGIN_DUPLICATE`);
- multiple plugins may occupy the **same** slot; their order is deterministic by plugin id;
- an unknown plugin id in `unregister` is a no-op returning `false`.

`<PluginSlot name="home.cards" props={{ ... }} />` from
`src/harness/pluginHost.tsx` renders the registered occupants. For tests and
debugging the booted registry is exposed as `globalThis.__DSH_SLOT_REGISTRY__`.
