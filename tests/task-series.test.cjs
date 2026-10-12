const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSeriesTasks, previewTaskAction, applyTaskAction } = require('../src/task-series.cjs');
const { cleanTask, makeSeries, validateState } = require('../src/core.cjs');

const stamp = 1700000000000;
const draft = { title: '重复阅读', date: '2030-06-10', time: '09:00', duration: 30, category: 'study', reminder: 10, priority: 'normal', notes: '每天独立记录' };
const task = (id, date, patch = {}) => ({
  ...draft, id, date, done: false, createdAt: stamp, updatedAt: stamp,
  notifiedAt: null, snoozeUntil: null, ...patch
});
const series = (id = 'series-a', count = 4) => Array.from({ length: count }, (_, index) => task(id + '-' + index, '2030-06-' + String(10 + index).padStart(2, '0'), { seriesId: id, seriesIndex: index }));
const legacy = () => Array.from({ length: 4 }, (_, index) => task('legacy-' + index, '2030-06-' + (10 + index)));
const stateOf = tasks => ({
  version: 1, tasks, settings: { sound: false, popup: false },
  history: tasks.flatMap((item, index) => [
    { id: 'history-' + item.id, taskId: item.id, at: stamp + index, dismissed: false },
    { id: 'old-history-' + item.id, taskId: item.id, at: stamp - 100 + index, dismissed: true }
  ])
});
const ids = items => items.map(item => item.id);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const view = item => ({ id: item.id, title: item.title, date: item.date, time: item.time, done: item.done });
const applyFollowing = (state, id, action) => {
  const preview = previewTaskAction(state.tasks, id, action);
  applyTaskAction(state, { id, action, scope: 'following', token: preview.token });
  return preview;
};
function rejectWithoutMutation(state, request) {
  const before = structuredClone(state);
  assert.throws(() => applyTaskAction(state, request));
  assert.deepEqual(state, before, 'Rejected operations must not partially change tasks, history or settings');
}

test('series validation allows legacy single tasks and gaps in immutable occurrence indices', () => {
  const tasks = [task('plain', '2030-06-10'), ...series().filter(item => item.seriesIndex !== 1), task('last', '2030-07-01', { seriesId: 'series-a', seriesIndex: 9999 })];
  const before = structuredClone(tasks);
  assert.doesNotThrow(() => validateSeriesTasks(freeze(tasks)));
  assert.deepEqual(tasks, before);
  assert.doesNotThrow(() => validateSeriesTasks([...series('group-a', 2), ...series('group-b', 2)]));
});

test('series validation rejects malformed metadata pairs, IDs and occurrence indices', () => {
  const invalid = [
    { seriesId: 'group' }, { seriesIndex: 0 }, { seriesId: null, seriesIndex: 0 },
    { seriesId: 'group', seriesIndex: null }, { seriesId: '', seriesIndex: 0 },
    { seriesId: 12, seriesIndex: 0 }, { seriesId: 'bad/id', seriesIndex: 0 },
    { seriesId: 'contains space', seriesIndex: 0 }, { seriesId: 'x'.repeat(81), seriesIndex: 0 },
    ...[-1, 10000, 0.5, '0', NaN, Infinity].map(seriesIndex => ({ seriesId: 'group', seriesIndex }))
  ];
  for (const metadata of invalid) assert.throws(() => validateSeriesTasks([task('bad', draft.date, metadata)]));
  assert.throws(() => validateSeriesTasks([
    task('one', draft.date, { seriesId: 'group', seriesIndex: 2 }),
    task('two', '2030-06-11', { seriesId: 'group', seriesIndex: 2 })
  ]));
});

test('new daily, weekday and weekly batches receive separate identities and sequential indices', () => {
  const configurations = [4, 8, 12, { frequency: 'daily', until: '2030-06-12' }, { frequency: 'weekdays', until: '2030-06-14' }, { frequency: 'daily', until: draft.date }];
  const groupIds = new Set();
  for (const repeat of configurations) {
    const original = Object.freeze(cleanTask(draft));
    const tasks = makeSeries(original, repeat);
    assert.ok(typeof tasks[0].seriesId === 'string' && tasks[0].seriesId.length > 0);
    assert.ok(!groupIds.has(tasks[0].seriesId), 'Separate creations must never share a series identity');
    groupIds.add(tasks[0].seriesId);
    assert.equal(new Set(tasks.map(item => item.seriesId)).size, 1);
    assert.deepEqual(tasks.map(item => item.seriesIndex), tasks.map((_, index) => index));
    assert.equal(new Set(tasks.map(item => item.id)).size, tasks.length);
    assert.equal(tasks[0].id, original.id);
    assert.equal(original.seriesId, undefined);
    validateSeriesTasks(tasks);
  }
  const single = makeSeries(cleanTask(draft), 1)[0];
  assert.equal(single.seriesId, undefined);
  assert.equal(single.seriesIndex, undefined);
  const weekendBase = cleanTask({ ...draft, date: '2030-06-15' });
  const weekendTasks = makeSeries(weekendBase, { frequency: 'weekdays', until: '2030-06-18' });
  assert.equal(weekendTasks[0].date, '2030-06-17');
  assert.equal(weekendTasks[0].id, weekendBase.id);
  assert.deepEqual(weekendTasks.map(item => item.seriesIndex), [0, 1]);
});

