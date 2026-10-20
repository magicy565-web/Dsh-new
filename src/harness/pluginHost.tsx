// Client-side slot host: discovers client plugins, registers them into one registry and
// renders their occupants inside a stable per-plugin error boundary.
//
// The shell (App.tsx, BusinessBrainHome.tsx) only knows about slot names. Adding a new
// client plugin never requires editing the shell: drop `plugins/<id>/client/index.tsx`
// with a default-exported client plugin and it is discovered at build time.
import { Component, useEffect, useReducer } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { createSlotRegistry } from '../../packages/harness-client/src/index.mjs';
import type { ClientPlugin, SlotName } from '../../packages/harness-client/src/index.mjs';
import './plugin-host.css';

export type { ClientPlugin, SlotName } from '../../packages/harness-client/src/index.mjs';

type PluginModule = { default?: unknown };

/** Build-time discovery: every `plugins/<id>/client/index.tsx` is statically imported. */
const discovered = import.meta.glob('../../plugins/*/client/index.tsx', { eager: true }) as unknown as Record<string, PluginModule>;

const registry = createSlotRegistry();

let booted = false;

/**
 * Register every discovered client plugin exactly once. Idempotent; called at module
 * load so the first render already sees the plugins, and exported for explicit boot.
 */
export function bootPluginHost() {
  if (booted) return registry;
  booted = true;
  const entries = Object.entries(discovered).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [path, module] of entries) {
    const candidate = (module as PluginModule | undefined)?.default;
    if (!candidate || typeof candidate !== 'object') {
      console.error(`[harness-client] 客户端插件入口 ${path} 没有 default 导出的插件对象，已跳过。`);
      continue;
    }
    try {
      registry.register(candidate as ClientPlugin);
    } catch (error) {
      console.error(`[harness-client] 客户端插件 ${path} 注册失败，已跳过。`, error);
    }
  }
  const activation = registry.activate({ registry });
  if (activation.failed.length) console.error(`[harness-client] 以下客户端插件 activate() 失败：${activation.failed.join(', ')}`);
  // Test/debug hook: lets the DOM tests inject or remove a plugin without a rebuild.
  (globalThis as unknown as { __DSH_SLOT_REGISTRY__: typeof registry }).__DSH_SLOT_REGISTRY__ = registry;
  return registry;
}

export const slotRegistry = bootPluginHost();

class PluginErrorBoundary extends Component<{ pluginId: string; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Log once per broken plugin; the boundary state prevents any retry loop.
    console.error(`[harness-client] 客户端插件 ${this.props.pluginId} 渲染失败，已隔离该插件，页面其余部分继续工作。`, error);
  }

  render() {
    return this.state.failed ? null : this.props.children ?? null;
  }
}

/**
 * Render every occupant registered for `name`, in deterministic plugin-id order.
 * One plugin throwing never prevents the other occupants or the rest of the page.
 */
export function PluginSlot({ name, props = {} }: { name: SlotName; props?: Record<string, unknown> }) {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  useEffect(() => registry.subscribe(rerender), []);
  const occupants = registry.slots(name);
  return (
    <div className="plugin-slot" data-slot={name}>
      {occupants.map(occupant => {
        const Occupant = occupant.render as unknown as ComponentType<Record<string, unknown>>;
        return (
          <div className="plugin-slot-item" data-plugin={occupant.pluginId} key={occupant.pluginId}>
            <PluginErrorBoundary pluginId={occupant.pluginId}>
              <Occupant {...props} />
            </PluginErrorBoundary>
          </div>
        );
      })}
    </div>
  );
}
