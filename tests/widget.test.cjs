const test = require('node:test');
const assert = require('node:assert/strict');
const { dateKey, normalizePrefs, getRange, selectTasks, groupTasks, isPastPlanTime } = require('../src/widget-model.cjs');
const { validateState } = require('../src/core.cjs');

const defaults = {
  enabled: false, mode: 'day', anchor: null, category: 'all', onTop: false,
  theme: 'sage', showCompleted: true, bounds: null
};
const localDate = value => new Date(value + 'T12:00:00');
const ids = tasks => tasks.map(task => task.id).sort();
const makeTask = (id, date, overrides = {}) => ({
  id, title: id, date, time: '09:00', duration: 30, category: 'work',
  reminder: -1, done: false, ...overrides
});

test('widget uses the local calendar day near midnight', () => {
  assert.equal(dateKey(new Date(2026, 8, 28, 0, 5)), '2026-09-28');
  assert.equal(dateKey(new Date(2026, 8, 28, 23, 55)), '2026-09-28');
});

test('legacy settings receive usable widget defaults', () => {
  assert.deepEqual(normalizePrefs(), defaults);
  assert.deepEqual(normalizePrefs(null), defaults);
  assert.deepEqual(normalizePrefs({}), defaults);
  const migrated = validateState({ version: 1, tasks: [], settings: { sound: false } });
  assert.equal(migrated.settings.sound, false);
  assert.deepEqual(migrated.settings.widget, defaults);
});

test('widget preferences reject invalid types and unknown choices', () => {
  const invalid = {
    enabled: 'yes', mode: 'month', anchor: '2026-02-30', category: 'unknown',
    onTop: 1, theme: 'black', showCompleted: 'false', bounds: { x: 1, y: 1 }
  };
  assert.deepEqual(normalizePrefs(invalid), defaults);
  for (const value of [false, 'week', 3, []]) {
    assert.deepEqual(normalizePrefs(value), defaults);
  }
});

