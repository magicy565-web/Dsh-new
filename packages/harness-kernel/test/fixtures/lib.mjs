// Shared helpers for harness-kernel test fixtures.
import { appendFileSync } from 'node:fs';
import { HarnessError, ERROR } from '../../../harness-contracts/src/index.mjs';

export { HarnessError, ERROR };

/** Append a JSON line to $HARNESS_TEST_TRACE (no-op when unset). */
export function trace(event, id, extra) {
  const file = process.env.HARNESS_TEST_TRACE;
  if (!file) return;
  appendFileSync(file, `${JSON.stringify({ event, id, ...(extra === undefined ? {} : { extra }) })}\n`);
}
