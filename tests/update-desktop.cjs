const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const workRoot = path.join(root, '_work');
const dataDir = path.join(workRoot, 'update-ui-' + randomUUID());
const output = path.join(root, 'outputs', 'verification');
const apiUrl = 'https://api.github.com/repos/OrangeCatzhang/orange-schedule/releases/latest';
const repositoryUrl = 'https://github.com/OrangeCatzhang/orange-schedule';
const notes = '更新摘要：日历与提醒更顺手。\n\n• 调整计划更方便。\n• 保留所有本机计划。\n\n说明原文：<b id="update-note-html">标记也按纯文本显示</b>\n<img src="https://invalid.example/update-test.png" onerror="window.__updateNotesExecuted=true">';
const env = { ...process.env, WEEKLIGHT_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
// Keep a failed/late mock installation from reaching any real remote server.
const networkGuards = [
  '--disable-background-networking',
  '--host-resolver-rules=MAP * ~NOTFOUND',
  '--proxy-server=http://127.0.0.1:9'
];
const launch = () => electron.launch(process.env.WEEKLIGHT_EXECUTABLE
  ? { executablePath: path.resolve(process.env.WEEKLIGHT_EXECUTABLE), args: networkGuards, env }
  : { args: [root, ...networkGuards], env });
const checks = [], rendererErrors = [], rendererRequests = [], sessions = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const readState = page => page.evaluate(() => window.weeklight.get());
const mockState = instance => instance.evaluate(() => {
  const test = globalThis.__weeklightUpdateTest;
  return {
    mode: test.mode, currentVersion: test.currentVersion, nextVersion: test.nextVersion,
    calls: test.calls, opens: test.opens, unexpected: test.unexpected
  };
});

async function installMocks(instance, mode) {
  return instance.evaluate(({ app, net, shell }, config) => {
    const currentVersion = app.getVersion();
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(currentVersion)) throw new Error('Test requires a stable current version');
    const parts = currentVersion.split('.').map(Number);
    if (!Number.isSafeInteger(parts[2] + 1)) throw new Error('Cannot construct a safe next patch version');
    const nextVersion = parts[0] + '.' + parts[1] + '.' + (parts[2] + 1);
    const test = {
      mode: config.mode, currentVersion, nextVersion, notes: config.notes,
      calls: [], opens: [], unexpected: []
    };
    globalThis.__weeklightUpdateTest = test;
    net.fetch = async (url, options = {}) => {
      test.calls.push({ url: String(url), method: options.method, mode: test.mode });
      if (String(url) !== config.apiUrl) {
        test.unexpected.push(String(url));
        throw new Error('Unexpected network target blocked by test');
      }
      const modeAtStart = test.mode;
      if (modeAtStart === 'offline') throw new Error('Simulated offline connection');
      const version = modeAtStart === 'current' ? currentVersion : nextVersion;
      const filename = 'OrangeSchedule-Setup-' + version + '.exe';
      const officialUrl = config.repositoryUrl + '/releases/download/v' + version + '/' + filename;
      const body = {
        tag_name: 'v' + version, draft: false, prerelease: false,
        body: test.notes, published_at: '2026-10-12T08:00:00Z',
        assets: [{
          name: filename, state: 'uploaded', size: 123456,
          browser_download_url: modeAtStart === 'malicious' ? 'https://invalid.example/fake-installer.exe' : officialUrl
        }]
      };
      return { status: 200, headers: { get: () => null }, json: async () => body };
    };
    shell.openExternal = async url => { test.opens.push(String(url)); };
    return { version: currentVersion, nextVersion, packaged: app.isPackaged, patchedAtUptimeMs: process.uptime() * 1000 };
  }, { mode, apiUrl, repositoryUrl, notes });
}

