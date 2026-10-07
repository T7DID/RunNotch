'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  shell,
  Tray
} = require('electron');
const { JobStore } = require('./store.cjs');
const {
  IPC_HOST,
  IPC_PORT,
  MAX_EVENT_BYTES,
  appDataDirectory,
  ensureIpcToken
} = require('./protocol.cjs');

const PEEK_WIDTH = 18;
const NOTCH_WIDTH = 96;
const EXPANDED_WIDTH = 382;
const MIN_HEIGHT = 168;
const MAX_HEIGHT = 620;

let mainWindow = null;
let tray = null;
let server = null;
let store = null;
let ipcToken = null;
let notchOpen = false;
let expanded = false;
let desiredHeight = 360;
let quitting = false;
const captureArgument = process.argv.indexOf('--capture');
const capturePath = captureArgument >= 0 ? process.argv[captureArgument + 1] : null;

app.setName('RunNotch');
app.setPath('userData', appDataDirectory());

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

function windowWidth() {
  if (expanded) return EXPANDED_WIDTH;
  return notchOpen ? NOTCH_WIDTH : PEEK_WIDTH;
}

function currentBounds(width = windowWidth(), height = desiredHeight) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  return {
    x: area.x + area.width - width,
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height
  };
}

function reposition(animate = true) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setBounds(currentBounds(windowWidth(), desiredHeight), animate && process.platform === 'darwin');
}

function showWindow() {
  if (!mainWindow) return;
  reposition(false);
  mainWindow.showInactive();
}

function revealWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  notchOpen = true;
  reposition(false);
  mainWindow.showInactive();
  mainWindow.webContents.send('ui:reveal');
}

function applyLaunchAtStartup(enabled) {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      enabled: Boolean(enabled),
      path: process.execPath,
      args: ['--startup'],
      name: 'RunNotch'
    });
  } catch (error) {
    console.error('[RunNotch] Could not update Windows startup:', error.message);
  }
}

function broadcastJobs() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('jobs:changed', store.list());
  updateTrayMenu();
}

