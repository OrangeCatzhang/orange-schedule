const test = require('node:test');
const assert = require('node:assert/strict');
const { win32: path } = require('node:path');
const { createLoginSettings } = require('../src/login-settings.cjs');

const current = 'C:\\Apps\\Weeklight\\橙子日程.exe';
const old = 'C:\\Apps\\Weeklight\\周光.exe';
const itemName = 'local.weeklight.planner';
const entry = (file, enabled = true, overrides = {}) => ({ name: itemName, path: file, args: ['--hidden'], scope: 'user', enabled, ...overrides });
const settings = (openAtLogin = false, launchItems = []) => ({ openAtLogin, launchItems, executableWillLaunchAtLogin: launchItems.some(item => item.enabled) });
function mockApp(responses = new Map(), isPackaged = true) {
  const reads = [], writes = [];
  const app = {
    isPackaged,
    getLoginItemSettings(options) { reads.push(structuredClone(options)); return responses.get(options.path) || settings(); },
    setLoginItemSettings(options) { writes.push(structuredClone(options)); }
  };
  return { app, reads, writes };
}
const helper = (mock, overrides = {}) => createLoginSettings({ app: mock.app, execPath: current, platform: 'win32', ...overrides });

test('current startup reads always compare the executable and --hidden arguments', () => {
  const mock = mockApp(new Map([[current, settings(true, [entry(current)])]]));
  assert.equal(helper(mock).getOpenAtLogin(), true);
  assert.deepEqual(mock.reads, [{ path: current, args: ['--hidden'] }]);
  assert.deepEqual(mock.writes, []);
});

test('an enabled same-directory legacy entry migrates once without requiring an existing EXE', () => {
  const mock = mockApp(new Map([[old, settings(true, [entry(old)])]]));
  const login = helper(mock);
  assert.deepEqual(login.migrateLegacyOnce(), { migrated: true, from: old, to: current });
  assert.deepEqual(mock.reads, [{ path: current, args: ['--hidden'] }, { path: old, args: ['--hidden'] }]);
  assert.deepEqual(mock.writes, [{ openAtLogin: true, path: current, args: ['--hidden'], name: itemName }]);
  assert.deepEqual(login.migrateLegacyOnce(), { migrated: false, reason: 'already-checked' });
  assert.equal(mock.reads.length, 2);
  assert.equal(mock.writes.length, 1);
});

test('missing, removed and Task Manager-disabled legacy startup entries stay disabled', () => {
  for (const legacy of [settings(), settings(false, [entry(old)]), settings(true, [entry(old, false)]), settings(true)]) {
    const mock = mockApp(new Map([[old, legacy]]));
    assert.equal(helper(mock).migrateLegacyOnce().migrated, false);
    assert.deepEqual(mock.writes, []);
  }
});

test('an existing current command is left unchanged even if Task Manager disabled it', () => {
  for (const enabled of [true, false]) {
    const mock = mockApp(new Map([[current, settings(true, [entry(current, enabled)])], [old, settings(true, [entry(old)])]]));
    assert.deepEqual(helper(mock).migrateLegacyOnce(), { migrated: false, reason: 'current-configured' });
    assert.deepEqual(mock.reads, [{ path: current, args: ['--hidden'] }]);
    assert.deepEqual(mock.writes, []);
  }
});

test('development builds and other platforms never inspect or change startup settings', () => {
  for (const options of [{ packaged: false, platform: 'win32' }, { packaged: true, platform: 'linux' }, { packaged: true, platform: 'darwin' }]) {
    const mock = mockApp(new Map([[old, settings(true, [entry(old)])]]), options.packaged);
    const login = helper(mock, { platform: options.platform });
    assert.equal(login.getOpenAtLogin(), false);
    assert.deepEqual(login.migrateLegacyOnce(), { migrated: false, reason: 'unsupported' });
    assert.deepEqual(mock.reads, []);
    assert.deepEqual(mock.writes, []);
  }
});

test('another installation directory is neither inspected nor migrated', () => {
  const elsewhere = 'C:\\OtherInstallation\\周光.exe';
  const mock = mockApp(new Map([[elsewhere, settings(true, [entry(elsewhere)])]]));
  assert.equal(helper(mock).migrateLegacyOnce().migrated, false);
  assert.deepEqual(mock.reads.map(read => read.path), [current, old]);
  assert.deepEqual(mock.writes, []);
  const misleading = mockApp(new Map([[old, settings(true, [entry(elsewhere)])]]));
  assert.equal(helper(misleading).migrateLegacyOnce().migrated, false);
  assert.deepEqual(misleading.writes, []);
});

test('an enabled unrelated or machine-wide entry cannot override the app entry being disabled', () => {
  for (const alternative of [entry(old, true, { name: 'another-startup-entry' }), entry(old, true, { scope: 'machine' })]) {
    const mock = mockApp(new Map([[old, settings(true, [entry(old, false), alternative])]]));
    assert.equal(helper(mock).migrateLegacyOnce().migrated, false);
    assert.deepEqual(mock.writes, []);
  }
});

test('spaced installation paths can obtain enabled evidence using a quoted registry comparison', () => {
  const target = 'C:\\Program Files\\Weeklight\\橙子日程.exe';
  const legacy = path.join(path.dirname(target), '周光.exe');
  const mock = mockApp(new Map([[legacy, settings(true)], ['"' + legacy + '"', settings(true, [entry(legacy)])]]));
  assert.equal(helper(mock, { execPath: target }).migrateLegacyOnce().migrated, true);
  assert.deepEqual(mock.reads.map(read => read.path), [target, legacy, '"' + legacy + '"']);
  assert.equal(mock.writes[0].path, target);
});

