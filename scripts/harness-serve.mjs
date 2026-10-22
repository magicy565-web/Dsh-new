// Start one reviewed harness composition and keep it serving until stopped.
//
// This is a thin launcher for the product-library / market local composition:
// it prints the exact origin, serves until SIGINT/SIGTERM, then disposes every
// plugin and closes the single-writer store. It creates no credentials and
// changes no policy.
import path from 'node:path';
import { createHarness } from '../packages/harness-kernel/src/app.mjs';

const root = path.resolve(import.meta.dirname, '..');
const compositionPath = process.env.HARNESS_COMPOSITION || 'harness.local.yml';

const harness = await createHarness({ compositionPath, root });
const started = await harness.start();
const url = started?.address?.url ?? started?.url ?? `http://${started?.address?.address}:${started?.address?.port}`;
console.log(`harness composition ${compositionPath} listening on ${url}`);
console.log('Press Ctrl+C to stop. The DSH product_library_* tools read this origin.');

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal}: stopping ${compositionPath}...`);
  try { await harness.stop(); } catch (error) { console.error('harness stop failed:', error?.message ?? error); process.exitCode = 1; }
  process.exit();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
