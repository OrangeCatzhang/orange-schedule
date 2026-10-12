const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const root = path.resolve(__dirname, '..'), workRoot = path.join(root, '_work');
const dataDir = path.join(workRoot, 'task-series-ui-' + randomUUID());
const output = path.join(root, 'outputs', 'verification');
const env = { ...process.env, WEEKLIGHT_DATA_DIR: dataDir }; delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch(process.env.WEEKLIGHT_EXECUTABLE
  ? { executablePath: path.resolve(process.env.WEEKLIGHT_EXECUTABLE), args: [], env } : { args: [root], env });
const key = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
const baseDate = (new Date().getFullYear() + 1) + '-06-10';
const day = offset => { const date = new Date(baseDate + 'T12:00:00'); date.setDate(date.getDate() + offset); return key(date); };
const draft = { title: '重复批次验证', date: baseDate, time: '09:00', duration: 30, category: 'study', reminder: -1, priority: 'normal', notes: '' };
const oldStamp = 1700000000000;
const seedTask = (id, title, offset, patch = {}) => ({ ...draft, id, title, date: day(offset), done: false, createdAt: oldStamp, updatedAt: oldStamp, ...patch });
const legacy = Array.from({ length: 4 }, (_, index) => seedTask('legacy-' + index, '旧版候选验证', index));
const unrelated = seedTask('legacy-unrelated', '旧版候选验证', 4, { createdAt: oldStamp + 1 });
const reminderTasks = Array.from({ length: 3 }, (_, index) => seedTask('popup-series-' + index, '提醒批次验证', 14 + index, { seriesId: 'popup-series', seriesIndex: index }));
const checks = [], errors = [];
const readState = page => page.evaluate(() => window.weeklight.get());
const details = tasks => tasks.map(task => ({ id: task.id, title: task.title, date: task.date, time: task.time,
  duration: task.duration, category: task.category, reminder: task.reminder, priority: task.priority, notes: task.notes,
  done: task.done, createdAt: task.createdAt, seriesId: task.seriesId, seriesIndex: task.seriesIndex,
  notifiedAt: task.notifiedAt ?? null, snoozeUntil: task.snoozeUntil ?? null })).sort((a, b) => a.id.localeCompare(b.id));
