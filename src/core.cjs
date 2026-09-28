const {normalizePrefs}=require('./widget-model.cjs');
const crypto = require('node:crypto');
const CATEGORIES = ['work','study','life'];
function dateKey(d) { return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); }
function at(task) { return new Date(task.date+'T'+task.time+':00').getTime(); }
function cleanTask(input, existing) {
  if (!input || typeof input !== 'object') throw new Error('计划格式不正确');
  const title=String(input.title||'').trim();
  if (!title || title.length>160) throw new Error('请填写 1–160 字的计划名称');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date||'') || !Number.isFinite(new Date(input.date+'T12:00:00').getTime()) || dateKey(new Date(input.date+'T12:00:00'))!==input.date) throw new Error('请选择有效日期');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time||'')) throw new Error('请选择有效时间');
  const duration=Number(input.duration), reminder=Number(input.reminder);
  if (!Number.isInteger(duration)||duration<15||duration>1440) throw new Error('时长须为 15–1440 分钟');
  if (![ -1,0,5,10,15,30,60,1440 ].includes(reminder)) throw new Error('提醒时间不正确');
  if (!CATEGORIES.includes(input.category)) throw new Error('请选择有效分类');
  const task={id:existing?.id||crypto.randomUUID(),title,date:input.date,time:input.time,duration,reminder,category:input.category,priority:input.priority==='high'?'high':'normal',notes:String(input.notes||'').slice(0,5000),done:!!input.done,createdAt:existing?.createdAt||Date.now(),updatedAt:Date.now()};
  if (existing && existing.date===task.date && existing.time===task.time && existing.reminder===task.reminder) {
    task.notifiedAt=existing.notifiedAt||null; task.snoozeUntil=existing.snoozeUntil||null;
  }
  return task;
}
function dueTasks(tasks,now=Date.now()) {
  return tasks.filter(t=>!t.done && t.reminder>=0 && (t.snoozeUntil ? t.snoozeUntil<=now : !t.notifiedAt && at(t)-t.reminder*60000<=now)).sort((a,b)=>at(a)-at(b));
}
function makeSeries(task, count=1) {
  if (![1,4,8,12].includes(count)) throw new Error('重复次数不正确');
  return Array.from({length:count},(_,i)=>{
    const d=new Date(task.date+'T12:00:00');d.setDate(d.getDate()+7*i);
    return {...task,id:i?crypto.randomUUID():task.id,date:dateKey(d)};
  });
}
function validateState(raw) {
  if (raw?.version!==1||!Array.isArray(raw.tasks)||raw.tasks.length>10000) throw new Error('不是有效的周光备份（最多 10000 项）');
  const ids=new Set();
  const tasks=raw.tasks.map(t=>{
    if(typeof t.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(t.id)||ids.has(t.id)) throw new Error('备份包含无效或重复的计划 ID');
    ids.add(t.id);
    const c=cleanTask(t,t);
    for(const key of ['notifiedAt','snoozeUntil']) if(t[key]!=null&&(!Number.isFinite(t[key])||t[key]<0)) throw new Error('备份中的提醒状态无效');
    return c;
  });
  return {version:1,tasks,settings:{sound:raw.settings?.sound!==false,popup:raw.settings?.popup!==false,widget:normalizePrefs(raw.settings?.widget)},history:Array.isArray(raw.history)?raw.history.filter(e=>e&&typeof e.id==='string'&&typeof e.taskId==='string'&&Number.isFinite(e.at)).slice(-300):[]};
}
module.exports={dateKey,at,cleanTask,dueTasks,makeSeries,validateState};
