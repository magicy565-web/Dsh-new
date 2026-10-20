// Framework-agnostic client plugin slot registry.
//
// This module is the browser-side counterpart of the server `harness.plugin.json`
// contract: a client plugin contributes React nodes to one of the frozen `SLOT`
// names, the host discovers the plugins, and the registry keeps the cross-plugin
// ordering deterministic (plugin id). It deliberately imports no React so the
// registry can be unit tested in Node with `node --test`.
import { ERROR, HarnessError, SLOT, assertId } from '../../harness-contracts/src/index.mjs';

/** The frozen slot vocabulary from packages/harness-contracts. */
export const SLOT_NAMES = Object.freeze(Object.values(SLOT));

// Cross-realm safe plain-object check: DOM tests inject plugins created in the Node
// realm, so prototype identity must not be compared with this realm's Object.prototype.
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.prototype.toString.call(value) === '[object Object]';

function byPluginId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * createSlotRegistry owns the client-side plugin table.
 *
 * A client plugin is `{ id, slots: { [slotName]: (props) => ReactNode }, activate?(ctx), dispose?() }`.
 * The registry never renders anything itself; it validates registrations and hands
 * the host an ordered list of occupants for a slot.
 *
 * @param {{ logger?: { error: (...args: unknown[]) => void } }} [options]
 */
export function createSlotRegistry(options = {}) {
  const logger = options.logger ?? (typeof console === 'object' ? console : { error() {} });
  const plugins = new Map();   // plugin id -> plugin object
  const failures = new Map();  // plugin id -> activation error
  const listeners = new Set();

  function notify() {
    for (const listener of [...listeners]) {
      try { listener(); }
      catch (error) { logger.error('[harness-client] a slot registry listener failed; ignoring it.', error); }
    }
  }

  /** Subscribe to registration changes. Returns an unsubscribe function. */
  function subscribe(listener) {
    if (typeof listener !== 'function')
      throw new HarnessError(ERROR.manifestInvalid, 'slot registry.subscribe(listener) requires a function.');
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  /** Validate and register one client plugin. A duplicate plugin id is refused. */
  function register(plugin) {
    if (!isPlain(plugin))
      throw new HarnessError(ERROR.manifestInvalid, 'A client plugin must be a plain object.');
    assertId(plugin.id, 'client plugin.id');
    if (plugins.has(plugin.id))
      throw new HarnessError(ERROR.pluginDuplicate, `client plugin ${plugin.id} is already registered.`);
    const slotMap = plugin.slots ?? {};
    if (!isPlain(slotMap))
      throw new HarnessError(ERROR.manifestInvalid, `client plugin ${plugin.id}.slots must be a plain object.`);
    for (const [name, render] of Object.entries(slotMap)) {
      if (!SLOT_NAMES.includes(name))
        throw new HarnessError(ERROR.manifestInvalid, `client plugin ${plugin.id} targets unknown slot "${name}"; allowed slots: ${SLOT_NAMES.join(', ')}.`);
      if (typeof render !== 'function')
        throw new HarnessError(ERROR.manifestInvalid, `client plugin ${plugin.id} slot "${name}" must be a render function.`);
    }
    plugins.set(plugin.id, plugin);
    notify();
    return plugin;
  }

  /** Remove one client plugin (used by HMR/tests) and dispose it when it asked to be. */
  function unregister(id) {
    const plugin = plugins.get(id);
    if (!plugin) return false;
    plugins.delete(id);
    failures.delete(id);
    try { plugin.dispose?.(); }
    catch (error) { logger.error(`[harness-client] client plugin ${id} dispose() failed; the plugin is unregistered anyway.`, error); }
    notify();
    return true;
  }

  /**
   * Call `activate(ctx)` on every registered plugin in plugin-id order. Plugins whose
   * activation fails are logged once and excluded from every slot (fail-closed).
   */
  function activate(ctx) {
    for (const plugin of [...plugins.values()].sort(byPluginId)) {
      if (typeof plugin.activate !== 'function') continue;
      try { plugin.activate(ctx); }
      catch (error) {
        failures.set(plugin.id, error);
        logger.error(`[harness-client] client plugin ${plugin.id} activate() failed; its slot occupants will not render.`, error);
      }
    }
    notify();
    return {
      activated: [...plugins.keys()].filter(id => !failures.has(id)).length,
      failed: [...failures.keys()].sort(),
    };
  }

  /**
   * Occupants of one slot, ordered deterministically by plugin id. Multiple plugins
   * may contribute to the same slot (they render as sibling blocks, never replacing
   * each other) and invalid slot names are refused.
   */
  function slots(name) {
    if (!SLOT_NAMES.includes(name))
      throw new HarnessError(ERROR.manifestInvalid, `Unknown client slot "${name}"; allowed slots: ${SLOT_NAMES.join(', ')}.`);
    return [...plugins.values()]
      .filter(plugin => !failures.has(plugin.id) && plugin.slots && Object.hasOwn(plugin.slots, name))
      .sort(byPluginId)
      .map(plugin => Object.freeze({ pluginId: plugin.id, render: plugin.slots[name] }));
  }

  /** Registered plugins as `{ id, slots: [slotName] }`, ordered by plugin id. */
  function list() {
    return [...plugins.values()].sort(byPluginId)
      .map(plugin => Object.freeze({ id: plugin.id, slots: Object.freeze(Object.keys(plugin.slots ?? {})) }));
  }

  return Object.freeze({ register, unregister, activate, slots, list, subscribe });
}