function notifyFor(job) {
  if (!Notification.isSupported()) return;
  const settings = store.settings();
  const succeeded = job.status === 'success';
  if ((succeeded && !settings.notifySuccess) || (!succeeded && !settings.notifyFailure)) return;
  const duration = job.finishedAt && job.startedAt ? formatDuration(job.finishedAt - job.startedAt) : '';
  const notification = new Notification({
    title: succeeded ? `${job.name} finished` : `${job.name} failed`,
    body: succeeded
      ? `Completed${duration ? ` in ${duration}` : ''}.`
      : `Exited${Number.isInteger(job.exitCode) ? ` with code ${job.exitCode}` : ''}${duration ? ` after ${duration}` : ''}.`,
    silent: !settings.sound
  });
  notification.on('click', () => {
    revealWindow();
    mainWindow.webContents.send('jobs:changed', store.list());
  });
  notification.show();
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function trayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="8" fill="#080808"/>
      <circle cx="16" cy="16" r="10" fill="none" stroke="#666" stroke-width="3"/>
      <path d="M16 6a10 10 0 0 1 9 5.6" fill="none" stroke="#00d978" stroke-width="3" stroke-linecap="round"/>
      <path d="m13 11 8 5-8 5z" fill="#fff"/>
    </svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`).resize({ width: 16, height: 16 });
}

function updateTrayMenu() {
  if (!tray) return;
  const jobs = store.list();
  const active = jobs.filter((job) => ['running', 'attention', 'stopping'].includes(job.status)).length;
  const attention = jobs.filter((job) => job.status === 'attention').length;
  tray.setToolTip(attention ? `RunNotch — ${attention} run${attention === 1 ? '' : 's'} need attention` : `RunNotch — ${active} active`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: active ? `${active} active run${active === 1 ? '' : 's'}` : 'No active runs', enabled: false },
    { type: 'separator' },
    { label: 'Show RunNotch', click: revealWindow },
    { label: 'Settings', click: () => { revealWindow(); mainWindow.webContents.send('ui:open-settings'); } },
    { label: 'Clear finished', enabled: jobs.some((job) => !['running', 'attention', 'stopping'].includes(job.status)), click: () => { store.clearFinished(); broadcastJobs(); } },
    { type: 'separator' },
    { label: 'Quit RunNotch', click: () => { quitting = true; app.quit(); } }
  ]));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    ...currentBounds(PEEK_WIDTH, desiredHeight),
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
  mainWindow.once('ready-to-show', showWindow);
  mainWindow.webContents.once('did-finish-load', () => {
    if (!capturePath) return;
    expanded = true;
    reposition(false);
    mainWindow.webContents.send('ui:capture');
    setTimeout(async () => {
      try {
        const image = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.resolve(capturePath), image.toPNG());
      } finally {
        quitting = true;
        app.quit();
      }
    }, 900);
  });
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function authorized(request) {
  return request.headers.authorization === `Bearer ${ipcToken}`;
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_EVENT_BYTES) {
        reject(Object.assign(new Error('Event is too large.'), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('Invalid JSON.'), { statusCode: 400 }));
      }
    });
    request.on('error', reject);
  });
}

function startServer() {
  server = http.createServer(async (request, response) => {
    if (!authorized(request)) {
      sendJson(response, 401, { error: 'unauthorized' });
      return;
    }
    if (request.method === 'GET' && request.url === '/v1/health') {
      sendJson(response, 200, { ok: true, version: app.getVersion() });
      return;
    }
    if (request.method === 'GET' && request.url === '/v1/jobs') {
      sendJson(response, 200, { jobs: store.list() });
      return;
    }
    if (request.method === 'POST' && request.url === '/v1/events') {
      try {
        const event = await readJson(request);
        const job = store.apply(event);
        broadcastJobs();
        if (event.type === 'finish') notifyFor(job);
        sendJson(response, 202, { accepted: true });
      } catch (error) {
        sendJson(response, error.statusCode || (error instanceof RangeError ? 404 : 400), { error: error.message });
      }
      return;
    }
    sendJson(response, 404, { error: 'not_found' });
  });
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      app.quit();
      return;
    }
    console.error('[RunNotch] IPC server failed:', error.message);
  });
  server.listen(IPC_PORT, IPC_HOST);
}

function stopProcessTree(job) {
  if (!job?.childPid) return Promise.reject(new Error('This run no longer has a process to stop.'));
  return new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      const child = spawn('taskkill.exe', ['/PID', String(job.childPid), '/T'], { windowsHide: true });
      let errorText = '';
      child.stderr.on('data', (chunk) => { errorText += chunk.toString(); });
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(errorText.trim() || `taskkill exited with code ${code}.`)));
      child.on('error', reject);
      return;
    }
    try {
      process.kill(job.childPid, 'SIGTERM');
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

function focusTerminal(job) {
  if (!job?.terminalPid) return Promise.resolve(false);
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    const safePid = Number(job.terminalPid);
    const command = `$w=New-Object -ComObject WScript.Shell; [bool]$w.AppActivate(${safePid})`;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.on('close', () => resolve(/true/i.test(output)));
    child.on('error', () => resolve(false));
  });
}

function registerIpc() {
  ipcMain.handle('jobs:list', () => store.list());
  ipcMain.handle('job:stop', async (_event, id) => {
    const job = store.get(String(id));
    if (!job || !['running', 'attention'].includes(job.status)) throw new Error('This run is not active.');
    store.apply({ type: 'stopping', id: job.id });
    broadcastJobs();
    try {
      await stopProcessTree(job);
      return { ok: true };
    } catch (error) {
      store.apply({ type: 'output', id: job.id, stream: 'stderr', text: `Could not stop the process: ${error.message}` });
      broadcastJobs();
      throw error;
    }
  });
  ipcMain.handle('job:focus', async (_event, id) => {
    const job = store.get(String(id));
    if (!job) return { ok: false };
    const focused = await focusTerminal(job);
    if (!focused && job.cwd) await shell.openPath(job.cwd);
    return { ok: focused, fallback: !focused };
  });
  ipcMain.handle('job:open-folder', async (_event, id) => {
    const job = store.get(String(id));
    if (!job?.cwd) return { ok: false };
    const error = await shell.openPath(job.cwd);
    return { ok: !error, error };
  });
  ipcMain.handle('job:remove', (_event, id) => {
    const job = store.get(String(id));
    if (job && ['running', 'attention', 'stopping'].includes(job.status)) throw new Error('Stop the run before removing it.');
    const removed = store.remove(String(id));
    broadcastJobs();
    return { ok: removed };
  });
  ipcMain.handle('jobs:clear-finished', () => { store.clearFinished(); broadcastJobs(); return { ok: true }; });
  ipcMain.handle('settings:get', () => store.settings());
  ipcMain.handle('settings:update', (_event, patch) => {
    const value = store.updateSettings(patch || {});
    if (Object.hasOwn(patch || {}, 'launchAtStartup')) applyLaunchAtStartup(value.launchAtStartup);
    broadcastJobs();
    return value;
  });
  ipcMain.on('ui:notch-open', (_event, value) => {
    notchOpen = Boolean(value);
    if (!notchOpen) expanded = false;
    reposition();
  });
  ipcMain.on('ui:expanded', (_event, value) => {
    expanded = Boolean(value);
    if (expanded) notchOpen = true;
    reposition();
  });
  ipcMain.on('ui:height', (_event, value) => {
    const next = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(Number(value) || MIN_HEIGHT)));
    if (Math.abs(next - desiredHeight) > 2) { desiredHeight = next; reposition(false); }
  });
  ipcMain.on('ui:hide', () => mainWindow?.hide());
}

app.on('second-instance', revealWindow);
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  server?.close();
});
app.on('window-all-closed', (event) => event.preventDefault());

app.whenReady().then(() => {
  ipcToken = ensureIpcToken();
  store = new JobStore(path.join(app.getPath('userData'), 'state.json'));
  applyLaunchAtStartup(store.settings().launchAtStartup);
  registerIpc();
  createWindow();
  startServer();
  tray = new Tray(trayIcon());
  tray.on('click', () => mainWindow?.isVisible() ? mainWindow.hide() : revealWindow());
  updateTrayMenu();
  globalShortcut.register('CommandOrControl+Shift+R', () => mainWindow?.isVisible() ? mainWindow.hide() : revealWindow());
  screen.on('display-added', () => reposition(false));
  screen.on('display-removed', () => reposition(false));
  screen.on('display-metrics-changed', () => reposition(false));
});
