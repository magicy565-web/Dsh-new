// Windows-only local QA fixture. Replaces store/artifact services, not production
// code. This validates HTTP/UI behavior and does NOT validate disk durability.
import { mock } from 'node:test';
import { mkdir } from 'node:fs/promises';
import * as original from '../../server/store.mjs';
import * as originalArtifacts from '../../server/artifacts.mjs';
const snapshots = new Map();
async function memoryStore(directory) {
  await mkdir(directory, { recursive: true });
  const time = new Date().toISOString();
  let state = snapshots.get(directory) || { version: 3, meta: { sequence: 0, createdAt: time, updatedAt: time },
    conversations: [], messages: [], goals: [], activity: [], memories: [], runs: [], artifacts: [],
    capabilities: { version: 1, skills: [], connectors: [], approvals: [], schedules: [], scheduleRuns: [], connectorRuns: [] },
    businessLibrary: { version: 1, company: { id: 'company', revision: 1, legalName: '', displayName: '', description: '', createdAt: time, updatedAt: time }, products: [], documents: [], operations: [], conversationReferences: [] },
    settings: { ...original.defaultSettings } };
  let queue = Promise.resolve();
  const listeners = new Set();
  return { directory, read: () => structuredClone(state),
    diagnostics: () => ({ state: 'open', durability: 'test-memory-only', schemaVersion: 3, sequence: state.meta.sequence, warnings: [] }),
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    update(callback) { const task = queue.then(() => { const next = structuredClone(state); const result = callback(next); if (result?.then) throw Error('Synchronous transaction required.'); next.meta.sequence++; next.meta.updatedAt = new Date().toISOString(); original.validateState(next); state = structuredClone(next); snapshots.set(directory, state); for (const listener of listeners) listener(state.meta); return structuredClone(result); }); queue = task.catch(() => {}); return task; },
    async close() { await queue; listeners.clear(); },
  };
}
mock.module(new URL('../../server/store.mjs', import.meta.url).href, { namedExports: { ...original, openStore: memoryStore } });
mock.module(new URL('../../server/artifacts.mjs', import.meta.url).href, { namedExports: { ...originalArtifacts, createArtifactService: async () => ({
  list: () => ({ artifacts: [] }), close: async () => {},
  create: async () => { throw Error('Artifact writes are outside the context QA fixture.'); },
}) } });
