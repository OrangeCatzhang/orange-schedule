const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const runFile = promisify(execFile);
const root = path.resolve(__dirname, '..');
const workRoot = path.join(root, '_work');
const dataDir = path.join(workRoot, 'startup-ui-' + randomUUID());
const testName = 'local.weeklight.startup-test-' + randomUUID();
const metadataConfig = require('../package.json');
const build = metadataConfig.build;
const { sanitizeFileName } = require('builder-util/out/filename');
const executableName = build.win?.executableName ?? build.executableName ?? (build.productName || metadataConfig.productName || metadataConfig.name);
const executable = process.env.WEEKLIGHT_EXECUTABLE ? path.resolve(process.env.WEEKLIGHT_EXECUTABLE)
  : process.env.WEEKLIGHT_STARTUP_DEVELOPMENT === '1' ? null
  : path.join(root, build.directories.output, 'win-unpacked', sanitizeFileName(executableName) + '.exe');
const env = { ...process.env, WEEKLIGHT_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], snapshots = [], rendererErrors = [];

async function originalStartupFingerprint() {
  const command = [
    "$key='local.weeklight.planner'",
    "$run=[Microsoft.Win32.Registry]::GetValue('HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',$key,$null)",
    "$approved=[Microsoft.Win32.Registry]::GetValue('HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',$key,$null)",
    "$matches=$false",
    "if($env:WEEKLIGHT_STARTUP_TEST_LEGACY){$candidate=$env:WEEKLIGHT_STARTUP_TEST_LEGACY;$quoted='\"'+$candidate+'\" --hidden';$plain=$candidate+' --hidden';$matches=($run -is [string]) -and ($run.Equals($quoted,[StringComparison]::OrdinalIgnoreCase) -or $run.Equals($plain,[StringComparison]::OrdinalIgnoreCase))}",
    "$serialized=[ordered]@{run=$run;approved=$approved}|ConvertTo-Json -Compress",
    "$sha=[System.Security.Cryptography.SHA256]::Create()",
    "$digest=[Convert]::ToBase64String($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($serialized)))",
    "$sha.Dispose()",
    "@{digest=$digest;migrationWouldMatch=$matches}|ConvertTo-Json -Compress"
  ].join('\n');
  const { stdout } = await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true, timeout: 10000, encoding: 'utf8',
    env: { ...process.env, WEEKLIGHT_STARTUP_TEST_LEGACY: executable ? path.join(path.dirname(executable), '周光.exe') : '' }
  });
  return JSON.parse(stdout.trim());
}
async function mainPage(instance) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const page = instance.windows().find(item => item.url().endsWith('/index.html'));
    if (page) { page.on('pageerror', error => rendererErrors.push(error.message)); await page.waitForSelector('.month-grid'); return page; }
    await sleep(50);
  }
  throw new Error('Main calendar did not open');
}
async function nativeState(instance) {
  return instance.evaluate(({ app }) => {
    const test = globalThis.__weeklightStartupTest;
    const matching = test.originalGet({ path: process.execPath, args: ['--hidden'] });
    const noArgs = test.originalGet({ path: process.execPath, args: [] });
    return {
      withHidden: matching.openAtLogin,
      withoutHidden: noArgs.openAtLogin,
      ownEntryEnabled: matching.launchItems?.find(item => item.name === test.name)?.enabled ?? null,
      scheduledStateMessages: test.scheduled,
      deliveredStateMessages: test.delivered
    };
  });
}
async function inspect(instance, page, label) {
  const snapshot = {
    label,
    checked: await page.locator('#setting-startup').isChecked(),
    disabled: await page.locator('#setting-startup').isDisabled(),
    response: await page.evaluate(async () => { const state = await window.weeklight.get(); return { autostart: state.autostart, packaged: state.packaged }; }),
    native: await nativeState(instance)
  };
  snapshots.push(snapshot);
  return snapshot;
}
async function clickStartup(page) {
  const before = await page.evaluate(() => window.__startupTestCompleted);
  await page.locator('#setting-startup').click();
  await page.waitForFunction(previous => window.__startupTestCompleted > previous, before);
}
async function waitDelayedMessages(instance) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const status = await nativeState(instance);
    if (status.scheduledStateMessages === status.deliveredStateMessages) return;
    await sleep(50);
  }
  throw new Error('Injected state messages did not drain');
}

