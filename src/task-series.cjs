const crypto=require('node:crypto');
const ACTIONS=new Set(['complete','reopen','delete']);
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(id);
function validateSeriesTasks(tasks){
 const seen=new Set();
 for(const task of tasks){
  if(task.seriesId===undefined&&task.seriesIndex===undefined)continue;
  if(!validId(task.seriesId)||!Number.isInteger(task.seriesIndex)||task.seriesIndex<0||task.seriesIndex>9999)throw new Error('重复计划分组信息无效');
  const key=task.seriesId+':'+task.seriesIndex;
  if(seen.has(key))throw new Error('重复计划组中存在相同的事项序号');
  seen.add(key);
 }
}
const legacyFields=['title','time','duration','category','reminder','priority','notes'];
const schedule=task=>task.date+'T'+task.time;
function previewTaskAction(tasks,id,action){
 if(!ACTIONS.has(action))throw new Error('计划操作无效');
 const task=tasks.find(t=>t.id===id);
 if(!task)throw new Error('计划已被删除，请刷新后重试');
 let source='single',matches=[task];
 if(task.seriesId!==undefined){
  source='series';
  matches=tasks.filter(t=>t.seriesId===task.seriesId&&t.seriesIndex>=task.seriesIndex).sort((a,b)=>a.seriesIndex-b.seriesIndex);
 }else if(Number.isFinite(task.createdAt)&&task.createdAt>0){
  const candidates=tasks.filter(t=>t.seriesId===undefined&&t.seriesIndex===undefined&&t.createdAt===task.createdAt&&legacyFields.every(field=>t[field]===task[field]));
  if(candidates.length>1){
   source='legacy';
   matches=candidates.filter(t=>schedule(t)>=schedule(task)).sort((a,b)=>schedule(a).localeCompare(schedule(b))||a.id.localeCompare(b.id));
  }
 }
 const token=crypto.createHash('sha256').update(JSON.stringify({id,action,source,tasks:matches})).digest('hex');
 const singleToken=crypto.createHash('sha256').update(JSON.stringify({id,action,task})).digest('hex');
 const display=t=>({id:t.id,title:t.title,date:t.date,time:t.time,done:t.done});
 return {task:display(task),source,followingCount:matches.length,items:matches.map(display),token,singleToken};
}
function applyTaskAction(state,request){
 if(!request||!['single','following'].includes(request.scope))throw new Error('请选择有效的操作范围');
 const preview=previewTaskAction(state.tasks,request.id,request.action);
 if(request.scope==='following'&&(typeof request.token!=='string'||request.token!==preview.token))throw new Error('事项已发生变化，请重新确认操作范围');
 if(request.scope==='single'&&request.action==='delete'&&(typeof request.token!=='string'||request.token!==preview.singleToken))throw new Error('事项已发生变化，请重新确认删除');
 const ids=new Set(request.scope==='following'?preview.items.map(t=>t.id):[request.id]);
 if(request.action==='delete'){
  state.tasks=state.tasks.filter(t=>!ids.has(t.id));state.history=state.history.filter(h=>!ids.has(h.taskId));
 }else{
  for(const task of state.tasks)if(ids.has(task.id)){
   task.done=request.action==='complete';task.snoozeUntil=null;task.updatedAt=Date.now();
  }
  if(request.action==='complete')state.history.forEach(h=>{if(ids.has(h.taskId))h.dismissed=true;});
 }
 return state;
}
module.exports={validateSeriesTasks,previewTaskAction,applyTaskAction};
