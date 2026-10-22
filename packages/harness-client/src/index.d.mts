// Hand-written types for the plain-ESM slot registry (index.mjs).
// Keep SlotName in sync with the frozen SLOT map in packages/harness-contracts/src/index.mjs.
export type SlotName = 'home.cards' | 'page.body' | 'session.header' | 'settings.section';

export declare const SLOT_NAMES: readonly SlotName[];

/** Props are opaque to the registry; each slot host and plugin agree on their own shape. */
export type SlotProps = Record<string, any>;

/** A client plugin contribution: a function component (or plain render function). */
export type SlotRender = (props: SlotProps) => unknown;

export type ClientPlugin = {
  id: string;
  slots: Partial<Record<SlotName, SlotRender>>;
  activate?(ctx: unknown): void;
  dispose?(): void;
};

export type SlotOccupant = {
  readonly pluginId: string;
  readonly render: SlotRender;
};

export type SlotRegistry = {
  register(plugin: ClientPlugin): ClientPlugin;
  unregister(id: string): boolean;
  activate(ctx?: unknown): { activated: number; failed: string[] };
  slots(name: SlotName): readonly SlotOccupant[];
  list(): ReadonlyArray<{ id: string; slots: readonly SlotName[] }>;
  subscribe(listener: () => void): () => void;
};

export type SlotRegistryOptions = {
  logger?: { error: (...args: unknown[]) => void };
};

export declare function createSlotRegistry(options?: SlotRegistryOptions): SlotRegistry;
