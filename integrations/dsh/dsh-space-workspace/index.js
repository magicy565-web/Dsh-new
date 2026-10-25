// Space workspace Host half.
//
// Durable local state for the ChatGPT-style Space panel: pages, files and the
// space navigation model. The browser panel talks to this module over the
// same-origin JSON surface; the store is a single atomic JSON file.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

export const API_PREFIX = '/space-api';
export const STATE_VERSION = 1;
export const ITEM_KINDS = ['page', 'file', 'site', 'image', 'folder', 'drive'];
export const BLOCK_TYPES = ['paragraph', 'h1', 'h2', 'h3', 'bulleted', 'numbered', 'todo', 'quote', 'code', 'divider', 'callout', 'highlight', 'table'];
const MAX_TITLE = 200;
const MAX_BODY = 20000;
const MAX_BODY_BYTES = 256 * 1024;

export class SpaceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'SpaceError';
    this.code = code;
    this.status = status;
  }
}

const fail = (code, message, status = 400) => {
  throw new SpaceError(code, message, status);
};
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const iso = (clock = Date.now) => new Date(clock()).toISOString();

function text(value, key, max = 4000, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') fail('INVALID_INPUT', `${key} 必须是文本。`);
  const trimmed = value.trim();
  if (required && !trimmed) fail('INVALID_INPUT', `${key} 不能为空。`);
  if (value.length > max) fail('INVALID_INPUT', `${key} 不能超过 ${max} 个字符。`);
  return value;
}

