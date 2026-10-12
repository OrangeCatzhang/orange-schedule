const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const runFile = promisify(execFile);

const root = path.resolve(__dirname, '..');
const workRoot = path.join(root, '_work');
const dataDir = path.join(workRoot, 'window-branding-' + randomUUID());
const output = path.join(root, 'outputs', 'verification');
const env = { ...process.env, WEEKLIGHT_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const guards = ['--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9'];
const checks = [], nativeWindows = [], sessions = [], errors = [], requests = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let instance, metadata;

async function launch(args = []) {
  const options = process.env.WEEKLIGHT_EXECUTABLE
    ? { executablePath: path.resolve(process.env.WEEKLIGHT_EXECUTABLE), args: [...args, ...guards], env }
    : { args: [root, ...args, ...guards], env };
  instance = await electron.launch(options);
  const info = await instance.evaluate(({ app, Notification, net, shell }) => {
    const state = { interceptedNotificationAttempts: 0, fetches: [], opens: [], loginWrites: [] };
    globalThis.__brandingTest = state;
    // Electron can register a Start Menu shortcut in the constructor, before show().
    // Stop at the capability check so the production notify() never constructs one.
    Notification.isSupported = () => { state.interceptedNotificationAttempts++; return false; };
    net.fetch = async url => { state.fetches.push(String(url)); throw new Error('Network blocked by isolated branding test'); };
    shell.openExternal = async url => { state.opens.push(String(url)); };
    app.setLoginItemSettings = settings => { state.loginWrites.push(settings); throw new Error('Startup writes blocked by isolated branding test'); };
    return { version: app.getVersion(), packaged: app.isPackaged, pid: process.pid, execPath: process.execPath, appPath: app.getAppPath(), resourcesPath: process.resourcesPath };
  });
  metadata ||= info;
  await instance.context().route(/^https?:\/\//, route => { requests.push(route.request().url()); return route.abort(); });
  instance.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  return info;
}

async function pageFor(role) {
  const filename = role === 'main' ? 'index' : role;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const page = instance.windows().find(page => page.url().endsWith('/' + filename + '.html'));
    if (page) {
      await page.waitForSelector(role === 'main' ? '.month-grid' : role === 'widget' ? '#widget-title' : '#quote-text', { state: 'attached' });
      page.on('pageerror', error => errors.push(error.message));
      return page;
    }
    await sleep(30);
  }
  throw new Error('Missing isolated ' + role + ' page');
}

async function windowState() {
  return instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => {
    const filename = window.webContents.getURL().split('/').at(-1);
    const role = filename === 'index.html' ? 'main' : filename?.replace(/\.html$/, '');
    const handle = window.getNativeWindowHandle();
    return { role, visible: window.isVisible(), handle: String(handle.length === 8 ? handle.readBigUInt64LE() : handle.readUInt32LE()) };
  }));
}

function quote(value) { return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"'; }

async function verifyNative(info, label, expected) {
  let windows;
  const deadline = Date.now() + 10000;
  do {
    windows = await windowState();
    if (Object.entries(expected).every(([role, visible]) => windows.some(window => window.role === role && window.visible === visible))) break;
    await sleep(30);
  } while (Date.now() < deadline);
  assert.deepEqual(windows.map(window => window.role).sort(), Object.keys(expected).sort(), label + ' exact windows');
  for (const [role, visible] of Object.entries(expected)) assert.equal(windows.find(window => window.role === role).visible, visible, label + ' ' + role + ' visibility');
  const inputPath = path.join(dataDir, 'native-input.json');
  await fs.writeFile(inputPath, JSON.stringify({ pid: info.pid, windows }), 'utf8');
  const { stdout } = await runFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'helpers', 'read-window-branding.ps1'), '-InputPath', inputPath], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
  const records = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  const iconPath = info.packaged ? path.join(info.resourcesPath, 'assets', 'icon.ico') : path.join(root, 'src', 'assets', 'icon.ico');
  assert.equal((await fs.stat(iconPath)).isFile(), true, 'Windows Shell must have a physical icon file');
  assert(!iconPath.includes('app.asar'), 'Shell icon cannot live inside an archive');
  const relaunch = [info.execPath, ...(info.packaged ? [] : [info.appPath])].map(quote).join(' ');
  for (const record of records) {
    assert.equal(record.pid, info.pid);
    const expectedAppId = info.packaged ? 'local.weeklight.planner' : 'local.weeklight.planner.development';
    const otherModeAppId = info.packaged ? 'local.weeklight.planner.development' : 'local.weeklight.planner';
    assert.equal(record.appId, expectedAppId, label + ' app identity matches the launch mode');
    assert.notEqual(record.appId, otherModeAppId, 'Development and installed windows must not share a taskbar identity');
    assert.equal(record.displayName, '橙子日程');
    assert.equal(record.iconResource, iconPath + ',0');
    assert.equal(record.relaunchCommand, relaunch);
    assert.equal(record.visible, expected[record.role]);
    // Electron may hide a taskbar entry through ITaskbarList without WS_EX_TOOLWINDOW.
    assert.equal(record.icons.length, 2);
    for (const icon of record.icons) {
      assert(icon.width >= 16 && icon.height >= 16);
      assert(icon.orangePixels / icon.totalPixels >= 0.10, label + ' ' + record.role + ' WM_GETICON ' + icon.kind + ' should contain the orange icon');
    }
    nativeWindows.push({ session: label, ...record });
  }
  checks.push(label + ': exact visibility, distinct development/installed AppUserModelID, real ICO resource, relaunch command/name and both native orange icons');
}

