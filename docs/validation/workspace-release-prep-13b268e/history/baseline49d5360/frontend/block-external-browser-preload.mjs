import { chromium } from '/workspace/workspace-release-20261013/node_modules/playwright/index.mjs';
const launch = chromium.launch.bind(chromium);
chromium.launch = async options => {
  const browser = await launch(options);
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async options => {
    const page = await newPage(options);
    await page.route('**/*', route => {
      const host = new URL(route.request().url()).hostname;
      return host === '127.0.0.1' || host === 'localhost' ? route.continue() : route.fulfill({ status: 204, body: '' });
    });
    return page;
  };
  return browser;
};