test('a custom old filename remains inside the same directory and path traversal is rejected', () => {
  const legacy = path.join(path.dirname(current), 'FormerPlanner.exe');
  const mock = mockApp(new Map([[legacy, settings(true, [entry(legacy)])]]));
  assert.equal(helper(mock, { legacyExecutableName: 'FormerPlanner.exe' }).migrateLegacyOnce().migrated, true);
  assert.equal(mock.reads[1].path, legacy);
  for (const invalid of ['..\\周光.exe', 'C:\\Other\\周光.exe', '..', 'old/current.exe']) {
    const rejected = mockApp();
    assert.throws(() => helper(rejected, { legacyExecutableName: invalid }).migrateLegacyOnce(), /filename in the same/);
    assert.deepEqual(rejected.reads, []);
    assert.deepEqual(rejected.writes, []);
  }
});

test('unchanged executable names do not migrate their own startup registration', () => {
  const mock = mockApp();
  assert.deepEqual(helper(mock, { execPath: old }).migrateLegacyOnce(), { migrated: false, reason: 'unchanged-executable' });
  assert.deepEqual(mock.reads, []);
  assert.deepEqual(mock.writes, []);
});

test('registry API failures propagate for the startup caller to catch and are not retried in the same launch', () => {
  const mock = mockApp();
  mock.app.getLoginItemSettings = () => { throw new Error('Read failed'); };
  const login = helper(mock);
  assert.throws(() => login.migrateLegacyOnce(), /Read failed/);
  assert.deepEqual(login.migrateLegacyOnce(), { migrated: false, reason: 'already-checked' });
  const writeFailure = mockApp(new Map([[old, settings(true, [entry(old)])]]));
  writeFailure.app.setLoginItemSettings = () => { throw new Error('Write failed'); };
  assert.throws(() => helper(writeFailure).migrateLegacyOnce(), /Write failed/);
});

test('setting startup writes the exact current command and verifies enabling and disabling', () => {
  const responses = new Map();
  const mock = mockApp(responses);
  const recordWrite = mock.app.setLoginItemSettings;
  mock.app.setLoginItemSettings = options => {
    recordWrite(options);
    responses.set(current, settings(options.openAtLogin, options.openAtLogin ? [entry(current)] : []));
  };
  const login = helper(mock);
  assert.equal(login.setOpenAtLogin(true), true);
  assert.equal(login.setOpenAtLogin(false), false);
  assert.deepEqual(mock.writes, [
    { openAtLogin: true, path: current, args: ['--hidden'], name: itemName },
    { openAtLogin: false, path: current, args: ['--hidden'], name: itemName }
  ]);
  assert.deepEqual(mock.reads, [
    { path: current, args: ['--hidden'] },
    { path: current, args: ['--hidden'] }
  ]);
});

test('a silently ignored startup write is reported instead of claiming success', () => {
  for (const requested of [true, false]) {
    const mock = mockApp(new Map([[current, settings(!requested)]]));
    assert.throws(() => helper(mock).setOpenAtLogin(requested), /Windows 未保存.*权限.*安全软件/);
    assert.deepEqual(mock.writes, [{ openAtLogin: requested, path: current, args: ['--hidden'], name: itemName }]);
    assert.deepEqual(mock.reads, [{ path: current, args: ['--hidden'] }]);
  }
});

test('startup writes reject non-boolean values before calling any registry API', () => {
  for (const value of [undefined, null, 0, 1, '', 'true', 'false', [], {}, new Boolean(false)]) {
    const mock = mockApp();
    assert.throws(() => helper(mock).setOpenAtLogin(value), { name: 'TypeError', message: '开机自动启动设置必须为布尔值' });
    assert.deepEqual(mock.writes, []);
    assert.deepEqual(mock.reads, []);
  }
});

test('unsupported startup writes reject without reading or changing registry settings', () => {
  for (const options of [{ packaged: false, platform: 'win32' }, { packaged: true, platform: 'linux' }, { packaged: true, platform: 'darwin' }]) {
    const mock = mockApp(new Map(), options.packaged);
    const login = helper(mock, { platform: options.platform });
    for (const requested of [true, false]) {
      assert.throws(() => login.setOpenAtLogin(requested), /仅支持打包后的 Windows 应用/);
    }
    assert.equal(login.getOpenAtLogin(), false);
    assert.deepEqual(mock.writes, []);
    assert.deepEqual(mock.reads, []);
  }
});

test('startup verification read failures propagate instead of returning a requested state', () => {
  for (const requested of [true, false]) {
    const mock = mockApp();
    const error = new Error('Registry read failed');
    mock.app.getLoginItemSettings = options => { mock.reads.push(structuredClone(options)); throw error; };
    const login = helper(mock);
    assert.throws(() => login.setOpenAtLogin(requested), value => value === error);
    assert.deepEqual(mock.writes, [{ openAtLogin: requested, path: current, args: ['--hidden'], name: itemName }]);
    assert.deepEqual(mock.reads, [{ path: current, args: ['--hidden'] }]);
    assert.throws(() => login.getOpenAtLogin(), value => value === error);
  }
});

test('startup write failures propagate without trying to confirm success', () => {
  const mock = mockApp();
  const error = new Error('Registry write failed');
  mock.app.setLoginItemSettings = options => { mock.writes.push(structuredClone(options)); throw error; };
  assert.throws(() => helper(mock).setOpenAtLogin(true), value => value === error);
  assert.equal(mock.writes.length, 1);
  assert.deepEqual(mock.reads, []);
});