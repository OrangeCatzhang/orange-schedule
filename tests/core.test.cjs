const test=require('node:test');const assert=require('node:assert/strict');
const {cleanTask,dueTasks,makeSeries,validateState,dateKey}=require('../src/core.cjs');
const draft={title:'阶段复盘',date:'2026-09-28',time:'10:00',duration:60,category:'work',reminder:10};
test('reject invalid dates, times and reminders',()=>{assert.throws(()=>cleanTask({...draft,date:'2026-02-30'}));assert.throws(()=>cleanTask({...draft,time:'24:00'}));assert.throws(()=>cleanTask({...draft,reminder:2}));assert.throws(()=>cleanTask({...draft,title:' '}));});
test('weekly repetitions preserve local dates across months and year',()=>{const tasks=makeSeries(cleanTask({...draft,date:'2026-12-28'}),4);assert.deepEqual(tasks.map(t=>t.date),['2026-12-28','2027-01-04','2027-01-11','2027-01-18']);assert.equal(new Set(tasks.map(t=>t.id)).size,4);});
test('remind exactly at threshold, then suppress across restart',()=>{const t=cleanTask(draft);const threshold=new Date('2026-09-28T09:50:00').getTime();assert.equal(dueTasks([t],threshold-1).length,0);assert.equal(dueTasks([t],threshold).length,1);t.notifiedAt=threshold;const restored=validateState({version:1,tasks:[t]});assert.equal(dueTasks(restored.tasks,threshold+1000000).length,0);});
test('snooze survives serialization and fires once at due time',()=>{const t={...cleanTask(draft),notifiedAt:1,snoozeUntil:100000};const restored=validateState(JSON.parse(JSON.stringify({version:1,tasks:[t]})));assert.equal(dueTasks(restored.tasks,99999).length,0);assert.equal(dueTasks(restored.tasks,100000).length,1);});
test('done and reminder-disabled tasks never fire',()=>{const t=cleanTask(draft);assert.deepEqual(dueTasks([{...t,done:true},{...t,reminder:-1}],Number.MAX_SAFE_INTEGER),[]);});
test('schedule changes rearm reminders but note-only edits do not',()=>{const old={...cleanTask(draft),notifiedAt:123};assert.equal(cleanTask({...old,notes:'new'},old).notifiedAt,123);assert.equal(cleanTask({...old,time:'11:00'},old).notifiedAt,undefined);});
test('missed reminders are caught after resume regardless of length of absence',()=>{const t=cleanTask(draft);assert.equal(dueTasks([t],new Date('2026-10-02T12:00:00').getTime()).length,1);});
test('backups reject duplicate ids without changing data',()=>{const t=cleanTask(draft);assert.throws(()=>validateState({version:1,tasks:[t,t]}));assert.throws(()=>validateState({version:2,tasks:[]}));});

test('daily repetition includes both endpoints, including a one-day range',()=>{
  const original=Object.freeze(cleanTask({...draft,date:'2030-06-10'}));
  const options=Object.freeze({frequency:'daily',until:'2030-06-10'});
  const tasks=makeSeries(original,options);
  assert.equal(tasks.length,1);
  assert.deepEqual(tasks[0],original);
  assert.notEqual(tasks[0],original,'Even a single generated task must be independent of the draft');
});

test('daily repetition crosses month, leap-day and year boundaries using calendar dates',()=>{
  const cases=[
    ['2030-01-30','2030-02-02',['2030-01-30','2030-01-31','2030-02-01','2030-02-02']],
    ['2027-02-28','2027-03-01',['2027-02-28','2027-03-01']],
    ['2028-02-28','2028-03-01',['2028-02-28','2028-02-29','2028-03-01']],
    ['2030-12-31','2031-01-02',['2030-12-31','2031-01-01','2031-01-02']]
  ];
  for(const [start,until,expected]of cases){
    const tasks=makeSeries(cleanTask({...draft,date:start}),{frequency:'daily',until});
    assert.deepEqual(tasks.map(task=>task.date),expected,`${start} through ${until}`);
    assert.ok(tasks.every(task=>task.time===draft.time));
  }
});

test('legacy numeric weekly repetition counts remain compatible',()=>{
  const original=Object.freeze(cleanTask({...draft,date:'2026-12-28'}));
  for(const [count,lastDate]of [[1,'2026-12-28'],[4,'2027-01-18'],[8,'2027-02-15'],[12,'2027-03-15']]){
    const tasks=makeSeries(original,count);
    assert.equal(tasks.length,count);
    assert.equal(tasks[0].id,original.id);
    assert.equal(tasks[0].date,original.date);
    assert.equal(tasks.at(-1).date,lastDate);
    assert.equal(new Set(tasks.map(task=>task.id)).size,count);
    assert.ok(tasks.every(task=>new Date(task.date+'T12:00:00').getDay()===1));
    assert.ok(tasks.every(task=>task.time===original.time&&task.reminder===original.reminder));
  }
  assert.deepEqual(makeSeries(original),[{...original}]);
});

test('daily tasks have unique IDs and preserve attributes without mutating the draft',()=>{
  const original=Object.freeze(cleanTask({...draft,date:'2030-06-10',time:'07:45',duration:45,reminder:30,category:'study',priority:'high',notes:'每天单独记录进展'}));
  const before=JSON.parse(JSON.stringify(original));
  const options=Object.freeze({frequency:'daily',until:'2030-06-13'});
  const tasks=makeSeries(original,options);
  const attributes=task=>Object.fromEntries(Object.entries(task).filter(([key])=>!['id','date'].includes(key)));
  assert.equal(tasks.length,4);
  assert.equal(new Set(tasks.map(task=>task.id)).size,4);
  assert.equal(new Set(tasks).size,4,'Generated tasks must be different objects');
  assert.equal(tasks[0].id,original.id);
  for(const task of tasks){
    assert.notEqual(task,original);
    assert.deepEqual(attributes(task),attributes(original));
  }
  assert.deepEqual(original,before);
  assert.deepEqual(options,{frequency:'daily',until:'2030-06-13'});
});

test('editing and completing one daily task leaves every other day unchanged',()=>{
  const tasks=makeSeries(cleanTask({...draft,date:'2030-06-10'}),{frequency:'daily',until:'2030-06-12'});
  const before=JSON.parse(JSON.stringify(tasks));
  tasks[1]=cleanTask({...tasks[1],title:'仅修改第二天',time:'11:30',notes:'只属于第二天'},tasks[1]);
  tasks[1].done=true;
  tasks[1].snoozeUntil=null;
  assert.equal(tasks[1].id,before[1].id);
  assert.equal(tasks[1].date,'2030-06-11');
  assert.equal(tasks[1].title,'仅修改第二天');
  assert.equal(tasks[1].done,true);
  assert.deepEqual(tasks[0],before[0]);
  assert.deepEqual(tasks[2],before[2]);
  assert.deepEqual(dueTasks(tasks,new Date('2030-06-13T12:00:00').getTime()).map(task=>task.id),[tasks[0].id,tasks[2].id]);
});

test('each daily task becomes due at its own threshold and earlier notifications do not suppress later days',()=>{
  const tasks=makeSeries(cleanTask({...draft,date:'2030-05-31',time:'08:30',reminder:15}),{frequency:'daily',until:'2030-06-02'});
  for(const task of tasks){
    const threshold=new Date(task.date+'T08:15:00').getTime();
    assert.deepEqual(dueTasks(tasks,threshold-1),[],`No early reminder on ${task.date}`);
    assert.deepEqual(dueTasks(tasks,threshold).map(due=>due.id),[task.id],`Only ${task.date} is due`);
    task.notifiedAt=threshold;
    assert.deepEqual(dueTasks(tasks,threshold),[],'Already notified tasks must not repeat');
  }
});

test('daily reminders with a one-day lead fire on the preceding calendar day',()=>{
  const tasks=makeSeries(cleanTask({...draft,date:'2030-06-01',time:'09:00',reminder:1440}),{frequency:'daily',until:'2030-06-02'});
  const thresholds=['2030-05-31T09:00:00','2030-06-01T09:00:00'].map(value=>new Date(value).getTime());
  for(let i=0;i<tasks.length;i++){
    assert.deepEqual(dueTasks(tasks,thresholds[i]-1),[]);
    assert.deepEqual(dueTasks(tasks,thresholds[i]).map(task=>task.id),[tasks[i].id]);
    tasks[i].notifiedAt=thresholds[i];
  }
});