test('widget anchors accept leap days and reject impossible or noncanonical dates', () => {
  assert.equal(normalizePrefs({ anchor: '2028-02-29' }).anchor, '2028-02-29');
  for (const anchor of ['2026-02-29', '2028-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '2026-09-00', '2026-9-28', '2026-09-28T12:00:00', '', 20260928]) {
    assert.equal(normalizePrefs({ anchor }).anchor, null, String(anchor));
  }
});

test('valid widget preferences survive backup validation without mutating input', () => {
  const prefs = {
    enabled: true, mode: 'week', anchor: '2026-12-31', category: 'study',
    onTop: true, theme: 'lavender', showCompleted: false,
    bounds: { x: 240, y: 120, width: 380, height: 600 }
  };
  const saved = structuredClone(prefs);
  assert.deepEqual(normalizePrefs(prefs), saved);
  assert.deepEqual(prefs, saved);
  const restored = validateState({ version: 1, tasks: [], settings: { widget: prefs } });
  assert.deepEqual(restored.settings.widget, saved);
});

test('day range includes its day and excludes the next local day across year and leap boundaries', () => {
  assert.deepEqual(getRange({ mode: 'day', anchor: '2026-12-31' }, localDate('2026-09-28')), { start: '2026-12-31', end: '2027-01-01' });
  assert.deepEqual(getRange({ mode: 'day', anchor: '2028-02-29' }), { start: '2028-02-29', end: '2028-03-01' });
});

test('week ranges run from Monday to the following Monday across a year', () => {
  for (const anchor of ['2026-12-28', '2026-12-31', '2027-01-03']) {
    assert.deepEqual(getRange({ mode: 'week', anchor }), { start: '2026-12-28', end: '2027-01-04' });
  }
  assert.deepEqual(getRange({ mode: 'week', anchor: '2027-01-04' }), { start: '2027-01-04', end: '2027-01-11' });
});

test('following today advances day and week while a pinned anchor stays fixed', () => {
  assert.deepEqual(getRange({ mode: 'day', anchor: null }, localDate('2026-09-30')), { start: '2026-09-30', end: '2026-10-01' });
  assert.deepEqual(getRange({ mode: 'week', anchor: null }, localDate('2026-10-04')), { start: '2026-09-28', end: '2026-10-05' });
  assert.deepEqual(getRange({ mode: 'week', anchor: null }, localDate('2026-10-05')), { start: '2026-10-05', end: '2026-10-12' });
  assert.deepEqual(getRange({ mode: 'day', anchor: '2026-09-28' }, localDate('2026-10-05')), { start: '2026-09-28', end: '2026-09-29' });
});

test('task selection uses scheduled dates and splits pending and completed in the selected range', () => {
  const tasks = [
    makeTask('previous', '2026-12-27'),
    makeTask('monday', '2026-12-28'),
    makeTask('completed', '2026-12-30', { done: true, updatedAt: localDate('2027-01-15').getTime() }),
    makeTask('sunday', '2027-01-03', { category: 'life' }),
    makeTask('next-week', '2027-01-04')
  ];
  const before = structuredClone(tasks);
  const result = selectTasks(tasks, { mode: 'week', anchor: '2027-01-01' });
  assert.equal(result.start, '2026-12-28');
  assert.equal(result.end, '2027-01-04');
  assert.deepEqual(ids(result.tasks), ['completed', 'monday', 'sunday']);
  assert.deepEqual(ids(result.pending), ['monday', 'sunday']);
  assert.deepEqual(ids(result.done), ['completed']);
  assert.deepEqual(tasks, before);
});

test('daily and category filters affect both pending and completed without including other dates', () => {
  const tasks = [
    makeTask('work-pending', '2026-09-28'),
    makeTask('work-done', '2026-09-28', { done: true }),
    makeTask('study-pending', '2026-09-28', { category: 'study' }),
    makeTask('study-done', '2026-09-28', { category: 'study', done: true }),
    makeTask('life-pending', '2026-09-28', { category: 'life' }),
    makeTask('tomorrow-work', '2026-09-29')
  ];
  const result = selectTasks(tasks, { mode: 'day', anchor: '2026-09-28', category: 'work' });
  assert.deepEqual(ids(result.tasks), ['work-done', 'work-pending']);
  assert.deepEqual(ids(result.pending), ['work-pending']);
  assert.deepEqual(ids(result.done), ['work-done']);
  const all = selectTasks(tasks, { mode: 'day', anchor: '2026-09-28', category: 'all' });
  assert.equal(all.tasks.length, 5);
  assert.equal(all.pending.length, 3);
  assert.equal(all.done.length, 2);
});

test('empty periods return empty lists', () => {
  const result = selectTasks([makeTask('outside', '2026-09-27')], { mode: 'day', anchor: '2026-09-28' });
  assert.deepEqual(result.tasks, []);
  assert.deepEqual(result.pending, []);
  assert.deepEqual(result.done, []);
});

test('hiding completed rows retains completed counts in the shared task model', () => {
  const tasks = [makeTask('pending', '2026-09-28'), makeTask('done', '2026-09-28', { done: true })];
  const result = selectTasks(tasks, { anchor: '2026-09-28', showCompleted: false });
  assert.deepEqual(ids(result.tasks), ['done', 'pending']);
  assert.deepEqual(ids(result.done), ['done']);
});

test('one multi-day task appears on each covered day, including its final day', () => {
  const task = makeTask('report', '2026-11-16', { endDate: '2026-11-30' });
  for (const anchor of ['2026-11-16', '2026-11-22', '2026-11-30']) {
    const selected = selectTasks([task], { mode: 'day', anchor });
    assert.deepEqual(ids(selected.pending), ['report']);
    assert.equal(selected.tasks[0], task);
  }
  for (const anchor of ['2026-11-15', '2026-12-01']) {
    assert.deepEqual(selectTasks([task], { mode: 'day', anchor }).tasks, []);
  }
});

test('weekly widget includes overlapping projects once and groups carry-ins inside the selected week', () => {
  const tasks = [
    makeTask('report', '2026-11-16', { endDate: '2026-11-30' }),
    makeTask('finish-on-monday', '2026-11-20', { endDate: '2026-11-23', done: true }),
    makeTask('previous', '2026-11-19', { endDate: '2026-11-22' }),
    makeTask('new', '2026-11-25'),
    makeTask('next', '2026-11-30')
  ];
  const before = structuredClone(tasks);
  const prefs = { mode: 'week', anchor: '2026-11-26' };
  const result = selectTasks(tasks, prefs);
  assert.deepEqual(ids(result.tasks), ['finish-on-monday', 'new', 'report']);
  assert.equal(result.tasks.length, 3, 'a project is counted once, not once for each day');
  assert.equal(result.done.length, 1);
  assert.deepEqual(groupTasks(result.tasks, prefs).map(g => [g.date, ids(g.tasks)]), [
    ['2026-11-23', ['finish-on-monday', 'report']], ['2026-11-25', ['new']]
  ]);
  assert.deepEqual(tasks, before, 'visible-week grouping never changes the saved start date');
});

test('overlapping tasks retain category and completion filters over a year boundary', () => {
  const tasks = [
    makeTask('report', '2026-12-20', { endDate: '2027-01-02' }),
    makeTask('study', '2026-12-31', { endDate: '2027-01-03', category: 'study' })
  ];
  const prefs = { mode: 'day', anchor: '2027-01-01', category: 'work' };
  assert.deepEqual(ids(selectTasks(tasks, prefs).pending), ['report']);
  tasks[0].done = true;
  const completed = selectTasks(tasks, prefs);
  assert.deepEqual(completed.pending, []);
  assert.deepEqual(ids(completed.done), ['report']);
  assert.deepEqual(ids(selectTasks(tasks, { ...prefs, anchor: '2027-01-02' }).done), ['report']);
});

test('spanning tasks become late after their final calendar day, not after their initial start time', () => {
  const task = makeTask('report', '2026-11-16', { endDate: '2026-11-30' });
  assert.equal(isPastPlanTime(task, new Date('2026-11-16T10:00:00')), false);
  assert.equal(isPastPlanTime(task, new Date('2026-11-30T23:59:59')), false);
  assert.equal(isPastPlanTime(task, new Date('2026-12-01T00:00:00')), true);
  assert.equal(isPastPlanTime({ ...task, done: true }, new Date('2026-12-01T00:00:00')), false);
  const single = makeTask('meeting', '2026-11-16');
  assert.equal(isPastPlanTime(single, new Date('2026-11-16T08:59:59')), false);
  assert.equal(isPastPlanTime(single, new Date('2026-11-16T09:00:01')), true);
});