const track = page => page.on('pageerror', error => errors.push(error.message));
async function pageFor(app, suffix) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    const page = app.windows().find(item => item.url().endsWith(suffix));
    if (page) { track(page); return page; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Missing window: ' + suffix);
}
async function createSeries(page, title, offset = 0, count = 5) {
  const before = new Set((await readState(page)).tasks.map(task => task.id));
  const state = await page.evaluate(({ draft, until }) => window.weeklight.saveTask(draft, { frequency: 'daily', until }),
    { draft: { ...draft, title, date: day(offset) }, until: day(offset + count - 1) });
  return state.tasks.filter(task => !before.has(task.id)).sort((a, b) => a.seriesIndex - b.seriesIndex);
}
async function expectDialog(page, source, count) {
  await page.waitForSelector('#task-action-dialog[open]');
  assert.equal(await page.locator('#task-action-dialog').getAttribute('data-source'), source);
  assert.equal(await page.locator('#task-action-following-count').innerText(), count + ' 项');
  assert.equal(await page.locator('[name=task-action-scope][value=single]').isChecked(), true);
  assert.equal(await page.locator('#task-action-items li').count(), count);
}
async function confirm(page, scope = 'following') {
  await page.locator('[name=task-action-scope][value=' + scope + ']').check();
  await page.locator('#task-action-confirm').click();
  await page.waitForSelector('#task-action-dialog', { state: 'detached' });
}
async function editDelete(page, id) {
  await page.locator('#calendar [data-task="' + id + '"]').click();
  await page.waitForFunction(() => document.querySelector('#editor').open);
  await page.locator('#delete-task').click();
}
async function expectChecked(page, ids) {
  await page.waitForFunction(ids => ids.every(id => document.querySelector('#calendar [data-toggle="' + id + '"]')?.classList.contains('checked')), ids);
}
async function cleanup() {
  const resolved = path.resolve(dataDir);
  assert.equal(path.dirname(resolved), path.resolve(workRoot));
  assert.ok(path.basename(resolved).startsWith('task-series-ui-'));
  const entry = await fs.lstat(resolved).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!entry) return;
  assert.equal(entry.isSymbolicLink(), false);
  const [actualData, actualWork] = await Promise.all([fs.realpath(resolved), fs.realpath(workRoot)]);
  assert.equal(path.dirname(actualData), actualWork, 'Cleanup must remain inside _work');
  await fs.rm(resolved, { recursive: true, force: true });
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'plans.json'), JSON.stringify({ version: 1,
    tasks: [...legacy, unrelated, ...reminderTasks], settings: { sound: false, popup: true, checkUpdates: false },
    history: [{ id: 'seed-popup-history', taskId: reminderTasks[0].id, at: oldStamp, dismissed: false }] }), 'utf8');
  let app, failure, version, cleaned = false, tasksPersisted = 0, capturedNotifications = 0, networkRequests = 0;
  try {
    app = await launch();
    let main = await pageFor(app, '/index.html');
    await main.waitForSelector('.month-grid');
    version = await app.evaluate(({ app }) => app.getVersion());
    await app.evaluate(({ Notification, net }) => {
      globalThis.__seriesNotifications = []; globalThis.__seriesNetworkRequests = 0;
      Notification.isSupported = () => true;
      Notification.prototype.show = function () { globalThis.__seriesNotifications.push({ title: this.title, body: this.body }); };
      net.fetch = async () => { globalThis.__seriesNetworkRequests++; throw new Error('Network disabled by isolated regression test'); };
    });
    let state = await readState(main);
    assert.equal(path.resolve(state.dataDir), dataDir);
    assert.equal(state.settings.checkUpdates, false);
    const a = await createSeries(main, draft.title), b = await createSeries(main, draft.title);
    assert.notEqual(a[0].seriesId, b[0].seriesId);
    await main.locator('[data-mode=list]').click();
    await main.locator('#jump-date').fill(baseDate); await main.locator('#jump-date').dispatchEvent('change');

    await main.locator('#calendar [data-toggle="' + a[2].id + '"]').click();
    await expectDialog(main, 'series', 3);
    await main.locator('#task-action-dialog').screenshot({ path: path.join(output, 'series-action-dialog.png') });
    await confirm(main);
    state = await readState(main);
    assert.deepEqual(a.map(task => state.tasks.find(item => item.id === task.id).done), [false, false, true, true, true]);
    assert.ok(b.every(task => !state.tasks.find(item => item.id === task.id).done));
    checks.push('main list completes index 2 and its two successors without changing the identically named second batch');

    const beforeCancel = details(state.tasks);
    await main.locator('#calendar [data-toggle="' + a[0].id + '"]').click();
    await expectDialog(main, 'series', 5); await main.locator('#task-action-cancel').click();
    await main.waitForSelector('#task-action-dialog', { state: 'detached' });
    assert.deepEqual(details((await readState(main)).tasks), beforeCancel);
    await main.locator('#calendar [data-toggle="' + a[0].id + '"]').click();
    await expectDialog(main, 'series', 5); await confirm(main, 'single');
    state = await readState(main);
    assert.equal(state.tasks.find(task => task.id === a[0].id).done, true);
    assert.deepEqual(details(state.tasks.filter(task => task.id !== a[0].id)), beforeCancel.filter(task => task.id !== a[0].id));
    checks.push('cancel does nothing and the default single scope changes only the selected occurrence');

    await editDelete(main, a[3].id); await expectDialog(main, 'series', 2); await confirm(main);
    await main.waitForFunction(() => !document.querySelector('#editor').open);
    state = await readState(main);
    assert.ok(a.slice(3).every(task => !state.tasks.some(item => item.id === task.id)));
    assert.ok(a.slice(0, 3).every(task => state.tasks.some(item => item.id === task.id)));
    assert.deepEqual(details(state.tasks.filter(task => task.seriesId === b[0].seriesId)), details(b));
    checks.push('editor deletion removes only the selected occurrence and later original indices');

    await editDelete(main, b[1].id); await expectDialog(main, 'series', 4);
    await main.locator('[name=task-action-scope][value=following]').check();
    await main.evaluate(task => window.weeklight.saveTask({ ...task, title: '确认期间已修改' }, 1), b[2]);
    const afterConcurrentEdit = await readState(main);
    await main.locator('#task-action-confirm').click();
    await main.waitForFunction(() => document.querySelector('#task-action-error').textContent.includes('发生变化'));
    assert.equal(await main.locator('#task-action-dialog').evaluate(dialog => dialog.open), true);
    assert.equal(await main.locator('#task-action-error').isVisible(), true);
    assert.deepEqual(details((await readState(main)).tasks), details(afterConcurrentEdit.tasks));
    await main.locator('#task-action-cancel').click();
    await main.locator('#editor .close-dialog').first().click();
    checks.push('a concurrent IPC edit invalidates the confirmation and leaves the dialog open without deleting data');

    const singleDelete = await createSeries(main, '单项删除并发验证', 0, 3);
    await editDelete(main, singleDelete[0].id); await expectDialog(main, 'series', 3);
    await main.evaluate(task => window.weeklight.saveTask({ ...task, title: '所选事项已被修改', notes: '删除确认打开之后保存的内容' }, 1), singleDelete[0]);
    const afterSingleEdit = await readState(main);
    await main.locator('#task-action-confirm').click();
    await main.waitForFunction(() => document.querySelector('#task-action-error').textContent.includes('发生变化'));
    assert.equal(await main.locator('#task-action-dialog').evaluate(dialog => dialog.open), true);
    assert.equal(await main.locator('#task-action-error').isVisible(), true);
    assert.equal(await main.locator('[name=task-action-scope][value=single]').isChecked(), true);
    assert.deepEqual((await readState(main)).tasks, afterSingleEdit.tasks);
    await main.locator('#task-action-cancel').click();
    await main.waitForSelector('#task-action-dialog', { state: 'detached' });
    await main.locator('#editor .close-dialog').first().click();
    checks.push('default single deletion rejects an edit to the selected task and preserves all task data');

    await editDelete(main, singleDelete[0].id); await expectDialog(main, 'series', 3);
    assert.equal(await main.locator('#task-action-task-title').innerText(), '所选事项已被修改');
    await main.evaluate(task => window.weeklight.saveTask({ ...task, title: '后续事项独立修改', notes: '仅删除当前项时保留此修改' }, 1), singleDelete[1]);
    const afterFollowingEdit = await readState(main);
    await main.locator('#task-action-confirm').click();
    await main.waitForSelector('#task-action-dialog', { state: 'detached' });
    await main.waitForFunction(() => !document.querySelector('#editor').open);
    state = await readState(main);
    assert.deepEqual(state.tasks, afterFollowingEdit.tasks.filter(task => task.id !== singleDelete[0].id));
    assert.equal(state.tasks.find(task => task.id === singleDelete[1].id).title, '后续事项独立修改');
    checks.push('a fresh single deletion succeeds after another occurrence changes and preserves that later edit');


    await main.locator('#calendar [data-toggle="legacy-1"]').click();
    await expectDialog(main, 'legacy', 3);
    assert.equal(await main.locator('#task-action-preview').evaluate(details => details.open), true);
    assert.equal(await main.locator('#task-action-legacy-warning').isVisible(), true);
    assert.deepEqual(await main.locator('#task-action-items li').evaluateAll(items => items.map(item => item.dataset.taskId)), ['legacy-1', 'legacy-2', 'legacy-3']);
    await main.locator('#task-action-dialog').screenshot({ path: path.join(output, 'legacy-action-dialog.png') });
    await confirm(main);
    state = await readState(main);
    assert.deepEqual(legacy.map(task => state.tasks.find(item => item.id === task.id).done), [false, true, true, true]);
    assert.equal(state.tasks.find(task => task.id === unrelated.id).done, false);
    assert.ok(state.tasks.filter(task => task.id.startsWith('legacy-')).every(task => task.seriesId === undefined));
    await editDelete(main, 'legacy-2'); await expectDialog(main, 'legacy', 2); await confirm(main);
    await main.waitForFunction(() => !document.querySelector('#editor').open);
    state = await readState(main);
    assert.deepEqual(state.tasks.filter(task => task.id.startsWith('legacy-')).map(task => task.id).sort(), ['legacy-0', 'legacy-1', 'legacy-unrelated']);
    checks.push('legacy candidates expand for inspection, require confirmation and exclude same-title tasks from a different creation');

    await main.locator('#calendar [data-task="' + b[0].id + '"]').click();
    await main.waitForFunction(() => document.querySelector('#editor').open);
    await main.evaluate(async id => {
      const preview = await window.weeklight.previewTaskAction(id, 'delete');
      return window.weeklight.applyTaskAction({ id, action: 'delete', scope: 'single', token: preview.singleToken });
    }, b[0].id);
    const afterDeletion = details((await readState(main)).tasks);
    await main.locator('#task-form [name=title]').fill('旧编辑器不得恢复已删事项');
    await main.locator('#task-form [type=submit]').click();
    await main.waitForFunction(() => document.querySelector('#form-error').textContent.includes('已被删除'));
    assert.equal(await main.locator('#editor').evaluate(dialog => dialog.open), true);
    assert.deepEqual(details((await readState(main)).tasks), afterDeletion);
    await main.locator('#editor .close-dialog').first().click();
    checks.push('saving a stale editor after deletion reports an error and cannot resurrect the task');

    const w = await createSeries(main, '便签批次验证', 7);
    await main.evaluate(anchor => window.weeklight.widgetSettings({ mode: 'day', anchor }), w[2].date);
    await main.evaluate(() => window.weeklight.openWidget());
    const widget = await pageFor(app, '/widget.html');
    await widget.waitForSelector('#pending-list [data-toggle="' + w[2].id + '"]');
    await widget.locator('#pending-list [data-toggle="' + w[2].id + '"]').click();
    await expectDialog(widget, 'series', 3); await confirm(widget);
    state = await readState(main);
    assert.deepEqual(w.map(task => state.tasks.find(item => item.id === task.id).done), [false, false, true, true, true]);
    await widget.locator('#done-list [data-toggle="' + w[2].id + '"]').waitFor();
    await expectChecked(main, w.slice(2).map(task => task.id));
    checks.push('the real widget completion control offers following scope and synchronizes the main list');

    await main.evaluate(anchor => window.weeklight.widgetSettings({ mode: 'day', anchor }), reminderTasks[1].date);
    await widget.locator('#pending-list [data-toggle="' + reminderTasks[1].id + '"]').waitFor();
    await main.evaluate(() => window.weeklight.testReminder());
    const popup = await pageFor(app, '/reminder.html');
    await popup.waitForSelector('[data-id="' + reminderTasks[0].id + '"][data-action=done]');
    await popup.locator('[data-id="' + reminderTasks[0].id + '"][data-action=done]').click();
    await expectDialog(popup, 'series', 3); await confirm(popup);
    state = await readState(main);
    assert.ok(reminderTasks.every(task => state.tasks.find(item => item.id === task.id).done));
    assert.ok(state.history.filter(item => item.taskId === reminderTasks[0].id).every(item => item.dismissed));
    await popup.waitForFunction(() => document.querySelectorAll('.reminder-row').length === 0);
    await widget.locator('#done-list [data-toggle="' + reminderTasks[1].id + '"]').waitFor();
    await expectChecked(main, reminderTasks.map(task => task.id));
    capturedNotifications = await app.evaluate(() => globalThis.__seriesNotifications.length);
    networkRequests = await app.evaluate(() => globalThis.__seriesNetworkRequests);
    assert.equal(capturedNotifications, 1); assert.equal(networkRequests, 0);
    checks.push('the real reminder completion control applies following scope and synchronizes popup, widget and main window');
    tasksPersisted = state.tasks.length;
    assert.deepEqual(errors, []);
  } catch (error) { failure = error; }
  finally {
    if (app) { try { await app.close(); } catch (error) { failure ||= error; } }
    try { await cleanup(); cleaned = true; } catch (error) { failure ||= error; }
    const result = { passed: !failure, version, checks, tasksPersisted, capturedNotifications, networkRequests,
      rendererErrors: errors, isolatedDataRemoved: cleaned, ...(failure ? { error: failure.message } : {}) };
    await fs.writeFile(path.join(output, 'task-series-desktop-tests.json'), JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify(result));
  }
  if (failure) throw failure;
})().catch(error => { console.error(error); process.exitCode = 1; });
