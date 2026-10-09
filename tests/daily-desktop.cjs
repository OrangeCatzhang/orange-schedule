const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const workRoot = path.join(root, '_work');
const dataDir = path.join(workRoot, 'daily-ui-' + randomUUID());
const output = path.join(root, 'outputs', 'verification');
const reportPath = path.join(output, 'daily-desktop-tests.json');
const screenshots = {
  editor: path.join(output, 'daily-repeat-editor.png'),
  list: path.join(output, 'daily-repeat-list.png')
};
const env = { ...process.env, WEEKLIGHT_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const executable = process.env.WEEKLIGHT_EXECUTABLE
  ? path.resolve(process.env.WEEKLIGHT_EXECUTABLE) : null;
const launch = () => electron.launch(executable
  ? { executablePath: executable, args: [], env }
  : { args: [root], env });
const checks = [], errors = [];
const startedAt = new Date().toISOString();
const dailyTitle = '每日重复验证：每天阅读';
const onceTitle = '每日重复验证：单次安排';
const weeklyTitle = '每日重复验证：每周回顾';
const dueTitle = '每日重复验证：到期提醒';
const dailyTime = '10:15';
let leapYear = new Date().getFullYear() + 1;
while (leapYear % 4 || (leapYear % 100 === 0 && leapYear % 400 !== 0)) leapYear++;
const firstDate = leapYear + '-02-28';
const lastDate = leapYear + '-03-02';
const expectedDates = [firstDate, leapYear + '-02-29', leapYear + '-03-01', lastDate];
const weeklyDate = leapYear + '-06-10';
const expectedWeeklyDates = [
  leapYear + '-06-10', leapYear + '-06-17', leapYear + '-06-24', leapYear + '-07-01'
];
const dateKey = date => [
  date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0')
].join('-');
function addDays(value, days) {
  const date = new Date(value + 'T12:00:00');
  date.setDate(date.getDate() + days);
  return dateKey(date);
}
const readState = page => page.evaluate(() => window.weeklight.get());
const taskDetails = tasks => tasks.map(task => ({
  id: task.id, title: task.title, date: task.date, time: task.time,
  duration: task.duration, category: task.category, reminder: task.reminder,
  done: task.done, priority: task.priority, notes: task.notes,
  createdAt: task.createdAt, notifiedAt: task.notifiedAt || null,
  snoozeUntil: task.snoozeUntil || null
})).sort((a, b) => a.id.localeCompare(b.id));

async function mainWindow(app) {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.month-grid');
  assert.equal(path.resolve((await readState(page)).dataDir), dataDir,
    'Application must use isolated data');
  await app.evaluate(({ Notification }) => {
    globalThis.__dailyNotifications = [];
    Notification.isSupported = () => true;
    Notification.prototype.show = function () {
      globalThis.__dailyNotifications.push({ title: this.title, body: this.body });
    };
  });
  return page;
}
async function jumpTo(page, date) {
  await page.locator('#jump-date').fill(date);
  await page.locator('#jump-date').dispatchEvent('change');
  assert.equal(await page.locator('#jump-date').inputValue(), date);
}
async function setDateField(page, name, value) {
  await page.locator('#task-form [name=' + name + ']').fill(value);
  await page.locator('#task-form [name=' + name + ']').dispatchEvent('change');
}
async function newEditor(page, trigger = page.locator('.new-button')) {
  await trigger.click();
  await page.waitForFunction(() => document.querySelector('#editor').open);
  assert.equal(await page.locator('#task-form [name=id]').inputValue(), '');
  assert.equal(await page.locator('#task-form [name=title]').inputValue(), '');
  assert.equal(await page.locator('#editor-title').innerText(), '新建计划');
}
async function fillBasics(page, { title, date, time = dailyTime, reminder = '-1' }) {
  await page.locator('#task-form [name=title]').fill(title);
  await setDateField(page, 'date', date);
  await page.locator('#task-form [name=time]').fill(time);
  await page.locator('#task-form [name=duration]').selectOption('30');
  await page.locator('#task-form [name=category]').selectOption('study');
  await page.locator('#task-form [name=reminder]').selectOption(reminder);
}
async function saveEditor(page) {
  await page.locator('#task-form [type=submit]').click();
  await page.waitForFunction(() => !document.querySelector('#editor').open);
  return readState(page);
}
async function expectRepeatEndState(page, daily) {
  assert.equal(await page.locator('#repeat-until-field').isVisible(), daily);
  const flags = await page.locator('#task-form [name=repeatUntil]').evaluate(input => ({
    required: input.required, disabled: input.disabled
  }));
  assert.deepEqual(flags, { required: daily, disabled: !daily });
}
async function expectListIds(page, ids) {
  await page.waitForFunction(expected => {
    const actual = [...document.querySelectorAll('#calendar .task-info[data-task]')]
      .map(item => item.dataset.task).sort();
    return JSON.stringify(actual) === JSON.stringify([...expected].sort());
  }, ids);
}
async function cleanTestData() {
  const resolved = path.resolve(dataDir);
  assert.equal(path.dirname(resolved), path.resolve(workRoot),
    'Cleanup target must be a direct child of _work');
  assert.ok(path.basename(resolved).startsWith('daily-ui-'));
  const entry = await fs.lstat(resolved).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!entry) return;
  assert.equal(entry.isSymbolicLink(), false, 'Cleanup must not follow a junction');
  const [actualData, actualWork] = await Promise.all([
    fs.realpath(resolved), fs.realpath(workRoot)
  ]);
  assert.equal(path.dirname(actualData), actualWork,
    'Resolved cleanup target must remain under _work');
  await fs.rm(resolved, { recursive: true, force: true });
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  let app, failure, version, cleaned = false, tasksPersisted = 0;
  let initialDailyIds = [], finalDailyTasks = [], dueDates = null;
  let notificationsBeforeRestart = 0, notificationsAfterRestart = 0;
  try {
    app = await launch();
    let page = await mainWindow(app);
    version = await app.evaluate(({ app }) => app.getVersion());
    await page.evaluate(() => window.weeklight.settings({ popup: false, sound: false }));
    assert.equal((await readState(page)).tasks.length, 0);
    await page.locator('[data-mode=list]').click();
    await jumpTo(page, firstDate);
    await newEditor(page, page.locator('#calendar .empty-state [data-action=new]'));
    await fillBasics(page, {
      title: dailyTitle, date: firstDate, reminder: '30'
    });
    assert.deepEqual(await page.locator('#task-form [name=repeat] option')
      .evaluateAll(options => options.map(option => option.value).sort()),
    ['1', '12', '4', '8', 'daily']);
    await page.locator('#task-form [name=repeat]').selectOption('daily');
    await expectRepeatEndState(page, true);
    assert.equal(await page.locator('#task-form [name=repeatUntil]').inputValue(),
      leapYear + '-03-28', 'The default includes exactly 30 days from February 28');
    assert.equal(await page.locator('#task-form [name=repeatUntil]').getAttribute('min'), firstDate);
    checks.push('new daily plan enables the required end date and defaults to 30 inclusive days');

    await setDateField(page, 'date', leapYear + '-02-29');
    assert.equal(await page.locator('#task-form [name=repeatUntil]').inputValue(),
      leapYear + '-03-29', 'An automatic end date follows the changed start date');
    await setDateField(page, 'repeatUntil', lastDate);
    await setDateField(page, 'date', firstDate);
    assert.equal(await page.locator('#task-form [name=repeatUntil]').inputValue(), lastDate,
      'A manually chosen end date must survive a start-date change');
    assert.equal(await page.locator('#task-form [name=repeatUntil]').getAttribute('min'), firstDate);
    checks.push('automatic end follows the start date while a manual end is preserved');

    const beforeInvalid = taskDetails((await readState(page)).tasks);
    await setDateField(page, 'repeatUntil', leapYear + '-02-27');
    assert.equal(await page.locator('#task-form [name=repeatUntil]')
      .evaluate(input => input.validity.rangeUnderflow), true);
    await page.locator('#task-form [type=submit]').click();
    assert.equal(await page.locator('#editor').evaluate(dialog => dialog.open), true);
    assert.deepEqual(taskDetails((await readState(page)).tasks), beforeInvalid,
      'An end date before the start must not save any partial series');
    checks.push('an end before the start is blocked without saving or closing the editor');

    await setDateField(page, 'repeatUntil', lastDate);
    assert.equal(await page.locator('#task-form').evaluate(form => form.checkValidity()), true);
    await page.screenshot({ path: screenshots.editor, fullPage: true });
    let state = await saveEditor(page);
    const series = state.tasks.filter(task => task.title === dailyTitle)
      .sort((a, b) => a.date.localeCompare(b.date));
    assert.equal(state.tasks.length, 4);
    assert.deepEqual(series.map(task => task.date), expectedDates);
    initialDailyIds = series.map(task => task.id);
    assert.equal(new Set(initialDailyIds).size, 4);
    assert.ok(series.every(task => task.time === dailyTime &&
      task.reminder === 30 && task.duration === 30 && task.category === 'study' && !task.done));
    await expectListIds(page, initialDailyIds);
    await page.screenshot({ path: screenshots.list, fullPage: true });
    checks.push('February 28 through March 2 creates four independent leap-year dates with matching time and reminder');

    const beforeComplete = state.tasks;
    await page.locator('#calendar [data-toggle="' + series[0].id + '"]').click();
    await page.waitForFunction(id => window.weeklight.get()
      .then(current => current.tasks.find(task => task.id === id)?.done), series[0].id);
    state = await readState(page);
    assert.equal(state.tasks.length, 4);
    assert.equal(state.tasks.filter(task => task.done).length, 1);
    assert.deepEqual(taskDetails(state.tasks.filter(task => task.id !== series[0].id)),
      taskDetails(beforeComplete.filter(task => task.id !== series[0].id)));
    checks.push('completing one day leaves the other three daily tasks unchanged');

    const beforeEdit = state.tasks;
    await page.locator('#calendar [data-task="' + series[1].id + '"]').click();
    await page.waitForFunction(() => document.querySelector('#editor').open);
    assert.equal(await page.locator('#repeat-field').isVisible(), false);
    await expectRepeatEndState(page, false);
    await page.locator('#task-form [name=title]').fill(dailyTitle + '（仅修改当天）');
    await page.locator('#task-form [name=time]').fill('11:45');
    state = await saveEditor(page);
    assert.equal(state.tasks.length, 4);
    const edited = state.tasks.find(task => task.id === series[1].id);
    assert.equal(edited.date, expectedDates[1]);
    assert.equal(edited.time, '11:45');
    assert.equal(edited.title, dailyTitle + '（仅修改当天）');
    assert.deepEqual(taskDetails(state.tasks.filter(task => task.id !== series[1].id)),
      taskDetails(beforeEdit.filter(task => task.id !== series[1].id)));
    checks.push('editing one day hides repetition controls and changes only that occurrence');

    const beforeDelete = state.tasks;
    await page.locator('#calendar [data-task="' + series[2].id + '"]').click();
    await page.waitForFunction(() => document.querySelector('#editor').open);
    await page.locator('#delete-task').click();
    await page.locator('#confirm-yes').click();
    await page.waitForFunction(() => !document.querySelector('#editor').open);
    state = await readState(page);
    assert.equal(state.tasks.length, 3);
    assert.equal(state.tasks.some(task => task.id === series[2].id), false);
    assert.deepEqual(taskDetails(state.tasks),
      taskDetails(beforeDelete.filter(task => task.id !== series[2].id)));
    checks.push('deleting one day preserves every other daily task and its completion state');

    await newEditor(page);
    await fillBasics(page, { title: onceTitle, date: lastDate });
    await page.locator('#task-form [name=repeat]').selectOption('daily');
    await setDateField(page, 'repeatUntil', firstDate);
    await page.locator('#task-form [name=repeat]').selectOption('1');
    await expectRepeatEndState(page, false);
    assert.equal(await page.locator('#task-form').evaluate(form => form.checkValidity()), true,
      'A hidden invalid end date must not block a non-repeating plan');
    const beforeOnce = (await readState(page)).tasks;
    state = await saveEditor(page);
    assert.equal(state.tasks.length, beforeOnce.length + 1);
    assert.equal(state.tasks.filter(task => task.title === onceTitle).length, 1);
    assert.deepEqual(taskDetails(state.tasks.filter(task => task.title !== onceTitle)),
      taskDetails(beforeOnce));
    checks.push('switching daily back to non-repeating disables the hidden end field and saves exactly one task');

    await newEditor(page);
    await fillBasics(page, { title: weeklyTitle, date: weeklyDate });
    await page.locator('#task-form [name=repeat]').selectOption('4');
    await expectRepeatEndState(page, false);
    const beforeWeekly = (await readState(page)).tasks;
    state = await saveEditor(page);
    const weeklyTasks = state.tasks.filter(task => task.title === weeklyTitle)
      .sort((a, b) => a.date.localeCompare(b.date));
    assert.equal(state.tasks.length, beforeWeekly.length + 4);
    assert.deepEqual(weeklyTasks.map(task => task.date), expectedWeeklyDates);
    assert.equal(new Set(weeklyTasks.map(task => task.id)).size, 4);
    assert.deepEqual(taskDetails(state.tasks.filter(task => task.title !== weeklyTitle)),
      taskDetails(beforeWeekly));
    checks.push('the existing four-week option still creates exactly four tasks seven days apart');

    const beforeCapacity = await readState(page);
    const capacityError = await page.evaluate(async ({ start, until }) => {
      try {
        await window.weeklight.saveTask({
          title: '每日重复验证：容量拒绝', date: start, time: '09:00',
          duration: 30, category: 'study', reminder: -1
        }, { frequency: 'daily', until });
        return null;
      } catch (error) { return error.message; }
    }, { start: firstDate, until: addDays(firstDate, 9999) });
    assert.match(capacityError || '', /10000/,
      'Main process must reject 10000 new tasks when other tasks already exist');
    state = await readState(page);
    assert.deepEqual(taskDetails(state.tasks), taskDetails(beforeCapacity.tasks));
    assert.deepEqual(state.history, beforeCapacity.history);
    checks.push('a 10000-day batch is atomically rejected against the total task capacity');

    const beforeNavigation = taskDetails(state.tasks);
    await jumpTo(page, addDays(lastDate, 1));
    assert.equal(await page.locator('#day-panel .task-row').count(), 0,
      'The selected day after the repeat end must contain no task from this series');
    state = await readState(page);
    assert.deepEqual(taskDetails(state.tasks), beforeNavigation);
    assert.ok(state.tasks.filter(task => initialDailyIds.includes(task.id))
      .every(task => task.date <= lastDate));
    // The list starts on Monday; jump a full four weeks so its range excludes the series.
    await jumpTo(page, addDays(lastDate, 28));
    for (const id of initialDailyIds)
      assert.equal(await page.locator('#calendar [data-task="' + id + '"]').count(), 0);
    assert.deepEqual(taskDetails((await readState(page)).tasks), beforeNavigation);
    checks.push('navigation after the end date neither continues the daily series nor recreates a deleted day');

    dueDates = { today: dateKey(new Date()) };
    dueDates.tomorrow = addDays(dueDates.today, 1);
    await jumpTo(page, dueDates.today);
    await newEditor(page);
    await fillBasics(page, {
      title: dueTitle, date: dueDates.today, time: '00:00', reminder: '0'
    });
    await page.locator('#task-form [name=repeat]').selectOption('daily');
    await setDateField(page, 'repeatUntil', dueDates.tomorrow);
    state = await saveEditor(page);
    const dueSeries = state.tasks.filter(task => task.title === dueTitle)
      .sort((a, b) => a.date.localeCompare(b.date));
    assert.deepEqual(dueSeries.map(task => task.date), [dueDates.today, dueDates.tomorrow]);
    assert.ok(dueSeries.every(task => task.time === '00:00' && task.reminder === 0));
    // Poll synchronous renderer state; a returned IPC Promise itself can be truthy.
    await page.waitForFunction(() => document.querySelector('#reminder-count').textContent === '1',
      null, { timeout: 15000 });
    state = await readState(page);
    assert.ok(state.tasks.find(task => task.id === dueSeries[0].id).notifiedAt);
    assert.equal(Boolean(state.tasks.find(task => task.id === dueSeries[1].id).notifiedAt), false);
    assert.equal(state.history.filter(item => item.taskId === dueSeries[0].id).length, 1);
    assert.equal(state.history.some(item => item.taskId === dueSeries[1].id), false);
    notificationsBeforeRestart = await app.evaluate(() => globalThis.__dailyNotifications.length);
    assert.equal(notificationsBeforeRestart, 1);
    assert.equal(app.windows().some(window => window.url().endsWith('/reminder.html')), false,
      'The regression must not open a real reminder popup');
    checks.push('the real reminder scheduler notifies today once and leaves tomorrow unnotified with notifications captured');

    const savedTasks = taskDetails(state.tasks);
    const savedHistory = state.history;
    tasksPersisted = state.tasks.length;
    finalDailyTasks = taskDetails(state.tasks.filter(task => initialDailyIds.includes(task.id)));
    await app.close();
    app = null;
    app = await launch();
    page = await mainWindow(app);
    state = await readState(page);
    assert.deepEqual(taskDetails(state.tasks), savedTasks,
      'Restart must preserve all task details without expanding the daily series');
    assert.deepEqual(state.history, savedHistory);
    // Wait through both the startup tick and one regular 5-second scheduler interval.
    await page.waitForTimeout(5500);
    state = await readState(page);
    assert.deepEqual(taskDetails(state.tasks), savedTasks);
    assert.deepEqual(state.history, savedHistory);
    notificationsAfterRestart = await app.evaluate(() => globalThis.__dailyNotifications.length);
    assert.equal(notificationsAfterRestart, 0, 'An already notified daily task must not notify again');
    assert.equal(app.windows().some(window => window.url().endsWith('/reminder.html')), false);
    await page.locator('[data-mode=list]').click();
    await jumpTo(page, firstDate);
    await expectListIds(page, state.tasks.filter(task =>
      initialDailyIds.includes(task.id) || task.title === onceTitle).map(task => task.id));
    checks.push('restart and subsequent scheduler ticks preserve all tasks, the deleted day and reminder deduplication');
    assert.deepEqual(errors, []);
  } catch (error) {
    failure = error;
  } finally {
    if (app) {
      try { await app.close(); } catch (error) { failure ||= error; }
    }
    try { await cleanTestData(); cleaned = true; } catch (error) { failure ||= error; }
    const result = {
      passed: !failure, version, execution: executable || 'project Electron',
      startedAt, finishedAt: new Date().toISOString(), checks,
      dailyRange: { start: firstDate, end: lastDate, expectedDates },
      weeklyDates: expectedWeeklyDates, dueReminderDates: dueDates,
      initialDailyIds, finalDailyTasks, tasksPersisted,
      notificationsBeforeRestart, notificationsAfterRestart,
      screenshots, rendererErrors: errors, isolatedDataRemoved: cleaned,
      ...(failure ? { error: failure.message, stack: failure.stack } : {})
    };
    await fs.writeFile(reportPath, JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify(result));
  }
  if (failure) throw failure;
})().catch(error => { console.error(error); process.exitCode = 1; });