async function getMainPage(instance) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const page = instance.windows().find(item => item.url().endsWith('/index.html'));
    if (page) {
      page.on('pageerror', error => rendererErrors.push(error.message));
      await page.waitForSelector('.month-grid');
      await page.waitForSelector('#update-banner', { state: 'attached' });
      await page.waitForSelector('#setting-updates', { state: 'attached' });
      return page;
    }
    await sleep(30);
  }
  throw new Error('Main calendar window did not open');
}

async function blockRendererNetwork(instance) {
  await instance.context().route(/^https?:\/\//, route => {
    rendererRequests.push(route.request().url());
    return route.abort();
  });
}

async function setMode(instance, mode) {
  await instance.evaluate((_, value) => { globalThis.__weeklightUpdateTest.mode = value; }, mode);
}

async function waitForCalls(instance, minimum) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if ((await mockState(instance)).calls.length >= minimum) return;
    await sleep(25);
  }
  throw new Error('Expected mocked update request was not made');
}

async function checkViaUi(instance, page, phase) {
  const before = (await mockState(instance)).calls.length;
  await page.locator('#check-updates').click();
  await waitForCalls(instance, before + 1);
  await page.waitForFunction(async expected => (await window.weeklight.get()).update.phase === expected, phase);
  await page.waitForFunction(() => !document.querySelector('#check-updates').disabled);
  return (await readState(page)).update;
}

async function openSettings(page) {
  if (!await page.locator('#settings-dialog').evaluate(dialog => dialog.open)) {
    await page.locator('#settings-button').click();
  }
  await page.waitForSelector('#settings-dialog[open]');
}

async function closeSettings(page) {
  if (await page.locator('#settings-dialog').evaluate(dialog => dialog.open)) {
    await page.locator('#settings-dialog .close-dialog').click();
  }
  await page.waitForFunction(() => !document.querySelector('#settings-dialog').open);
}

async function setAutomaticUpdates(page, enabled) {
  await page.locator('#setting-updates').setChecked(enabled);
  await page.waitForFunction(async expected => {
    const state = await window.weeklight.get();
    return state.settings.checkUpdates === expected && !document.querySelector('#setting-updates').disabled;
  }, enabled);
  const saved = JSON.parse(await fs.readFile(path.join(dataDir, 'plans.json'), 'utf8'));
  assert.equal(saved.settings.checkUpdates, enabled);
}

async function clickDownload(instance, page, expectedUrl) {
  const before = (await mockState(instance)).opens.length;
  if (!await page.locator('#update-details').evaluate(details => details.open)) {
    await page.locator('#update-release-title').click();
  }
  await page.locator('#download-update').click();
  const deadline = Date.now() + 5000;
  while ((await mockState(instance)).opens.length === before && Date.now() < deadline) await sleep(20);
  const opens = (await mockState(instance)).opens;
  assert.equal(opens.length, before + 1);
  assert.equal(opens.at(-1), expectedUrl);
}

async function assertDownloadUnavailable(page) {
  const result = await page.evaluate(async () => {
    try { await window.weeklight.downloadUpdate('https://invalid.example/injected.exe'); return { allowed: true }; }
    catch (error) { return { allowed: false, message: error.message }; }
  });
  assert.equal(result.allowed, false);
  assert.match(result.message, /请先检查是否有可用更新/);
}

