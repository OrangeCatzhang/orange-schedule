const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..'), workRoot = path.join(root, '_work');
const dataDir = path.join(workRoot, 'language-ui-' + randomUUID());
const output = path.join(root, 'outputs', 'verification');
const env = { ...process.env, WEEKLIGHT_DATA_DIR: dataDir }; delete env.ELECTRON_RUN_AS_NODE;
const guards = ['--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9'];
const date = (new Date().getFullYear() + 1) + '-06-10';
const originalTitle = '保留中文计划 · User content', originalNotes = '这些用户备注保持原样';
const seedTasks = Array.from({ length: 3 }, (_, i) => ({ id: 'language-series-' + i, title: originalTitle,
  date: date.slice(0, -2) + String(10 + i), time: '09:00', duration: 35, category: 'study', reminder: -1,
  notes: originalNotes, priority: 'normal', done: false, createdAt: 1700000000000, updatedAt: 1700000000000,
  seriesId: 'language-series', seriesIndex: i }));
const checks = [], errors = [], geometry = [], sessions = [];
let app;
const originalDetails = tasks => tasks.map(task => Object.fromEntries(Object.keys(seedTasks[0]).filter(key => key !== 'updatedAt').map(key => [key, task[key]])));
const readState = page => page.evaluate(() => window.weeklight.get());
const track = page => page.on('pageerror', error => errors.push(error.message));
async function pageFor(suffix, selector) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const page = app.windows().find(item => item.url().endsWith(suffix));
    if (page) { track(page); await page.waitForSelector(selector, { state: 'attached' }); return page; }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('Missing language-test window: ' + suffix);
}
async function launch() {
  app = await electron.launch(process.env.WEEKLIGHT_EXECUTABLE
    ? { executablePath: path.resolve(process.env.WEEKLIGHT_EXECUTABLE), args: guards, env }
    : { args: [root, ...guards], env });
  await app.evaluate(({ Notification, net, shell, app }) => {
    globalThis.__languageSafety = { notifications: 0, fetches: [], external: [], startup: [] };
    // Returning false prevents Electron from constructing a notification and creating a system shortcut.
    Notification.isSupported = () => { globalThis.__languageSafety.notifications++; return false; };
    net.fetch = async url => { globalThis.__languageSafety.fetches.push(String(url)); throw new Error('Network blocked by language test'); };
    shell.openExternal = async url => { globalThis.__languageSafety.external.push(String(url)); };
    app.setLoginItemSettings = settings => { globalThis.__languageSafety.startup.push(settings); throw new Error('Startup writes blocked by language test'); };
  });
  app.on('window', track);
  await app.context().route(/^https?:\/\//, route => route.abort());
  const main = await pageFor('/index.html', '.month-grid');
  assert.equal(path.resolve((await readState(main)).dataDir), dataDir);
  return main;
}
async function closeSession() {
  const safety = await app.evaluate(() => globalThis.__languageSafety);
  assert.deepEqual(safety.fetches, []); assert.deepEqual(safety.external, []); assert.deepEqual(safety.startup, []);
  sessions.push(safety); await app.close(); app = null;
}
async function switchLanguage(page, language, windows) {
  await page.evaluate(value => window.weeklight.settings({ language: value }), language);
  for (const target of windows) await target.waitForFunction(value => document.documentElement.lang === value, language);
}
async function expectNoUntranslatedText(page) {
  const found = await page.evaluate(({ originalTitle, originalNotes }) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), found = []; let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement, text = node.textContent.trim();
      if (!text || !/[\u4e00-\u9fff]/.test(text) || !parent?.getClientRects().length) continue;
      if (parent.closest('script,style,option[value="zh-CN"]') || text === originalTitle || text === originalNotes) continue;
      found.push(text);
    }
    return found;
  }, { originalTitle, originalNotes });
  assert.deepEqual(found, [], 'Visible product copy must be English: ' + page.url());
}
async function setSize(page, width, height) {
  const window = await app.browserWindow(page); await window.evaluate((window, size) => window.setSize(...size), [width, height]);
  await page.waitForFunction(() => document.readyState === 'complete');
}
async function inspectGeometry(page, selectors, name) {
  const measured = await page.evaluate(selectors => selectors.map(selector => {
    const node = document.querySelector(selector), box = node.getBoundingClientRect();
    return { selector, scroll: node.scrollWidth, client: node.clientWidth, width: box.width, height: box.height };
  }), selectors);
  assert(measured.every(item => item.scroll <= item.client + 1), name + ' must not overflow horizontally');
  geometry.push({ name, measured });
}
const editorDraft = page => page.evaluate(() => ({ values: Object.fromEntries(new FormData(document.querySelector('#task-form'))),
  focus: document.activeElement.name, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }));
