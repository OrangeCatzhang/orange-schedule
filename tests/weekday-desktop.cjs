const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const workRoot = path.join(root, '_work');
const dataDir = path.join(workRoot, 'weekday-ui-' + randomUUID());
const output = path.join(root, 'outputs', 'verification');
const env = { ...process.env, WEEKLIGHT_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch(process.env.WEEKLIGHT_EXECUTABLE
  ? { executablePath: path.resolve(process.env.WEEKLIGHT_EXECUTABLE), args: [], env }
  : { args: [root], env });
const checks = [], errors = [];
const key = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
const addDays = (value, days) => { const date = new Date(value + 'T12:00:00'); date.setDate(date.getDate() + days); return key(date); };
const future = new Date(new Date().getFullYear() + 1, 2, 1, 12);
future.setDate(future.getDate() + (8 - future.getDay()) % 7);
const monday = key(future);
const readState = page => page.evaluate(() => window.weeklight.get());
const details = tasks => tasks.map(task => ({
  id: task.id, title: task.title, date: task.date, time: task.time, duration: task.duration,
  category: task.category, reminder: task.reminder, priority: task.priority, notes: task.notes,
  done: task.done, createdAt: task.createdAt, notifiedAt: task.notifiedAt ?? null, snoozeUntil: task.snoozeUntil ?? null
})).sort((a, b) => a.id.localeCompare(b.id));
const titled = (state, title) => state.tasks.filter(task => task.title === title).sort((a, b) => a.date.localeCompare(b.date));

async function mainWindow(app) {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.month-grid');
  assert.equal(path.resolve((await readState(page)).dataDir), dataDir);
  return page;
}
async function setDate(page, name, value) {
  const input = page.locator('#task-form [name=' + name + ']');
  await input.fill(value);
  await input.dispatchEvent('change');
}
async function jumpTo(page, value) {
  await page.locator('#jump-date').fill(value);
  await page.locator('#jump-date').dispatchEvent('change');
}
async function openNew(page, title, date, trigger = page.locator('.new-button')) {
  await trigger.click();
  await page.waitForFunction(() => document.querySelector('#editor').open);
  assert.equal(await page.locator('#task-form [name=id]').inputValue(), '');
  assert.equal(await page.locator('#task-form [name=title]').inputValue(), '');
  await page.locator('#task-form [name=title]').fill(title);
  await setDate(page, 'date', date);
  await page.locator('#task-form [name=time]').fill('10:15');
  await page.locator('#task-form [name=duration]').selectOption('30');
  await page.locator('#task-form [name=category]').selectOption('study');
  await page.locator('#task-form [name=reminder]').selectOption('-1');
}
async function expectEndField(page, active) {
  assert.equal(await page.locator('#repeat-until-field').isVisible(), active);
  assert.deepEqual(await page.locator('#task-form [name=repeatUntil]').evaluate(input => ({ disabled: input.disabled, required: input.required })),
    { disabled: !active, required: active });
}
async function save(page) {
  await page.locator('#task-form [type=submit]').click();
  await page.waitForFunction(() => !document.querySelector('#editor').open);
  return readState(page);
}
async function expectList(page, tasks) {
  await page.waitForFunction(expected => {
    const actual = [...document.querySelectorAll('#calendar .task-info[data-task]')].map(item => item.dataset.task).sort();
    return JSON.stringify(actual) === JSON.stringify([...expected].sort());
  }, tasks.map(task => task.id));
}
async function cleanup() {
  const resolved = path.resolve(dataDir);
  assert.equal(path.dirname(resolved), path.resolve(workRoot));
  assert.ok(path.basename(resolved).startsWith('weekday-ui-'));
  const entry = await fs.lstat(resolved).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!entry) return;
  assert.equal(entry.isSymbolicLink(), false, 'Cleanup must not follow a directory junction');
  const [actualData, actualWork] = await Promise.all([fs.realpath(resolved), fs.realpath(workRoot)]);
  assert.equal(path.dirname(actualData), actualWork, 'Cleanup target must resolve to a child of _work');
  await fs.rm(resolved, { recursive: true, force: true });
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  let app, failure, version, cleaned = false, tasksPersisted = 0;
  try {
    app = await launch();
    let page = await mainWindow(app);
    version = await app.evaluate(({ app }) => app.getVersion());
    assert.equal((await readState(page)).tasks.length, 0);
    await page.locator('[data-mode=list]').click();
    await jumpTo(page, monday);
    const firstTitle = '工作日验证：第一周阅读';
    await openNew(page, firstTitle, monday, page.locator('#calendar .empty-state [data-action=new]'));
    const options = await page.locator('#task-form [name=repeat] option').evaluateAll(items => items.map(item => item.value));
    for (const value of ['1', '4', '8', '12', 'daily', 'weekdays']) assert.ok(options.includes(value), 'Missing repeat option ' + value);
    await page.locator('#task-form [name=repeat]').selectOption('weekdays');
    await expectEndField(page, true);
    assert.equal(await page.locator('#task-form [name=repeatUntil]').getAttribute('min'), monday);
    await setDate(page, 'repeatUntil', addDays(monday, 6));
    assert.match(await page.locator('#form-hint').innerText(), /5\s*项/);
    await page.screenshot({ path: path.join(output, 'weekday-repeat-editor.png'), fullPage: true });
    let state = await save(page);
    const first = titled(state, firstTitle);
    assert.deepEqual(first.map(task => task.date), [0, 1, 2, 3, 4].map(day => addDays(monday, day)));
    assert.equal(new Set(first.map(task => task.id)).size, 5);
    assert.ok(first.every(task => task.time === '10:15' && task.duration === 30 && task.reminder === -1 && task.category === 'study'));
    await expectList(page, state.tasks);
    checks.push('weekdays exposes a required end date, previews five tasks and creates only Monday through Friday');

    const weekendTitle = '工作日验证：周末开始';
    await openNew(page, weekendTitle, addDays(monday, 5));
    await page.locator('#task-form [name=repeat]').selectOption('weekdays');
    await setDate(page, 'repeatUntil', addDays(monday, 11));
    assert.match(await page.locator('#form-hint').innerText(), /5\s*项/);
    const beforeWeekend = details(state.tasks);
    state = await save(page);
    const second = titled(state, weekendTitle);
    assert.deepEqual(second.map(task => task.date), [7, 8, 9, 10, 11].map(day => addDays(monday, day)));
    assert.equal(state.tasks.length, 10);
    assert.deepEqual(details(state.tasks.filter(task => task.title !== weekendTitle)), beforeWeekend);
    assert.equal(await page.locator('#jump-date').inputValue(), addDays(monday, 7));
    await page.locator('#day-panel [data-task="' + second[0].id + '"]').waitFor();
    await expectList(page, state.tasks);
    await page.screenshot({ path: path.join(output, 'weekday-repeat-list.png'), fullPage: true });
    checks.push('a Saturday start creates the following Monday first and selects that actual date in the day panel');

    const dailyTitle = '工作日验证：切换每日';
    await openNew(page, dailyTitle, addDays(monday, 12));
    await page.locator('#task-form [name=repeat]').selectOption('weekdays');
    await setDate(page, 'repeatUntil', addDays(monday, 13));
    assert.match(await page.locator('#form-hint').innerText(), /没有工作日/);
    const beforeInvalid = details(state.tasks);
    await page.locator('#task-form [type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#form-error').textContent.includes('没有工作日'));
    assert.equal(await page.locator('#form-error').isVisible(), true);
    assert.equal(await page.locator('#editor').evaluate(dialog => dialog.open), true);
    assert.deepEqual(details((await readState(page)).tasks), beforeInvalid);
    assert.equal(await page.locator('#task-form [type=submit]').isEnabled(), true);
    checks.push('a weekend-only range reports a visible error and saves no tasks while leaving the form recoverable');

    await page.locator('#task-form [name=repeat]').selectOption('daily');
    await expectEndField(page, true);
    assert.equal(await page.locator('#task-form [name=repeatUntil]').inputValue(), addDays(monday, 13));
    assert.match(await page.locator('#form-hint').innerText(), /2\s*项/);
    state = await save(page);
    assert.deepEqual(titled(state, dailyTitle).map(task => task.date), [12, 13].map(day => addDays(monday, day)));
    assert.equal(state.tasks.length, 12);
    checks.push('switching the rejected weekend range to daily preserves its end date and creates both weekend days');

    const onceTitle = '工作日验证：切换单次';
    await openNew(page, onceTitle, addDays(monday, 14));
    await page.locator('#task-form [name=repeat]').selectOption('weekdays');
    await setDate(page, 'repeatUntil', monday);
    await page.locator('#task-form [name=repeat]').selectOption('1');
    await expectEndField(page, false);
    assert.equal(await page.locator('#task-form').evaluate(form => form.checkValidity()), true);
    state = await save(page);
    assert.deepEqual(titled(state, onceTitle).map(task => task.date), [addDays(monday, 14)]);
    assert.equal(state.tasks.length, 13);
    checks.push('switching weekdays to non-repeating disables the hidden invalid end and saves exactly one task');

    const weeklyTitle = '工作日验证：切换每周';
    await openNew(page, weeklyTitle, monday);
    await page.locator('#task-form [name=repeat]').selectOption('weekdays');
    await setDate(page, 'repeatUntil', addDays(monday, -1));
    await page.locator('#task-form [name=repeat]').selectOption('4');
    await expectEndField(page, false);
    assert.equal(await page.locator('#task-form').evaluate(form => form.checkValidity()), true);
    state = await save(page);
    assert.deepEqual(titled(state, weeklyTitle).map(task => task.date), [0, 7, 14, 21].map(day => addDays(monday, day)));
    assert.equal(state.tasks.length, 17);
    assert.equal(new Set(state.tasks.map(task => task.id)).size, 17);
    checks.push('switching weekdays to the legacy weekly option still creates four independent weekly dates');

    const beforeComplete = state.tasks;
    await page.locator('#calendar [data-toggle="' + first[0].id + '"]').click();
    await page.locator('#task-action-confirm').click();
    await page.waitForFunction(id => document.querySelector('#calendar [data-toggle="' + id + '"]').classList.contains('checked'), first[0].id);
    state = await readState(page);
    assert.equal(state.tasks.filter(task => task.done).length, 1);
    assert.deepEqual(details(state.tasks.filter(task => task.id !== first[0].id)), details(beforeComplete.filter(task => task.id !== first[0].id)));
    const beforeEdit = state.tasks;
    await page.locator('#calendar [data-task="' + first[1].id + '"]').click();
    await page.waitForFunction(() => document.querySelector('#editor').open);
    assert.equal(await page.locator('#repeat-field').isVisible(), false);
    await expectEndField(page, false);
    await page.locator('#task-form [name=title]').fill(firstTitle + '（仅修改当天）');
    state = await save(page);
    assert.equal(state.tasks.length, 17);
    assert.equal(state.tasks.find(task => task.id === first[1].id).date, addDays(monday, 1));
    assert.deepEqual(details(state.tasks.filter(task => task.id !== first[1].id)), details(beforeEdit.filter(task => task.id !== first[1].id)));
    checks.push('completion and editing affect only the selected weekday occurrence');

    const savedTasks = details(state.tasks);
    assert.deepEqual(state.history, [], 'Synthetic tasks have disabled reminders');
    await app.close();
    app = null;
    app = await launch();
    page = await mainWindow(app);
    state = await readState(page);
    assert.deepEqual(details(state.tasks), savedTasks);
    assert.deepEqual(state.history, []);
    await page.locator('[data-mode=list]').click();
    await jumpTo(page, monday);
    await expectList(page, state.tasks);
    tasksPersisted = state.tasks.length;
    checks.push('restart preserves all seventeen tasks and the individual completion and edit');
    assert.deepEqual(errors, []);
  } catch (error) {
    failure = error;
  } finally {
    if (app) {
      try { await app.close(); } catch (error) { failure ||= error; }
    }
    try { await cleanup(); cleaned = true; } catch (error) { failure ||= error; }
    const result = { passed: !failure, version, checks, tasksPersisted, startMonday: monday,
      rendererErrors: errors, isolatedDataRemoved: cleaned, ...(failure ? { error: failure.message } : {}) };
    await fs.writeFile(path.join(output, 'weekday-desktop-tests.json'), JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify(result));
  }
  if (failure) throw failure;
})().catch(error => { console.error(error); process.exitCode = 1; });