async function cleanup() {
  const target = path.resolve(dataDir);
  assert.equal(path.dirname(target), path.resolve(workRoot));
  assert(path.basename(target).startsWith('update-ui-'));
  const entry = await fs.lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!entry) return;
  assert.equal(entry.isSymbolicLink(), false);
  const [actualTarget, actualWork] = await Promise.all([fs.realpath(target), fs.realpath(workRoot)]);
  assert.equal(path.dirname(actualTarget), actualWork, 'Cleanup must remain inside _work');
  await fs.rm(target, { recursive: true, force: true });
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'plans.json'), JSON.stringify({
    version: 1, tasks: [], settings: { sound: false, popup: false, checkUpdates: false }, history: []
  }), 'utf8');
  let instance, main, metadata, failure;
  let cleaned = false;
  try {
    instance = await launch();
    metadata = await installMocks(instance, 'current');
    await blockRendererNetwork(instance);
    main = await getMainPage(instance);
    const initial = await readState(main);
    assert.equal(path.resolve(initial.dataDir), dataDir);
    assert.equal(initial.settings.checkUpdates, false);
    assert.equal(initial.update.phase, 'idle');
    assert.equal((await mockState(instance)).calls.length, 0);
    await openSettings(main);
    assert.equal(await main.locator('#setting-updates').isChecked(), false);
    assert((await main.locator('#update-current').innerText()).includes(metadata.version));
    checks.push('isolated data disables automatic checks and shows the actual application version');

    const current = await checkViaUi(instance, main, 'current');
    assert.equal(current.release, null);
    assert.match(await main.locator('#update-status').innerText(), /已是最新稳定版/);
    assert.equal(await main.locator('#update-details').evaluate(details => details.hidden), true);
    assert.equal(await main.locator('#update-banner').evaluate(banner => banner.hidden), true);
    await assertDownloadUnavailable(main);
    assert.equal((await mockState(instance)).opens.length, 0);
    checks.push('manual checking recognizes the current release and blocks downloads without an update');

    await setMode(instance, 'available');
    const available = await checkViaUi(instance, main, 'available');
    const expectedUrl = repositoryUrl + '/releases/download/v' + metadata.nextVersion + '/OrangeSchedule-Setup-' + metadata.nextVersion + '.exe';
    assert.equal(available.release.version, metadata.nextVersion);
    assert.equal(available.release.url, expectedUrl);
    await closeSettings(main);
    await main.locator('#update-banner').waitFor({ state: 'visible' });
    assert((await main.locator('#update-banner-title').innerText()).includes(metadata.nextVersion));
    await main.locator('#update-view').click();
    await main.waitForSelector('#settings-dialog[open]');
    assert.equal(await main.locator('#update-details').evaluate(details => details.open), true);
    assert.equal(await main.locator('#update-notes').textContent(), notes);
    assert.equal(await main.locator('#update-notes *').count(), 0);
    assert.equal(await main.evaluate(() => Boolean(window.__updateNotesExecuted)), false);
    await main.screenshot({ path: path.join(output, 'update-available.png') });
    checks.push('new stable versions show a banner whose details preserve release notes as inert text');

    await clickDownload(instance, main, expectedUrl);
    const previousOpens = (await mockState(instance)).opens.length;
    await main.evaluate(async () => {
      const snapshot = await window.weeklight.get();
      snapshot.update.release.url = 'https://invalid.example/mutated-snapshot.exe';
      await window.weeklight.downloadUpdate('javascript:alert(1)');
    });
    let native = await mockState(instance);
    assert.equal(native.opens.length, previousOpens + 1);
    assert.equal(native.opens.at(-1), expectedUrl);
    checks.push('download clicks and forged renderer arguments only open the last validated installer URL');

    await closeSettings(main);
    await main.locator('#update-later').click();
    await main.locator('#update-banner').waitFor({ state: 'hidden' });
    let state = await readState(main);
    assert.equal(state.update.dismissed, true);
    assert.equal(state.update.release.url, expectedUrl);
    await openSettings(main);
    assert.equal(await main.locator('#update-details').evaluate(details => details.hidden), false);
    await clickDownload(instance, main, expectedUrl);
    checks.push('later hides the banner while settings retain the release and download action');

    const rediscovered = await checkViaUi(instance, main, 'available');
    assert.equal(rediscovered.dismissed, false);
    await closeSettings(main);
    await main.locator('#update-banner').waitFor({ state: 'visible' });
    checks.push('a new manual check restores a previously dismissed prompt');

    await openSettings(main);
    await setMode(instance, 'offline');
    const offline = await checkViaUi(instance, main, 'error');
    assert.match(offline.error, /无法连接 GitHub/);
    assert.equal(offline.release.url, expectedUrl);
    assert.match(await main.locator('#update-status').innerText(), /无法连接 GitHub/);
    assert.equal(await main.locator('#update-details').evaluate(details => details.hidden), false);
    await clickDownload(instance, main, expectedUrl);
    checks.push('offline errors are readable and preserve a previously validated downloadable release');

    await setAutomaticUpdates(main, true);
    sessions.push(await mockState(instance));
    await instance.close();
    instance = null;

    instance = await launch();
    const second = await installMocks(instance, 'current');
    assert(second.patchedAtUptimeMs < 7000, 'Install network mocks before the startup update timer');
    await blockRendererNetwork(instance);
    main = await getMainPage(instance);
    await openSettings(main);
    assert.equal((await readState(main)).settings.checkUpdates, true);
    assert.equal(await main.locator('#setting-updates').isChecked(), true);
    await waitForCalls(instance, 1);
    await main.waitForFunction(async () => (await window.weeklight.get()).update.phase === 'current', null, { timeout: 12000 });
    native = await mockState(instance);
    assert.equal(native.calls.length, 1);
    assert.equal(native.calls[0].mode, 'current');
    assert.equal(native.opens.length, 0);
    checks.push('the enabled checkbox survives restart and the startup timer checks the mocked release once');

    await setAutomaticUpdates(main, false);
    sessions.push(await mockState(instance));
    await instance.close();
    instance = null;

    instance = await launch();
    await installMocks(instance, 'malicious');
    await blockRendererNetwork(instance);
    main = await getMainPage(instance);
    await openSettings(main);
    assert.equal((await readState(main)).settings.checkUpdates, false);
    assert.equal(await main.locator('#setting-updates').isChecked(), false);
    assert.equal((await mockState(instance)).calls.length, 0);
    assert.equal((await readState(main)).update.release, null);
    // Observe the startup timer before making any manual attempt that could throttle it.
    const disabledDeadline = Date.now() + 10000;
    while (await instance.evaluate(() => process.uptime() * 1000) < 8000 && Date.now() < disabledDeadline) await sleep(50);
    assert.equal((await mockState(instance)).calls.length, 0);
    assert.equal((await readState(main)).update.phase, 'idle');
    checks.push('the disabled checkbox survives restart and suppresses the automatic startup request');

    const malicious = await checkViaUi(instance, main, 'error');
    assert.match(malicious.error, /官方发布地址不一致/);
    assert.equal(malicious.release, null);
    assert.equal(await main.locator('#update-details').evaluate(details => details.hidden), true);
    assert.equal(await main.locator('#update-banner').evaluate(banner => banner.hidden), true);
    assert.equal(await main.locator('#download-update').isVisible(), false);
    await assertDownloadUnavailable(main);
    assert.equal((await mockState(instance)).opens.length, 0);
    checks.push('a foreign installer URL produces an error without a banner, download control or external navigation');

    native = await mockState(instance);
    assert.equal(native.calls.length, 1);
    sessions.push(native);
    assert(sessions.flatMap(session => session.calls).every(call => call.url === apiUrl && call.method === 'GET'));
    assert(sessions.every(session => session.unexpected.length === 0));
    assert(sessions.flatMap(session => session.opens).every(url => url === expectedUrl));
    assert.deepEqual(rendererErrors, []);
    assert.deepEqual(rendererRequests, []);
    checks.push('all update requests use the fixed mocked API and every external action is intercepted');
  } catch (error) {
    failure = error;
  } finally {
    try { if (instance) await instance.close(); } catch (error) { failure ||= error; }
    try { await cleanup(); cleaned = true; } catch (error) { failure ||= error; }
    const result = {
      passed: !failure, version: metadata?.version, packaged: metadata?.packaged,
      checks, sessions, rendererErrors, rendererRequests,
      isolatedDataRemoved: cleaned, error: failure?.message
    };
    await fs.writeFile(path.join(output, 'update-desktop-tests.json'), JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify(result));
  }
  if (failure) throw failure;
})().catch(error => { console.error(error); process.exitCode = 1; });