test('ordinary task input cannot forge a series and edits preserve trusted series identity', () => {
  const fresh = cleanTask({ ...draft, seriesId: 'forged-group', seriesIndex: 9000 });
  assert.equal(fresh.seriesId, undefined);
  assert.equal(fresh.seriesIndex, undefined);
  const original = series()[2];
  const edited = cleanTask({ ...original, title: '改名后的事项', date: '2030-05-01', time: '11:00', seriesId: 'forged-group', seriesIndex: 0 }, original);
  assert.equal(edited.seriesId, original.seriesId);
  assert.equal(edited.seriesIndex, 2);
  assert.equal(edited.date, '2030-05-01');
  const withoutInputMetadata = { ...original, title: '不发送隐藏字段' };
  delete withoutInputMetadata.seriesId;
  delete withoutInputMetadata.seriesIndex;
  const saved = cleanTask(withoutInputMetadata, original);
  assert.equal(saved.seriesId, original.seriesId);
  assert.equal(saved.seriesIndex, 2);
});

test('series preview follows original indices after moves and ignores identically named other groups', () => {
  const a = series();
  a[0].date = '2030-12-31';
  a[1].date = '2030-08-01';
  a[2].date = '2030-05-01';
  a[3].title = '同组已经改名';
  const tasks = [a[3], ...series('series-b'), a[0], task('same-name-single', draft.date), a[2], a[1]];
  const before = structuredClone(tasks);
  const preview = previewTaskAction(freeze(tasks), a[1].id, 'complete');
  assert.equal(preview.source, 'series');
  assert.deepEqual(preview.task, view(a[1]));
  assert.deepEqual(preview.items, [a[1], a[2], a[3]].map(view));
  assert.equal(preview.followingCount, 3);
  assert.ok(typeof preview.token === 'string' && preview.token.length > 0);
  assert.deepEqual(tasks, before);
});

test('single scope changes exactly the selected task even when a following group exists', () => {
  for (const action of ['complete', 'reopen', 'delete']) {
    const state = stateOf(series());
    state.tasks[1].done = action === 'reopen';
    const before = structuredClone(state);
    const token = action === 'delete' ? previewTaskAction(state.tasks, state.tasks[1].id, action).singleToken : undefined;
    applyTaskAction(state, { id: state.tasks[1].id, action, scope: 'single', token });
    assert.deepEqual(state.tasks.filter(item => item.id !== before.tasks[1].id), before.tasks.filter(item => item.id !== before.tasks[1].id));
    assert.deepEqual(state.history.filter(item => item.taskId !== before.tasks[1].id), before.history.filter(item => item.taskId !== before.tasks[1].id));
    if (action === 'delete') assert.equal(state.tasks.some(item => item.id === before.tasks[1].id), false);
    else assert.equal(state.tasks.find(item => item.id === before.tasks[1].id).done, action === 'complete');
  }
});

test('following completion is idempotent for mixed done states and clears every affected reminder', () => {
  const tasks = [...series(), ...series('series-b', 2)];
  tasks[2].done = true;
  tasks.forEach(item => { item.snoozeUntil = stamp + 100000; });
  const state = stateOf(tasks), before = structuredClone(state);
  const selected = tasks[1].id;
  const affected = new Set(tasks.slice(1, 4).map(item => item.id));
  applyFollowing(state, selected, 'complete');
  assert.ok(state.tasks.filter(item => affected.has(item.id)).every(item => item.done && item.snoozeUntil === null));
  assert.ok(state.history.filter(item => affected.has(item.taskId)).every(item => item.dismissed));
  assert.deepEqual(state.tasks.filter(item => !affected.has(item.id)), before.tasks.filter(item => !affected.has(item.id)));
  assert.deepEqual(state.history.filter(item => !affected.has(item.taskId)), before.history.filter(item => !affected.has(item.taskId)));
  applyFollowing(state, selected, 'complete');
  assert.ok(state.tasks.filter(item => affected.has(item.id)).every(item => item.done));
  applyFollowing(state, selected, 'reopen');
  assert.ok(state.tasks.filter(item => affected.has(item.id)).every(item => !item.done));
  assert.deepEqual(state.tasks.filter(item => !affected.has(item.id)), before.tasks.filter(item => !affected.has(item.id)));
});

