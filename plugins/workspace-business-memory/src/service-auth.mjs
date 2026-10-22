// Authenticate the host process that may compile memory for a task run.
//
// A service bridge is not a workspace member: no human is acting, so it cannot
// borrow the member table or the role claims of a request header. The only
// credential is a dedicated token in a private operator file, and the token is
// never written to configuration, logs, health output or error messages.
import { open, constants as fsConstants } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { BusinessMemoryError } from './domain.mjs';

const TOKEN = /^[A-Za-z0-9._~+/=-]{32,256}$/u;
const BEARER = /^Bearer ([A-Za-z0-9._~+/=-]{32,256})$/u;

/** The stable subject every service write is attributed to. */
export const SERVICE_SUBJECT = 'service:workspace-host';

function unavailable(message) {
  return new BusinessMemoryError(503, 'BUSINESS_MEMORY_SERVICE_UNAVAILABLE', message);
}

/**
 * Read the dedicated service token from a private operator file.
 * Mirrors the product-library token reader: no symlinks, bounded size, owner
 * only on POSIX, strict UTF-8.
 */
export async function readServiceToken(filename) {
  if (typeof filename !== 'string' || !isAbsolute(filename))
    throw new BusinessMemoryError(500, 'BUSINESS_MEMORY_SERVICE_CONFIG', 'Use an absolute service token file.');
  let handle;
  try {
    handle = await open(filename, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 16 || stat.size > 4096)
      throw new BusinessMemoryError(500, 'BUSINESS_MEMORY_SERVICE_CONFIG', 'The service token file is invalid.');
    if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || ![0, process.getuid()].includes(stat.uid)))
      throw new BusinessMemoryError(500, 'BUSINESS_MEMORY_SERVICE_CONFIG', 'The service token file must be private to its owner.');
    const bytes = await handle.readFile();
    const token = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
    if (!TOKEN.test(token))
      throw new BusinessMemoryError(500, 'BUSINESS_MEMORY_SERVICE_CONFIG', 'The service token file is invalid.');
    return token;
  } catch (error) {
    if (error instanceof BusinessMemoryError) throw error;
    throw unavailable('The service token file could not be read.');
  } finally {
    await handle?.close().catch(() => {});
  }
}

function sameToken(left, right) {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}

/**
 * Authenticate one service request and return the actor it acts as.
 * Unconfigured bridges fail closed (503) instead of serving an open endpoint.
 */
export async function authorizeService(request, { tokenFile, workspaceId }) {
  if (typeof tokenFile !== 'string' || !tokenFile)
    throw new BusinessMemoryError(503, 'BUSINESS_MEMORY_SERVICE_UNCONFIGURED',
      'No service token is configured; the host bridge stays unavailable.');
  const expected = await readServiceToken(tokenFile);
  const header = request?.headers?.authorization ?? request?.headers?.Authorization ?? '';
  const match = typeof header === 'string' ? BEARER.exec(header.trim()) : null;
  if (!match || !sameToken(match[1], expected))
    throw new BusinessMemoryError(401, 'BUSINESS_MEMORY_SERVICE_UNAUTHORIZED',
      'A valid service token is required for the host bridge.');
  return { subject: SERVICE_SUBJECT, role: 'operator', workspaceId };
}
