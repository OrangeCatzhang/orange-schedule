const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workRoot = path.join(root, '_work');
const dataDir = path.join(workRoot, 'widget-ui-' + Date.now());
const output = path.join(root, 'outputs', 'verification');
const env = { ...process.env, WEEKLIGHT_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch(process.env.WEEKLIGHT_EXECUTABLE
  ? { executablePath: path.resolve(process.env.WEEKLIGHT_EXECUTABLE), args: [], env }
  : { args: [root], env });
const errors = [];
const checks = [];
const record = label => checks.push(label);
const track = page => page.on('pageerror', error => errors.push(error.message));
const state = page => page.evaluate(() => window.weeklight.get());
const prefs = (page, patch) => page.evaluate(value => window.weeklight.widgetSettings(value), patch);
const save = (page, task) => page.evaluate(value => window.weeklight.saveTask(value, 1), task);
const windowInfo = (app, suffix) => app.evaluate(({ BrowserWindow }, suffix) => {
  const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith(suffix));
  return window ? { visible: window.isVisible(), onTop: window.isAlwaysOnTop(), bounds: window.getBounds() } : null;
}, suffix);

async function count(page, selector, expected) {
  await page.waitForFunction(({ selector, expected }) => document.querySelectorAll(selector).length === expected, { selector, expected });
  assert.equal(await page.locator(selector).count(), expected);
}
async function openWidget(app, page) {
  const created = app.waitForEvent('window');
  await page.evaluate(() => window.weeklight.openWidget());
  const widget = await created;
  track(widget);
  await widget.waitForSelector('#widget-title');
  return widget;
}
async function getMainWindow(app) {
  const deadline = Date.now() + 10000;
  let page;
  while (!page && Date.now() < deadline) {
    page = app.windows().find(item => item.url().endsWith('/index.html'));
    if (!page) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert(page, 'Main calendar window should exist');
  return page;
}
async function getRestoredWidget(app) {
  const deadline = Date.now() + 10000;
  let widget;
  while (!widget && Date.now() < deadline) {
    widget = app.windows().find(page => page.url().endsWith('/widget.html'));
    if (!widget) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert(widget, 'Enabled widget should reopen during startup');
  track(widget);
  await widget.waitForSelector('#widget-title');
  return widget;
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  let app;
  try {
    app = await launch();
    let main = await getMainWindow(app);
    track(main);
    await main.waitForSelector('.month-grid');
    assert.equal((await state(main)).settings.widget.enabled, false);
    assert.equal(await windowInfo(app, '/widget.html'), null);
    record('legacy default leaves desktop widget closed');

    const draft = { time: '09:00', duration: 30, category: 'work', reminder: -1 };
    for (const task of [
      { title: '完成跨年提案', date: '2026-12-28' },
      { title: '阅读并做好笔记', date: '2026-12-28', category: 'study', done: true },
      { title: '傍晚散步', date: '2026-12-28', category: 'life', time: '18:00' },
      { title: '学习新的课程', date: '2026-12-30', category: 'study' },
      { title: '上一周的计划', date: '2026-12-27' },
      { title: '下一周的计划', date: '2027-01-04' }
    ]) await save(main, { ...draft, ...task });
    await prefs(main, { anchor: '2026-12-28', mode: 'day' });
    let widget = await openWidget(app, main);
    await count(widget, '#pending-list [data-toggle]', 2);
    await count(widget, '#done-list [data-toggle]', 1);
    assert.equal((await state(main)).settings.widget.enabled, true);
    await widget.screenshot({ path: path.join(output, 'widget-day.png') });
    record('daily pending and completed lists');

    await widget.locator('button[data-mode=week]').click();
    await count(widget, '#pending-list [data-toggle]', 3);
    await count(widget, '#done-list [data-toggle]', 1);
    assert.equal((await state(main)).settings.widget.mode, 'week');
    await widget.screenshot({ path: path.join(output, 'widget-week.png') });
    record('Monday to Sunday week spanning New Year');

    await widget.locator('#widget-category').selectOption('study');
    await count(widget, '#pending-list [data-toggle]', 1);
    await count(widget, '#done-list [data-toggle]', 1);
    assert((await widget.locator('#pending-list').textContent()).includes('学习新的课程'));
    record('category filters both task groups');
    await widget.locator('#widget-category').selectOption('all');

    const task = (await state(main)).tasks.find(item => item.title === '完成跨年提案');
    await widget.locator('#pending-list [data-toggle="' + task.id + '"]').click();
    await count(widget, '#pending-list [data-toggle]', 2);
    await count(widget, '#done-list [data-toggle]', 2);
    assert.equal((await state(main)).tasks.find(item => item.id === task.id).done, true);
    await main.evaluate(id => window.weeklight.toggleTask(id), task.id);
    await count(widget, '#pending-list [data-toggle]', 3);
    await count(widget, '#done-list [data-toggle]', 1);
    record('complete and undo synchronize in both windows');

    await widget.locator('#pending-list [data-edit="' + task.id + '"]').click();
    await main.waitForSelector('#editor[open]');
    assert.equal(await main.locator('#editor [name=title]').inputValue(), task.title);
    // Keep the editor open while another window changes the completion state.
    await widget.locator('#pending-list [data-toggle="' + task.id + '"]').click();
    await count(widget, '#done-list [data-toggle]', 2);
    assert.equal((await state(main)).tasks.find(item => item.id === task.id).done, true);
    await main.locator('#editor [name=title]').fill('修改后的跨年提案');
    await main.locator('#editor [type=submit]').click();
    await main.waitForFunction(() => !document.querySelector('#editor').open);
    await widget.waitForFunction(() => document.querySelector('#done-list').textContent.includes('修改后的跨年提案'));
    assert.equal((await state(main)).tasks.find(item => item.id === task.id).done, true);
    record('editing from widget opens main editor and broadcasts changes');
    record('saving an open editor preserves completion changed in the widget');

    // Exercise the opposite direction, then leave the original pending counts restored.
    await widget.locator('#done-list [data-edit="' + task.id + '"]').click();
    await main.waitForSelector('#editor[open]');
    await widget.locator('#done-list [data-toggle="' + task.id + '"]').click();
    await count(widget, '#pending-list [data-toggle]', 3);
    assert.equal((await state(main)).tasks.find(item => item.id === task.id).done, false);
    await main.locator('#editor [name=title]').fill('撤销完成后修改的跨年提案');
    await main.locator('#editor [type=submit]').click();
    await main.waitForFunction(() => !document.querySelector('#editor').open);
    await widget.waitForFunction(() => document.querySelector('#pending-list').textContent.includes('撤销完成后修改的跨年提案'));
    assert.equal((await state(main)).tasks.find(item => item.id === task.id).done, false);
    await count(widget, '#pending-list [data-toggle]', 3);
    await count(widget, '#done-list [data-toggle]', 1);
    record('saving an open editor preserves undo-completion changed in the widget');

    await widget.locator('button[data-mode=day]').click();
    await widget.locator('#widget-next').click();
    await count(widget, '#pending-list [data-toggle]', 0);
    assert.equal((await state(main)).settings.widget.anchor, '2026-12-29');
    await widget.locator('#widget-prev').click();
    await count(widget, '#pending-list [data-toggle]', 2);
    await widget.locator('#widget-today').click();
    assert.equal((await state(main)).settings.widget.anchor, null);
    await widget.locator('#widget-date').fill('2026-12-28');
    await widget.locator('#widget-date').dispatchEvent('change');
    await count(widget, '#pending-list [data-toggle]', 2);
    record('date navigation, today-following mode and chosen date');

    await widget.locator('#quick-form [name=title]').fill('便签直接添加的事项');
    await widget.locator('#quick-form [name=date]').fill('2026-12-28');
    await widget.locator('#quick-form [name=time]').fill('14:30');
    await widget.locator('#quick-form [name=reminder]').selectOption('-1');
    await widget.locator('#quick-form').evaluate(form => form.requestSubmit());
    await count(widget, '#pending-list [data-toggle]', 3);
    const quick = (await state(main)).tasks.find(item => item.title === '便签直接添加的事项');
    assert(quick);
    assert.equal(quick.date, '2026-12-28');
    assert.equal(quick.time, '14:30');
    assert.equal(quick.reminder, -1);
    record('quick capture writes the shared plan data');

    assert.equal(await widget.locator('#widget-pin').getAttribute('aria-pressed'), 'false');
    await widget.locator('#widget-pin').click();
    await widget.waitForFunction(() => document.querySelector('#widget-pin').getAttribute('aria-pressed') === 'true');
    assert.equal((await windowInfo(app, '/widget.html')).onTop, true);
    await widget.locator('#widget-preferences').click();
    await widget.locator('.swatches [data-theme=lavender]').click();
    await widget.locator('#show-completed').uncheck();
    await widget.locator('#done-list').waitFor({ state: 'hidden' });
    await widget.locator('#show-completed').check();
    await widget.locator('#widget-preferences').click();
    await widget.locator('#done-list').waitFor({ state: 'visible' });
    record('always on top and completed visibility controls');

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith('/widget.html')).setBounds({ x: 120, y: 100, width: 400, height: 650 }));
    let persistedBounds;
    const saveDeadline = Date.now() + 10000;
    while (Date.now() < saveDeadline) {
      persistedBounds = (await state(main)).settings.widget.bounds;
      if (persistedBounds?.width === 400 && persistedBounds?.height === 650 && persistedBounds?.x === 120 && persistedBounds?.y === 100) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.deepEqual(persistedBounds, { x: 120, y: 100, width: 400, height: 650 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith('/index.html')).close());
    assert.equal((await windowInfo(app, '/index.html')).visible, false);
    assert.equal((await windowInfo(app, '/widget.html')).visible, true);
    await widget.locator('#widget-open-main').click();
    assert.equal((await windowInfo(app, '/index.html')).visible, true);
    record('closing main window leaves widget active and widget reopens main');

    await app.close();
    app = null;
    app = await launch();
    main = await getMainWindow(app);
    track(main);
    await main.waitForSelector('.month-grid');
    widget = await getRestoredWidget(app);
    const restored = (await state(main)).settings.widget;
    assert.equal(restored.enabled, true);
    assert.equal(restored.mode, 'day');
    assert.equal(restored.anchor, '2026-12-28');
    assert.equal(restored.theme, 'lavender');
    assert.equal(restored.onTop, true);
    assert.equal(restored.showCompleted, true);
    assert.deepEqual(restored.bounds, persistedBounds);
    assert.equal((await windowInfo(app, '/widget.html')).onTop, true);
    await count(widget, '#pending-list [data-toggle]', 3);
    await count(widget, '#done-list [data-toggle]', 1);
    record('restart restores enabled widget, preferences, position and tasks');

    await widget.locator('#widget-close').click();
    assert.equal((await state(main)).settings.widget.enabled, false);
    const closedWidget = await windowInfo(app, '/widget.html');
    assert(!closedWidget || !closedWidget.visible);
    await app.close();
    app = null;
    app = await launch();
    main = await getMainWindow(app);
    track(main);
    await main.waitForSelector('.month-grid');
    assert.equal((await state(main)).settings.widget.enabled, false);
    assert.equal(await windowInfo(app, '/widget.html'), null);
    record('closing widget disables automatic restoration');

    assert.deepEqual(errors, []);
    const result = { passed: true, checks, tasksPersisted: (await state(main)).tasks.length, rendererErrors: errors };
    await fs.writeFile(path.join(output, 'widget-desktop-tests.json'), JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify(result));
  } finally {
    if (app) await app.close();
    assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(workRoot));
    assert(path.basename(dataDir).startsWith('widget-ui-'));
    await fs.rm(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });





