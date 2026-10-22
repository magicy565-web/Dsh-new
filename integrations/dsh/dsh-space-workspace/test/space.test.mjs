import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SpaceStore, createSpaceService, createHttpHandler, API_PREFIX, ITEM_KINDS } from '../index.js';

async function withStore(run, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-space-test-'));
  try {
    const store = new SpaceStore({ dir, ...options });
    await run(createSpaceService(store), store, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('seeded space exposes the demo items and counts', async () => {
  await withStore(async service => {
    const state = await service.state();
    assert.equal(state.items.length, 9);
    assert.deepEqual(
      Object.fromEntries(ITEM_KINDS.map(key => [key, state.counts[key]])),
      { page: 3, file: 3, site: 3, image: 0, folder: 0, drive: 0 },
    );
    assert.equal(state.items[0].title, '无标题页面');
    assert.equal(state.items.some(item => item.title === '示例页面' && item.starred && item.shared), true);
    assert.equal(state.tasks.length, 2);
  });
});

test('seedDemo:false starts empty and survives a create', async () => {
  await withStore(
    async service => {
      const before = await service.state();
      assert.equal(before.items.length, 0);
      const created = await service.createPage({ title: '新页面', body: '正文' });
      assert.equal(created.title, '新页面');
      assert.equal(created.body, '正文');
      const after = await service.state();
      assert.equal(after.items.length, 1);
      assert.equal(after.items[0].title, '新页面');
    },
    { seedDemo: false },
  );
});

test('create, read and update a page', async () => {
  await withStore(async service => {
    const created = await service.createPage({ title: '测试页面', body: '第一行' });
    assert.match(created.id, /^item_/u);
    assert.equal(created.kind, 'page');
    assert.equal(created.owned, true);
    assert.equal(created.starred, false);

    const loaded = await service.item(created.id);
    assert.equal(loaded.body, '第一行');

    const starred = await service.updateItem(created.id, { starred: true });
    assert.equal(starred.starred, true);

    const updated = await service.updateItem(created.id, { title: '改名', body: '第二行' });
    assert.equal(updated.title, '改名');
    assert.equal(updated.body, '第二行');
    assert.equal(updated.starred, true);

    await assert.rejects(() => service.updateItem('item_missing', { starred: true }), error => error.code === 'NOT_FOUND');
  });
});

test('state filtering by kind and query', async () => {
  await withStore(async service => {
    const pages = await service.state({ kind: 'page' });
    assert.equal(pages.items.length, 3);
    assert.equal(pages.items.every(item => item.kind === 'page'), true);
    const hit = await service.state({ q: '示例页面' });
    assert.equal(hit.items.length, 1);
    assert.equal(hit.items[0].title, '示例页面');
  });
});

test('trash, restore, members and task settings persist', async () => {
  await withStore(async service => {
    const page = await service.createPage({ title: '回收测试' });
    const pinned = await service.updateItem(page.id, { pinned: true });
    assert.equal(pinned.pinned, true);

    const trashed = await service.trashItem(page.id);
    assert.ok(trashed.deletedAt);
    const visible = await service.state();
    assert.equal(visible.items.some(item => item.id === page.id), false);
    const trashState = await service.state({ trash: '1' });
    assert.equal(trashState.items.some(item => item.id === page.id), true);

    const restored = await service.restoreItem(page.id);
    assert.equal(restored.deletedAt, null);

    const member = await service.addMember(page.id, { name: '张三' });
    assert.equal(member.members.length, 1);
    assert.equal(member.members[0].name, '张三');
    assert.equal(member.shared, true);

    const task = await service.createTask({ title: '周报', repeat: 'weekdays', time: '18:30', timezone: 'UTC', endMode: 'count', endCount: 10, newChat: true });
    assert.equal(task.repeat, 'weekdays');
    assert.equal(task.time, '18:30');
    assert.equal(task.endMode, 'count');
    assert.equal(task.endCount, 10);
    assert.equal(task.newChat, true);

    const updated = await service.updateTask(task.id, { status: 'paused', repeat: 'monthly' });
    assert.equal(updated.status, 'paused');
    assert.equal(updated.repeat, 'monthly');

    await service.deleteItem(page.id);
    await assert.rejects(() => service.item(page.id), error => error.code === 'NOT_FOUND');
  });
});

test('page blocks persist and derive a plain-text body', async () => {
  await withStore(async service => {
    const created = await service.createPage({
      title: '块页面',
      blocks: [
        { id: 'b1', type: 'h1', text: '标题' },
        { id: 'b2', type: 'todo', text: '任务', checked: true },
        { id: 'b3', type: 'divider', text: '' },
      ],
    });
    assert.equal(created.blocks.length, 3);
    assert.equal(created.body.includes('# 标题'), true);
    assert.equal(created.body.includes('- [x] 任务'), true);

    const updated = await service.updateItem(created.id, { blocks: [{ id: 'b1', type: 'paragraph', text: '正文' }] });
    assert.equal(updated.blocks.length, 1);
    assert.equal(updated.blocks[0].type, 'paragraph');
    assert.equal(updated.body, '正文');

    await assert.rejects(() => service.updateItem(created.id, { blocks: [{ type: 'invalid' }] }), error => error.code === 'INVALID_INPUT');
  });
});

test('http surface requires the browser session and supports page writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-space-test-'));
  const service = createSpaceService(new SpaceStore({ dir }));
  const authorize = request => (request.headers['x-test-session'] === 'ok' ? (request.headers['x-test-cross'] === '1' ? 403 : undefined) : 401);
  const server = createServer(createHttpHandler(service, { authorize }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}${API_PREFIX}`;
  const auth = { 'x-test-session': 'ok' };
  try {
    const unauthenticated = await fetch(`${base}/state`);
    assert.equal(unauthenticated.status, 401);
    assert.equal((await unauthenticated.json()).error.code, 'UNAUTHORIZED');

    const state = await fetch(`${base}/state`, { headers: auth }).then(response => response.json());
    assert.equal(state.ok, true);
    assert.equal(state.data.items.length, 9);

    const created = await fetch(`${base}/pages`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'HTTP 页面', body: '正文' }),
    });
    assert.equal(created.status, 201);
    const page = (await created.json()).data;
    assert.equal(page.title, 'HTTP 页面');

    const read = await fetch(`${base}/items/${page.id}`, { headers: auth }).then(response => response.json());
    assert.equal(read.data.body, '正文');

    const starred = await fetch(`${base}/items/${page.id}`, {
      method: 'PATCH',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ starred: true }),
    }).then(response => response.json());
    assert.equal(starred.data.starred, true);

    const trashed = await fetch(`${base}/items/${page.id}/trash`, { method: 'POST', headers: auth }).then(response => response.json());
    assert.ok(trashed.data.deletedAt);
    const restored = await fetch(`${base}/items/${page.id}/restore`, { method: 'POST', headers: auth }).then(response => response.json());
    assert.equal(restored.data.deletedAt, null);

    const member = await fetch(`${base}/items/${page.id}/members`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '李四' }),
    }).then(response => response.json());
    assert.equal(member.data.members[0].name, '李四');

    const task = await fetch(`${base}/tasks`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'HTTP 任务', repeat: 'weekly', time: '10:00' }),
    }).then(response => response.json());
    assert.equal(task.data.repeat, 'weekly');
    assert.equal(task.data.time, '10:00');

    const crossOrigin = await fetch(`${base}/pages`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json', 'x-test-cross': '1' },
      body: JSON.stringify({ title: 'x' }),
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal((await crossOrigin.json()).error.code, 'ORIGIN_DENIED');

    const missing = await fetch(`${base}/items/item_missing`, { headers: auth });
    assert.equal(missing.status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
