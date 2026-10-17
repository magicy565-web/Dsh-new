import { clone, fail } from '../plugins/workspace-goal-intelligence/src/contracts.mjs';

const ROUTES = Object.freeze([
  ['commerce-cohort:', 'commerce'],
  ['inquiry-pipeline:', 'inquiry'],
  ['inquiry-aging:', 'inquiry'],
  ['product-completeness:', 'product'],
]);

function route(reference, adapters) {
  const id = reference?.id;
  if (typeof id !== 'string') fail('BRAIN_SOURCE_NOT_SELECTED');
  const match = ROUTES.find(([prefix]) => id.startsWith(prefix));
  if (!match || !adapters[match[1]]) fail('BRAIN_SOURCE_NOT_SELECTED');
  return adapters[match[1]];
}

export function createCompositeGoalBrainSourceAdapter({ commerce = null, inquiry = null, product = null } = {}) {
  const adapters = { commerce, inquiry, product };
  for (const adapter of Object.values(adapters)) {
    if (adapter !== null && (!adapter || typeof adapter.list !== 'function' || typeof adapter.read !== 'function' || typeof adapter.current !== 'function'))
      throw new TypeError('Brain source adapters must implement list/read/current.');
  }
  async function list(args = {}) {
    const groups = await Promise.all(Object.values(adapters).filter(Boolean).map(adapter => adapter.list(args)));
    const seen = new Map();
    for (const group of groups) for (const reference of Array.isArray(group) ? group : []) {
      const key = reference.kind + ':' + reference.id;
      const existing = seen.get(key);
      if (existing && JSON.stringify(existing) !== JSON.stringify(reference)) fail('BRAIN_SOURCE_CONFLICT');
      seen.set(key, clone(reference));
    }
    return [...seen.values()];
  }
  async function read(args = {}) { return route(args.reference, adapters).read(args); }
  function current(args = {}) { return route(args.reference, adapters).current(args); }
  return Object.freeze({ list, read, current });
}