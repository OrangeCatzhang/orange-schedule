const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const workRoot = path.join(root, '_work');
const dataDir = path.join(workRoot, 'list-ui-' + randomUUID());
const output = path.join(root, 'outputs', 'verification');
const reportPath = path.join(output, 'list-desktop-tests.json');
const env = { ...process.env, WEEKLIGHT_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch(process.env.WEEKLIGHT_EXECUTABLE
  ? { executablePath: path.resolve(process.env.WEEKLIGHT_EXECUTABLE), args: [], env }
  : { args: [root], env });
// Fixed calendar days in the following year stay in one range and never become overdue.
const futureYear = new Date().getFullYear() + 1;
const firstDate = futureYear + '-06-10';
const secondDate = futureYear + '-06-11';
const startTime = '10:00';
const checks = [], errors = [];
const readState = page => page.evaluate(() => window.weeklight.get());
const sortIds = items => [...items].sort();
const taskDetails = tasks => tasks.map(task => ({
  id: task.id, title: task.title, date: task.date, time: task.time,
  duration: task.duration, category: task.category, reminder: task.reminder,
  done: task.done, priority: task.priority, notes: task.notes, createdAt: task.createdAt
})).sort((a, b) => a.id.localeCompare(b.id));

async function mainWindow(app) {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.month-grid');
  assert.equal(path.resolve((await readState(page)).dataDir), dataDir, 'Application must use isolated test data');
  return page;
}
async function jumpTo(page, date) {
  await page.locator('#jump-date').fill(date);
  await page.locator('#jump-date').dispatchEvent('change');
  assert.equal(await page.locator('#jump-date').inputValue(), date);
}
async function newEditor(page, trigger, date) {
  await trigger.click();
  await page.waitForFunction(() => document.querySelector('#editor').open);
  assert.equal(await page.locator('#task-form [name=id]').inputValue(), '', 'New plan must not retain an edited task ID');
  assert.equal(await page.locator('#task-form [name=title]').inputValue(), '', 'New plan must start with an empty title');
  assert.equal(await page.locator('#task-form [name=date]').inputValue(), date, 'New plan must use its date group');
  assert.equal(await page.locator('#editor-title').innerText(), '新建计划');
  assert.equal(await page.locator('#delete-task').isVisible(), false);
}
async function saveNew(page, title, date) {
  const before = await readState(page);
  await page.locator('#task-form [name=title]').fill(title);
  await page.locator('#task-form [name=time]').fill(startTime);
  await page.locator('#task-form [name=duration]').selectOption('30');
  await page.locator('#task-form [name=category]').selectOption('study');
  await page.locator('#task-form [name=reminder]').selectOption('-1');
  await page.locator('#task-form [name=repeat]').selectOption('1');
  await page.locator('#task-form [type=submit]').click();
  await page.waitForFunction(() => !document.querySelector('#editor').open);
  const after = await readState(page);
  assert.equal(after.tasks.length, before.tasks.length + 1, 'Saving a new plan must add a task');
  assert.equal(new Set(after.tasks.map(task => task.id)).size, after.tasks.length, 'Each task must have a unique ID');
  assert.deepEqual(taskDetails(after.tasks.filter(task => before.tasks.some(old => old.id === task.id))), taskDetails(before.tasks), 'New task must not overwrite earlier tasks');
  const added = after.tasks.filter(task => !before.tasks.some(old => old.id === task.id));
  assert.equal(added.length, 1);
  assert.equal(added[0].title, title);
  assert.equal(added[0].date, date);
  assert.equal(added[0].time, startTime);
  assert.equal(added[0].reminder, -1);
  await page.locator('#calendar [data-task="' + added[0].id + '"]').waitFor();
  return added[0];
}
async function expectVisibleTasks(page, expectedIds) {
  await page.waitForFunction(expected => {
    const actual = [...document.querySelectorAll('#calendar .task-info[data-task]')].map(item => item.dataset.task).sort();
    return JSON.stringify(actual) === JSON.stringify([...expected].sort());
  }, expectedIds);
  const actual = await page.locator('#calendar .task-info[data-task]').evaluateAll(items => items.map(item => item.dataset.task));
  assert.deepEqual(sortIds(actual), sortIds(expectedIds));
}
async function selectStatus(page, status, tasks) {
  await page.locator('#list-filter [data-status="' + status + '"]').click();
  assert.equal(await page.locator('#list-filter [data-status="' + status + '"]').getAttribute('aria-pressed'), 'true');
  const visible = tasks.filter(task => status === 'all' || (status === 'done' ? task.done : !task.done));
  await expectVisibleTasks(page, visible.map(task => task.id));
}
async function cleanTestData() {
  const resolved = path.resolve(dataDir);
  assert.equal(path.dirname(resolved), path.resolve(workRoot), 'Cleanup target must be a direct child of _work');
  assert.ok(path.basename(resolved).startsWith('list-ui-'), 'Cleanup target must belong to this test');
  const entry = await fs.lstat(resolved).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!entry) return;
  assert.equal(entry.isSymbolicLink(), false, 'Cleanup must not follow a directory junction');
  const [actualData, actualWork] = await Promise.all([fs.realpath(resolved), fs.realpath(workRoot)]);
  assert.equal(path.dirname(actualData), actualWork, 'Resolved cleanup target must remain under _work');
  await fs.rm(resolved, { recursive: true, force: true });
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  let app, failure, version, tasksPersisted = 0, cleaned = false;
  try {
    app = await launch();
    let page = await mainWindow(app);
    version = await app.evaluate(({ app }) => app.getVersion());
    assert.equal((await readState(page)).tasks.length, 0);
    await page.locator('[data-mode=list]').click();
    await jumpTo(page, firstDate);
    await newEditor(page, page.locator('#calendar .empty-state [data-action=new]'), firstDate);
    const first = await saveNew(page, '清单验证：第一项', firstDate);
    checks.push('empty list creates the first task on the selected future date');

    const groupAdd = date => page.locator('#calendar [data-new-date="' + date + '"]');
    const firstDay = [first];
    for (const title of ['清单验证：第二项', '清单验证：第三项']) {
      await newEditor(page, groupAdd(firstDate), firstDate);
      firstDay.push(await saveNew(page, title, firstDate));
    }
    assert.equal(new Set(firstDay.map(task => task.id)).size, 3);
    assert.ok(firstDay.every(task => task.date === firstDate && task.time === startTime));
    await expectVisibleTasks(page, firstDay.map(task => task.id));
    checks.push('date-group add creates a second and third task at the same time with fresh IDs');

    await jumpTo(page, secondDate);
    await newEditor(page, page.locator('.new-button'), secondDate);
    const otherDay = await saveNew(page, '清单验证：另一天', secondDate);
    assert.equal(await page.locator('#jump-date').inputValue(), secondDate);
    await newEditor(page, groupAdd(firstDate), firstDate);
    firstDay.push(await saveNew(page, '清单验证：回到原日期', firstDate));
    assert.equal((await readState(page)).tasks.find(task => task.id === otherDay.id).date, secondDate);
    checks.push('returning from another date uses the clicked group date and preserves the other day');

    const beforeEdit = (await readState(page)).tasks;
    await page.locator('#calendar [data-task="' + first.id + '"]').click();
    await page.waitForFunction(() => document.querySelector('#editor').open);
    assert.equal(await page.locator('#task-form [name=id]').inputValue(), first.id);
    await page.locator('#task-form [name=title]').fill('清单验证：第一项已修改');
    await page.locator('#task-form [type=submit]').click();
    await page.waitForFunction(() => !document.querySelector('#editor').open);
    const afterEdit = (await readState(page)).tasks;
    assert.equal(afterEdit.length, beforeEdit.length);
    assert.equal(afterEdit.find(task => task.id === first.id).title, '清单验证：第一项已修改');
    assert.deepEqual(taskDetails(afterEdit.filter(task => task.id !== first.id)), taskDetails(beforeEdit.filter(task => task.id !== first.id)));
    await newEditor(page, groupAdd(firstDate), firstDate);
    firstDay.push(await saveNew(page, '清单验证：编辑后新增', firstDate));
    let state = await readState(page);
    assert.equal(state.tasks.length, 6);
    assert.equal(state.tasks.find(task => task.id === first.id).title, '清单验证：第一项已修改');
    assert.equal(state.tasks.filter(task => task.date === firstDate).length, 5);
    checks.push('editing an existing task does not leak its ID or title into the next new task');

    for (const id of [first.id, otherDay.id]) {
      await page.locator('#calendar [data-toggle="' + id + '"]').click();
      await page.waitForFunction(id => document.querySelector('#calendar [data-toggle="' + id + '"]').classList.contains('checked'), id);
    }
    state = await readState(page);
    assert.equal(state.tasks.filter(task => task.done).length, 2);
    for (const status of ['todo', 'done', 'all']) await selectStatus(page, status, state.tasks);
    checks.push('pending, completed and all filters show the expected four, two and six tasks');
    await page.screenshot({ path: path.join(output, 'list-same-day.png'), fullPage: true });
    const savedTasks = taskDetails(state.tasks);
    assert.deepEqual(state.history, [], 'Synthetic test tasks must not generate reminders');
    await app.close();
    app = null;

    app = await launch();
    page = await mainWindow(app);
    state = await readState(page);
    assert.deepEqual(taskDetails(state.tasks), savedTasks, 'Restart must preserve every task and completion state');
    assert.deepEqual(state.history, []);
    await page.locator('[data-mode=list]').click();
    await jumpTo(page, firstDate);
    for (const status of ['todo', 'done', 'all']) await selectStatus(page, status, state.tasks);
    await newEditor(page, groupAdd(firstDate), firstDate);
    await page.locator('#editor .close-dialog').first().click();
    assert.deepEqual(taskDetails((await readState(page)).tasks), savedTasks, 'Canceling a fresh draft after restart must not change saved tasks');
    tasksPersisted = state.tasks.length;
    checks.push('restart preserves all six tasks, filter membership and a usable date-group add button');
    assert.deepEqual(errors, []);
  } catch (error) {
    failure = error;
  } finally {
    if (app) {
      try { await app.close(); } catch (error) { failure ||= error; }
    }
    try { await cleanTestData(); cleaned = true; } catch (error) { failure ||= error; }
    const result = {
      passed: !failure, version, checks, tasksPersisted,
      dates: { first: firstDate, second: secondDate }, rendererErrors: errors,
      isolatedDataRemoved: cleaned, ...(failure ? { error: failure.message } : {})
    };
    await fs.writeFile(reportPath, JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify(result));
  }
  if (failure) throw failure;
})().catch(error => { console.error(error); process.exitCode = 1; });