test('following deletion respects immutable indices and removes only matching task history', () => {
  const a = series('series-a', 5).filter(item => item.seriesIndex !== 3);
  a[0].date = '2031-01-01';
  a[2].date = '2030-05-01';
  const state = stateOf([...a, ...series('series-b', 2)]);
  const deleted = new Set([a[2].id, a[3].id]);
  const before = structuredClone(state);
  applyFollowing(state, a[2].id, 'delete');
  assert.deepEqual(state.tasks, before.tasks.filter(item => !deleted.has(item.id)));
  assert.deepEqual(state.history, before.history.filter(item => !deleted.has(item.taskId)));
  assert.deepEqual(state.tasks.filter(item => item.seriesId === 'series-a').map(item => item.seriesIndex), [0, 1]);
  assert.deepEqual(state.settings, before.settings);
});

test('legacy candidate previews require exact creation evidence and never establish groups automatically', () => {
  const candidates = legacy();
  const mismatches = [
    { createdAt: stamp + 1 }, { title: '另一标题' }, { time: '10:00' }, { duration: 60 },
    { category: 'work' }, { reminder: 30 }, { priority: 'high' }, { notes: '另一备注' },
    { seriesId: 'already-linked', seriesIndex: 0 }
  ].map((patch, index) => task('different-' + index, '2030-06-20', patch));
  const tasks = [candidates[3], ...mismatches, candidates[0], candidates[2], candidates[1]];
  const before = structuredClone(tasks);
  const preview = previewTaskAction(freeze(tasks), candidates[1].id, 'delete');
  assert.equal(preview.source, 'legacy');
  assert.equal(preview.followingCount, 3);
  assert.deepEqual(ids(preview.items), [candidates[1].id, candidates[2].id, candidates[3].id]);
  assert.deepEqual(tasks, before);
  const last = previewTaskAction(tasks, candidates[3].id, 'complete');
  assert.equal(last.source, 'legacy', 'The last member still belongs to a candidate group of at least two');
  assert.equal(last.followingCount, 1);
});

test('legacy following requires confirmation, acts only on the confirmed suffix and leaves metadata absent', () => {
  const candidates = legacy();
  const unrelated = task('unrelated', '2030-06-14', { createdAt: stamp + 1 });
  const state = stateOf([...candidates, unrelated]);
  rejectWithoutMutation(state, { id: candidates[1].id, action: 'complete', scope: 'following' });
  const before = structuredClone(state);
  applyFollowing(state, candidates[1].id, 'complete');
  assert.equal(state.tasks[0].done, false);
  assert.ok(state.tasks.slice(1, 4).every(item => item.done));
  assert.deepEqual(state.tasks[4], before.tasks[4]);
  assert.ok(state.tasks.every(item => item.seriesId === undefined && item.seriesIndex === undefined));
  const afterComplete = structuredClone(state);
  applyFollowing(state, candidates[2].id, 'delete');
  const removed = new Set([candidates[2].id, candidates[3].id]);
  assert.deepEqual(state.tasks, afterComplete.tasks.filter(item => !removed.has(item.id)));
  assert.deepEqual(state.history, afterComplete.history.filter(item => !removed.has(item.taskId)));
});

test('same titles without valid matching timestamps remain unrelated single tasks', () => {
  const single = task('single', draft.date);
  const other = task('other', '2030-06-11', { createdAt: stamp + 1 });
  assert.equal(previewTaskAction([single, other], single.id, 'complete').source, 'single');
  for (const createdAt of [undefined, 0, -1, NaN, Infinity, String(stamp)]) {
    const tasks = [task('one', draft.date, { createdAt }), task('two', '2030-06-11', { createdAt })];
    const preview = previewTaskAction(tasks, 'one', 'complete');
    assert.equal(preview.source, 'single');
    assert.equal(preview.followingCount, 1);
    assert.deepEqual(ids(preview.items), ['one']);
  }
});

test('following refuses missing, tampered and stale preview tokens without partial writes', () => {
  const original = stateOf(series());
  const id = original.tasks[1].id;
  const preview = previewTaskAction(original.tasks, id, 'complete');
  for (const token of [undefined, null, '', 'tampered-' + preview.token])
    rejectWithoutMutation(structuredClone(original), { id, action: 'complete', scope: 'following', token });
  const changes = [
    state => state.tasks.push(task('new-following', '2030-06-20', { seriesId: 'series-a', seriesIndex: 4 })),
    state => { state.tasks = state.tasks.filter(item => item.id !== 'series-a-3'); },
    state => { state.tasks[2].title = '确认后被修改'; },
    state => { state.tasks[2].done = true; }
  ];
  for (const mutate of changes) {
    const state = structuredClone(original);
    mutate(state);
    rejectWithoutMutation(state, { id, action: 'complete', scope: 'following', token: preview.token });
  }
});