async function finishSession(label) {
  const state = await instance.evaluate(() => globalThis.__brandingTest);
  assert.deepEqual(state.fetches, []);
  assert.deepEqual(state.opens, []);
  assert.deepEqual(state.loginWrites, []);
  sessions.push({ label, ...state });
  await instance.close();
  instance = null;
}

async function shortcutFingerprints() {
  const locations = [process.env.APPDATA, process.env.PROGRAMDATA].filter(Boolean);
  const files = locations.flatMap(location => ['橙子日程.lnk', 'Electron.lnk'].map(name =>
    path.join(location, 'Microsoft', 'Windows', 'Start Menu', 'Programs', name)));
  return Promise.all(files.map(async file => {
    try {
      const bytes = await fs.readFile(file);
      return { path: file, exists: true, sha256: createHash('sha256').update(bytes).digest('hex') };
    } catch (error) {
      if (error.code === 'ENOENT') return { path: file, exists: false, sha256: null };
      throw error;
    }
  }));
}

async function cleanup() {
  const target = path.resolve(dataDir);
  assert.equal(path.dirname(target), workRoot);
  assert(path.basename(target).startsWith('window-branding-'));
  const entry = await fs.lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!entry) return;
  assert.equal(entry.isSymbolicLink(), false);
  const [actualTarget, actualWork] = await Promise.all([fs.realpath(target), fs.realpath(workRoot)]);
  assert.equal(path.dirname(actualTarget), actualWork);
  await fs.rm(target, { recursive: true, force: true });
}

(async () => {
  assert.equal(process.platform, 'win32', 'Native branding regression requires Windows');
  await fs.mkdir(output, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'plans.json'), JSON.stringify({ version: 1, tasks: [], settings: { sound: false, popup: true, checkUpdates: false, widget: { enabled: false, onTop: false } }, history: [] }), 'utf8');
  let failure, cleaned = false, shortcutsBefore, shortcutsAfter, shortcutsUnchanged = false;
  try {
    shortcutsBefore = await shortcutFingerprints();
    let info = await launch();
    let main = await pageFor('main');
    assert.equal(path.resolve((await main.evaluate(() => window.weeklight.get())).dataDir), dataDir);
    await verifyNative(info, 'normal startup', { main: true });
    if (process.env.WEEKLIGHT_BRANDING_PREVIEW === '1') {
      console.log(JSON.stringify({ previewReady: true, pid: info.pid, windows: await windowState(), durationMs: 30000 }));
      await sleep(30000);
    }
    await main.evaluate(() => window.weeklight.testReminder());
    await pageFor('reminder');
    await main.evaluate(() => window.weeklight.openWidget());
    await pageFor('widget');
    await verifyNative(info, 'three window types', { main: true, reminder: true, widget: true });
    assert.equal(await instance.evaluate(() => globalThis.__brandingTest.interceptedNotificationAttempts), 1, 'System notification attempt is blocked before construction');
    await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/reminder.html')).close());
    await main.evaluate(() => window.weeklight.testReminder());
    await pageFor('reminder');
    await verifyNative(info, 'recreated reminder', { main: true, reminder: true, widget: true });
    assert.equal(await instance.evaluate(() => globalThis.__brandingTest.interceptedNotificationAttempts), 2, 'Both reminder attempts stop before constructing system notifications');
    await main.evaluate(() => window.weeklight.closeWidget());
    await finishSession('normal startup');

    info = await launch(['--hidden']);
    main = await pageFor('main');
    await verifyNative(info, 'hidden startup', { main: false });
    await main.evaluate(() => window.weeklight.showMain());
    await verifyNative(info, 'show after hidden startup', { main: true });
    await finishSession('hidden startup');

    info = await launch(['--widget']);
    main = await pageFor('main');
    await pageFor('widget');
    await verifyNative(info, 'widget-only startup', { main: false, widget: true });
    await finishSession('widget-only startup');

    info = await launch();
    main = await pageFor('main');
    await pageFor('widget');
    const restored = await main.evaluate(() => window.weeklight.get());
    assert.equal(restored.settings.widget.enabled, true);
    assert.equal(restored.settings.checkUpdates, false);
    assert.equal(restored.settings.sound, false);
    assert.equal(restored.tasks.length, 0);
    await verifyNative(info, 'restart restores widget', { main: true, widget: true });
    checks.push('restart retains isolated settings and the widget without introducing tasks');
    await finishSession('restart');
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    checks.push('system notification attempts blocked before construction; no network, external navigation, or startup registration writes');
  } catch (error) { failure = error; }
  finally {
    try { if (instance) await instance.close(); } catch (error) { failure ||= error; }
    try { await cleanup(); cleaned = true; } catch (error) { failure ||= error; }
    try {
      shortcutsAfter = await shortcutFingerprints();
      assert.deepEqual(shortcutsAfter, shortcutsBefore, 'Start Menu shortcuts must remain byte-for-byte unchanged');
      shortcutsUnchanged = true;
    } catch (error) { failure ||= error; }
    const result = { passed: !failure, version: metadata?.version, packaged: metadata?.packaged, checks, nativeWindows, sessions, errors, requests, shortcutsBefore, shortcutsAfter, shortcutsUnchanged, isolatedDataRemoved: cleaned, error: failure?.stack };
    await fs.writeFile(path.join(output, 'window-branding-desktop.json'), JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify(result));
  }
  if (failure) throw failure;
})().catch(error => { console.error(error); process.exitCode = 1; });
