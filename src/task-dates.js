(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WeeklightDates = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000;
  function isDateKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function ordinal(value) {
    if (!isDateKey(value)) throw new Error('请选择有效日期');
    return Date.parse(value + 'T00:00:00Z') / DAY;
  }
  function taskEndDate(task) { return task.endDate || task.date; }
  function occursOn(task, date) { return task.date <= date && taskEndDate(task) >= date; }
  // Task endpoints are inclusive; view ranges are [start, endExclusive).
  function overlapsRange(task, start, endExclusive) {
    return start < endExclusive && task.date < endExclusive && taskEndDate(task) >= start;
  }
  function spanDays(task) { return ordinal(taskEndDate(task)) - ordinal(task.date) + 1; }
  function endDateForDays(start, days) {
    if (!Number.isSafeInteger(days) || days < 1) throw new Error('持续天数须为正整数');
    const date = new Date((ordinal(start) + days - 1) * DAY);
    if (!Number.isFinite(date.getTime())) throw new Error('计划日期超出支持范围');
    const key = date.toISOString().slice(0, 10);
    if (!isDateKey(key)) throw new Error('计划日期超出支持范围');
    return key;
  }
  function shiftTaskDates(task, newStart) {
    const days = spanDays(task);
    const endDate = endDateForDays(newStart, days);
    return { date: newStart, ...(days > 1 ? { endDate } : {}) };
  }
  return { isDateKey, taskEndDate, occursOn, overlapsRange, spanDays, endDateForDays, shiftTaskDates };
});
