const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { APP_ID, resolveAppId, createWindowBranding } = require('../src/window-branding.cjs');

function branding(overrides = {}) {
  return createWindowBranding({
    app: { isPackaged: true, getAppPath() { throw new Error('Packaged relaunch must use only the installed executable'); } },
    platform: 'win32',
    resourcesPath: 'C:\\Program Files\\橙子日程\\resources',
    execPath: 'C:\\Program Files\\橙子日程\\橙子日程.exe',
    sourceDir: 'C:\\Program Files\\橙子日程\\resources\\app.asar\\src',
    ...overrides
  });
}
function mockWindow() {
  const calls = [];
  return {
    calls,
    setAppDetails(value) { calls.push(['details', value]); },
    setIcon(value) { calls.push(['icon', value]); }
  };
}

test('packaged Windows branding writes physical ICO metadata before the AppUserModelID', () => {
  const brand = branding();
  assert.equal(brand.iconPath, 'C:\\Program Files\\橙子日程\\resources\\assets\\icon.ico');
  assert.ok(!brand.iconPath.includes('.asar'));
  const window = mockWindow();
  brand.apply(window);
  assert.deepEqual(window.calls, [
    ['details', {
      appIconPath: brand.iconPath,
      appIconIndex: 0,
      relaunchCommand: '"C:\\Program Files\\橙子日程\\橙子日程.exe"',
      relaunchDisplayName: '橙子日程'
    }],
    ['details', { appId: 'local.weeklight.planner' }],
    ['icon', brand.iconPath]
  ]);
});

test('development relaunch quotes both Electron and checkout paths with spaces', () => {
  const brand = branding({
    app: { isPackaged: false, getAppPath: () => 'E:\\My Projects\\橙子日程' },
    execPath: 'E:\\My Projects\\橙子日程\\node_modules\\electron\\dist\\electron.exe',
    sourceDir: 'E:\\My Projects\\橙子日程\\src'
  });
  const window = mockWindow();
  brand.apply(window);
  assert.equal(brand.iconPath, 'E:\\My Projects\\橙子日程\\src\\assets\\icon.ico');
  assert.equal(window.calls[0][1].relaunchCommand,
    '"E:\\My Projects\\橙子日程\\node_modules\\electron\\dist\\electron.exe" "E:\\My Projects\\橙子日程"');
  assert.equal(window.calls[1][1].appId, 'local.weeklight.planner.development');
  assert.notEqual(window.calls[1][1].appId, APP_ID);
});


test('process and window identities share one resolver while development stays separate from production', () => {
  for (const [isPackaged, expectedId] of [
    [true, 'local.weeklight.planner'],
    [false, 'local.weeklight.planner.development']
  ]) {
    const app = { isPackaged, getAppPath: () => 'E:\\My Projects\\橙子日程' };
    assert.equal(resolveAppId(app), expectedId);
    const window = mockWindow();
    branding({ app }).apply(window);
    assert.deepEqual(window.calls[1], ['details', { appId: resolveAppId(app) }]);
  }
});

test('Windows relaunch escapes a trailing directory backslash before the closing quote', () => {
  const brand = branding({ app: { isPackaged: false, getAppPath: () => 'E:\\' } });
  const window = mockWindow();
  brand.apply(window);
  assert.equal(window.calls[0][1].relaunchCommand, '"C:\\Program Files\\橙子日程\\橙子日程.exe" "E:\\\\"');
});

test('Windows resource paths retain UNC shares and their spaces', () => {
  const brand = branding({
    resourcesPath: '\\\\fileserver\\Shared Apps\\橙子日程\\resources',
    execPath: '\\\\fileserver\\Shared Apps\\橙子日程\\橙子日程.exe'
  });
  const window = mockWindow();
  brand.apply(window);
  assert.equal(brand.iconPath, '\\\\fileserver\\Shared Apps\\橙子日程\\resources\\assets\\icon.ico');
  assert.equal(window.calls[0][1].relaunchCommand, '"\\\\fileserver\\Shared Apps\\橙子日程\\橙子日程.exe"');
});

test('each window receives independent shell details while visibility and taskbar policy stay with callers', () => {
  const brand = branding();
  const first = mockWindow();
  brand.apply(first);
  first.calls[1][1].appId = 'mutated';
  first.calls[0][1].appIconPath = 'wrong.ico';
  const second = mockWindow();
  brand.apply(second);
  assert.equal(second.calls[1][1].appId, APP_ID);
  assert.equal(Object.hasOwn(second.calls[0][1], 'appId'), false);
  assert.equal(second.calls[0][1].appIconPath, brand.iconPath);
  assert.deepEqual(second.calls.map(call => call[0]), ['details', 'details', 'icon']);
});

for (const platform of ['linux', 'darwin']) {
  test(`${platform} keeps its PNG window icon without invoking Windows-only APIs`, () => {
    const sourceDir = path.resolve('app', 'src');
    const brand = branding({
      platform,
      sourceDir,
      resourcesPath: undefined,
      app: { isPackaged: false, getAppPath() { throw new Error('No Windows relaunch metadata on this platform'); } }
    });
    assert.equal(brand.iconPath, path.join(sourceDir, 'assets', 'icon.png'));
    assert.doesNotThrow(() => brand.apply({}));
  });
}
