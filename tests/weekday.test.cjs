const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { cleanTask, dueTasks, makeSeries, validateState, dateKey } = require('../src/core.cjs');

const draft = { title: '工作日阅读', date: '2026-10-12', time: '09:00', duration: 30, category: 'study', reminder: 10, priority: 'high', notes: '每个工作日独立记录' };
const weekdays = (start, until) => makeSeries(cleanTask({ ...draft, date: start }), { frequency: 'weekdays', until });
const dates = tasks => tasks.map(task => task.date);
const addDays = (value, days) => { const date = new Date(value + 'T12:00:00'); date.setDate(date.getDate() + days); return dateKey(date); };
const attributes = task => Object.fromEntries(Object.entries(task).filter(([key]) => !['id', 'date', 'seriesId', 'seriesIndex'].includes(key)));
const savedFields = task => ({
  id: task.id, title: task.title, date: task.date, time: task.time, duration: task.duration,
  category: task.category, reminder: task.reminder, priority: task.priority, notes: task.notes,
  done: task.done, createdAt: task.createdAt, notifiedAt: task.notifiedAt ?? null, snoozeUntil: task.snoozeUntil ?? null
});

test('weekdays include Monday through Friday and both weekday endpoints', () => {
  assert.deepEqual(dates(weekdays('2026-10-12', '2026-10-16')),
    ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
  assert.deepEqual(dates(weekdays('2026-10-14', '2026-10-14')), ['2026-10-14']);
});

test('weekdays skip weekends across weeks, month ends, leap days and years', () => {
  const cases = [
    ['2026-10-16', '2026-10-20', ['2026-10-16', '2026-10-19', '2026-10-20']],
    ['2027-01-29', '2027-02-02', ['2027-01-29', '2027-02-01', '2027-02-02']],
    ['2028-02-25', '2028-03-01', ['2028-02-25', '2028-02-28', '2028-02-29', '2028-03-01']],
    ['2026-12-31', '2027-01-04', ['2026-12-31', '2027-01-01', '2027-01-04']]
  ];
  for (const [start, until, expected] of cases) {
    const tasks = weekdays(start, until);
    assert.deepEqual(dates(tasks), expected, `${start} through ${until}`);
    assert.ok(tasks.every(task => [1, 2, 3, 4, 5].includes(new Date(task.date + 'T12:00:00').getDay())));
  }
});

test('weekend starts move the first occurrence to Monday without exceeding the end date', () => {
  for (const start of ['2026-10-17', '2026-10-18']) {
    const base = Object.freeze(cleanTask({ ...draft, date: start }));
    const tasks = makeSeries(base, Object.freeze({ frequency: 'weekdays', until: '2026-10-20' }));
    assert.deepEqual(dates(tasks), ['2026-10-19', '2026-10-20']);
    assert.equal(tasks[0].id, base.id, 'The first actual occurrence must retain the draft ID');
    assert.equal(base.date, start, 'Moving the first occurrence must not mutate the draft');
  }
  assert.deepEqual(dates(weekdays('2026-10-16', '2026-10-17')), ['2026-10-16']);
  assert.deepEqual(dates(weekdays('2026-10-16', '2026-10-18')), ['2026-10-16']);
});

test('a range containing only Saturday or Sunday reports that no weekdays exist', () => {
  for (const [start, until] of [['2026-10-17', '2026-10-17'], ['2026-10-18', '2026-10-18'], ['2026-10-17', '2026-10-18']]) {
    assert.throws(() => weekdays(start, until), /没有工作日/);
  }
});

test('weekday occurrences have independent objects and IDs while retaining all task attributes', () => {
  const base = Object.freeze(cleanTask({ ...draft, date: '2026-10-17' }));
  const before = structuredClone(base);
  const options = Object.freeze({ frequency: 'weekdays', until: '2026-10-23' });
  const tasks = makeSeries(base, options);
  assert.equal(tasks.length, 5);
  assert.equal(new Set(tasks).size, 5);
  assert.equal(new Set(tasks.map(task => task.id)).size, 5);
  assert.equal(tasks[0].id, base.id);
  for (const task of tasks) {
    assert.notEqual(task, base);
    assert.deepEqual(attributes(task), attributes(base));
  }
  assert.deepEqual(base, before);
  assert.deepEqual(options, { frequency: 'weekdays', until: '2026-10-23' });
});

test('editing or completing one weekday does not modify the other occurrences', () => {
  const tasks = weekdays('2026-10-12', '2026-10-16');
  const before = structuredClone(tasks);
  tasks[1] = cleanTask({ ...tasks[1], title: '仅修改星期二', time: '11:30', notes: '当天备注' }, tasks[1]);
  tasks[1].done = true;
  assert.equal(tasks[1].id, before[1].id);
  assert.equal(tasks[1].date, before[1].date);
  assert.equal(tasks[1].time, '11:30');
  assert.deepEqual(tasks.filter((_, index) => index !== 1), before.filter((_, index) => index !== 1));
  assert.deepEqual(dueTasks(tasks, new Date('2026-10-17T12:00:00').getTime()).map(task => task.id),
    before.filter((_, index) => index !== 1).map(task => task.id));
});

test('weekday reminders fire at separate thresholds and have no Saturday or Sunday occurrence', () => {
  const tasks = weekdays('2026-10-16', '2026-10-20');
  for (const task of tasks) {
    const threshold = new Date(task.date + 'T08:50:00').getTime();
    assert.deepEqual(dueTasks(tasks, threshold - 1), []);
    assert.deepEqual(dueTasks(tasks, threshold).map(item => item.id), [task.id]);
    task.notifiedAt = threshold;
    assert.deepEqual(dueTasks(tasks, threshold), []);
    if (task.date === '2026-10-16') {
      for (const weekend of ['2026-10-17', '2026-10-18'])
        assert.deepEqual(dueTasks(tasks, new Date(weekend + 'T23:59:00').getTime()), []);
    }
  }
});

test('backup restart preserves every weekday and its separate completion and reminder state', () => {
  const tasks = weekdays('2026-10-16', '2026-10-21');
  tasks[0].done = true;
  tasks[1].notifiedAt = new Date('2026-10-19T08:50:00').getTime();
  tasks[2].notifiedAt = new Date('2026-10-20T08:50:00').getTime();
  tasks[2].snoozeUntil = new Date('2026-10-20T09:00:00').getTime();
  const backup = { version: 1, tasks, settings: { sound: false }, history: [] };
  const serialized = JSON.stringify(backup);
  const restored = validateState(JSON.parse(serialized));
  assert.equal(restored.tasks.length, 4);
  assert.deepEqual(restored.tasks.map(savedFields), tasks.map(savedFields));
  assert.equal(restored.settings.sound, false);
  assert.equal(JSON.stringify(backup), serialized);
  assert.deepEqual(dueTasks(restored.tasks, tasks[2].snoozeUntil - 1), []);
  assert.deepEqual(dueTasks(restored.tasks, tasks[2].snoozeUntil).map(task => task.id), [tasks[2].id]);
  restored.tasks[2].snoozeUntil = null;
  assert.deepEqual(dueTasks(restored.tasks, new Date('2026-10-21T08:50:00').getTime()).map(task => task.id), [tasks[3].id]);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(restored))).tasks.map(savedFields), restored.tasks.map(savedFields));
});

