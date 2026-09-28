const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const runFile = promisify(execFile);
const root = path.resolve(__dirname, '..');
const workRoot = path.join(root, '_work');
const dataDir = path.join(workRoot, 'widget-layer-' + Date.now());
const reportPath = path.join(root, 'outputs', 'verification', 'widget-layer-tests.json');
const env = { ...process.env, WEEKLIGHT_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const executable = process.env.WEEKLIGHT_EXECUTABLE ? path.resolve(process.env.WEEKLIGHT_EXECUTABLE) : null;
const launch = () => electron.launch(executable ? { executablePath: executable, args: [], env } : { args: [root], env });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const state = page => page.evaluate(() => window.weeklight.get());
const prefs = (page, patch) => page.evaluate(value => window.weeklight.widgetSettings(value), patch);
const checks = [];
const rendererErrors = [];
const nativeSnapshots = [];
const track = page => page.on('pageerror', error => rendererErrors.push(error.message));

async function findPage(app, suffix) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const page = app.windows().find(item => item.url().endsWith(suffix));
    if (page) { track(page); return page; }
    await sleep(50);
  }
  throw new Error('Window was not created: ' + suffix);
}
async function metadata(app) {
  return app.evaluate(({ app, BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/index.html'));
    const widget = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/widget.html'));
    if (!main || !widget) throw new Error('Both test windows are required');
    const handle = window => {
      const bytes = window.getNativeWindowHandle();
      return (bytes.length === 8 ? bytes.readBigUInt64LE(0) : BigInt(bytes.readUInt32LE(0))).toString();
    };
    return {
      pid: process.pid, resources: process.resourcesPath, packaged: app.isPackaged,
      widgetHandle: handle(widget), mainHandle: handle(main),
      bounds: widget.getBounds(), onTop: widget.isAlwaysOnTop(), focused: widget.isFocused(),
      mainFocused: main.isFocused(), mainVisible: main.isVisible()
    };
  });
}
async function inspect(app) {
  const info = await metadata(app);
  const helper = info.packaged ? path.join(info.resources, 'native', 'WeeklightLayer.exe') : path.join(root, 'src', 'native', 'WeeklightLayer.exe');
  const { stdout } = await runFile(helper, ['inspect', info.widgetHandle, String(info.pid), info.mainHandle], { windowsHide: true, timeout: 5000, encoding: 'utf8' });
  const fields = Object.fromEntries(stdout.trim().split(/\r?\n/).map(line => line.split('=')));
  const result = { ...info, index: Number(fields.index), otherIndex: Number(fields.otherIndex), shellIndex: Number(fields.shellIndex ?? -1), desktopIndex: Number(fields.desktopIndex ?? -1), visible: fields.visible === 'true', iconic: fields.iconic === 'true' };
  assert(Number.isInteger(result.index) && result.index >= 0, 'Widget HWND must exist in native Z order');
  assert(Number.isInteger(result.otherIndex) && result.otherIndex >= 0, 'Main HWND must exist in native Z order');
  return result;
}
async function expectLayer(app, label, predicate, stableMs = 250) {
  const deadline = Date.now() + 10000;
  let matchingSince = null, last;
  while (Date.now() < deadline) {
    last = await inspect(app);
    if (predicate(last)) {
      matchingSince ??= Date.now();
      if (Date.now() - matchingSince >= stableMs) {
        nativeSnapshots.push({ label, ...last });
        return last;
      }
    } else matchingSince = null;
    await sleep(80);
  }
  throw new Error(label + ' failed; last native state: ' + JSON.stringify(last));
}
const bottom = info => info.visible && !info.iconic && info.mainVisible && !info.onTop && info.index > info.otherIndex;
const pinned = info => info.visible && !info.iconic && info.onTop && info.index < info.otherIndex;
async function focus(app, suffix) {
  await app.evaluate(({ BrowserWindow }, suffix) => {
    const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith(suffix));
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }, suffix);
}
async function waitPrefs(page, predicate) {
  const deadline = Date.now() + 10000;
  let current;
  while (Date.now() < deadline) {
    current = (await state(page)).settings.widget;
    if (predicate(current)) return current;
    await sleep(50);
  }
  throw new Error('Saved preferences did not settle: ' + JSON.stringify(current));
}

