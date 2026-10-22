// Test helpers for the harness kernel.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));
export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

export function fixtureComposition(...parts) {
  return join(FIXTURES, 'compositions', ...parts);
}

export function fixture(...parts) {
  return join(FIXTURES, ...parts);
}

/** Logger that records everything instead of printing. */
export function captureLogger() {
  const lines = [];
  const record = type => (...args) => lines.push({ type, args });
  const logger = { error: record('error'), warn: record('warn'), info: record('info'), debug: record('debug'), lines };
  return logger;
}

export const silentLogger = Object.freeze({
  error() {},
  warn() {},
  info() {},
  debug() {},
});

/** Run `fn(tracePath)` with $HARNESS_TEST_TRACE pointing at a fresh file; return parsed lines. */
export async function withTrace(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'harness-kernel-trace-'));
  const tracePath = join(directory, 'trace.jsonl');
  const previous = process.env.HARNESS_TEST_TRACE;
  process.env.HARNESS_TEST_TRACE = tracePath;
  try {
    await fn(tracePath);
    let text = '';
    try {
      text = await readFile(tracePath, 'utf8');
    } catch {
      return [];
    }
    return text
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } finally {
    if (previous === undefined) delete process.env.HARNESS_TEST_TRACE;
    else process.env.HARNESS_TEST_TRACE = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

/** Create a throwaway workspace root containing `files` ({ relativePath: content }). */
export async function makeRoot(files) {
  const root = await mkdtemp(join(tmpdir(), 'harness-kernel-root-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(root, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
  return root;
}

export async function cleanupRoot(root) {
  await rm(root, { recursive: true, force: true });
}

export async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { response, status: response.status, headers: response.headers, body, text };
}

export function assertHarnessError(error, code) {
  assert.ok(error, 'expected an error');
  assert.equal(error.name, 'HarnessError');
  assert.equal(error.code, code);
  return error;
}