test('a confirmation token is bound to its action and selected occurrence', () => {
  const state = stateOf(series());
  const token = previewTaskAction(state.tasks, 'series-a-1', 'complete').token;
  rejectWithoutMutation(state, { id: 'series-a-1', action: 'delete', scope: 'following', token });
  rejectWithoutMutation(state, { id: 'series-a-2', action: 'complete', scope: 'following', token });
});

test('unknown action, scope and task IDs are rejected rather than broadening an operation', () => {
  const state = stateOf(series());
  assert.throws(() => previewTaskAction(state.tasks, 'missing', 'complete'));
  assert.throws(() => previewTaskAction(state.tasks, state.tasks[0].id, 'archive'));
  for (const request of [
    { id: 'missing', action: 'delete', scope: 'single' },
    { id: 'series-a-0', action: 'archive', scope: 'single' },
    { id: 'series-a-0', action: 'complete', scope: 'everything' },
    { id: 'series-a-0', action: 'complete', scope: '' },
    { id: 'series-a-0', action: 'delete', scope: 'following', token: 'not-confirmed' }
  ]) rejectWithoutMutation(state, request);
});

test('backup restart preserves series identity and rejects malformed or conflicting metadata', () => {
  const original = stateOf([...series().filter(item => item.seriesIndex !== 1), task('old-single', '2030-06-20')]);
  original.tasks[1].date = '2030-05-01';
  original.tasks[1].done = true;
  const restored = validateState(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(restored.tasks.map(item => [item.id, item.seriesId, item.seriesIndex, item.date, item.done]), original.tasks.map(item => [item.id, item.seriesId, item.seriesIndex, item.date, item.done]));
  assert.deepEqual(ids(previewTaskAction(restored.tasks, 'series-a-2', 'delete').items), ['series-a-2', 'series-a-3']);
  for (const patch of [{ seriesId: 'group' }, { seriesIndex: 0 }, { seriesId: 'group', seriesIndex: -1 }, { seriesId: 'group', seriesIndex: '0' }]) {
    assert.throws(() => validateState({ version: 1, tasks: [task('bad-backup', draft.date, patch)] }));
  }
  assert.throws(() => validateState({ version: 1, tasks: [
    task('one', draft.date, { seriesId: 'same', seriesIndex: 1 }),
    task('two', '2030-06-11', { seriesId: 'same', seriesIndex: 1 })
  ] }));
});


test('backups without real creation times cannot fabricate a legacy batch', () => {
  const base={title:'旧记录',date:'2027-01-04',time:'09:00',duration:30,category:'work',reminder:-1};
  for(const createdAt of [undefined,null,0,-1,'123',NaN,Infinity]){
    const restored=validateState({version:1,tasks:[{...base,id:'unknown-a',createdAt},{...base,id:'unknown-b',date:'2027-01-05',createdAt}]});
    assert.ok(restored.tasks.every(t=>t.createdAt===0));
    assert.equal(previewTaskAction(restored.tasks,'unknown-a','delete').source,'single');
    const edited=cleanTask({...restored.tasks[0],title:'编辑后'},restored.tasks[0]);
    assert.equal(edited.createdAt,0,'Editing must keep the creation time unknown');
  }
  assert.ok(cleanTask(base).createdAt>0,'Only a newly created task receives the current creation time');
});

test('single deletion rejects missing or stale selected-task confirmation without changing data', () => {
  const state=stateOf(series()), id=state.tasks[1].id;
  const preview=previewTaskAction(state.tasks,id,'delete');
  for(const token of [undefined,'invalid',preview.token]) rejectWithoutMutation(state,{id,action:'delete',scope:'single',token});
  state.tasks[1].title='确认后改名';
  rejectWithoutMutation(state,{id,action:'delete',scope:'single',token:preview.singleToken});
});

test('single deletion remains valid when only other following tasks change', () => {
  const state=stateOf(series()), id=state.tasks[1].id;
  const preview=previewTaskAction(state.tasks,id,'delete');
  state.tasks[2].title='后续事项改名';
  state.tasks.push(task('later','2030-06-20',{seriesId:'series-a',seriesIndex:4}));
  const before=structuredClone(state);
  applyTaskAction(state,{id,action:'delete',scope:'single',token:preview.singleToken});
  assert.deepEqual(state.tasks,before.tasks.filter(t=>t.id!==id));
  assert.deepEqual(state.history,before.history.filter(h=>h.taskId!==id));
});
