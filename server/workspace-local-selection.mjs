// Generic host selection/configuration guard; loaded plugins own file tools.
// No database, model loop, HTTP Host, ambient files or enterprise identity.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { looksLikeCredential } from './workspace-public-input.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k));
export async function plainPath(filename) {
  if (!path.isAbsolute(filename)) fail('LOCAL_ABSOLUTE_SELECTION_REQUIRED');
  let current = path.parse(filename).root, stat;
  for (const part of filename.slice(current.length).split(path.sep).filter(Boolean)) {
    if (['.git','.aws','.codex','.agents','.data'].includes(part)) fail('LOCAL_CONTROL_DIRECTORY_REFUSED');
    current = path.join(current, part); stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) fail('LOCAL_SYMLINK_REFUSED');
  }
  if (await fs.realpath(filename) !== filename) fail('LOCAL_PATH_CHANGED');
  return stat;
}
async function selectedBytes(filename, expected) {
  const current = await plainPath(filename);
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.dev !== current.dev || stat.ino !== current.ino
      || expected && (stat.dev !== expected.dev || stat.ino !== expected.ino) || stat.size > 65536) fail('LOCAL_SOURCE_CHANGED');
    const buffer = Buffer.alloc(65537); let size = 0;
    while (size < buffer.length) { const read = await handle.read(buffer, size, buffer.length - size, size); if (!read.bytesRead) break; size += read.bytesRead; }
    if (size > 65536 || size !== stat.size) fail('LOCAL_SOURCE_CHANGED');
    return { content: buffer.subarray(0, size), dev: stat.dev, ino: stat.ino };
  } finally { await handle.close(); }
}
export async function createLocalSelection({ inputs, outputDirectory, directory }) {
  if (process.platform !== 'linux' || !Array.isArray(inputs) || inputs.length < 1 || inputs.length > 4) fail('LOCAL_SELECTION_REQUIRED');
  outputDirectory = path.resolve(outputDirectory);
  const outputStat = await plainPath(outputDirectory);
  if (!outputStat?.isDirectory()) fail('LOCAL_EXISTING_OUTPUT_DIRECTORY_REQUIRED');
  const outputHandle = await fs.open(outputDirectory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const pinned = await outputHandle.stat();
  if (pinned.dev !== outputStat.dev || pinned.ino !== outputStat.ino) { await outputHandle.close(); fail('LOCAL_OUTPUT_CHANGED'); }
  const selected = [], used = new Map(), saved = [], restoredSources = [];
  let bytes = 0, pendingWrites = 0, closed = false;
  try {
    await fs.mkdir(directory + '/sources', { mode: 0o700 }); await fs.mkdir(directory + '/writes', { mode: 0o700 });
    for (const [index, input] of inputs.entries()) {
      const filename = path.resolve(input), stat = await plainPath(filename);
      if (path.basename(filename) === 'workspace.json') fail('LOCAL_WORKSPACE_DATABASE_REFUSED');
      if (!stat?.isFile() || !/\.(md|txt|csv|json|pdf)$/i.test(filename) || stat.size > 65536) fail('LOCAL_INPUT_TYPE_OR_LIMIT');
      const { content, dev, ino } = await selectedBytes(filename, stat), name = path.basename(filename), id = 'input-' + (index + 1);
      if ((bytes += content.length) > 65536 || name.length > 200 || /[\r\n\0]/.test(name)) fail('LOCAL_INPUT_TYPE_OR_LIMIT');
      if (looksLikeCredential(name) || !/\.pdf$/i.test(filename) && looksLikeCredential(content.toString('utf8'))) fail('LOCAL_CREDENTIAL_TEXT_REFUSED');
      const snapshot = directory + '/sources/' + id + path.extname(filename).toLowerCase();
      await fs.writeFile(snapshot, content, { flag: 'wx', mode: 0o600 });
      selected.push({ id, filename, name, sha256: sha(content), snapshot, dev, ino });
    }
  } catch (error) { await outputHandle.close(); throw error; }
  async function authorize(signal) {
    signal?.throwIfAborted(); if (closed) fail('LOCAL_FILES_CLOSED');
    const current = await plainPath(outputDirectory);
    if (current.dev !== pinned.dev || current.ino !== pinned.ino) fail('LOCAL_OUTPUT_CHANGED');
    for (const file of selected) {
      if (sha((await selectedBytes(file.filename, file)).content) !== file.sha256 || sha(await fs.readFile(file.snapshot)) !== file.sha256) fail('LOCAL_SOURCE_CHANGED');
    }
    signal?.throwIfAborted();
  }
  let controller;
  return { options: { inputs, outputDirectory, directory: directory + '/plugin-files' },
    manifest: selected.map(({id,name,sha256}) => ({id,name,sha256})), authorize,
    get saved() { return controller?.saved || []; }, get restoredSources() { return controller?.restoredSources || []; },
    attach(value) { if (controller || JSON.stringify(value.manifest) !== JSON.stringify(this.manifest)) fail('LOCAL_PLUGIN_SELECTION_REFUSED'); controller = value; },
    async close() { try { await controller?.close(); } finally { if (!closed) { closed = true; await outputHandle.close(); } } }
  };
}