async function cleanup() {
  assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(workRoot));
  assert(path.basename(dataDir).startsWith('language-ui-'));
  const item = await fs.lstat(dataDir); assert.equal(item.isSymbolicLink(), false);
  assert.equal(path.dirname(await fs.realpath(dataDir)), await fs.realpath(workRoot));
  await fs.rm(dataDir, { recursive: true, force: true });
}
(async () => {
  await fs.mkdir(output, { recursive: true }); await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'plans.json'), JSON.stringify({ version: 1, tasks: seedTasks,
    settings: { language: 'zh-CN', sound: false, popup: true, checkUpdates: false, widget: { enabled: false, anchor: date, onTop: false } },
    history: [{ id: 'language-history', taskId: seedTasks[0].id, at: 1700000000000, dismissed: false }] }), 'utf8');
  let failure, version;
  try {
    let main = await launch(); version = await app.evaluate(({ app }) => app.getVersion());
    assert.equal(await main.locator('#page-title').innerText(), '计划日历');
    await main.locator('#settings-button').click(); await main.locator('#setting-language').selectOption('en');
    await main.waitForFunction(() => document.documentElement.lang === 'en');
    assert.equal((await readState(main)).settings.language, 'en');
    await expectNoUntranslatedText(main); await main.locator('#settings-dialog .close-dialog').click();
    await main.evaluate(() => window.weeklight.openWidget()); let widget = await pageFor('/widget.html', '#widget-title');
    await main.evaluate(() => window.weeklight.testReminder()); let reminder = await pageFor('/reminder.html', '#quote-text[data-id]');
    for (const page of [main, widget, reminder]) { assert.equal(await page.locator('html').getAttribute('lang'), 'en'); await expectNoUntranslatedText(page); }
    assert.equal(await reminder.locator('#quote-count').innerText(), '120 quotes');
    assert(/[A-Za-z]/.test(await reminder.locator('#quote-text').innerText()));
    checks.push('Saved language setting updates main calendar, widget, reminder, update copy, and quotes');

    await setSize(main, 1050, 720); await setSize(widget, 340, 380); await setSize(reminder, 400, 440);
    await inspectGeometry(main, ['.sidebar', '.workspace', '.planner', '.calendar-toolbar', '.summary', '.page-header'], '1050px calendar');
    await inspectGeometry(widget, ['.widget', '.widget-chrome', '.widget-controls', '.quick-options'], '340px widget');
    await inspectGeometry(reminder, ['.reminder-window', '.reminder-quote', '.reminder-footer'], '400px reminder');
    const reminderLayout = await reminder.evaluate(() => ({ listHeight: document.querySelector('#reminders').getBoundingClientRect().height,
      footerBottom: document.querySelector('.reminder-footer').getBoundingClientRect().bottom, height: innerHeight }));
    assert(reminderLayout.listHeight > 60); assert(reminderLayout.footerBottom <= reminderLayout.height + 1);
    let minimumQuoteSpace = { listHeight: Infinity };
    const quoteIds = new Set([await reminder.locator('#quote-text').getAttribute('data-id')]);
    for (let i = 0; i < 120; i++) {
      const next = await reminder.evaluate(() => window.weeklight.nextReminderMessage());
      await reminder.waitForFunction(id => document.querySelector('#quote-text').dataset.id === id, next.reminderMessage.id);
      const measured = await reminder.evaluate(() => ({ id: document.querySelector('#quote-text').dataset.id,
        listHeight: document.querySelector('#reminders').getBoundingClientRect().height,
        footerBottom: document.querySelector('.reminder-footer').getBoundingClientRect().bottom, height: innerHeight }));
      if (measured.listHeight < minimumQuoteSpace.listHeight) minimumQuoteSpace = measured;
      assert(measured.listHeight > 60, 'Long English quote must leave room for task actions: ' + measured.id);
      assert(measured.footerBottom <= measured.height + 1); quoteIds.add(measured.id);
    }
    assert.equal(quoteIds.size, 120);
    geometry.push({ name: 'English quote catalog at 400×440', uniqueQuotes: quoteIds.size, minimumQuoteSpace });
    const widgetLayout = await widget.evaluate(() => ({ listHeight: document.querySelector('.task-scroll').getBoundingClientRect().height,
      footerBottom: document.querySelector('.widget-footer').getBoundingClientRect().bottom, height: innerHeight }));
    assert(widgetLayout.listHeight > 10); assert(widgetLayout.footerBottom <= widgetLayout.height + 1);
    await main.screenshot({ path: path.join(output, 'language-calendar-minimum-en.png') });
    await widget.screenshot({ path: path.join(output, 'language-widget-minimum-en.png') });
    await reminder.screenshot({ path: path.join(output, 'language-reminder-minimum-en.png') });
    checks.push('English labels fit 1050px calendar, 340px widget, and 400px reminder minimum sizes');

    await main.locator('.new-button').click(); await main.locator('#task-form [name=title]').fill(originalTitle);
    await main.locator('#task-form [name=notes]').fill(originalNotes); await main.locator('#task-form [name=date]').fill(date);
    await main.locator('#task-form [name=date]').dispatchEvent('change'); await main.locator('#task-form [name=repeat]').selectOption('weekdays');
    await main.locator('#task-form [name=repeatUntil]').fill(date.slice(0, -2) + '25'); await main.locator('#task-form [name=repeatUntil]').dispatchEvent('change');
    await main.locator('#task-form [name=title]').focus(); await main.locator('#task-form [name=title]').evaluate(input => input.setSelectionRange(2, 7));
    const draft = await editorDraft(main);
    await switchLanguage(widget, 'zh-CN', [main, widget, reminder]); assert.deepEqual(await editorDraft(main), draft);
    assert.equal(await main.locator('#editor-title').innerText(), '新建计划'); assert.equal(await reminder.locator('#quote-count').innerText(), '120 条名句');
    await switchLanguage(widget, 'en', [main, widget, reminder]); assert.deepEqual(await editorDraft(main), draft);
    assert.equal(await main.locator('#editor-title').innerText(), 'New task');
    await main.locator('#editor .close-dialog').first().click();
    checks.push('Cross-window switching preserves every unsaved editor field, focus, and text selection');

    await widget.locator('#quick-form [name=title]').fill('Quick draft 保持');
    await widget.locator('#quick-form [name=time]').fill('17:45'); await widget.locator('#quick-form [name=reminder]').selectOption('10');
    await widget.locator('#quick-form [name=title]').focus(); await widget.locator('#quick-form [name=title]').evaluate(input => input.setSelectionRange(3, 8));
    const quick = () => widget.evaluate(() => ({ values: Object.fromEntries(new FormData(document.querySelector('#quick-form'))),
      focus: document.activeElement.name, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }));
    const quickDraft = await quick(); await switchLanguage(main, 'zh-CN', [main, widget, reminder]); assert.deepEqual(await quick(), quickDraft);
    await switchLanguage(main, 'en', [main, widget, reminder]); assert.deepEqual(await quick(), quickDraft);
    checks.push('Widget quick-add text, reminder selection, time, focus, and selection survive language changes');

    await main.locator('[data-mode=list]').click(); await main.locator('#jump-date').fill(date); await main.locator('#jump-date').dispatchEvent('change');
    await main.locator('#calendar [data-toggle="' + seedTasks[0].id + '"]').click(); await main.waitForSelector('#task-action-dialog[open]');
    await main.locator('[name=task-action-scope][value=following]').check(); const beforeAction = (await readState(main)).tasks;
    await switchLanguage(widget, 'zh-CN', [main, widget, reminder]); assert.equal(await main.locator('[name=task-action-scope][value=following]').isChecked(), true);
    await switchLanguage(widget, 'en', [main, widget, reminder]); assert.equal(await main.locator('[name=task-action-scope][value=following]').isChecked(), true);
    await expectNoUntranslatedText(main); await main.locator('#task-action-cancel').click();
    assert.deepEqual((await readState(main)).tasks, beforeAction);
    checks.push('An open recurring-task dialog changes language without resetting scope or changing tasks');

    const stale = await main.evaluate(async task => {
      const next = await window.weeklight.saveTask(task, 1); return next.tasks.find(item => item.title === task.title);
    }, { title: 'Stale editor probe', date, time: '10:00', duration: 30, reminder: -1, category: 'work', notes: '' });
    await main.locator('#calendar [data-task="' + stale.id + '"]').click();
    await main.waitForFunction(() => document.querySelector('#editor').open);
    await widget.evaluate(id => window.weeklight.deleteTask(id), stale.id);
    await main.locator('#task-form [type=submit]').click();
    await main.waitForFunction(() => document.querySelector('#form-error').textContent.length > 0);
    const errorEn = await main.locator('#form-error').innerText(); assert(!/[\u4e00-\u9fff]/.test(errorEn));
    const errorDraft = await editorDraft(main);
    await switchLanguage(widget, 'zh-CN', [main, widget, reminder]);
    assert.equal(await main.locator('#form-error').innerText(), '计划已被删除，无法保存旧编辑内容');
    assert.deepEqual(await editorDraft(main), errorDraft);
    await switchLanguage(widget, 'en', [main, widget, reminder]);
    assert.equal(await main.locator('#form-error').innerText(), errorEn); assert.deepEqual(await editorDraft(main), errorDraft);
    await main.locator('#editor .close-dialog').first().click();
    checks.push('An existing stale-editor error retranslates in both directions without resetting the draft');

    const invalid = await main.evaluate(async () => { try { await window.weeklight.saveTask({ title: '', date: 'bad', time: '09:00' }, 1); return ''; } catch (error) { return error.message; } });
    assert(invalid && !/[\u4e00-\u9fff]/.test(invalid));
    await main.locator('#settings-button').click(); await main.locator('#load-samples').click(); await main.waitForFunction(() => !document.querySelector('#settings-dialog').open);
    let state = await readState(main); const samples = state.tasks.filter(task => !task.id.startsWith('language-series-'));
    assert.equal(samples.length, 12); assert(samples.every(task => task.title.startsWith('[Sample] ') && !/[\u4e00-\u9fff]/.test(task.title + task.notes)));
    assert.deepEqual(originalDetails(state.tasks.filter(task => task.id.startsWith('language-series-'))), originalDetails(seedTasks));
    checks.push('English validation and newly loaded samples are translated; existing Chinese task data is unchanged');

    const rotation = state.settings.reminderRotation; await closeSession(); main = await launch();
    assert.equal((await readState(main)).settings.language, 'en'); assert.equal(await main.locator('#page-title').innerText(), 'Calendar');
    assert.deepEqual((await readState(main)).settings.reminderRotation, rotation);
    widget = await pageFor('/widget.html', '#widget-title'); assert.equal(await widget.locator('html').getAttribute('lang'), 'en');
    await main.evaluate(() => window.weeklight.testReminder()); reminder = await pageFor('/reminder.html', '#quote-text[data-id]');
    for (const page of [main, widget, reminder]) await expectNoUntranslatedText(page);
    state = await readState(main); assert.deepEqual(originalDetails(state.tasks.filter(task => task.id.startsWith('language-series-'))), originalDetails(seedTasks));
    await main.locator('#settings-button').click(); await main.locator('#load-samples').click(); await main.waitForFunction(() => !document.querySelector('#settings-dialog').open);
    assert.equal((await readState(main)).tasks.length, 15);
    await switchLanguage(main, 'zh-CN', [main, widget, reminder]); await main.locator('#settings-button').click(); await main.locator('#load-samples').click();
    await main.waitForFunction(() => !document.querySelector('#settings-dialog').open); assert.equal((await readState(main)).tasks.length, 15);
    await switchLanguage(main, 'en', [main, widget, reminder]);
    checks.push('Restart restores English across windows and quote rotation; sample loading is idempotent across languages');
    assert.deepEqual(errors, []); await closeSession();
  } catch (error) { failure = error; } finally {
    if (app) await app.close(); await cleanup();
    const result = { passed: !failure, version, checks, geometry, sessions, rendererErrors: errors, cleaned: true, failure: failure?.stack };
    await fs.writeFile(path.join(output, 'language-desktop.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  }
  if (failure) throw failure;
})().catch(error => { console.error(error); process.exitCode = 1; });
