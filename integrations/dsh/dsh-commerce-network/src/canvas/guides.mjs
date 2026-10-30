// Pure geometry for snapping, smart guides and multi-selection alignment.

export const snapToGrid = (value, grid) => (grid > 0 ? Math.round(value / grid) * grid : value);

const columns = (box) => [box.x, box.x + box.w / 2, box.x + box.w];
const rows = (box) => [box.y, box.y + box.h / 2, box.y + box.h];

function nearest(own, targets, threshold) {
  let best = null;
  for (const mine of own) for (const target of targets) {
    const delta = target - mine;
    if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta };
  }
  return best;
}

/**
 * Snap `box` to the edges and centres of `others` within `threshold` flow units
 * and report the guide lines that are then visible.
 */
export function alignmentGuides(box, others, threshold = 6) {
  if (!others.length) return { dx: 0, dy: 0, guides: [] };
  const horizontal = nearest(columns(box), others.flatMap(columns), threshold);
  const vertical = nearest(rows(box), others.flatMap(rows), threshold);
  const dx = horizontal?.delta ?? 0;
  const dy = vertical?.delta ?? 0;
  const snapped = { ...box, x: box.x + dx, y: box.y + dy };
  const guides = [];
  for (const axis of ['x', 'y']) {
    const lines = axis === 'x' ? columns : rows;
    const crossStart = axis === 'x' ? (b) => b.y : (b) => b.x;
    const crossEnd = axis === 'x' ? (b) => b.y + b.h : (b) => b.x + b.w;
    for (const line of new Set(lines(snapped).map((value) => Math.round(value * 100) / 100))) {
      const sharing = others.filter((other) => lines(other).some((value) => Math.abs(value - line) <= 0.5));
      if (!sharing.length) continue;
      const members = [snapped, ...sharing];
      guides.push({ axis, position: line, start: Math.min(...members.map(crossStart)), end: Math.max(...members.map(crossEnd)) });
    }
  }
  return { dx, dy, guides };
}

export const ALIGN_MODES = Object.freeze(['left', 'center', 'right', 'top', 'middle', 'bottom', 'distribute-x', 'distribute-y']);

/** New top-left positions for the given boxes; distribution needs at least three. */
export function alignBoxes(boxes, mode) {
  if (boxes.length < 2 || !ALIGN_MODES.includes(mode)) return [];
  const left = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const top = Math.min(...boxes.map((b) => b.y));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  switch (mode) {
    case 'left': return boxes.map((b) => ({ id: b.id, x: left, y: b.y }));
    case 'right': return boxes.map((b) => ({ id: b.id, x: right - b.w, y: b.y }));
    case 'center': return boxes.map((b) => ({ id: b.id, x: (left + right) / 2 - b.w / 2, y: b.y }));
    case 'top': return boxes.map((b) => ({ id: b.id, x: b.x, y: top }));
    case 'bottom': return boxes.map((b) => ({ id: b.id, x: b.x, y: bottom - b.h }));
    case 'middle': return boxes.map((b) => ({ id: b.id, x: b.x, y: (top + bottom) / 2 - b.h / 2 }));
    default: {
      if (boxes.length < 3) return [];
      const horizontal = mode === 'distribute-x';
      const sorted = [...boxes].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
      const total = sorted.reduce((sum, b) => sum + (horizontal ? b.w : b.h), 0);
      const span = horizontal ? right - left : bottom - top;
      const gap = (span - total) / (sorted.length - 1);
      let cursor = horizontal ? left : top;
      return sorted.map((b) => {
        const next = horizontal ? { id: b.id, x: cursor, y: b.y } : { id: b.id, x: b.x, y: cursor };
        cursor += (horizontal ? b.w : b.h) + gap;
        return next;
      });
    }
  }
}
