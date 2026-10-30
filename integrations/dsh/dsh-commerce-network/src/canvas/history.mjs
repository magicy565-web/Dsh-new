// Undo/redo for layout only. Business records are never part of this history.

const same = (a, b) => a.x === b.x && a.y === b.y;

export function createHistory(limit = 100) {
  let past = [];
  let future = [];
  return {
    record(entry) {
      const changes = (entry?.changes || []).filter((change) => !same(change.before, change.after));
      if (!changes.length) return false;
      past.push({ label: entry.label || '移动节点', changes });
      if (past.length > limit) past.shift();
      future = [];
      return true;
    },
    undo() {
      const entry = past.pop();
      if (!entry) return null;
      future.push(entry);
      return { label: entry.label, positions: entry.changes.map((change) => ({ id: change.id, position: { ...change.before } })) };
    },
    redo() {
      const entry = future.pop();
      if (!entry) return null;
      past.push(entry);
      return { label: entry.label, positions: entry.changes.map((change) => ({ id: change.id, position: { ...change.after } })) };
    },
    /** Forget changes to nodes that no longer exist after a refresh. */
    prune(validIds) {
      const keep = (entries) => entries.map((entry) => ({ ...entry, changes: entry.changes.filter((change) => validIds.has(change.id)) })).filter((entry) => entry.changes.length);
      past = keep(past);
      future = keep(future);
    },
    clear() { past = []; future = []; },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
  };
}