test('weekdays reject missing, malformed, impossible and reversed end dates', () => {
  for (const until of [undefined, null, false, 20261016, '', '2026-10-11', '2026-2-13', '2026-02-30', '2027-02-29', '2026-13-01', '2026-10-16T12:00:00', 'invalid']) {
    assert.throws(() => weekdays('2026-10-12', until), `Must reject ${String(until)}`);
  }
});

test('the 10000 limit counts actual weekdays and rejects excess before allocating task IDs', context => {
  const base = Object.freeze(cleanTask({ ...draft, date: '2026-10-12' }));
  // 2000 complete calendar weeks contain exactly 10000 Monday-Friday occurrences.
  const lastFriday = addDays(base.date, 1999 * 7 + 4);
  const lastSunday = addDays(base.date, 1999 * 7 + 6);
  const tasks = makeSeries(base, { frequency: 'weekdays', until: lastSunday });
  assert.equal(tasks.length, 10000);
  assert.equal(tasks.at(-1).date, lastFriday);
  assert.equal(new Set(tasks.map(task => task.id)).size, 10000);
  let allocatedIds = 0;
  context.mock.method(crypto, 'randomUUID', () => { allocatedIds++; return 'unexpected-allocation-' + allocatedIds; });
  assert.throws(() => makeSeries(base, { frequency: 'weekdays', until: addDays(lastSunday, 1) }), /10000/);
  assert.equal(allocatedIds, 0, 'Over-limit generation must reject before materializing tasks');
});

test('weekday support preserves daily weekends, daily capacity and numeric weekly calls', () => {
  const base = cleanTask({ ...draft, date: '2026-10-16' });
  assert.deepEqual(dates(makeSeries(base, { frequency: 'daily', until: '2026-10-19' })),
    ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19']);
  assert.throws(() => makeSeries(base, { frequency: 'daily', until: addDays(base.date, 10000) }), /10000/);
  for (const count of [1, 4, 8, 12]) {
    const tasks = makeSeries(base, count);
    assert.equal(tasks.length, count);
    assert.equal(tasks[0].date, base.date);
    assert.equal(tasks.at(-1).date, addDays(base.date, (count - 1) * 7));
  }
});
