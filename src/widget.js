const api=window.weeklight,model=window.WeeklightWidget,$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cats={work:{name:'工作',color:'#77a58b'},study:{name:'学习',color:'#ab94be'},life:{name:'生活',color:'#c4a776'}};
let state,prefs,busy=false,lastDate,toastTimer;
const today=()=>model.dateKey(new Date()),parse=d=>new Date(d+'T12:00:00'),fmt=d=>{const v=parse(d);return v.getMonth()+1+'月'+v.getDate()+'日';};
function toast(msg){$('#widget-toast').textContent=msg;$('#widget-toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#widget-toast').classList.remove('visible'),2400);}
async function run(fn){try{return await fn();}catch(e){toast(e.message.replace(/^Error invoking remote method '[^']+': Error: /,''));return null;}}
function row(t){
 const overdue=!t.done&&new Date(t.date+'T'+t.time+':00')<new Date();const c=cats[t.category];
 return '<div class="widget-task '+(t.done?'done':'')+'"><button class="check-task" data-toggle="'+esc(t.id)+'" aria-label="'+(t.done?'撤销完成 ':'完成 ')+esc(t.title)+'" aria-pressed="'+t.done+'">'+(t.done?'✓':'')+'</button><button class="task-text" data-edit="'+esc(t.id)+'" title="编辑计划"><span class="task-title">'+esc(t.title)+(t.priority==='high'?'<span class="priority">◆</span>':'')+'</span><span class="task-meta"><span>'+t.time+'</span><i style="--category:'+c.color+'"></i><span>'+c.name+'</span>'+(overdue?'<span class="late">已过计划时间</span>':'')+'</span></button></div>';
}
function renderList(ts,isDone=false){
 if(!ts.length)return '<div class="empty-message">'+(isDone?'完成的事项会留在这里':'<strong>留一点空间，安排下一步</strong>添加计划，或切换日期查看')+'</div>';
 if(prefs.mode==='day')return ts.map(row).join('');
 return [...new Set(ts.map(t=>t.date))].map(d=>'<div class="day-group">'+fmt(d)+' · 周'+['日','一','二','三','四','五','六'][parse(d).getDay()]+(d===today()?' · 今天':'')+'</div>'+ts.filter(t=>t.date===d).map(row).join('')).join('');
}
function syncQuickDate(d){if(lastDate!==d){const f=$('#quick-form');f.elements.date.value=d;if(!lastDate){const now=new Date();now.setMinutes(Math.ceil((now.getMinutes()+1)/15)*15,0,0);f.elements.time.value=d===model.dateKey(now)?String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0'):'09:00';}lastDate=d;}}
function render(){
 prefs=model.normalizePrefs(state.settings.widget);const range=model.selectTasks(state.tasks,prefs),d=prefs.anchor||today();
 $('.widget').dataset.theme=prefs.theme;$('#widget-pin').setAttribute('aria-pressed',String(prefs.onTop));$('#widget-pin').title=prefs.onTop?'取消置顶，回到桌面底层':'置顶便签';$('#widget-pin').setAttribute('aria-label',$('#widget-pin').title);
 $$('.segmented button').forEach(b=>b.classList.toggle('active',b.dataset.mode===prefs.mode));
 $('#widget-category').value=prefs.category;$('#widget-date').value=d;
 $('#follow-indicator').textContent=prefs.anchor?'固定日期':'跟随今天';
 $('#widget-title').textContent=prefs.mode==='day'?(d===today()?'今天的计划':fmt(d)+'的计划'):'这一周的计划';
 const end=parse(range.end);end.setDate(end.getDate()-1);
 $('#widget-range').textContent=prefs.mode==='day'?parse(d).getFullYear()+'年 '+fmt(d)+' · 周'+['日','一','二','三','四','五','六'][parse(d).getDay()]:parse(range.start).getFullYear()+'年 '+fmt(range.start)+' — '+fmt(model.dateKey(end));
 $('#pending-count').textContent=range.pending.length;$('#done-count').textContent=range.done.length;$('#progress-number').textContent=range.pending.length;
 $('.progress-ring').style.setProperty('--progress',(range.tasks.length?range.done.length/range.tasks.length*100:0)+'%');$('.progress-ring').title=range.done.length+' / '+range.tasks.length+' 已完成';
 const focusId=document.activeElement?.dataset.toggle;const scroll=$('.task-scroll').scrollTop;
 $('#pending-list').innerHTML=renderList(range.pending);$('#done-list').innerHTML=renderList(range.done,true);
 $('#done-list').hidden=!prefs.showCompleted;$('#toggle-done').setAttribute('aria-expanded',String(prefs.showCompleted));$('#done-chevron').textContent=prefs.showCompleted?'⌄':'›';$('#show-completed').checked=prefs.showCompleted;
 $$('.swatches button').forEach(b=>b.classList.toggle('active',b.dataset.theme===prefs.theme));
 $('.task-scroll').scrollTop=scroll;if(focusId)$$('[data-toggle]').find(b=>b.dataset.toggle===focusId)?.focus({preventScroll:true});
 syncQuickDate(d);
}
function settings(patch){return run(()=>api.widgetSettings(patch));}
$('#widget-pin').onclick=()=>settings({onTop:!prefs.onTop});
$('#widget-close').onclick=()=>run(()=>api.closeWidget());
$('#widget-open-main').onclick=()=>run(()=>api.showMain());
$('#widget-preferences').onclick=()=>{$('#preferences').hidden=!$('#preferences').hidden;};
$('#widget-today').onclick=()=>settings({anchor:null});
function navigate(direction){const d=parse(prefs.anchor||today());d.setDate(d.getDate()+direction*(prefs.mode==='week'?7:1));settings({anchor:model.dateKey(d)});}
$('#widget-prev').onclick=()=>navigate(-1);$('#widget-next').onclick=()=>navigate(1);
$('#widget-date').onchange=e=>{if(e.target.value)settings({anchor:e.target.value});};
$('#widget-category').onchange=e=>settings({category:e.target.value});
$('#toggle-done').onclick=()=>settings({showCompleted:!prefs.showCompleted});
$('#show-completed').onchange=e=>settings({showCompleted:e.target.checked});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.mode)settings({mode:b.dataset.mode});if(b.dataset.theme)settings({theme:b.dataset.theme});if(b.dataset.toggle)run(()=>api.toggleTask(b.dataset.toggle));if(b.dataset.edit)run(()=>api.editTask(b.dataset.edit));});
$('#quick-form').onsubmit=async e=>{
 e.preventDefault();if(busy)return;busy=true;$('#quick-submit').disabled=true;$('#quick-error').textContent='';
 try{const data=Object.fromEntries(new FormData(e.target));await api.saveTask({...data,duration:30,category:prefs.category==='all'?'work':prefs.category,priority:'normal',notes:''},1);e.target.elements.title.value='';if(data.date!==(prefs.anchor||today()))await api.widgetSettings({anchor:data.date});toast('已添加到日历');e.target.elements.title.focus();}
 catch(err){$('#quick-error').textContent=err.message.replace(/^Error invoking remote method '[^']+': Error: /,'');}
 finally{busy=false;$('#quick-submit').disabled=false;}
};
api.onState(s=>{state=s;render();});api.onError(toast);api.get().then(s=>{state=s;render();}).catch(e=>toast(e.message));
setInterval(()=>{if(state)render();},30000);
