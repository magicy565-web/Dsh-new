// The camera is personal: it is remembered per browser and project and is never written to the
// shared layout, so opening the canvas never overwrites a teammate's view.

const keyFor = (scope) => `dsh-commerce-network:viewport:${scope}`;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

export const isViewport = (value) => Boolean(value) && finite(value.x) && finite(value.y) && finite(value.zoom)
  && Math.abs(value.x) <= 1e6 && Math.abs(value.y) <= 1e6 && value.zoom >= 0.1 && value.zoom <= 4;

export function loadViewport(scope, storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(keyFor(scope)) ?? 'null');
    return isViewport(parsed) ? { x: parsed.x, y: parsed.y, zoom: parsed.zoom } : null;
  } catch { return null; }
}

export function saveViewport(scope, viewport, storage = globalThis.localStorage) {
  if (!isViewport(viewport)) return false;
  try { storage?.setItem(keyFor(scope), JSON.stringify({ x: viewport.x, y: viewport.y, zoom: viewport.zoom })); return true; } catch { return false; }
}