(async () => {
  assert.equal(process.platform, 'win32', 'Native desktop stacking test requires Windows');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  let app, result;
  try {
    app = await launch();
    let main = await findPage(app, '/index.html');
    await main.waitForSelector('.month-grid');
    await prefs(main, { mode: 'day', anchor: '2026-12-28' });
    await main.evaluate(() => window.weeklight.openWidget());
    let widget = await findPage(app, '/widget.html');
    await widget.waitForSelector('#widget-title');
    const opened = await expectLayer(app, 'first open', bottom);
    if (opened.desktopIndex >= 0) assert(opened.index < opened.desktopIndex, 'Widget must stay above the native desktop: ' + JSON.stringify(opened));
    checks.push('first open is visible, unminimized and below the main window in native Z order');

    // Explicitly move once; all subsequent layer operations must preserve this geometry.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/widget.html')).setBounds({ x: 160, y: 90, width: 400, height: 620 }));
    const expectedBounds = (await metadata(app)).bounds;
    await waitPrefs(main, value => JSON.stringify(value.bounds) === JSON.stringify(expectedBounds));
    const assertBounds = async () => assert.deepEqual((await metadata(app)).bounds, expectedBounds, 'Changing Z order must not move or resize the widget');

    await main.evaluate(() => window.weeklight.openWidget());
    const reopened = await expectLayer(app, 'open existing visible window', bottom);
    assert.equal(reopened.widgetHandle, opened.widgetHandle);
    await assertBounds();
    checks.push('opening the existing visible widget sends it below the main window');

    await main.evaluate(() => window.weeklight.closeWidget());
    assert.equal((await state(main)).settings.widget.enabled, false);
    assert.equal((await inspect(app)).visible, false);
    await main.evaluate(() => window.weeklight.openWidget());
    const reopenedHidden = await expectLayer(app, 'reopen hidden window', bottom);
    assert.equal(reopenedHidden.widgetHandle, opened.widgetHandle);
    await assertBounds();
    checks.push('reopening the hidden widget restores its visibility and bottom position');

    await prefs(main, { onTop: true });
    await focus(app, '/index.html');
    await expectLayer(app, 'explicit always on top', pinned);
    await assertBounds();
    checks.push('always on top remains above the focused main window');

    await widget.locator('#widget-pin').click();
    await expectLayer(app, 'unpin', bottom);
    assert.equal((await state(main)).settings.widget.onTop, false);
    await assertBounds();
    checks.push('unpin immediately returns the widget below the main window');

    await focus(app, '/widget.html');
    await expectLayer(app, 'active interaction', info => info.visible && !info.iconic && info.focused && !info.onTop && info.index < info.otherIndex);
    await widget.locator('#quick-form [name=title]').fill('底层便签仍能输入与添加');
    await widget.locator('#quick-form [name=date]').fill('2026-12-28');
    await widget.locator('#quick-form [name=time]').fill('14:30');
    await widget.locator('#quick-form [name=reminder]').selectOption('-1');
    assert.equal(await widget.locator('#quick-form [name=title]').inputValue(), '底层便签仍能输入与添加');
    await widget.locator('#quick-submit').click();
    await widget.waitForFunction(() => document.querySelector('#pending-list').textContent.includes('底层便签仍能输入与添加'));
    const created = (await state(main)).tasks.find(task => task.title === '底层便签仍能输入与添加');
    assert(created);
    assert.equal(created.date, '2026-12-28');
    assert.equal(created.time, '14:30');
    assert.equal(created.reminder, -1);
    await assertBounds();
    checks.push('focused widget supports normal text input and quick task creation');

    await focus(app, '/index.html');
    await expectLayer(app, 'blur after interaction', info => bottom(info) && !info.focused && info.mainFocused);
    await assertBounds();
    checks.push('losing focus after interaction restores the bottom position');

    await prefs(main, { onTop: true });
    await main.evaluate(() => Promise.all([false, true, false, true, false, true].map(onTop => window.weeklight.widgetSettings({ onTop }))));
    assert.equal((await state(main)).settings.widget.onTop, true);
    await expectLayer(app, 'rapid toggles ending pinned', pinned, 700);
    await assertBounds();
    checks.push('rapid onTop changes ending true retain the final pinned state');

    await main.evaluate(() => Promise.all([false, true, false, true, false].map(onTop => window.weeklight.widgetSettings({ onTop }))));
    assert.equal((await state(main)).settings.widget.onTop, false);
    await expectLayer(app, 'rapid toggles ending unpinned', bottom, 700);
    await assertBounds();
    checks.push('rapid onTop changes ending false retain the final bottom state');

    await waitPrefs(main, value => value.enabled && !value.onTop && JSON.stringify(value.bounds) === JSON.stringify(expectedBounds));
    await app.close();
    app = null;
    app = await launch();
    main = await findPage(app, '/index.html');
    await main.waitForSelector('.month-grid');
    widget = await findPage(app, '/widget.html');
    await widget.waitForSelector('#widget-title');
    const restoredLayer = await expectLayer(app, 'restart restore', bottom);
    if (restoredLayer.desktopIndex >= 0) assert(restoredLayer.index < restoredLayer.desktopIndex, 'Restored widget must stay above the native desktop: ' + JSON.stringify(restoredLayer));
    await assertBounds();
    const restored = await state(main);
    assert.equal(restored.settings.widget.enabled, true);
    assert.equal(restored.settings.widget.onTop, false);
    assert(restored.tasks.some(task => task.id === created.id));
    checks.push('restart restores the enabled widget at the bottom with its size, position and task');
    checks.push('all layer transitions preserve window size and position');

    assert.deepEqual(rendererErrors, []);
    result = { passed: true, executable, checks, nativeSnapshots, rendererErrors };
    console.log(JSON.stringify({ passed: true, checks, rendererErrors }));
  } catch (error) {
    result = { passed: false, executable, checks, nativeSnapshots, rendererErrors, error: String(error.stack || error) };
    throw error;
  } finally {
    try { if (app) await app.close(); }
    finally {
      if (result) await fs.writeFile(reportPath, JSON.stringify(result, null, 2), 'utf8');
      assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(workRoot));
      assert(path.basename(dataDir).startsWith('widget-layer-'));
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

