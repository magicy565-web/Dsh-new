// Legacy store migration: import conversations and messages from the old
// single-workspace store file into the harness storage state.
//
// Design rules:
//   * the legacy file is read-only input; it is never modified;
//   * every imported id is derived deterministically from the legacy id, and the
//     mapping is persisted, so a second run imports nothing new (idempotent);
//   * nothing is guessed: records that fail validation are skipped with a
//     reason instead of being repaired;
//   * runs, events and approvals are not invented — imported history has no runs.
//
// Usage:
//   node scripts/migrate-legacy.mjs --from legacy.json [--to .harness-data] [--apply]
//   (without --apply it is a dry run that writes nothing)
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATION_VERSION = 1;
export const LEGACY_VERSIONS = Object.freeze([1, 2, 3]);
const MAX_RECORDS = 5_000;

export class MigrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
  }
}

const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const isIso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** Deterministic UUID (v5 layout) from any legacy id. */
export function stableId(prefix, legacyId) {
  const hex = createHash('sha256').update(`legacy:${prefix}:${legacyId}`).digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function readChat(workspace) {
  const chat = workspace.harnessChat;
  if (!isPlain(chat)) {
    return { version: 1, seq: 0, conversations: [], messages: [], runs: [], events: [], receipts: [], approvals: [] };
  }
  return structuredClone(chat);
}

/**
 * Plan a migration without touching disk.
 * @param {object} legacy parsed legacy store
 * @param {object} workspaceState current harness workspace state (may be {})
 */
export function planMigration(legacy, workspaceState = {}) {
  if (!isPlain(legacy)) throw new MigrationError('MIGRATION_INVALID', 'The legacy store must be a JSON object.');
  if (!LEGACY_VERSIONS.includes(legacy.version))
    throw new MigrationError('MIGRATION_VERSION', `Unsupported legacy store version: ${String(legacy.version)}.`);
  for (const key of ['conversations', 'messages']) {
    if (legacy[key] !== undefined && !Array.isArray(legacy[key]))
      throw new MigrationError('MIGRATION_INVALID', `legacy.${key} must be an array.`);
    if (Array.isArray(legacy[key]) && legacy[key].length > MAX_RECORDS)
      throw new MigrationError('MIGRATION_TOO_LARGE', `legacy.${key} has too many records.`);
  }

  const chat = readChat(workspaceState);
  const existingConversations = new Set(chat.conversations.map(item => item.id));
  const existingMessages = new Set(chat.messages.map(item => item.id));
  const legacyMap = isPlain(workspaceState.harnessLegacy) && isPlain(workspaceState.harnessLegacy.conversations)
    ? structuredClone(workspaceState.harnessLegacy.conversations)
    : {};

  const skipped = [];
  const skip = (reason, sample) => skipped.push({ reason, sample });
  const conversations = [];
  const messages = [];

  for (const row of legacy.conversations ?? []) {
    if (!isPlain(row) || typeof row.id !== 'string' || !row.id) { skip('CONVERSATION_ID', row?.id ?? null); continue; }
    if (typeof row.title !== 'string' || !row.title.trim()) { skip('CONVERSATION_TITLE', row.id); continue; }
    if (!isIso(row.createdAt)) { skip('CONVERSATION_CREATED_AT', row.id); continue; }
    const id = legacyMap[row.id] ?? stableId('conversation', row.id);
    legacyMap[row.id] = id;
    if (existingConversations.has(id)) continue;
    conversations.push({
      id,
      workspaceId: 'local',
      title: row.title.trim().slice(0, 200),
      createdAt: new Date(Date.parse(row.createdAt)).toISOString(),
      updatedAt: new Date(Date.parse(isIso(row.updatedAt) ? row.updatedAt : row.createdAt)).toISOString(),
      status: 'open',
    });
    existingConversations.add(id);
  }

  for (const row of legacy.messages ?? []) {
    if (!isPlain(row)) { skip('MESSAGE_SHAPE', null); continue; }
    if (typeof row.conversationId !== 'string' || !legacyMap[row.conversationId]) { skip('MESSAGE_CONVERSATION', row.conversationId ?? null); continue; }
    if (!['user', 'assistant'].includes(row.role)) { skip(`MESSAGE_ROLE_${String(row.role).toUpperCase()}`, row.id ?? null); continue; }
    if (typeof row.content !== 'string' || !row.content.trim()) { skip('MESSAGE_CONTENT', row.id ?? null); continue; }
    if (!isIso(row.createdAt)) { skip('MESSAGE_CREATED_AT', row.id ?? null); continue; }
    const id = stableId('message', typeof row.id === 'string' && row.id ? row.id : `${row.conversationId}:${row.createdAt}:${row.content.length}`);
    if (existingMessages.has(id)) continue;
    messages.push({
      id,
      conversationId: legacyMap[row.conversationId],
      role: row.role,
      content: row.content,
      createdAt: new Date(Date.parse(row.createdAt)).toISOString(),
    });
    existingMessages.add(id);
  }

  const nextChat = {
    ...chat,
    conversations: [...chat.conversations, ...conversations],
    messages: [...chat.messages, ...messages],
  };
  const nextWorkspace = {
    ...workspaceState,
    harnessChat: nextChat,
    harnessLegacy: { version: MIGRATION_VERSION, conversations: legacyMap },
  };
  return {
    conversations: conversations.length,
    messages: messages.length,
    skipped: skipped.length,
    skippedReasons: Object.entries(skipped.reduce((acc, item) => { acc[item.reason] = (acc[item.reason] ?? 0) + 1; return acc; }, {})),
    samples: skipped.slice(0, 5),
    nextWorkspace,
  };
}

/** Load the current storage state, or {} when the file does not exist yet. */
export async function loadState(statePath) {
  try {
    const text = await readFile(statePath, 'utf8');
    const value = JSON.parse(text);
    if (!isPlain(value)) throw new MigrationError('MIGRATION_INVALID', 'The harness state file is not an object.');
    return value;
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    if (error instanceof MigrationError) throw error;
    throw new MigrationError('MIGRATION_INVALID', `Cannot read the harness state: ${error.message}`);
  }
}

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const from = argValue(argv, '--from');
  if (!from) {
    process.stderr.write('usage: node scripts/migrate-legacy.mjs --from <legacy.json> [--to <harness-data-dir>] [--apply]\n');
    process.exitCode = 2;
    return;
  }
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const to = argValue(argv, '--to') ?? path.join(root, '.harness-data');
  const apply = argv.includes('--apply');
  const statePath = path.join(path.resolve(to), 'workspace.json');

  const legacy = JSON.parse(await readFile(path.resolve(from), 'utf8'));
  const state = await loadState(statePath);
  const workspaceState = state.workspaces?.local ?? {};
  const plan = planMigration(legacy, workspaceState);
  const report = {
    dryRun: !apply,
    from: path.resolve(from),
    to: statePath,
    conversations: plan.conversations,
    messages: plan.messages,
    skipped: plan.skipped,
    skippedReasons: plan.skippedReasons,
    samples: plan.samples,
  };
  if (apply) {
    state.workspaces = { ...(state.workspaces ?? {}), local: plan.nextWorkspace };
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
    const info = await stat(statePath);
    report.bytes = info.size;
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => {
    process.stderr.write(`migrate-legacy: ${error.code ?? 'ERROR'} ${error.message}\n`);
    process.exitCode = 1;
  });
}
