import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '/workspace/workspace-release-20261013/node_modules/playwright/index.mjs';
const expectedSource = '017cf2030836398513319a7c910c6ad732e43b16';
const root = '/tmp/workspace-launch-20261013/frontend-visible-017cf20';
const launch = chromium.launch.bind(chromium), seen = new WeakSet();
const sourceHead = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: '/workspace/workspace-release-20261013', encoding: 'utf8' }).trim();
function instrument(page) {
  if (seen.has(page)) return page; seen.add(page);
  const screenshot = page.screenshot.bind(page);
  page.screenshot = async options => {
    const path = options?.path && resolve(options.path); assert.ok(path?.startsWith(root + '/'), 'Visual evidence stays in the explicit /tmp output directory'); assert.equal(sourceHead(), expectedSource);
    const state = await page.evaluate(() => ({ title: document.title, route: location.pathname, viewport: { width: innerWidth, height: innerHeight }, shell: document.querySelector('.app-shell')?.className, chatTitle: document.querySelector('.chat-title-pill span')?.textContent,
      libraryTab: document.querySelector('.business-library .bl-tabs [aria-current="page"]')?.textContent,
      visibleHeadings: [...document.querySelectorAll('h1,h2,h3')].filter(element => element.getClientRects().length).map(element => element.textContent),
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map(element => ({ label: element.getAttribute('aria-label'), heading: element.querySelector('h2')?.textContent })),
      visibleTaskSummaries: [...document.querySelectorAll('.conversation-run > summary,.conversation-task-list > summary')].filter(element => element.getClientRects().length).map(element => element.textContent),
      visibleFiles: [...document.querySelectorAll('.cloud-file,.bl-download')].filter(element => element.getClientRects().length).map(element => ({ text: element.textContent, path: element.getAttribute('href') })),
      bodyExcerpt: document.body.innerText.slice(0, 1800), documentWidth: document.documentElement.scrollWidth }));
    const result = await screenshot(options);
    const metadata = { source: expectedSource, sourceStatus: execFileSync('git', ['status', '--short'], { cwd: '/workspace/workspace-release-20261013', encoding: 'utf8' }).trim(), capturedAt: new Date().toISOString(), actualBrowser: true, screenshot: path, pageUrl: page.url(), path: state.route, viewport: state.viewport, state,
      evidenceGroup: process.env.FRONTEND_VISIBLE_KIND || 'local-fixture', dataSource: 'Synthetic temporary original Workspace Store and original loopback HTTP host; no production data.',
      backendBoundary: 'Current production React bundle rendered against the original createApp/Runtime/Store implementation on 127.0.0.1.',
      modelBoundary: process.env.FRONTEND_VISIBLE_KIND === 'pi-results' ? 'Actual installed Pi package with its local faux provider; synthetic response only, zero live model or external execution.' : 'Provider disabled; no live model or external execution.',
      identityBoundary: process.env.FRONTEND_VISIBLE_KIND === 'delegation' ? 'Synthetic pre-existing local operator/native-session metadata; existing original binding code. No real Host/login/native acceptance.' : 'Local no-login fixture; no real identity/production authorization acceptance.' };
    await writeFile(path + '.json', JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' }); return result;
  };
  return page;
}
chromium.launch = async options => {
  const browser = await launch(options), newContext = browser.newContext.bind(browser), newPage = browser.newPage.bind(browser);
  browser.newContext = async options => { const context = await newContext(options), newPage = context.newPage.bind(context); context.newPage = async () => instrument(await newPage()); return context; };
  browser.newPage = async options => instrument(await newPage(options)); return browser;
};