function assertKeys(value, allowed, label) {
  if (!isRecord(value)) fail('INVALID_INPUT', `${label} 必须是一个对象。`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('INVALID_INPUT', `${label} 不支持字段：${key}。`);
  return value;
}

const DEMO_BODY = {
  page: '在页面中，你可以写作、创作，并与 ChatGPT 和团队成员协作。\n\n此处使用中性文字演示界面结构，没有复制账号中的私人文件内容。\n\n• 输入 / 添加内容块\n• 在底部聊天中提出要求\n• 用页面组织资料与成果\n• 通过评论和分享协作\n\n本复原只连接已经观察到的界面状态。',
  todo: '示例待办清单\n\n- 整理本周询盘\n- 更新产品报价\n- 跟进重点客户\n- 准备下周出货资料',
};

function blockId() {
  return `blk_${randomUUID()}`;
}

function deriveBlocks(body) {
  const lines = String(body || '').split('\n');
  const blocks = [];
  let code = null;
  for (const line of lines) {
    if (line.startsWith('```')) {
      if (code) {
        blocks.push({ id: blockId(), type: 'code', text: code.join('\n') });
        code = null;
      } else {
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    if (line.trim() === '---') {
      blocks.push({ id: blockId(), type: 'divider', text: '' });
      continue;
    }
    let match;
    if ((match = /^###\s+(.*)$/u.exec(line))) blocks.push({ id: blockId(), type: 'h3', text: match[1] });
    else if ((match = /^##\s+(.*)$/u.exec(line))) blocks.push({ id: blockId(), type: 'h2', text: match[1] });
    else if ((match = /^#\s+(.*)$/u.exec(line))) blocks.push({ id: blockId(), type: 'h1', text: match[1] });
    else if ((match = /^-\s+\[( |x)\]\s+(.*)$/u.exec(line))) blocks.push({ id: blockId(), type: 'todo', text: match[2], checked: match[1] === 'x' });
    else if ((match = /^-\s+(.*)$/u.exec(line))) blocks.push({ id: blockId(), type: 'bulleted', text: match[1] });
    else if ((match = /^\d+\.\s+(.*)$/u.exec(line))) blocks.push({ id: blockId(), type: 'numbered', text: match[1] });
    else if ((match = /^>\s*(.*)$/u.exec(line))) blocks.push({ id: blockId(), type: line.includes('高亮') ? 'highlight' : line.includes('提示') ? 'callout' : 'quote', text: match[1] });
    else if (line.trim() === '') continue;
    else blocks.push({ id: blockId(), type: 'paragraph', text: line });
  }
  if (code) blocks.push({ id: blockId(), type: 'code', text: code.join('\n') });
  return blocks.length ? blocks : [{ id: blockId(), type: 'paragraph', text: '' }];
}

function normalizeBlocks(value) {
  if (!Array.isArray(value)) fail('INVALID_INPUT', 'blocks 必须是数组。');
  if (value.length > 500) fail('INVALID_INPUT', 'blocks 不能超过 500 个。');
  const blocks = value.map(entry => {
    if (!isRecord(entry)) fail('INVALID_INPUT', '每个 block 必须是对象。');
    if (!BLOCK_TYPES.includes(entry.type)) fail('INVALID_INPUT', `不支持的块类型：${entry.type}`);
    const text = typeof entry.text === 'string' ? entry.text : '';
    if (text.length > 20000) fail('INVALID_INPUT', '单个块不能超过 20 000 个字符。');
    return {
      id: typeof entry.id === 'string' && entry.id.length <= 100 ? entry.id : blockId(),
      type: entry.type,
      text,
      checked: entry.checked === true,
    };
  });
  return blocks.length ? blocks : [{ id: blockId(), type: 'paragraph', text: '' }];
}

function blocksToText(blocks) {
  return blocks
    .map(block => {
      const text = block.text || '';
      switch (block.type) {
        case 'h1': return `# ${text}`;
        case 'h2': return `## ${text}`;
        case 'h3': return `### ${text}`;
        case 'bulleted': return `- ${text}`;
        case 'numbered': return `1. ${text}`;
        case 'todo': return `- [${block.checked ? 'x' : ' '}] ${text}`;
        case 'quote': return `> ${text}`;
        case 'code': return `\`\`\`\n${text}\n\`\`\``;
        case 'divider': return '---';
        case 'callout': return `> 提示：${text}`;
        case 'highlight': return `> 高亮：${text}`;
        default: return text;
      }
    })
    .join('\n\n');
}

function demoItems(clock = Date.now) {
  const now = clock();
  const at = minutes => new Date(now - minutes * 60_000).toISOString();
  const item = (kind, title, minutes, extra = {}) => ({
    id: `item_${randomUUID()}`,
    kind,
    title,
    body: '',
    parentId: null,
    starred: false,
    shared: false,
    owned: true,
    meta: {},
    comments: [],
    messages: [],
    members: [],
    pinned: false,
    deletedAt: null,
    createdAt: at(minutes + 30),
    updatedAt: at(minutes),
    ...extra,
  });
  return [
    item('page', '无标题页面', 10),
    item('page', '示例待办清单', 20, { body: DEMO_BODY.todo, starred: true, shared: true }),
    item('page', '示例页面', 30, { body: DEMO_BODY.page, starred: true, shared: true }),
    item('file', '示例数据.json', 40, { meta: { ext: 'json', size: '12 KB' } }),
    item('file', '示例报告.pdf', 50, { meta: { ext: 'pdf', size: '2.4 MB' } }),
    item('file', '示例文档.docx', 60, { meta: { ext: 'docx', size: '86 KB' } }),
    item('site', '示例站点 A', 70, { meta: { visibility: '仅自己可见' } }),
    item('site', '示例站点 B', 80, { meta: { visibility: '仅自己可见' } }),
    item('site', '示例站点 C', 90, { meta: { visibility: '仅自己可见' } }),
  ];
}

export function emptyState() {
  return { version: STATE_VERSION, seedVersion: 2, sequence: 0, items: [], tasks: [] };
}

export function seedState(clock = Date.now) {
  const now = clock();
  const at = minutes => new Date(now - minutes * 60_000).toISOString();
  return {
    version: STATE_VERSION,
    seedVersion: 2,
    sequence: 1,
    items: demoItems(clock),
    tasks: [
      { id: `task_${randomUUID()}`, title: '演示任务 A', goal: '', frequency: 'daily', repeat: 'daily', time: '09:00', timezone: 'Asia/Shanghai', endMode: 'never', endDate: null, endCount: null, newChat: false, status: 'paused', createdAt: at(120), updatedAt: at(60) },
      { id: `task_${randomUUID()}`, title: '演示任务 B', goal: '', frequency: 'weekly', repeat: 'weekly', time: '09:00', timezone: 'Asia/Shanghai', endMode: 'never', endDate: null, endCount: null, newChat: false, status: 'completed', createdAt: at(240), updatedAt: at(30) },
    ],
  };
}

function validateState(state) {
  if (!isRecord(state) || state.version !== STATE_VERSION) fail('STORAGE_UNAVAILABLE', '空间文件版本无法识别，未做任何写入。', 503);
  if (!Array.isArray(state.items)) fail('STORAGE_UNAVAILABLE', '空间文件结构不完整，未做任何写入。', 503);
  return state;
}

function migrateState(state) {
  if (!Array.isArray(state.tasks)) state.tasks = [];
  if ((state.seedVersion || 1) < 2) {
    state.seedVersion = 2;
    if (state.items.length && !state.items.some(item => item.kind === 'site')) {
      const time = iso();
      for (const title of ['示例站点 A', '示例站点 B', '示例站点 C']) {
        state.items.push({
          id: `item_${randomUUID()}`,
          kind: 'site',
          title,
          body: '',
          parentId: null,
          starred: false,
          shared: false,
          owned: true,
          meta: { visibility: '仅自己可见' },
          comments: [],
          messages: [],
          members: [],
          pinned: false,
          deletedAt: null,
          createdAt: time,
          updatedAt: time,
        });
      }
    }
  }
  for (const item of state.items) {
    if (!ITEM_KINDS.includes(item.kind)) item.kind = 'file';
    if (typeof item.title !== 'string') item.title = '';
    if (typeof item.body !== 'string') item.body = '';
    if (typeof item.starred !== 'boolean') item.starred = false;
    if (typeof item.shared !== 'boolean') item.shared = false;
    if (typeof item.owned !== 'boolean') item.owned = true;
    if (!isRecord(item.meta)) item.meta = {};
    if (!Array.isArray(item.comments)) item.comments = [];
    if (!Array.isArray(item.messages)) item.messages = [];
    if (!Array.isArray(item.members)) item.members = [];
    if (!Array.isArray(item.blocks)) item.blocks = item.kind === 'page' ? deriveBlocks(item.body) : [];
    if (typeof item.pinned !== 'boolean') item.pinned = false;
    if (item.deletedAt !== null && typeof item.deletedAt !== 'string') item.deletedAt = null;
    if (typeof item.updatedAt !== 'string') item.updatedAt = iso();
    if (typeof item.createdAt !== 'string') item.createdAt = item.updatedAt;
  }
  return state;
}

export class SpaceStore {
  #loaded = null;
  #queue = Promise.resolve();

  constructor({ dir, seedDemo = true, clock = Date.now } = {}) {
    if (typeof dir !== 'string' || !dir) throw new TypeError('SpaceStore requires a directory.');
    this.dir = resolve(dir);
    this.seedDemo = seedDemo !== false;
    this.clock = clock;
  }

  get file() {
    return join(this.dir, 'space.json');
  }

  async state() {
    if (this.#loaded) return this.#loaded;
    let raw;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        this.#loaded = this.seedDemo ? seedState(this.clock) : emptyState();
        return this.#loaded;
      }
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      fail('STORAGE_UNAVAILABLE', `空间文件不是有效 JSON：${this.file}`, 503);
    }
    this.#loaded = migrateState(validateState(parsed));
    return this.#loaded;
  }

  async mutate(operation) {
    const run = this.#queue.then(async () => {
      const state = await this.state();
      const draft = structuredClone(state);
      const result = await operation(draft);
      draft.sequence = (draft.sequence || 0) + 1;
      await this.#persist(draft);
      this.#loaded = draft;
      return result;
    });
    this.#queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async #persist(state) {
    await mkdir(this.dir, { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(temporary, this.file);
  }
}

function sortItems(items) {
  return [...items].sort(
    (left, right) => Number(right.pinned === true) - Number(left.pinned === true) || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
  );
}

function summarize(item) {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    starred: item.starred,
    shared: item.shared,
    owned: item.owned,
    parentId: item.parentId,
    meta: item.meta,
    pinned: item.pinned === true,
    deletedAt: item.deletedAt || null,
    memberCount: item.members.length,
    updatedAt: item.updatedAt,
    createdAt: item.createdAt,
  };
}

function requireItem(state, id) {
  const item = state.items.find(entry => entry.id === id);
  if (!item) fail('NOT_FOUND', '没有找到这个条目。', 404);
  return item;
}

const DEFAULT_TITLES = { page: '无标题页面', file: '新文件', site: '新网站', image: '新图像', folder: '新文件夹', space: '新空间', drive: '新云端文件' };

function normalizeMeta(value) {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) fail('INVALID_INPUT', 'meta 必须是对象。');
  const keys = Object.keys(value);
  if (keys.length > 20) fail('INVALID_INPUT', 'meta 最多 20 个字段。');
  const meta = {};
  for (const key of keys) {
    if (!/^[A-Za-z0-9_.-]{1,40}$/u.test(key)) fail('INVALID_INPUT', `meta 字段名不合法：${key}`);
    const entry = value[key];
    if (typeof entry === 'string') meta[key] = entry.slice(0, 500);
    else if (typeof entry === 'number' || typeof entry === 'boolean') meta[key] = entry;
    else fail('INVALID_INPUT', `meta.${key} 必须是字符串、数字或布尔值。`);
  }
  return meta;
}

function fullItem(item) {
  return { ...summarize(item), body: item.body, blocks: item.blocks || [], comments: item.comments, messages: item.messages, members: item.members };
}

function summarizeTask(task) {
  return {
    id: task.id,
    title: task.title,
    goal: task.goal,
    frequency: task.frequency,
    repeat: task.repeat || task.frequency || 'daily',
    time: task.time || '09:00',
    timezone: task.timezone || 'Asia/Shanghai',
    endMode: task.endMode || 'never',
    endDate: task.endDate || null,
    endCount: task.endCount || null,
    newChat: task.newChat === true,
    custom: task.custom || '',
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function createSpaceService(store) {
  if (!(store instanceof SpaceStore)) throw new TypeError('createSpaceService requires a SpaceStore.');
  return {
    async state(query = {}) {
      const state = await store.state();
      const kind = query.kind && ITEM_KINDS.includes(query.kind) ? query.kind : null;
      const q = String(query.q || '').trim().toLowerCase();
      const includeTrash = String(query.trash || '') === '1';
      const base = state.items.filter(item => (includeTrash ? item.deletedAt !== null : item.deletedAt === null));
      const items = sortItems(base)
        .filter(item => (!kind || item.kind === kind) && (!q || item.title.toLowerCase().includes(q)))
        .map(summarize);
      const counts = Object.fromEntries(ITEM_KINDS.map(key => [key, base.filter(item => item.kind === key).length]));
      const tasks = [...state.tasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map(summarizeTask);
      return { items, counts, tasks, sequence: state.sequence, seeded: state.items.length > 0 };
    },

    async item(id) {
      const state = await store.state();
      return fullItem(requireItem(state, id));
    },

    async createItem(input = {}) {
      assertKeys(input, ['kind', 'title', 'body', 'meta', 'parentId', 'blocks'], 'item');
      if (!ITEM_KINDS.includes(input.kind)) fail('INVALID_INPUT', `kind 必须是 ${ITEM_KINDS.join('、')} 之一。`);
      const kind = input.kind;
      return store.mutate(state => {
        const time = iso(store.clock);
        const body = text(input.body ?? '', 'body', MAX_BODY);
        const blocks = kind === 'page' ? normalizeBlocks(input.blocks ?? deriveBlocks(body)) : [];
        const item = {
          id: `item_${randomUUID()}`,
          kind,
          title: text(input.title ?? '', 'title', MAX_TITLE) || DEFAULT_TITLES[kind],
          body: blocks.length ? blocksToText(blocks) : body,
          blocks,
          parentId: typeof input.parentId === 'string' ? input.parentId : null,
          starred: false,
          shared: false,
          owned: true,
          meta: normalizeMeta(input.meta),
          comments: [],
          messages: [],
          members: [],
          pinned: false,
          deletedAt: null,
          createdAt: time,
          updatedAt: time,
        };
        state.items.push(item);
        return fullItem(item);
      });
    },

    async createPage(input = {}) {
      assertKeys(input, ['title', 'body', 'blocks'], 'page');
      return this.createItem({ kind: 'page', title: input.title, body: input.body, blocks: input.blocks });
    },

    async updateItem(id, input = {}) {
      assertKeys(input, ['title', 'body', 'starred', 'shared', 'pinned', 'blocks'], 'changes');
      if (!Object.keys(input).length) fail('INVALID_INPUT', '请至少提供一个要修改的字段。');
      return store.mutate(state => {
        const item = requireItem(state, id);
        if (input.title !== undefined) item.title = text(input.title, 'title', MAX_TITLE) || DEFAULT_TITLES[item.kind] || '无标题';
        if (input.body !== undefined) item.body = text(input.body, 'body', MAX_BODY);
        if (input.blocks !== undefined) {
          if (item.kind !== 'page') fail('INVALID_INPUT', '只有页面支持 blocks。');
          item.blocks = normalizeBlocks(input.blocks);
          item.body = blocksToText(item.blocks);
        }
        if (input.starred !== undefined) item.starred = input.starred === true;
        if (input.shared !== undefined) item.shared = input.shared === true;
        if (input.pinned !== undefined) item.pinned = input.pinned === true;
        item.updatedAt = iso(store.clock);
        return fullItem(item);
      });
    },

    async trashItem(id) {
      return store.mutate(state => {
        const item = requireItem(state, id);
        item.deletedAt = iso(store.clock);
        item.updatedAt = item.deletedAt;
        return fullItem(item);
      });
    },

    async restoreItem(id) {
      return store.mutate(state => {
        const item = requireItem(state, id);
        item.deletedAt = null;
        item.updatedAt = iso(store.clock);
        return fullItem(item);
      });
    },

    async deleteItem(id) {
      return store.mutate(state => {
        const index = state.items.findIndex(entry => entry.id === id);
        if (index < 0) fail('NOT_FOUND', '没有找到这个条目。', 404);
        state.items.splice(index, 1);
        return { id };
      });
    },

    async addMember(id, input = {}) {
      assertKeys(input, ['name'], 'member');
      const name = text(input.name, 'name', 100, true);
      return store.mutate(state => {
        const item = requireItem(state, id);
        item.members.push({ id: randomUUID(), name, role: 'member', at: iso(store.clock) });
        item.shared = true;
        item.updatedAt = iso(store.clock);
        return fullItem(item);
      });
    },

    async addComment(id, input = {}) {
      assertKeys(input, ['text'], 'comment');
      const body = text(input.text, 'text', 2000, true);
      return store.mutate(state => {
        const item = requireItem(state, id);
        item.comments.push({ id: randomUUID(), text: body, author: 'local', at: iso(store.clock) });
        item.updatedAt = iso(store.clock);
        return fullItem(item);
      });
    },

    async addMessage(id, input = {}) {
      assertKeys(input, ['text'], 'message');
      const body = text(input.text, 'text', 2000, true);
      return store.mutate(state => {
        const item = requireItem(state, id);
        item.messages.push({ id: randomUUID(), role: 'user', text: body, at: iso(store.clock) });
        item.updatedAt = iso(store.clock);
        return fullItem(item);
      });
    },

    async tasks() {
      const state = await store.state();
      return [...state.tasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map(summarizeTask);
    },

    async createTask(input = {}) {
      assertKeys(input, ['title', 'goal', 'repeat', 'frequency', 'time', 'timezone', 'endMode', 'endDate', 'endCount', 'newChat', 'custom'], 'task');
      const repeat = ['once', 'hourly', 'daily', 'weekdays', 'weekly', 'monthly', 'custom'].includes(input.repeat || input.frequency)
        ? input.repeat || input.frequency
        : 'daily';
      return store.mutate(state => {
        const time = iso(store.clock);
        const task = {
          id: `task_${randomUUID()}`,
          title: text(input.title, 'title', MAX_TITLE, true),
          goal: text(input.goal ?? '', 'goal', 4000),
          frequency: repeat,
          repeat,
          time: typeof input.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/u.test(input.time) ? input.time : '09:00',
          timezone: text(input.timezone ?? '', 'timezone', 60) || 'Asia/Shanghai',
          endMode: ['never', 'date', 'count'].includes(input.endMode) ? input.endMode : 'never',
          endDate: typeof input.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(input.endDate) ? input.endDate : null,
          endCount: Number.isInteger(input.endCount) && input.endCount > 0 && input.endCount <= 999 ? input.endCount : null,
          newChat: input.newChat === true,
          custom: text(input.custom ?? '', 'custom', 200),
          status: 'active',
          createdAt: time,
          updatedAt: time,
        };
        state.tasks.push(task);
        return summarizeTask(task);
      });
    },

    async updateTask(id, input = {}) {
      assertKeys(input, ['status', 'title', 'goal', 'repeat', 'time', 'timezone', 'endMode', 'endDate', 'endCount', 'newChat', 'custom'], 'task');
      return store.mutate(state => {
        const task = state.tasks.find(entry => entry.id === id);
        if (!task) fail('NOT_FOUND', '没有找到这个定时任务。', 404);
        if (input.status !== undefined) {
          if (!['active', 'paused', 'completed'].includes(input.status)) fail('INVALID_INPUT', 'status 必须是 active、paused 或 completed。');
          task.status = input.status;
        }
        if (input.title !== undefined) task.title = text(input.title, 'title', MAX_TITLE, true);
        if (input.goal !== undefined) task.goal = text(input.goal, 'goal', 4000);
        if (input.repeat !== undefined && ['once', 'hourly', 'daily', 'weekdays', 'weekly', 'monthly', 'custom'].includes(input.repeat)) {
          task.repeat = input.repeat;
          task.frequency = input.repeat;
        }
        if (input.time !== undefined && /^([01]\d|2[0-3]):[0-5]\d$/u.test(input.time)) task.time = input.time;
        if (input.timezone !== undefined) task.timezone = text(input.timezone, 'timezone', 60) || task.timezone;
        if (input.endMode !== undefined && ['never', 'date', 'count'].includes(input.endMode)) task.endMode = input.endMode;
        if (input.endDate !== undefined) task.endDate = typeof input.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(input.endDate) ? input.endDate : null;
        if (input.endCount !== undefined) task.endCount = Number.isInteger(input.endCount) && input.endCount > 0 ? input.endCount : null;
        if (input.newChat !== undefined) task.newChat = input.newChat === true;
        if (input.custom !== undefined) task.custom = text(input.custom, 'custom', 200);
        task.updatedAt = iso(store.clock);
        return summarizeTask(task);
      });
    },
  };
}

function isLoopback(address) {
  if (typeof address !== 'string' || !address) return false;
  const normalized = address.replace(/^::ffff:/u, '');
  return normalized === '::1' || normalized.startsWith('127.');
}

function send(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

const ok = (res, data, status = 200) => send(res, status, { ok: true, data });
const failResponse = (res, error) => send(res, error.status || 500, { ok: false, error: { code: error.code || 'INTERNAL', message: error.message || '空间操作失败。' } });

async function readJsonBody(req) {
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!type.includes('application/json')) throw new SpaceError('CONTENT_TYPE', '请求必须使用 application/json。', 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new SpaceError('BODY_TOO_LARGE', '请求体超过 256 KiB。', 413);
    chunks.push(chunk);
  }
  if (!size) return {};
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new SpaceError('INVALID_JSON', '请求体不是有效 JSON。');
  }
  if (!isRecord(parsed)) throw new SpaceError('INVALID_INPUT', '请求体必须是 JSON 对象。');
  return parsed;
}

function assertSameOrigin(req) {
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite && !['same-origin', 'none'].includes(String(fetchSite))) throw new SpaceError('ORIGIN_DENIED', '只接受同源请求。', 403);
  const origin = req.headers.origin;
  if (!origin) return;
  let parsed;
  try {
    parsed = new URL(String(origin));
  } catch {
    throw new SpaceError('ORIGIN_DENIED', 'Origin 无法识别。', 403);
  }
  const host = String(req.headers.host || '');
  if (!host || parsed.host !== host) throw new SpaceError('ORIGIN_DENIED', '只接受同源请求。', 403);
}

export function createHttpHandler(service, { allowRemote = false, authorize = null } = {}) {
  return async function handler(req, res) {
    try {
      if (!allowRemote && !isLoopback(req.socket?.remoteAddress)) throw new SpaceError('REMOTE_DENIED', '空间只接受本机访问。', 403);
      if (authorize) {
        let rejection;
        try {
          rejection = authorize({ headers: req.headers });
        } catch {
          rejection = 401;
        }
        if (rejection)
          throw new SpaceError(
            rejection === 403 ? 'ORIGIN_DENIED' : 'UNAUTHORIZED',
            rejection === 403 ? '只接受来自本 Harness 页面的同源请求。' : '空间需要已登录的 Harness 页面。',
            rejection,
          );
      }
      const url = new URL(String(req.url || '/'), `http://${req.headers.host || '127.0.0.1'}`);
      if (!url.pathname.startsWith(API_PREFIX)) throw new SpaceError('NOT_FOUND', '没有这个空间接口。', 404);
      const route = url.pathname.slice(API_PREFIX.length) || '/';
      const method = req.method || 'GET';
      const query = Object.fromEntries(url.searchParams.entries());
      let match;

      if (method === 'GET' && route === '/state') return ok(res, await service.state(query));
      if (method === 'POST' && route === '/pages') {
        assertSameOrigin(req);
        return ok(res, await service.createPage(await readJsonBody(req)), 201);
      }
      if (method === 'POST' && route === '/items') {
        assertSameOrigin(req);
        return ok(res, await service.createItem(await readJsonBody(req)), 201);
      }
      if ((match = /^\/items\/([^/]+)\/comments$/u.exec(route))) {
        const id = decodeURIComponent(match[1]);
        if (method === 'POST') {
          assertSameOrigin(req);
          return ok(res, await service.addComment(id, await readJsonBody(req)), 201);
        }
      }
      if ((match = /^\/items\/([^/]+)\/messages$/u.exec(route))) {
        const id = decodeURIComponent(match[1]);
        if (method === 'POST') {
          assertSameOrigin(req);
          return ok(res, await service.addMessage(id, await readJsonBody(req)), 201);
        }
      }
      if (method === 'GET' && route === '/tasks') return ok(res, await service.tasks());
      if (method === 'POST' && route === '/tasks') {
        assertSameOrigin(req);
        return ok(res, await service.createTask(await readJsonBody(req)), 201);
      }
      if ((match = /^\/tasks\/([^/]+)$/u.exec(route))) {
        const id = decodeURIComponent(match[1]);
        if (method === 'PATCH' || method === 'POST') {
          assertSameOrigin(req);
          return ok(res, await service.updateTask(id, await readJsonBody(req)));
        }
      }
      if ((match = /^\/items\/([^/]+)\/(trash|restore|members)$/u.exec(route))) {
        const id = decodeURIComponent(match[1]);
        const action = match[2];
        if (method === 'POST') {
          assertSameOrigin(req);
          if (action === 'trash') return ok(res, await service.trashItem(id));
          if (action === 'restore') return ok(res, await service.restoreItem(id));
          return ok(res, await service.addMember(id, await readJsonBody(req)), 201);
        }
      }
      if ((match = /^\/items\/([^/]+)$/u.exec(route))) {
        const id = decodeURIComponent(match[1]);
        if (method === 'GET') return ok(res, await service.item(id));
        if (method === 'DELETE') {
          assertSameOrigin(req);
          return ok(res, await service.deleteItem(id));
        }
        if (method === 'PATCH' || method === 'POST') {
          assertSameOrigin(req);
          return ok(res, await service.updateItem(id, await readJsonBody(req)));
        }
      }
      throw new SpaceError('NOT_FOUND', '没有这个空间接口。', 404);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof SpaceError) return failResponse(res, error);
      console.error('[space-workspace] request failed', error);
      return failResponse(res, new SpaceError('INTERNAL', '空间操作失败，已记录错误。', 500));
    }
  };
}

export function resolveDataDirectory(config = {}) {
  if (typeof config.dataDir === 'string' && config.dataDir.trim()) return resolve(config.dataDir.trim());
  const profile = process.env.DSH_PROFILE_DIR;
  const configuredHome = process.env.DSH_HOME;
  const expandedHome = configuredHome === '~' ? homedir()
    : configuredHome?.startsWith('~/') || configuredHome?.startsWith('~\\') ? join(homedir(), configuredHome.slice(2)) : configuredHome;
  const home = configuredHome?.trim() ? resolve(expandedHome) : profile ? resolve(profile, '..', '..') : join(homedir(), '.dsh');
  return join(home, 'data', 'space-workspace');
}

export const inject = ['tools'];

export function apply(ctx, config = {}) {
  const store = new SpaceStore({ dir: resolveDataDirectory(config), seedDemo: config.seedDemo !== false });
  const service = createSpaceService(store);
  ctx.inject(['webServer', 'connection'], webCtx => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'prefix',
          path: API_PREFIX,
          handler: createHttpHandler(service, {
            allowRemote: config.allowRemote === true,
            authorize: request => webCtx.connection.requestRejection(request),
          }),
        }),
      'space-workspace: http',
    );
  });
}

export default { apply, inject };
