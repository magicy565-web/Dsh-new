import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/** Pages a plugin serves: a GET of a single path segment, no parameters. */
async function pageRoutes() {
  const plugins = await readdir(path.join(ROOT, 'plugins'), { withFileTypes: true }).catch(() => []);
  const routes = [];
  for (const entry of plugins.filter(item => item.isDirectory())) {
    const file = path.join(ROOT, 'plugins', entry.name, 'harness.plugin.json');
    const manifest = JSON.parse(await readFile(file, 'utf8').catch(() => 'null'));
    if (!manifest) continue;
    for (const route of manifest.routes ?? []) {
      const match = /^GET (\/[a-z][a-z-]*)$/u.exec(route);
      if (match) routes.push({ plugin: manifest.id ?? entry.name, path: match[1] });
    }
  }
  return routes;
}

const source = async relative => readFile(path.join(ROOT, relative), 'utf8');

test('every page a plugin serves is reachable from the home page', async () => {
  const routes = await pageRoutes();
  assert.ok(routes.length >= 10, `expected the page routes, saw ${routes.length}`);
  const home = await source('plugins/workspace-home/src/area.mjs');
  // /login is reached by redirect when signed out; /home is this page itself.
  const exempt = new Set(['/login', '/home']);
  const missing = routes.filter(route => !exempt.has(route.path) && !home.includes(`href="${route.path}"`));
  assert.deepEqual(missing.map(route => `${route.plugin} ${route.path}`), [], 'home must link every page');
});

test('the chat sidebar links the working surfaces', async () => {
  const chat = await source('plugins/workspace-chat/src/area.mjs');
  for (const href of ['/home', '/files', '/quotes', '/purchases', '/sessions', '/ops']) {
    assert.ok(chat.includes(`href="${href}"`), `chat must link ${href}`);
  }
});

test('every page has a title and no external asset references', async () => {
  const routes = await pageRoutes();
  for (const route of routes) {
    const pluginDir = path.join(ROOT, 'plugins', route.plugin.replace(/^workspace-/u, 'workspace-'));
    const areaFile = path.join(pluginDir, 'src', 'area.mjs');
    const area = await readFile(areaFile, 'utf8').catch(() => null);
    if (!area) continue;
    assert.match(area, /<title>/u, `${route.plugin} page has no <title>`);
    assert.ok(!/src="https?:\/\//u.test(area), `${route.plugin} page loads an external script`);
    assert.ok(!/href="https?:\/\//u.test(area), `${route.plugin} page links an external stylesheet`);
  }
});
