'use strict';

// Workspace Harness desktop shell (Electron).
//
// The Electron process owns the window and the local server lifecycle; the
// server itself runs on Electron's embedded Node 24 (Node 24.22 in Electron 45)
// via ELECTRON_RUN_AS_NODE, using the same scripts/harness-serve.mjs as the
// browser edition. Nothing about the harness code changes between the packages.
//
// Flags:
//   --smoke        start the server, probe /healthz, write a JSON result, exit
//   --server-only  start the server without a window or tray
//   --stop         stop the managed server and exit

const { app, BrowserWindow, Tray, Menu, shell, dialog, nativeImage } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');

const APP_NAME = 'Workspace Harness';
const APP_ID = 'com.magicy565.workspaceharness';
const PORT = 8790;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const argv = process.argv.slice(1);
const SMOKE = argv.includes('--smoke');
const SERVER_ONLY = argv.includes('--server-only');
const STOP_ONLY = argv.includes('--stop');

const appRoot = path.join(process.resourcesPath, 'app');
const harnessRoot = path.join(appRoot, 'harness');
const iconPath = path.join(appRoot, 'icon.ico');

const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '.', 'AppData', 'Local');
const stateRoot = path.join(localAppData, 'WorkspaceHarness');
const dataRoot = path.join(stateRoot, 'data');
const logRoot = path.join(stateRoot, 'logs');
const desktopLog = path.join(logRoot, 'desktop.log');
const serverLog = path.join(logRoot, 'server.log');
const pidFile = path.join(stateRoot, 'server.pid');
const smokeFile = path.join(process.env.TEMP || stateRoot, 'workspace-harness-smoke.json');

let mainWindow = null;
let tray = null;
let serverProcess = null;
let serverReady = false;
let quitting = false;
let reusedServer = false;

function log(...parts) {
  try {
    fs.mkdirSync(logRoot, { recursive: true });
    fs.appendFileSync(desktopLog, `[${new Date().toISOString()}] ${parts.join(' ')}\n`);
  } catch { /* logging must never break the app */ }
}

function readPid() {
  try {
    const value = Number(fs.readFileSync(pidFile, 'utf8').trim());
    return Number.isInteger(value) && value > 0 ? value : 0;
  } catch { return 0; }
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

function portOpen() {
  return new Promise(resolve => {
    const socket = new net.Socket();
    const done = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(400);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(PORT, '127.0.0.1');
  });
}

async function waitForPort(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen()) return true;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return portOpen();
}

function prepareComposition() {
  const template = fs.readFileSync(path.join(harnessRoot, 'harness.local.yml'), 'utf8');
  const needle = 'directory: .harness-data';
  if (!template.includes(needle)) {
    throw new Error('harness.local.yml is missing the storage directory line');
  }
  const dataPath = dataRoot.replace(/\\/g, '/');
  const text = template.replace(needle, `directory: '${dataPath}'`);
  const target = path.join(stateRoot, 'harness.yml');
  fs.writeFileSync(target, text, 'utf8');
  return target;
}

function stopManagedServer() {
  const pid = readPid();
  if (pid && processAlive(pid)) {
    try {
      execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      log('taskkill server pid', pid);
    } catch (error) { log('taskkill failed', error.message); }
  }
  try { fs.unlinkSync(pidFile); } catch { /* already gone */ }
  serverProcess = null;
  serverReady = false;
}

async function startServer() {
  if (await portOpen()) {
    reusedServer = true;
    serverReady = true;
    log('port', PORT, 'already open; reusing the running server');
    return;
  }

  const composition = prepareComposition();
  const entry = path.join(harnessRoot, 'desktop', 'start.mjs');
  if (!fs.existsSync(entry)) throw new Error(`missing server entry: ${entry}`);

  // Electron 45 embeds Node 24, so the same executable runs the harness in
  // ELECTRON_RUN_AS_NODE mode. No second Node runtime has to be shipped.
  log('starting server', process.execPath, entry);
  serverProcess = spawn(process.execPath, [entry], {
    cwd: harnessRoot,
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      HARNESS_COMPOSITION: composition,
      WORKSPACE_HARNESS_LOG: serverLog,
    },
  });
  fs.writeFileSync(pidFile, String(serverProcess.pid));
  serverProcess.on('exit', (code, signal) => {
    log('server exited', code, signal);
    serverProcess = null;
    if (!quitting && !serverReady) {
      dialog.showErrorBox(APP_NAME, `本地服务启动后立即退出（code ${code}）。\n日志：${serverLog}`);
    }
  });

  if (!(await waitForPort(90000))) {
    throw new Error(`server did not listen on ${PORT} within 90s`);
  }
  serverReady = true;
}

