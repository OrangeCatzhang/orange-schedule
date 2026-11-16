const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const root = path.resolve(__dirname, '..'), workRoot = path.join(root, '_work');
const dataDir = path.join(workRoot, 'month-span-ui-' + randomUUID());
const output = path.join(root, 'outputs', 'verification');
const packaged = !!process.env.WEEKLIGHT_EXECUTABLE;
const suffix = packaged ? '-packaged' : '';
const env = { ...process.env, WEEKLIGHT_DATA_DIR: dataDir }; delete env.ELECTRON_RUN_AS_NODE;
const guards = ['--hidden', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9'];
const checks = [], errors = [], geometry = [], sessions = [];
let app, page, version;
const readState = () => page.evaluate(() => window.weeklight.get());
// Loading normalizes optional reminder state and refreshes the validation timestamp.
const taskDetails = tasks => tasks.map(({ updatedAt, ...task }) => ({ ...task, notifiedAt: task.notifiedAt ?? null, snoozeUntil: task.snoozeUntil ?? null }));
const field = name => page.locator('#task-form [name=' + name + ']');
const key = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
const plusDays = (value, amount) => { const date = new Date(value + 'T12:00:00'); date.setDate(date.getDate() + amount); return key(date); };
async function launch() {
  app = await electron.launch(packaged
    ? { executablePath: path.resolve(process.env.WEEKLIGHT_EXECUTABLE), args: guards, env }
    : { args: [root, ...guards], env });
  await app.evaluate(({ Notification, net, shell, app }) => {
    globalThis.__monthSpanSafety = { notifications: 0, fetches: [], external: [], startup: [] };
    Notification.isSupported = () => { globalThis.__monthSpanSafety.notifications++; return false; };
    net.fetch = async url => { globalThis.__monthSpanSafety.fetches.push(String(url)); throw new Error('Network blocked by month/span test'); };
    shell.openExternal = async url => { globalThis.__monthSpanSafety.external.push(String(url)); };
    app.setLoginItemSettings = settings => { globalThis.__monthSpanSafety.startup.push(settings); throw new Error('Startup writes blocked by month/span test'); };
  });
  await app.context().route(/^https?:\/\//, route => route.abort());
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    page = app.windows().find(item => item.url().endsWith('/index.html'));
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert(page, 'Main window must exist');
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('#calendar > *', { state: 'attached' });
  assert.equal(path.resolve((await readState()).dataDir), dataDir);
  version = await app.evaluate(({ app }) => app.getVersion());
}
async function close() {
  const safety = await app.evaluate(() => globalThis.__monthSpanSafety);
  assert.deepEqual(safety, { notifications: 0, fetches: [], external: [], startup: [] });
  sessions.push(safety); await app.close(); app = null;
}
async function fillDate(name, value) {
  await field(name).fill(value); await field(name).dispatchEvent(name === 'date' ? 'change' : 'input');
}
async function jump(value) {
  await page.locator('#jump-date').fill(value); await page.locator('#jump-date').dispatchEvent('change');
  assert.equal(await page.locator('#jump-date').inputValue(), value);
}
async function newTask(title, date) {
  await page.locator('.new-button').click();
  await field('title').fill(title); await fillDate('date', date); await field('reminder').selectOption('-1');
}
async function save() {
  await page.locator('#task-form [type=submit]').click();
  await page.waitForFunction(() => !document.querySelector('#editor').open);
}
async function saveViaApi(title, date, endDate) {
  return page.evaluate(async task => {
    const state = await window.weeklight.saveTask(task, 1); return state.tasks.find(item => item.title === task.title);
  }, { title, date, ...(endDate ? { endDate } : {}), time: '09:00', duration: 60, category: 'work', reminder: -1, notes: '', priority: 'normal' });
}
async function inspectGeometry(name, selectors, target = page) {
  const measured = await target.evaluate(selectors => selectors.map(selector => {
    const node = document.querySelector(selector), box = node.getBoundingClientRect();
    return { selector, scroll: node.scrollWidth, client: node.clientWidth, width: box.width, height: box.height };
  }), selectors);
  assert(measured.every(item => item.client > 0 && item.scroll <= item.client + 1), name + ' must not overflow horizontally: ' + JSON.stringify(measured));
  geometry.push({ name, measured });
}
async function setSize(width, height) {
  const window = await app.browserWindow(page); await window.evaluate((window, size) => window.setSize(...size), [width, height]);
}
async function capture(target, name) {
  const window = await app.browserWindow(target);
  // A hidden packaged window can return an old compositor frame. Show without
  // activation and wait for painting before the native capture, then hide again.
  await window.evaluate(window => window.showInactive());
  try {
    await target.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 100)))));
    const png = await window.evaluate(async window => {
      const image = await Promise.race([
        window.capturePage(undefined, { stayHidden: true, stayAwake: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Native capture timed out')), 10000))
      ]);
      if (image.isEmpty()) throw new Error('Native capture returned an empty image');
      return image.toPNG().toString('base64');
    });
    await fs.writeFile(path.join(output, name + '-' + version + suffix + '.png'), Buffer.from(png, 'base64'));
  } finally { await window.evaluate(window => window.hide()); }
}
async function snapshot(name) {
  await page.evaluate(() => document.querySelector('#toast').classList.remove('visible'));
  await page.evaluate(() => document.activeElement?.blur());
  await capture(page, name);
}
async function cleanup() {
  assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(workRoot));
  assert(path.basename(dataDir).startsWith('month-span-ui-'));
  if (await fs.stat(dataDir).catch(() => null)) {
    assert.equal((await fs.lstat(dataDir)).isSymbolicLink(), false);
    assert.equal(path.dirname(await fs.realpath(dataDir)), await fs.realpath(workRoot));
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

(async () => {
  await fs.mkdir(dataDir, { recursive: true }); await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'plans.json'), JSON.stringify({ version: 1, tasks: [], history: [], settings: {
    language: 'zh-CN', sound: false, popup: false, checkUpdates: false, widget: { enabled: false, onTop: false }
  } }), 'utf8');
  let failure, persisted;
  try {
    await launch();
    assert.equal(await page.locator('[data-mode=month]').getAttribute('aria-pressed'), 'true');
    for (const [date, count, first, last, title] of [
      ['2026-11-01', 42, '2026-10-26', '2026-12-06', '2026年 11月'],
      ['2027-02-01', 28, '2027-02-01', '2027-02-28', '2027年 2月'],
      ['2028-02-29', 35, '2028-01-31', '2028-03-05', '2028年 2月']
    ]) {
      await jump(date); assert.equal(await page.locator('.day-cell').count(), count);
      assert.equal(await page.locator('.day-cell').first().getAttribute('data-date'), first);
      assert.equal(await page.locator('.day-cell').last().getAttribute('data-date'), last);
      assert.equal(await page.locator('#date-range').innerText(), title);
    }
    await jump('2026-12-31'); await page.locator('#next').click();
    assert.equal(await page.locator('#date-range').innerText(), '2027年 1月');
    await page.locator('#previous').click(); assert.equal(await page.locator('#date-range').innerText(), '2026年 12月');
    await jump('2026-11-16'); await page.locator('[data-mini="2026-11-01"]').click();
    assert.equal(await page.locator('#date-range').innerText(), '2026年 11月');
    assert.equal(await page.locator('.day-cell.selected').getAttribute('data-date'), '2026-11-01');
    checks.push('Natural months cover all 28/35/42 cells including leap day; November 1 stays in November; month arrows cross years');

    await jump('2026-11-16'); await newTask('Project delivery plan', '2026-11-16');
    assert.equal(await field('endDate').inputValue(), '2026-11-16'); assert.equal(await field('spanDays').inputValue(), '1');
    await field('spanDays').fill('15'); assert.equal(await field('endDate').inputValue(), '2026-11-30');
    await fillDate('endDate', '2026-11-25'); assert.equal(await field('spanDays').inputValue(), '10');
    await fillDate('date', '2026-11-20'); assert.equal(await field('endDate').inputValue(), '2026-11-29');
    for (const invalid of ['0', '-1', '1.5', '']) {
      await field('spanDays').fill(invalid);
      assert.equal(await field('spanDays').evaluate(node => node.checkValidity()), false, 'Invalid day count: ' + invalid);
      if (invalid === '0') {
        for (const language of ['en', 'zh-CN']) {
          await page.evaluate(language => window.weeklight.settings({ language }), language);
          await page.waitForFunction(language => document.documentElement.lang === language, language);
          assert.equal(await field('spanDays').inputValue(), '0');
          assert.equal(await field('spanDays').evaluate(node => node.checkValidity()), false);
        }
      }
      await page.locator('#task-form [type=submit]').click();
      assert.equal((await readState()).tasks.length, 0); assert.equal(await page.locator('#editor').evaluate(node => node.open), true);
    }
    await field('spanDays').fill('10'); await fillDate('endDate', '2026-11-19');
    assert.equal(await field('endDate').evaluate(node => node.checkValidity()), false);
    await page.locator('#task-form [type=submit]').click(); assert.equal((await readState()).tasks.length, 0);
    await fillDate('date', '2028-02-28'); await field('spanDays').fill('4');
    assert.equal(await field('endDate').inputValue(), '2028-03-02');
    await fillDate('date', '2026-11-16'); await field('spanDays').fill('15');
    await field('notes').fill('Prepare the draft, review feedback, and deliver the final package.');
    await snapshot('month-span-editor'); await save();
    let state = await readState(); assert.equal(state.tasks.length, 1);
    const project = state.tasks[0];
    assert.equal(project.date, '2026-11-16'); assert.equal(project.endDate, '2026-11-30'); assert.equal(project.seriesId, undefined);
    assert.equal(await page.locator('#calendar [data-task="' + project.id + '"]').count(), 15);
    assert.equal(await page.locator('#view-count').innerText(), '1 待办 · 0 已办');
    for (const day of [16, 20, 30]) assert.equal(await page.locator('[data-mini="2026-11-' + day + '"]').evaluate(node => node.classList.contains('dot')), true);
    checks.push('Start/end/day fields stay synchronized, reject invalid values and handle leap days; a 15-day project saves exactly one task and occupies 15 calendar dates');

    await page.locator('[data-mode=week]').click();
    assert.equal(await page.locator('.week-spans [data-task="' + project.id + '"]').count(), 7);
    assert.equal(await page.locator('.week-body [data-task="' + project.id + '"]').count(), 0);
    await page.locator('.span-cell[data-date="2026-11-18"] [data-task="' + project.id + '"]').dragTo(page.locator('.span-cell[data-date="2026-11-19"]'), { targetPosition: { x: 5, y: 5 } });
    await page.waitForFunction(async id => (await window.weeklight.get()).tasks.find(task => task.id === id).date === '2026-11-17', project.id);
    state = await readState(); assert.equal(state.tasks[0].endDate, '2026-12-01');
    await page.evaluate(id => window.weeklight.moveTask(id, '2026-11-16'), project.id);
    assert.equal((await readState()).tasks[0].endDate, '2026-11-30');
    await page.locator('[data-mode=month]').click();
    await page.locator('.day-cell[data-date="2026-11-18"] [data-task="' + project.id + '"]').dragTo(page.locator('.day-cell[data-date="2026-11-19"]'), { targetPosition: { x: 5, y: 5 } });
    await page.waitForFunction(async id => (await window.weeklight.get()).tasks.find(task => task.id === id).date === '2026-11-17', project.id);
    assert.equal((await readState()).tasks[0].endDate, '2026-12-01');
    await page.evaluate(id => window.weeklight.moveTask(id, '2026-11-16'), project.id);
    checks.push('Weekly spans appear outside the time grid; dragging a continuation day in week and month preserves grab offset and total duration; move IPC preserves the end date');

    await saveViaApi('Confirm requirements', '2026-11-18'); await saveViaApi('Review final draft', '2026-11-26');
    await jump('2026-11-16'); await snapshot('month-span-calendar');
    const current = key(new Date());
    const active = await saveViaApi('Active multi-day project', plusDays(current, -2), plusDays(current, 2));
    const expired = await saveViaApi('Expired multi-day project', plusDays(current, -5), plusDays(current, -1));
    const upcoming = await saveViaApi('Upcoming multi-day project', plusDays(current, 1), plusDays(current, 3));
    await page.locator('[data-view=today]').click();
    assert.equal(await page.locator('#calendar [data-task="' + active.id + '"]').count(), 1);
    assert.equal(await page.locator('#calendar [data-task="' + active.id + '"]').evaluate(node => node.closest('.task-row').classList.contains('overdue')), false);
    assert.equal(await page.locator('.overdue-group [data-task="' + expired.id + '"]').count(), 1);
    assert.equal(await page.locator('#calendar [data-task="' + upcoming.id + '"]').count(), 0);
    const beforeCompletion = (await readState()).tasks;
    await page.locator('#calendar [data-toggle="' + active.id + '"]').click();
    await page.waitForFunction(async id => (await window.weeklight.get()).tasks.find(task => task.id === id).done, active.id);
    state = await readState(); assert.equal(state.tasks.length, beforeCompletion.length);
    assert.equal(state.tasks.filter(task => task.done).length, 1); assert.equal(state.tasks.find(task => task.id === active.id).endDate, plusDays(current, 2));
    assert.equal(await page.locator('#calendar [data-task="' + active.id + '"]').count(), 1);
    checks.push('Today includes active spans once, marks overdue only after the end date, excludes future spans, and completes an entire span in one action');

    await page.locator('[data-view=calendar]').click(); await jump('2026-11-16');
    await newTask('Weekday review', '2026-11-16');
    assert.equal(await field('spanDays').inputValue(), '1');
    await field('repeat').selectOption('weekdays'); await fillDate('repeatUntil', '2026-11-22');
    await field('repeatUntil').dispatchEvent('change'); await save();
    const weekdays = (await readState()).tasks.filter(task => task.title === 'Weekday review');
    assert.deepEqual(weekdays.map(task => task.date), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']);
    assert(weekdays.every(task => task.endDate === undefined));
    checks.push('New editor resets to one day; weekday repetition continues to create five single-day tasks and skips the weekend');

    await page.evaluate(() => window.weeklight.settings({ language: 'en' }));
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    assert.equal(await page.locator('[data-mode=month]').innerText(), 'Month');
    assert.equal(await page.locator('#date-range').innerText(), 'November 2026');
    await setSize(1050, 760);
    await inspectGeometry('English month at 1050px', ['.workspace', '.calendar-toolbar', '.segmented', '.month-grid', '.view-options']);
    await page.locator('#calendar [data-task="' + project.id + '"]').first().click();
    assert.equal(await field('endDate').inputValue(), '2026-11-30'); assert.equal(await field('spanDays').inputValue(), '15');
    await inspectGeometry('English span editor at 1050px', ['#editor', '#task-form', '.form-grid', '#span-hint']);
    const englishEditor = await page.locator('#editor').innerText();
    assert(!/[\u4e00-\u9fff]/.test(englishEditor), 'New editor labels should all be translated');
    await snapshot('month-span-editor-english-narrow');
    await page.locator('#editor .close-dialog').first().click();
    await page.locator('[data-mode=week]').click();
    await inspectGeometry('English span band at 1050px', ['.week-spans', '.week-header']);
    await page.evaluate(() => window.weeklight.widgetSettings({ anchor: '2026-11-25', mode: 'day' }));
    const widgetPromise = app.waitForEvent('window');
    await page.evaluate(() => window.weeklight.openWidget());
    const widget = await widgetPromise;
    widget.on('pageerror', error => errors.push(error.message));
    await widget.waitForSelector('#pending-list [data-edit="' + project.id + '"]');
    const widgetWindow = await app.browserWindow(widget);
    await widgetWindow.evaluate(window => { window.hide(); window.setSize(340, 380); });
    assert.equal(await widget.locator('[data-edit="' + project.id + '"]').count(), 1);
    assert.equal(await widget.locator('[data-edit="' + project.id + '"] .task-span').innerText(), 'Nov 16 — Nov 30 · 15 days total');
    await widget.locator('[data-mode=week]').click();
    await widget.waitForFunction(() => document.querySelector('[data-mode=week]').classList.contains('active'));
    assert.equal(await widget.locator('[data-edit="' + project.id + '"]').count(), 1);
    await inspectGeometry('English widget span at 340px', ['.widget', '.widget-controls', '[data-edit="' + project.id + '"]', '[data-edit="' + project.id + '"] .task-span'], widget);
    await capture(widget, 'month-span-widget-english');
    await widget.locator('#widget-close').click();
    assert.equal((await readState()).settings.widget.enabled, false);
    checks.push('Desktop note day/week views each show an intersecting project once with its end date and duration, fitting English 340px minimum width');
    persisted = (await readState()).tasks; await close(); await launch();
    assert.equal(await page.locator('[data-mode=week]').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(taskDetails((await readState()).tasks), taskDetails(persisted));
    await page.locator('[data-mode=month]').click(); await close(); await launch();
    assert.equal(await page.locator('[data-mode=month]').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(taskDetails((await readState()).tasks), taskDetails(persisted));
    assert.equal((await readState()).settings.language, 'en'); assert.deepEqual((await readState()).history, []);
    checks.push('English month/editor/weekly span band fit minimum width, full end date and completion survive restart, and selected month/week mode is remembered');
    assert.deepEqual(errors, []); await close();
  } catch (error) { failure = error; }
  finally {
    if (app) { try { await close(); } catch (error) { failure ||= error; if (app) await app.close(); } }
    await cleanup();
    const result = { passed: !failure, version, packaged, checks, geometry, sessions, tasksPersisted: persisted?.length, rendererErrors: errors, isolatedDataRemoved: true, failure: failure?.stack };
    await fs.writeFile(path.join(output, 'month-span-desktop-' + (version || 'unknown') + suffix + '.json'), JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify(result));
  }
  if (failure) throw failure;
})().catch(error => { console.error(error); process.exitCode = 1; });