test('a serialized backup preserves every daily occurrence and its independent reminder state',()=>{
  const tasks=makeSeries(cleanTask({...draft,date:'2030-06-10',notes:'重复计划备份验证'}),{frequency:'daily',until:'2030-06-13'});
  const threshold=date=>new Date(date+'T09:50:00').getTime();
  tasks[0].done=true;
  tasks[1].notifiedAt=threshold(tasks[1].date);
  tasks[2].notifiedAt=threshold(tasks[2].date);
  tasks[2].snoozeUntil=threshold(tasks[2].date)+600000;
  const fields=task=>({
    id:task.id,title:task.title,date:task.date,time:task.time,duration:task.duration,
    category:task.category,reminder:task.reminder,priority:task.priority,notes:task.notes,
    done:task.done,createdAt:task.createdAt,notifiedAt:task.notifiedAt??null,snoozeUntil:task.snoozeUntil??null
  });
  const backup={version:1,tasks,settings:{sound:false,popup:true},history:[]};
  const original=JSON.stringify(backup);
  const restored=validateState(JSON.parse(original));
  assert.equal(restored.tasks.length,4);
  assert.deepEqual(restored.tasks.map(fields),tasks.map(fields));
  assert.equal(restored.settings.sound,false);
  assert.equal(JSON.stringify(backup),original,'Backup validation must not modify the source');
  assert.deepEqual(dueTasks(restored.tasks,tasks[2].snoozeUntil-1),[]);
  assert.deepEqual(dueTasks(restored.tasks,tasks[2].snoozeUntil).map(task=>task.id),[tasks[2].id]);
  restored.tasks[2].snoozeUntil=null;
  restored.tasks[2].notifiedAt=tasks[2].snoozeUntil;
  assert.deepEqual(dueTasks(restored.tasks,threshold(tasks[3].date)).map(task=>task.id),[tasks[3].id]);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(restored))).tasks.map(fields),restored.tasks.map(fields));
});

test('daily repetition rejects missing, malformed, impossible and reversed end dates',()=>{
  const original=Object.freeze(cleanTask({...draft,date:'2028-02-28'}));
  const invalidEnds=[undefined,null,false,20280301,'','2028-2-29','2028-02-30','2027-02-29','2028-13-01','2028-00-01','2028-03-00','2028-02-29T12:00:00','not-a-date','2028-02-27'];
  for(const until of invalidEnds){
    assert.throws(()=>makeSeries(original,{frequency:'daily',until}),`Must reject end date ${String(until)}`);
  }
});

test('repetition rejects unknown frequency and unsupported legacy counts',()=>{
  const original=Object.freeze(cleanTask(draft));
  for(const options of [{frequency:'monthly',until:'2026-10-28'},{frequency:'hourly',until:'2026-10-28'},{frequency:'Daily',until:'2026-10-28'}]){
    assert.throws(()=>makeSeries(original,options));
  }
  for(const count of [0,-1,2,3,5,13,1.5,NaN,Infinity])assert.throws(()=>makeSeries(original,count));
});

test('daily repetition allows 10000 occurrences but rejects a larger inclusive range',()=>{
  const original=Object.freeze(cleanTask({...draft,date:'2030-01-01'}));
  const end=new Date(original.date+'T12:00:00');
  end.setDate(end.getDate()+9999);
  const lastAllowed=dateKey(end);
  const tasks=makeSeries(original,{frequency:'daily',until:lastAllowed});
  assert.equal(tasks.length,10000);
  assert.equal(tasks[0].date,original.date);
  assert.equal(tasks.at(-1).date,lastAllowed);
  assert.equal(new Set(tasks.map(task=>task.id)).size,10000);
  end.setDate(end.getDate()+1);
  assert.throws(()=>makeSeries(original,{frequency:'daily',until:dateKey(end)}),'10001 daily occurrences must be rejected before allocating a series');
});
