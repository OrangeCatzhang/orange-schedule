const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { isDateKey, taskEndDate, occursOn, overlapsRange, spanDays, endDateForDays, shiftTaskDates } = require('../src/task-dates.js');

test('inclusive spans include both endpoints without expanding a task into occurrences', () => {
  const task = Object.freeze({ date: '2026-11-16', endDate: '2026-11-30' });
  assert.equal(spanDays(task), 15);
  assert.equal(taskEndDate(task), '2026-11-30');
  for (const date of ['2026-11-16', '2026-11-23', '2026-11-30']) assert.equal(occursOn(task, date), true);
  for (const date of ['2026-11-15', '2026-12-01']) assert.equal(occursOn(task, date), false);
  assert.equal(spanDays({ date: '2026-11-16' }), 1);
  assert.equal(taskEndDate({ date: '2026-11-16' }), '2026-11-16');
});

test('calendar overlap includes tasks that started before a view and excludes the next view boundary', () => {
  const range = ['2026-11-01', '2026-12-01'];
  for (const task of [
    { date: '2026-10-20', endDate: '2026-11-01' },
    { date: '2026-11-30', endDate: '2026-12-02' },
    { date: '2026-10-01', endDate: '2027-01-01' },
    { date: '2026-11-30' }
  ]) assert.equal(overlapsRange(task, ...range), true);
  for (const task of [
    { date: '2026-10-01', endDate: '2026-10-31' },
    { date: '2026-12-01' },
    { date: '2026-12-01', endDate: '2026-12-05' }
  ]) assert.equal(overlapsRange(task, ...range), false);
  assert.equal(overlapsRange({ date: '2026-11-01' }, '2026-11-01', '2026-11-01'), false);
});

test('day count and shifting use calendar days across leap years, DST dates and year boundaries', () => {
  for (const [start, days, end] of [
    ['2026-11-16', 15, '2026-11-30'], ['2028-02-28', 3, '2028-03-01'],
    ['2027-02-28', 2, '2027-03-01'], ['2026-03-07', 3, '2026-03-09'],
    ['2026-10-31', 3, '2026-11-02'], ['2026-12-31', 2, '2027-01-01']
  ]) {
    assert.equal(endDateForDays(start, days), end);
    assert.equal(spanDays({ date: start, endDate: end }), days);
  }
  const task = Object.freeze({ date: '2026-11-16', endDate: '2026-11-30' });
  assert.deepEqual(shiftTaskDates(task, '2026-12-25'), { date: '2026-12-25', endDate: '2027-01-08' });
  assert.deepEqual(shiftTaskDates({ date: '2026-11-16' }, '2026-12-01'), { date: '2026-12-01' });
});

test('invalid dates, day counts and dates beyond the four-digit year are rejected', () => {
  for (const value of [null, undefined, '', '2026-2-01', '2026-02-29', '2026-02-30', '2026-13-01', '10000-01-01', '2026-11-16T00:00:00']) assert.equal(isDateKey(value), false);
  assert.equal(isDateKey('2028-02-29'), true);
  for (const days of [0, -1, 1.5, NaN, Infinity, '15', Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => endDateForDays('2026-11-16', days));
  assert.throws(() => endDateForDays('2026-02-30', 1));
  assert.equal(endDateForDays('9999-12-31', 1), '9999-12-31');
  assert.throws(() => endDateForDays('9999-12-31', 2));
  assert.throws(() => shiftTaskDates({ date: '2026-11-16', endDate: '2026-11-30' }, '9999-12-31'));
});

test('browser and Node expose the same date functions', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../src/task-dates.js'), 'utf8'), context);
  assert.equal(context.WeeklightDates.endDateForDays('2026-11-16', 15), '2026-11-30');
  assert.equal(context.WeeklightDates.spanDays({ date: '2028-02-28', endDate: '2028-03-01' }), 3);
});
