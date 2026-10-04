import path from 'node:path';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

/** Pin supported native durable stores inside the private application data root. */
export function createNativeStorageOverlay({ dshHome, compression }) {
  if (typeof dshHome !== 'string' || !path.isAbsolute(dshHome) || path.resolve(dshHome) !== dshHome
    || !['none', 'zstd'].includes(compression)) throw new Error('Native recovery storage requires a canonical absolute home and explicit compression.');
  return [
    { id: 'session-persistence-jsonl', config: { root: path.join(dshHome, 'sessions'), compression } },
    { id: 'attachment-local', config: { dshHome } },
    { id: 'storage-json', config: { root: path.join(dshHome, 'storages') } },
    { id: 'spill-local', config: { root: path.join(dshHome, 'spills') } },
  ];
}

/** Accept only the narrow generated storage patch; deployment review is separate. */
export function readNativeStorageOverlay(filename, dshHome) {
  try {
    const content = readFileSync(filename, 'utf8');
    if (content.length > 32_768) throw new Error('Size limit');
    const value = JSON.parse(content), compression = value?.[0]?.config?.compression;
    if (!isDeepStrictEqual(value, createNativeStorageOverlay({ dshHome, compression }))) throw new Error('Unexpected fields');
    return { compression };
  } catch { throw new Error('Invalid reviewed native recovery storage patch.'); }
}
