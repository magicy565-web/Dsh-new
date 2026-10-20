// Shared helpers for the harness-seams tests.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HarnessError } from '../../harness-contracts/src/index.mjs';

/** Create a real (not mocked) temporary directory for a durable store. */
export async function makeTempDirectory(label = 'harness-seams') {
  return fs.mkdtemp(path.join(os.tmpdir(), `${label}-`));
}

/** Register cleanup that removes a temporary directory after the test. */
export function removeDirectory(t, directory) {
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
}

/** Register cleanup that closes a storage service after the test. */
export function closeAfter(t, service) {
  t.after(async () => {
    try {
      await service.close();
    } catch {
      // already closed by the test body
    }
  });
}

/** Predicate for assert.throws/assert.rejects on a contract error code. */
export const harnessError = code => error => {
  assert.ok(error instanceof HarnessError, `expected a HarnessError, got ${error?.name ?? typeof error}: ${error?.message}`);
  assert.equal(error.code, code);
  return true;
};

/** Await a rejection and return it (fails the test if it resolves). */
export async function captureError(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  assert.fail('expected the operation to reject');
}

export const ACTOR_A = Object.freeze({ subject: 'actor-a', role: 'user', workspaceId: 'local' });
export const ACTOR_B = Object.freeze({ subject: 'actor-b', role: 'user', workspaceId: 'local' });
export const LOCAL_ADMIN = Object.freeze({ subject: 'local-operator', role: 'admin', workspaceId: 'local' });

/** Deterministic injectable clock (callable, with test controls attached). */
export function fakeClock(start = 1_000_000) {
  let current = start;
  const clock = () => current;
  clock.now = () => current;
  clock.advance = milliseconds => {
    current += milliseconds;
    return current;
  };
  clock.set = milliseconds => {
    current = milliseconds;
    return current;
  };
  return clock;
}

/** A hand-rolled in-memory ctx.approval stand-in (used only for provider wiring tests). */
export function stubApproval() {
  return { request: () => ({}), decide: () => ({}), consume: () => true, list: () => [] };
}