function probeHealth() {
  return new Promise((resolve, reject) => {
    const request = http.get(`${ORIGIN}/healthz`, { timeout: 10000 }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('timeout', () => request.destroy(new Error('healthz timeout')));
    request.on('error', reject);
  });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#0b1220',
    title: APP_NAME,
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadURL(`${ORIGIN}/home`).catch(error => log('load failed', error.message));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', event => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/iu.test(url) && !url.startsWith(ORIGIN)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN)) {
      event.preventDefault();
      if (/^https?:/iu.test(url)) shell.openExternal(url);
    }
  });
}

function createTray() {
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 }));
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 Workspace Harness', click: showWindow },
    { label: '在浏览器中打开', click: () => shell.openExternal(`${ORIGIN}/home`) },
    { type: 'separator' },
    { label: '停止本地服务', click: () => { stopManagedServer(); } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
}

app.setAppUserModelId(APP_ID);
if (SMOKE) app.disableHardwareAcceleration();

// Keep Chromium state inside the same per-user directory as the data/logs so an
// uninstall leaves a predictable, single tree.
try {
  fs.mkdirSync(path.join(stateRoot, 'chromium'), { recursive: true });
  app.setPath('userData', path.join(stateRoot, 'chromium'));
} catch (error) { log('userData setup failed', error.message); }

const singleInstance = SMOKE || STOP_ONLY ? true : app.requestSingleInstanceLock();
if (!singleInstance) {
  // A desktop instance already owns the app; focus it and exit this process.
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(async () => {
    fs.mkdirSync(dataRoot, { recursive: true });
    fs.mkdirSync(logRoot, { recursive: true });
    log('desktop ready', app.getVersion(), 'smoke=' + SMOKE, 'serverOnly=' + SERVER_ONLY);

    if (STOP_ONLY) {
      stopManagedServer();
      app.exit(0);
      return;
    }

    try {
      await startServer();
    } catch (error) {
      log('start failed', error.stack || error.message);
      if (SMOKE) {
        try { fs.writeFileSync(smokeFile, JSON.stringify({ ok: false, error: error.message }, null, 2)); } catch { }
        app.exit(1);
      } else {
        dialog.showErrorBox(`${APP_NAME} 启动失败`, `${error.message}\n\n日志：${serverLog}`);
        app.exit(1);
      }
      return;
    }

    if (SMOKE) {
      let result;
      try {
        const health = await probeHealth();
        const parsed = JSON.parse(health.body);
        const bad = parsed.plugins.filter(plugin => plugin.status !== 'ok');
        result = {
          ok: health.status === 200 && bad.length === 0,
          status: health.status,
          plugins: parsed.plugins.length,
          badPlugins: bad.map(plugin => plugin.id),
          serverPid: readPid(),
          log: serverLog,
        };
      } catch (error) {
        result = { ok: false, error: error.message };
      }
      try { fs.writeFileSync(smokeFile, JSON.stringify(result, null, 2)); } catch { }
      log('smoke', JSON.stringify(result));
      stopManagedServer();
      app.exit(result.ok ? 0 : 1);
      return;
    }

    createWindow();
    if (!SERVER_ONLY) createTray();
    log('window created');
  }).catch(error => {
    log('fatal', error.stack || error.message);
    dialog.showErrorBox(`${APP_NAME} 启动失败`, error.message);
    app.exit(1);
  });

  app.on('window-all-closed', () => {
    // Closing the window hides it; the tray keeps the app alive.
  });

  app.on('before-quit', () => {
    quitting = true;
    if (!reusedServer) stopManagedServer();
    else log('leaving the reused server running');
  });

  app.on('will-quit', () => {
    if (tray) { tray.destroy(); tray = null; }
  });
}