(async () => {
  assert.equal(process.platform, 'win32', 'Startup integration tests require Windows');
  let instance, beforeFingerprint, metadata, failure;
  let cleanupSucceeded = false, originalStartupUnchanged = false;
  try {
    beforeFingerprint = await originalStartupFingerprint();
    assert.equal(beforeFingerprint.migrationWouldMatch, false, 'The test build could migrate a real startup entry; aborting before launch');
    instance = await electron.launch(executable ? { executablePath: executable, args: [], env } : { args: [root], env });
    const page = await mainPage(instance);
    metadata = await instance.evaluate(({ app, BrowserWindow }, name) => {
      const originalGet = app.getLoginItemSettings.bind(app);
      const originalSet = app.setLoginItemSettings.bind(app);
      const wasPackaged = app.isPackaged;
      app.setAppUserModelId(name);
      // Only this test process receives the packaged override. No production file is changed.
      if (!app.isPackaged) Object.defineProperty(app, 'isPackaged', { configurable: true, value: true });
      app.setLoginItemSettings = options => {
        const activeTest = globalThis.__weeklightStartupTest;
        if (activeTest?.suppressWrites) { activeTest.suppressedWrites++; return; }
        return originalSet({ ...options, name });
      };
      const main = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/index.html'));
      const originalSend = main.webContents.send.bind(main.webContents);
      const test = {
        name, originalGet, originalSet, originalSend, contents: main.webContents,
        delayMs: 0, scheduled: 0, delivered: 0, timers: new Set(), suppressWrites: false, suppressedWrites: 0
      };
      globalThis.__weeklightStartupTest = test;
      main.webContents.send = (channel, ...args) => {
        if (channel !== 'state' || !test.delayMs) return originalSend(channel, ...args);
        test.scheduled++;
        const timer = setTimeout(() => {
          test.timers.delete(timer);
          if (!main.webContents.isDestroyed()) originalSend(channel, ...args);
          test.delivered++;
        }, test.delayMs);
        test.timers.add(timer);
      };
      originalSet({ openAtLogin: false, path: process.execPath, args: ['--hidden'], name });
      return { version: app.getVersion(), actualPackagedBuild: wasPackaged };
    }, testName);
    // Refresh the renderer snapshot after assigning the isolated startup identity.
    await page.evaluate(() => window.weeklight.settings({ sound: true }));
    await page.locator('#settings-button').click();
    await page.waitForFunction(() => !document.querySelector('#setting-startup').disabled);
    await page.evaluate(() => {
      const input = document.querySelector('#setting-startup');
      const original = input.onchange;
      window.__startupTestCompleted = 0;
      window.__startupTestBusyStates = [];
      input.onchange = async function (event) {
        try {
          const pending = original.call(this, event);
          window.__startupTestBusyStates.push(['sound', 'popup', 'startup'].map(id => document.querySelector('#setting-' + id).disabled));
          return await pending;
        }
        finally { window.__startupTestCompleted++; }
      };
    });
    const initial = await inspect(instance, page, 'initial');
    assert.equal(initial.checked, false);
    assert.equal(initial.disabled, false);
    assert.equal(initial.native.withHidden, false);

    await clickStartup(page);
    await page.waitForFunction(() => document.querySelector('#setting-startup').checked === true);
    const enabled = await inspect(instance, page, 'normal enable');
    assert.equal(enabled.response.autostart, true);
    assert.equal(enabled.native.withHidden, true);
    assert.equal(enabled.native.withoutHidden, false);
    assert.equal(enabled.native.ownEntryEnabled, true);
    checks.push('enabling writes only the test startup item and the exact path/--hidden query reads true');

    await page.locator('#settings-dialog .close-dialog').click();
    await page.locator('#settings-button').click();
    await page.waitForFunction(() => !document.querySelector('#setting-startup').disabled);
    assert.equal(await page.locator('#setting-startup').isChecked(), true);
    checks.push('reopening settings preserves the enabled checkbox');

    await clickStartup(page);
    await page.waitForFunction(() => document.querySelector('#setting-startup').checked === false);
    const disabled = await inspect(instance, page, 'normal disable');
    assert.equal(disabled.response.autostart, false);
    assert.equal(disabled.native.withHidden, false);
    assert.equal(disabled.native.ownEntryEnabled, null);
    checks.push('disabling removes the test startup item and reads false');

    await instance.evaluate(() => { globalThis.__weeklightStartupTest.delayMs = 1500; });
    await clickStartup(page);
    const delayedEnable = await inspect(instance, page, 'enable before delayed state broadcast');
    assert.equal(delayedEnable.native.withHidden, true, 'Native startup registration should already be enabled');
    assert.equal(delayedEnable.response.autostart, true, 'The main process response should report the successful write');
    assert(delayedEnable.native.scheduledStateMessages > delayedEnable.native.deliveredStateMessages, 'The broadcast must still be delayed to exercise the race');
    assert.equal(delayedEnable.checked, true, 'Startup checkbox bounced back before the delayed state broadcast despite a successful native write');
    checks.push('enabling uses the invoke result immediately while state broadcasts are delayed');

    await waitDelayedMessages(instance);
    await clickStartup(page);
    const delayedDisable = await inspect(instance, page, 'disable before delayed state broadcast');
    assert.equal(delayedDisable.native.withHidden, false);
    assert.equal(delayedDisable.response.autostart, false);
    assert(delayedDisable.native.scheduledStateMessages > delayedDisable.native.deliveredStateMessages);
    assert.equal(delayedDisable.checked, false, 'Startup checkbox bounced back to enabled while its state broadcast was delayed');
    checks.push('disabling uses the invoke result immediately while state broadcasts are delayed');
    await waitDelayedMessages(instance);
    await instance.evaluate(() => { globalThis.__weeklightStartupTest.delayMs = 0; });
    await page.locator('#settings-dialog .close-dialog').click();
    await page.locator('#settings-button').click();
    await page.waitForFunction(() => !document.querySelector('#setting-startup').disabled);
    assert.equal(await page.locator('#setting-startup').isChecked(), false);
    checks.push('reopening settings preserves the disabled checkbox');

    await instance.evaluate(() => { globalThis.__weeklightStartupTest.suppressWrites = true; });
    await clickStartup(page);
    const rejected = await inspect(instance, page, 'silent native write refusal');
    assert.equal(rejected.checked, false);
    assert.equal(rejected.disabled, false);
    assert.equal(rejected.response.autostart, false);
    assert.equal(rejected.native.withHidden, false);
    assert.equal(await instance.evaluate(() => globalThis.__weeklightStartupTest.suppressedWrites), 1);
    const error = page.locator('#settings-error');
    assert.equal(await error.getAttribute('role'), 'alert');
    assert.equal(await error.isVisible(), true);
    assert.match(await error.textContent(), /Windows.*(保存|启动)/);
    checks.push('a silently rejected native write shows an inline error and restores the unchecked, enabled control');

    await instance.evaluate(() => { globalThis.__weeklightStartupTest.suppressWrites = false; });
    await clickStartup(page);
    const retried = await inspect(instance, page, 'retry after native write refusal');
    assert.equal(retried.checked, true);
    assert.equal(retried.native.withHidden, true);
    assert.equal((await error.textContent()).trim(), '');
    await clickStartup(page);
    assert.equal((await nativeState(instance)).withHidden, false);
    checks.push('restoring native writes allows a successful retry and clears the error');
    const busyStates = await page.evaluate(() => window.__startupTestBusyStates);
    assert(busyStates.length >= 6);
    assert(busyStates.every(states => states.every(Boolean)), 'All three switches should be disabled while a settings save is pending');
    assert.equal(await page.locator('#setting-sound').isDisabled(), false);
    assert.equal(await page.locator('#setting-popup').isDisabled(), false);
    assert.equal(await page.locator('#setting-startup').isDisabled(), false);
    checks.push('all settings switches disable during saves and recover afterwards');
    assert.deepEqual(rendererErrors, []);
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (instance) {
        cleanupSucceeded = await instance.evaluate(({ app }, name) => {
          const test = globalThis.__weeklightStartupTest;
          if (!test) return true;
          if (test.name !== name || !name.startsWith('local.weeklight.startup-test-')) throw new Error('Unsafe startup cleanup identity');
          for (const timer of test.timers) clearTimeout(timer);
          test.contents.send = test.originalSend;
          test.originalSet({ openAtLogin: false, path: process.execPath, args: ['--hidden'], name });
          const remaining = test.originalGet({ path: process.execPath, args: ['--hidden'] });
          return !remaining.openAtLogin && !remaining.launchItems?.some(item => item.name === name);
        }, testName);
        assert.equal(cleanupSucceeded, true, 'The isolated startup registration must be removed before exit');
      }
    } catch (error) { failure ||= error; }
    finally { if (instance) await instance.close(); }
    try {
      if (beforeFingerprint) {
        const after = await originalStartupFingerprint();
        originalStartupUnchanged = after.digest === beforeFingerprint.digest;
        assert.equal(originalStartupUnchanged, true, 'The real application startup values must remain unchanged');
      }
    } catch (error) { failure ||= error; }
    const target = path.resolve(dataDir);
    assert.equal(path.dirname(target), path.resolve(workRoot));
    assert(path.basename(target).startsWith('startup-ui-'));
    await fs.rm(target, { recursive: true, force: true });
    const version = String(metadata?.version || 'unknown').replace(/[^0-9A-Za-z.-]/g, '_');
    const report = path.join(root, 'outputs', 'verification', 'startup-desktop-' + version + '-' + (executable ? 'packaged' : 'development') + '.json');
    const result = { passed: !failure, version: metadata?.version, actualPackagedBuild: metadata?.actualPackagedBuild, checks, snapshots, rendererErrors, testStartupItemRemoved: cleanupSucceeded, originalStartupUnchanged, error: failure?.message };
    await fs.mkdir(path.dirname(report), { recursive: true });
    await fs.writeFile(report, JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify(result));
  }
  if (failure) throw failure;
})().catch(error => { console.error(error); process.exitCode = 1; });
