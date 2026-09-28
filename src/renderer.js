const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],api=window.weeklight;
const paths={widget:'M4 4h16v16H4zM4 9h16M9 9v11M12 13h5M12 16h4',plus:'M12 5v14M5 12h14',calendar:'M4 5h16v16H4zM7 3v4M17 3v4M4 10h16M8 14h2M14 14h2M8 17h2',sun:'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',bell:'M18 8a6 6 0 0 0-12 0c0 7-2 7-2 9h16c0-2-2-2-2-9M10 21h4',check:'m5 12 4 4L19 6',settings:'m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',search:'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0m-2 4 6 6',left:'m14 6-6 6 6 6',right:'m9 6 6 6-6 6',shield:'m12 3 8 3v6c0 4-8 9-8 9s-8-5-8-9V6zM8 12l3 3 5-6',clock:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7v5l3 2',leaf:'M20 4C7 2 2 8 6 16s16 3 14-12ZM5 21l10-12',arrow:'M7 17 17 7M7 7h10v10'};
const icon=name=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[name]||paths.calendar)+'"/></svg>';
$$('[data-icon]').forEach(e=>e.innerHTML=icon(e.dataset.icon));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
const parse=s=>new Date(s+'T12:00:00');const add=(d,n)=>{d=new Date(d);d.setDate(d.getDate()+n);return d;};
const monday=d=>add(d,-(d.getDay()+6)%7);const today=()=>key(new Date());
const cats={work:{name:'工作 / 项目',short:'工作',color:'#6b9b87',bg:'#e9f3ed',ink:'#355e4b'},study:{name:'学习 / 成长',short:'学习',color:'#a195b9',bg:'#f1edf7',ink:'#6b5784'},life:{name:'生活 / 日常',short:'生活',color:'#c6a574',bg:'#fbf1df',ink:'#84602f'}};
let state,view='calendar',mode='four',anchor=monday(new Date()),selected=today(),mini=new Date(),filter=null,query='',toastTimer,editing=null,busy=false;
let dragId=null,dragCandidate=false,deferredRender=false;
function flushDeferredRender(){if(deferredRender&&!dragId&&!dragCandidate){deferredRender=false;render();}}
let showCompleted=localStorage.getItem('weeklight.showCompleted')!=='false',listStatus='all';
const matchesStatus=t=>listStatus==='all'||(listStatus==='done'?t.done:!t.done);
const isOverdue=t=>!t.done&&t.date<today();
const sorted=ts=>ts.slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
function filtered(ts=state.tasks){return sorted(ts.filter(t=>(!filter||t.category===filter)&&(!query||(t.title+' '+t.notes).toLowerCase().includes(query.toLowerCase()))));}
function inRange(t,start=anchor,days=mode==='week'?7:28){return t.date>=key(start)&&t.date<key(add(start,days));}
function dayTasks(d){return filtered().filter(t=>t.date===d);}
function calendarDayTasks(d){return dayTasks(d).filter(t=>showCompleted||!t.done);}
function style(t){const c=cats[t.category];return '--event-bg:'+c.bg+';--event-ink:'+c.ink+';--event-border:'+c.color;}
function fmt(d){return d.getMonth()+1+'月'+d.getDate()+'日';}
function toast(s){$('#toast').textContent=s;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3500);}
async function run(fn,message){try{const result=await fn();if(message&&result!==null)toast(message);return result;}catch(e){toast(e.message.replace(/^Error invoking remote method '[^']+': Error: /,''));return null;}}
function openDialog(el){if(!el.open)el.showModal();}
function render(){
 if(!state)return;
 // Keep native drag sources attached while cross-window state updates arrive.
 if(dragId||dragCandidate){deferredRender=true;return;}
 deferredRender=false;
 $$('.nav-item[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
 $('#today-count').textContent=state.tasks.filter(t=>t.date<=today()&&!t.done).length;
 $('#today-count').title='今天及之前尚未完成的计划';
 const pending=state.history.filter(h=>!h.dismissed&&state.tasks.some(t=>t.id===h.taskId&&!t.done));
 $('#reminder-count').textContent=pending.length;$('#bell-dot').style.display=pending.length?'block':'none';
 $('#categories').innerHTML=Object.entries(cats).map(([id,c])=>'<button class="category-button '+(filter===id?'active':'')+'" data-category="'+id+'"><i class="category-dot" style="--category:'+c.color+'"></i>'+c.name+'<span>'+state.tasks.filter(t=>t.category===id&&!t.done).length+'</span></button>').join('');
 const summaryTasks=state.tasks.filter(t=>inRange(t,monday(new Date()),28)),done=summaryTasks.filter(t=>t.done).length;
 const hours=summaryTasks.filter(t=>!t.done).reduce((a,t)=>a+t.duration,0)/60;
 $('#summary').innerHTML=[['calendar','未来四周',summaryTasks.length,'项计划',''],['check','已完成',done,'项计划',summaryTasks.length?Math.round(done/summaryTasks.length*100)+'% 完成率':''],['clock','待办预计用时',Number(hours.toFixed(1)),'小时','']].map(a=>'<div class="stat-card"><div class="stat-icon">'+icon(a[0])+'</div><div class="stat-copy"><span>'+a[1]+'</span><div class="stat-number">'+a[2]+'<small>'+a[3]+'</small></div></div><div class="stat-caption">'+a[4]+'</div></div>').join('');
 $('#page-title').textContent=({calendar:'计划日历',today:'今天',inbox:'提醒中心',done:'已完成'}[view]);
 $('#page-subtitle').textContent=({calendar:'安排未来几周，也掌握今天要做的事。',today:'今天的安排与此前未完成的计划，一起查看。',inbox:'处理到时提醒，或选择稍后再次提醒。',done:'查看已经完成的计划，回顾每天的进展。'}[view]);
 $('#filter-label').textContent=(filter?cats[filter].name:'全部计划')+(query?' · 搜索结果':'');
 $('.segmented').hidden=view!=='calendar';
 $('#previous').disabled=view!=='calendar';$('#next').disabled=view!=='calendar';
 $$('.segmented button').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
 $('#date-range').textContent=view==='calendar'? (anchor.getFullYear()+'年 '+fmt(anchor)+' — '+fmt(add(anchor,mode==='week'?6:27))):({today:fmt(new Date())+' · 今天',inbox:'待处理提醒',done:'已完成计划'}[view]);
 const isList=view==='today'||(view==='calendar'&&mode==='list');
 $('#list-filter').hidden=!isList;
 $('#date-jump-label').hidden=view!=='calendar';
 $('#jump-date').value=selected;
 $('#calendar-completed-label').hidden=view!=='calendar'||mode==='list';
 $('#show-completed').checked=showCompleted;
 $('.view-options').hidden=view==='inbox';
 $$('#list-filter button').forEach(b=>{b.classList.toggle('active',b.dataset.status===listStatus);b.setAttribute('aria-pressed',String(b.dataset.status===listStatus));});
 let visible=filtered().filter(t=>view==='today'?(t.date===today()||isOverdue(t)):view==='done'?t.done:inRange(t));
 if(isList)visible=visible.filter(matchesStatus);
 else if(view==='calendar'&&!showCompleted)visible=visible.filter(t=>!t.done);
 $('#view-count').textContent=visible.filter(t=>!t.done).length+' 待办 · '+visible.filter(t=>t.done).length+' 已办';
 $('#calendar-tip').textContent=view==='calendar'&&mode!=='list'?'点击日期查看 · 拖动计划改期 · N 新建':'勾选完成 · 点击计划编辑';
 const scroll=$('.week-scroll')?.scrollTop;
 if(view==='calendar'&&mode==='four')renderFour();
 else if(view==='calendar'&&mode==='week')renderWeek();
 else renderList(pending);
 if($('.week-scroll'))$('.week-scroll').scrollTop=scroll??8*72;
 renderMini();renderPanel();
}
function event(t,extra='',className=''){
 return '<button class="event '+className+(t.done?' done':'')+'" draggable="true" data-task="'+esc(t.id)+'" style="'+style(t)+extra+'" title="'+esc(t.title+' · '+t.time)+'"><span class="event-time">'+esc(t.time)+(t.priority==='high'?'<span class="event-important">◆</span>':'')+'</span><div class="event-title">'+(t.done?'✓ ':'')+esc(t.title)+'</div></button>';
}
function renderFour(){
 $('#calendar').innerHTML='<div class="weekday-row">'+['周一','周二','周三','周四','周五','周六','周日'].map(d=>'<span>'+d+'</span>').join('')+'</div><div class="month-grid">'+Array.from({length:28},(_,i)=>{
 const d=add(anchor,i),k=key(d),ts=calendarDayTasks(k);
 return '<div class="day-cell '+(k===selected?'selected':'')+'" data-date="'+k+'"><div class="day-number"><b class="'+(k===today()?'today':'')+'">'+d.getDate()+'</b><span>'+(d.getDate()===1?d.getMonth()+1+'月':'')+'</span><button class="day-add" data-new-date="'+k+'" aria-label="'+k+' 新建计划">+</button></div>'+ts.slice(0,3).map(t=>event(t)).join('')+(ts.length>3?'<button class="more-button" data-select="'+k+'">还有 '+(ts.length-3)+' 项</button>':'')+(!ts.length&&k===today()?'<div class="empty-hint">暂无计划<br>点击 ＋ 添加</div>':'')+'</div>';
 }).join('')+'</div>';
}
function renderWeek(){
 const days=Array.from({length:7},(_,i)=>add(anchor,i));
 $('#calendar').innerHTML='<div class="week-header"><span></span>'+days.map((d,i)=>'<button data-select="'+key(d)+'" class="'+(key(d)===today()?'today':'')+'">周'+['一','二','三','四','五','六','日'][i]+'<b>'+d.getDate()+'</b></button>').join('')+'</div><div class="week-scroll"><div class="week-body"><div class="time-labels">'+Array.from({length:24},(_,h)=>'<div>'+String(h).padStart(2,'0')+':00</div>').join('')+'</div>'+days.map(d=>{
 const ts=calendarDayTasks(key(d));const placements=[];let cluster=[],end=-1;
 const flush=()=>{const width=Math.max(1,...cluster.map(e=>e.lane+1));cluster.forEach(e=>placements.push({...e,width}));cluster=[];};
 ts.forEach(t=>{const start=+t.time.slice(0,2)*60 + +t.time.slice(3),finish=start+Math.max(t.duration,25);if(start>=end){flush();end=-1;}let lane=0;while(cluster.some(e=>e.lane===lane&&e.end>start))lane++;cluster.push({t,start,end:finish,lane});end=Math.max(end,finish);});flush();
 return '<div class="week-column">'+Array.from({length:24},(_,h)=>'<div class="hour-cell" data-date="'+key(d)+'" data-time="'+String(h).padStart(2,'0')+':00"></div>').join('')+placements.map(e=>event(e.t,';top:'+e.start*1.2+'px;height:'+Math.min(Math.max(28,e.t.duration*1.2-3),1728-e.start*1.2)+'px;left:calc('+e.lane/e.width*100+'% + 2px);width:calc('+100/e.width+'% - 4px)','week-event')).join('')+(key(d)===today()?'<div class="now-line" style="top:'+((new Date().getHours()*60+new Date().getMinutes())*1.2)+'px"></div>':'')+'</div>';
 }).join('')+'</div></div>';
}
function row(t){return '<div class="task-row '+(t.done?'done':'')+(isOverdue(t)?' overdue':'')+'"><button class="task-check '+(t.done?'checked':'')+'" data-toggle="'+esc(t.id)+'" aria-label="'+(t.done?'取消完成 ':'完成 ')+esc(t.title)+'">'+(t.done?'✓':'')+'</button><div class="task-info" role="button" tabindex="0" data-task="'+esc(t.id)+'"><strong>'+esc(t.title)+(t.priority==='high'?' <span class="event-important">◆</span>':'')+'</strong><p>'+(isOverdue(t)?'<span class="overdue-date">'+fmt(parse(t.date))+' · </span>':'')+t.time+' · '+t.duration+' 分钟'+(t.reminder>=0?' · 提醒':'')+'</p><span class="tag" style="background:'+cats[t.category].bg+';color:'+cats[t.category].ink+'">'+cats[t.category].short+'</span></div></div>';}
function empty(title,desc){return '<div class="empty-state"><div class="empty-icon">'+icon('leaf')+'</div><h3>'+title+'</h3><p>'+desc+'</p><button class="secondary" data-action="new">'+icon('plus')+' 安排一件事</button></div>';}
function renderList(pending){
 if(view==='inbox'){
  const hs=pending.filter(h=>filtered().some(t=>t.id===h.taskId)).reverse();
  $('#calendar').innerHTML='<div class="list-view">'+(hs.length?hs.map(h=>{const t=state.tasks.find(t=>t.id===h.taskId);return '<div class="reminder-row"><h3>'+esc(t.title)+'</h3><p>'+t.date+' '+t.time+' · '+cats[t.category].name+'</p><div class="actions"><button class="small-button" data-reminder="'+t.id+'" data-action="done">✓ 已完成</button><button class="small-button" data-reminder="'+t.id+'" data-action="snooze">10 分钟后提醒</button><button class="text-button" data-reminder="'+t.id+'" data-action="dismiss">知道了</button></div></div>';}).join(''):empty('暂时没有待处理提醒','计划到达提醒时间后，会出现在这里。'))+'</div>';return;
 }
 let ts=filtered().filter(t=>view==='today'?(t.date===today()||isOverdue(t)):view==='done'?t.done:inRange(t));
 if(view!=='done')ts=ts.filter(matchesStatus);
 const groups=[...new Set(ts.map(t=>t.date))];
 let content='';
 if(view==='today'){
  const overdue=ts.filter(isOverdue),current=ts.filter(t=>t.date===today());
  if(overdue.length)content+='<section class="today-group overdue-group"><h3 class="list-group-title">逾期未完成 <span>'+overdue.length+'</span></h3><p class="group-description">可以完成这些计划，或点击修改日期。</p>'+overdue.map(row).join('')+'</section>';
  if(current.length)content+='<section class="today-group"><h3 class="list-group-title">今天 <span>'+current.length+'</span></h3>'+current.map(row).join('')+'</section>';
 }else content=groups.map(d=>'<h3 class="list-group-title">'+fmt(parse(d))+' · 周'+['日','一','二','三','四','五','六'][parse(d).getDay()]+'<span>'+ts.filter(t=>t.date===d).length+'</span></h3>'+ts.filter(t=>t.date===d).map(row).join('')).join('');
 const emptyTitle=view==='done'||listStatus==='done'?'还没有已完成的计划':listStatus==='todo'?'当前没有待办计划':'这段时间还没有计划';
 $('#calendar').innerHTML='<div class="list-view">'+(content||empty(query?'没有找到匹配的计划':emptyTitle,query?'试试其他关键词，或清除搜索。':listStatus!=='all'?'可以切换清单状态，或添加新的计划。':'点击「新建计划」，安排下一步。'))+'</div>';
}
function renderMini(){
 $('#mini-label').textContent=mini.getFullYear()+'年 '+(mini.getMonth()+1)+'月';
 const first=monday(new Date(mini.getFullYear(),mini.getMonth(),1));
 $('#mini-days').innerHTML=Array.from({length:42},(_,i)=>{const d=add(first,i),k=key(d);return '<button data-mini="'+k+'" class="'+(d.getMonth()!==mini.getMonth()?'outside ':'')+(k===selected?'selected ':'')+(state.tasks.some(t=>t.date===k&&!t.done)?'dot':'')+'" aria-label="'+k+'">'+d.getDate()+'</button>';}).join('');
}
function renderPanel(){
 const d=parse(selected),ts=dayTasks(selected),week=state.tasks.filter(t=>inRange(t,monday(d),7)),done=week.filter(t=>t.done).length,pct=week.length?Math.round(done/week.length*100):0;
 $('#day-panel').innerHTML='<div class="day-panel-inner"><div class="panel-heading"><div><div class="panel-eyebrow">'+(selected===today()?'今天':'所选日期')+'</div><h2 class="panel-title">'+fmt(d)+'</h2><div class="panel-subtitle">周'+['日','一','二','三','四','五','六'][d.getDay()]+' · '+ts.length+' 项计划</div></div>'+icon('sun')+'</div><div class="panel-list">'+(ts.length?ts.map(row).join(''):'<div class="empty-panel"><div class="empty-icon">'+icon('leaf')+'</div><p>这一天还没有计划</p><small>点击下方按钮添加</small></div>')+'</div><button class="panel-add" data-new-date="'+selected+'">＋ 为这天添加计划</button></div><div class="week-focus"><h3>'+icon('leaf')+' 这一周的进展</h3><p><strong>'+pct+'<span style="font-size:11px">%</span></strong><span style="float:right;margin-top:10px">'+done+' / '+week.length+' 已完成</span></p><div class="progress-track"><i style="width:'+pct+'%"></i></div></div>';
}
function setView(v){view=v;if(v==='today')selected=today();render();}
function openEditor(t=null,date=selected,time='09:00'){
 editing=t;const f=$('#task-form');f.reset();
 f.elements.id.value=t?.id||'';f.elements.title.value=t?.title||'';f.elements.date.value=t?.date||date;f.elements.time.value=t?.time||time;
 for(const n of ['duration','category','reminder','notes'])if(t){if(n==='duration'&&![...f.elements.duration.options].some(o=>o.value===String(t.duration)))f.elements.duration.add(new Option(t.duration+' 分钟',t.duration));f.elements[n].value=t[n];}
 f.elements.priority.checked=t?.priority==='high';$('#editor-title').textContent=t?'编辑计划':'新建计划';$('#repeat-field').hidden=!!t;$('#delete-task').hidden=!t;$('#form-error').textContent='';
 $('#form-hint').textContent=t?'修改仅影响当前这项计划。':'重复计划会生成独立事项，可分别修改和完成。';
 openDialog($('#editor'));setTimeout(()=>f.elements.title.focus(),50);
}
function confirmDelete(t){return new Promise(resolve=>{$('#confirm-text').textContent='“'+t.title+'”将从日历中移除。';openDialog($('#confirm-dialog'));const finish=value=>{$('#confirm-dialog').close();resolve(value);};$('#confirm-no').onclick=()=>finish(false);$('#confirm-yes').onclick=()=>finish(true);$('#confirm-dialog').oncancel=()=>resolve(false);});}
document.addEventListener('click',async e=>{
 const b=e.target.closest('button,[data-task],.day-cell,.hour-cell');if(!b)return;
 if(b.dataset.reminder){await run(()=>api.reminderAction(b.dataset.reminder,b.dataset.action),'已更新提醒');return;}
 if(b.dataset.task){const t=state.tasks.find(t=>t.id===b.dataset.task);if(t)openEditor(t);return;}
 if(b.dataset.toggle){await run(()=>api.toggleTask(b.dataset.toggle));return;}
 if(b.dataset.newDate){selected=b.dataset.newDate;openEditor(null,selected);return;}
 if(b.dataset.view){setView(b.dataset.view);return;}
 if(b.dataset.mode){mode=b.dataset.mode;render();return;}
 if(b.dataset.status){listStatus=b.dataset.status;render();return;}
 if(b.dataset.category){filter=filter===b.dataset.category?null:b.dataset.category;render();return;}
 if(b.dataset.mini){selected=b.dataset.mini;anchor=monday(parse(selected));mini=parse(selected);view='calendar';render();return;}
 if(b.dataset.select){selected=b.dataset.select;mini=parse(selected);render();return;}
 if(b.dataset.action==='new'){openEditor();return;}if(b.dataset.action==='inbox'){setView('inbox');return;}
 if(b.classList.contains('close-dialog')){b.closest('dialog').close();return;}
 if(b.dataset.date){selected=b.dataset.date;if(b.dataset.time)openEditor(null,selected,b.dataset.time);else{mini=parse(selected);render();}return;}
});
document.addEventListener('dblclick',e=>{const cell=e.target.closest('.day-cell');if(cell&&!e.target.closest('button'))openEditor(null,cell.dataset.date);});
document.addEventListener('keydown',e=>{
 if((e.key==='Enter'||e.key===' ')&&e.target.matches('[role=button][data-task]')){e.preventDefault();e.target.click();}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#search-row').hidden=false;$('#search').focus();}
 if(!document.querySelector('dialog[open]')&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)&&!e.ctrlKey&&!e.metaKey&&e.key.toLowerCase()==='n'){e.preventDefault();openEditor();}
});
function moveRange(days){anchor=add(anchor,days);selected=key(anchor);mini=parse(selected);render();}
$('#previous').onclick=()=>moveRange(mode==='week'?-7:-28);
$('#next').onclick=()=>moveRange(mode==='week'?7:28);
$('#go-today').onclick=()=>{anchor=monday(new Date());selected=today();mini=new Date();if(view!=='calendar')view='today';render();};
$('#mini-prev').onclick=()=>{mini=new Date(mini.getFullYear(),mini.getMonth()-1,1);renderMini();};
$('#mini-next').onclick=()=>{mini=new Date(mini.getFullYear(),mini.getMonth()+1,1);renderMini();};
$('#reset-filter').onclick=()=>{filter=null;render();};
$('#open-widget').onclick=()=>run(()=>api.openWidget());
$('#show-completed').onchange=e=>{showCompleted=e.target.checked;localStorage.setItem('weeklight.showCompleted',String(showCompleted));render();};
$('#jump-date').onchange=e=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(e.target.value))return;selected=e.target.value;mini=parse(selected);anchor=monday(mini);render();};
$('#search-button').onclick=()=>{$('#search-row').hidden=!$('#search-row').hidden;if(!$('#search-row').hidden)$('#search').focus();};
$('#search').oninput=e=>{query=e.target.value.trim();render();};
$('#clear-search').onclick=()=>{query='';$('#search').value='';render();};
$('#task-form').onsubmit=async e=>{
 e.preventDefault();if(busy)return;busy=true;const submit=e.target.querySelector('[type=submit]');submit.disabled=true;
 const data=Object.fromEntries(new FormData(e.target));data.priority=e.target.elements.priority.checked?'high':'normal';data.done=editing?.done||false;
 try{await api.saveTask(data,editing?1:Number(data.repeat));$('#editor').close();selected=data.date;mini=parse(selected);if(!inRange(data))anchor=monday(mini);if(view==='inbox'||view==='done')view='calendar';render();toast(editing?'计划已更新':'计划已保存');}
 catch(e){$('#form-error').textContent=e.message.replace(/^Error invoking remote method '[^']+': Error: /,'');}
 finally{busy=false;submit.disabled=false;}
};
$('#delete-task').onclick=async()=>{if(editing&&await confirmDelete(editing)){const r=await run(()=>api.deleteTask(editing.id),'计划已删除');if(r)$('#editor').close();}};
document.addEventListener('pointerdown',e=>{dragCandidate=!!e.target.closest('.event');});
for(const name of ['pointerup','pointercancel'])document.addEventListener(name,()=>{dragCandidate=false;setTimeout(flushDeferredRender,0);});
function dropCell(e){
 const cell=e.target.closest('.day-cell,.hour-cell');if(cell)return cell;
 const column=e.target.closest('.week-column');if(!column)return null;
 const hour=Math.max(0,Math.min(23,Math.floor((e.clientY-column.getBoundingClientRect().top)/72)));
 return column.querySelectorAll('.hour-cell')[hour];
}
function clearDrag(){dragId=null;dragCandidate=false;$$('.dragover').forEach(e=>e.classList.remove('dragover'));}
document.addEventListener('dragstart',e=>{const t=e.target.closest('.event');if(t){dragCandidate=false;dragId=t.dataset.task;e.dataTransfer.setData('text/plain',dragId);e.dataTransfer.effectAllowed='move';}});
document.addEventListener('dragover',e=>{const cell=dropCell(e);if(cell&&dragId){e.preventDefault();e.dataTransfer.dropEffect='move';$$('.dragover').filter(el=>el!==cell).forEach(el=>el.classList.remove('dragover'));cell.classList.add('dragover');}});
document.addEventListener('dragleave',e=>{const cell=e.target.closest('.day-cell,.hour-cell');if(cell&&!cell.contains(e.relatedTarget))cell.classList.remove('dragover');});
document.addEventListener('dragend',()=>{clearDrag();flushDeferredRender();});
document.addEventListener('drop',async e=>{const cell=dropCell(e),id=dragId||e.dataTransfer.getData('text/plain');if(cell&&state.tasks.some(t=>t.id===id)){e.preventDefault();clearDrag();await run(()=>api.moveTask(id,cell.dataset.date,cell.dataset.time),'计划已改期');flushDeferredRender();}});
let settingsBusy=false,settingsError='';
const settingsErrorText=e=>e.message.replace(/^Error invoking remote method '[^']+': Error: /,'');
$('#settings-button').onclick=async()=>{
 settingsBusy=true;settingsError='';syncSettings();openDialog($('#settings-dialog'));
 try{state=await api.get();}catch(e){settingsError=settingsErrorText(e);}finally{settingsBusy=false;syncSettings();}
};
function syncSettings(){
 $('#setting-sound').checked=state.settings.sound;$('#setting-popup').checked=state.settings.popup;$('#setting-startup').checked=state.autostart;
 $('#setting-sound').disabled=settingsBusy;$('#setting-popup').disabled=settingsBusy;$('#setting-startup').disabled=settingsBusy||!state.packaged;
 $('#startup-hint').textContent=settingsBusy?'正在确认设置…':state.packaged?'登录 Windows 后在后台运行':'请使用 Windows 安装版设置开机启动';
 $('#settings-error').textContent=settingsError||state.autostartError||'';$('#data-path').textContent=state.dataDir;
}
for(const [id,k] of [['sound','sound'],['popup','popup'],['startup','autostart']])$('#setting-'+id).onchange=async e=>{
 if(settingsBusy)return;
 const enabled=e.target.checked;settingsBusy=true;settingsError='';
 for(const input of ['sound','popup','startup'])$('#setting-'+input).disabled=true;
 $('#startup-hint').textContent='正在保存设置…';$('#settings-error').textContent='';
 try{state=await api.settings({[k]:enabled});render();}
 catch(e){settingsError=settingsErrorText(e);try{state=await api.get();}catch{}}
 finally{settingsBusy=false;syncSettings();}
};
$('#test-reminder').onclick=()=>run(()=>api.testReminder(),'测试提醒已发送');
$('#export-data').onclick=()=>run(()=>api.exportData(),'备份已导出');
$('#import-data').onclick=()=>run(()=>api.importData(),'备份已合并');
$('#open-data').onclick=()=>run(()=>api.openData());
$('#quit').onclick=()=>api.quit();
$('#load-samples').onclick=async()=>{
 if(busy)return;busy=true;$('#load-samples').disabled=true;
 try{
 const base=monday(new Date());const examples=[['梳理本周优先事项',0,'09:00','work',60],['留给深度工作的时间',1,'10:00','work',120],['读完一章，记下想法',2,'19:30','study',45],['散步，给自己充充电',3,'18:00','life',30],['整理项目进展',4,'14:00','work',60],['一周回顾与下周计划',6,'17:00','life',30],['把一个新想法做成小实验',8,'09:30','study',90],['推进关键里程碑',10,'14:00','work',120],['和朋友一起吃晚餐',12,'18:30','life',90],['整理阅读笔记',16,'20:00','study',60],['项目阶段复盘',18,'15:00','work',60],['为下个月留出方向',25,'10:00','life',60]];
 for(const [title,i,time,category,duration]of examples){const name='[示例] '+title;if(!state.tasks.some(t=>t.title===name))await api.saveTask({title:name,date:key(add(base,i)),time,category,duration,reminder:-1,notes:'这是示例计划，可以修改或删除。',priority:'normal'},1);}
 toast('已添加示例计划，提醒均为关闭');$('#settings-dialog').close();view='calendar';anchor=base;selected=today();mini=new Date();render();
 }catch(e){toast(e.message);}finally{busy=false;$('#load-samples').disabled=false;}
};
api.onState(s=>{state=s;render();});
api.onNew(date=>openEditor(null,typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)?date:selected));api.onError(toast);
api.onEditTask?.(async id=>{try{state=await api.get();const task=state.tasks.find(t=>t.id===id);if(!task){toast('这项计划已被删除');return;}selected=task.date;anchor=monday(parse(selected));mini=parse(selected);view='calendar';render();openEditor(task);}catch(e){toast('无法打开计划：'+e.message);}});
api.get().then(s=>{state=s;render();if(s.startupError)toast(s.startupError);}).catch(e=>toast('无法读取数据：'+e.message));
setInterval(()=>{if(!document.querySelector('dialog[open]'))render();},60000);
