const api=window.weeklight,model=window.WeeklightWidget,$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const i18n=window.WeeklightI18n,tr=(key,values)=>i18n.t(key,values);
const cats={work:{name:'工作',color:'#77a58b'},study:{name:'学习',color:'#ab94be'},life:{name:'生活',color:'#c4a776'}};
let state,prefs,busy=false,lastDate,toastTimer,toastKey='',quickError='';
const today=()=>model.dateKey(new Date()),parse=d=>new Date(d+'T12:00:00'),fmt=d=>i18n.getLanguage()==='en'?i18n.formatDate(parse(d),{month:'short',day:'numeric'}):tr('{month}月{day}日',{month:parse(d).getMonth()+1,day:parse(d).getDate()});
const weekday=d=>i18n.formatDate(parse(d),{weekday:'short'});
const errorText=e=>String(e?.message||e).replace(/^Error invoking remote method '[^']+': Error: /,'');
function toast(msg){toastKey=msg;$('#widget-toast').textContent=tr(msg);$('#widget-toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#widget-toast').classList.remove('visible'),2400);}
async function run(fn){try{return await fn();}catch(e){toast(errorText(e));return null;}}
function row(t){
 const overdue=!t.done&&new Date(t.date+'T'+t.time+':00')<new Date();const c=cats[t.category];
 return '<div class="widget-task '+(t.done?'done':'')+'"><button class="check-task" data-toggle="'+esc(t.id)+'" aria-label="'+esc(tr(t.done?'撤销完成 {title}':'完成 {title}',{title:t.title}))+'" aria-pressed="'+t.done+'">'+(t.done?'✓':'')+'</button><button class="task-text" data-edit="'+esc(t.id)+'" title="'+esc(tr('编辑计划'))+'"><span class="task-title">'+esc(t.title)+(t.priority==='high'?'<span class="priority">◆</span>':'')+'</span><span class="task-meta"><span>'+t.time+'</span><i style="--category:'+c.color+'"></i><span>'+esc(tr(c.name))+'</span>'+(overdue?'<span class="late">'+esc(tr('已过计划时间'))+'</span>':'')+'</span></button></div>';
}
function renderList(ts,isDone=false){
 if(!ts.length)return '<div class="empty-message">'+(isDone?esc(tr('完成的事项会留在这里')):'<strong>'+esc(tr('留一点空间，安排下一步'))+'</strong>'+esc(tr('添加计划，或切换日期查看')))+'</div>';
 if(prefs.mode==='day')return ts.map(row).join('');
 return [...new Set(ts.map(t=>t.date))].map(d=>'<div class="day-group">'+fmt(d)+' · '+weekday(d)+(d===today()?' · '+tr('今天'):'')+'</div>'+ts.filter(t=>t.date===d).map(row).join('')).join('');
}
function syncQuickDate(d){if(lastDate!==d){const f=$('#quick-form');f.elements.date.value=d;if(!lastDate){const now=new Date();now.setMinutes(Math.ceil((now.getMinutes()+1)/15)*15,0,0);f.elements.time.value=d===model.dateKey(now)?String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0'):'09:00';}lastDate=d;}}
function render(){
 i18n.apply();if(toastKey)$('#widget-toast').textContent=tr(toastKey);$('#quick-error').textContent=i18n.translateError(quickError);
 prefs=model.normalizePrefs(state.settings.widget);const range=model.selectTasks(state.tasks,prefs),d=prefs.anchor||today();
 $('.widget').dataset.theme=prefs.theme;$('#widget-pin').setAttribute('aria-pressed',String(prefs.onTop));$('#widget-pin').title=tr(prefs.onTop?'取消置顶，回到桌面底层':'置顶便签');$('#widget-pin').setAttribute('aria-label',$('#widget-pin').title);
 $$('.segmented button').forEach(b=>b.classList.toggle('active',b.dataset.mode===prefs.mode));
 $('#widget-category').value=prefs.category;$('#widget-date').value=d;
 $('#follow-indicator').textContent=tr(prefs.anchor?'固定日期':'跟随今天');
 $('#widget-title').textContent=prefs.mode==='day'?(d===today()?tr('今天的计划'):tr('{date}的计划',{date:fmt(d)})):tr('这一周的计划');
 const end=parse(range.end);end.setDate(end.getDate()-1);
 const rangeStart=parse(range.start);
 const weekRange=i18n.getLanguage()==='en'?i18n.formatDate(rangeStart,{month:'short',day:'numeric',...(rangeStart.getFullYear()!==end.getFullYear()?{year:'numeric'}:{})})+' – '+i18n.formatDate(end,{month:'short',day:'numeric',year:'numeric'}):tr('{year}年 {start} — {end}',{year:rangeStart.getFullYear(),start:fmt(range.start),end:fmt(model.dateKey(end))});
 $('#widget-range').textContent=prefs.mode==='day'?tr('{year}年 {date} · {weekday}',{year:parse(d).getFullYear(),date:fmt(d),weekday:weekday(d)}):weekRange;
 $('#pending-count').textContent=range.pending.length;$('#done-count').textContent=range.done.length;$('#progress-number').textContent=range.pending.length;
 $('.progress-ring').style.setProperty('--progress',(range.tasks.length?range.done.length/range.tasks.length*100:0)+'%');$('.progress-ring').title=tr('{done} / {total} 已完成',{done:range.done.length,total:range.tasks.length});
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
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.mode)settings({mode:b.dataset.mode});if(b.dataset.theme)settings({theme:b.dataset.theme});if(b.dataset.toggle){const t=state.tasks.find(t=>t.id===b.dataset.toggle);if(t)run(()=>window.WeeklightTaskActions.act(t.id,t.done?'reopen':'complete'));}if(b.dataset.edit)run(()=>api.editTask(b.dataset.edit));});
$('#quick-form').onsubmit=async e=>{
 e.preventDefault();if(busy)return;busy=true;$('#quick-submit').disabled=true;quickError='';$('#quick-error').textContent='';
 try{const data=Object.fromEntries(new FormData(e.target));await api.saveTask({...data,duration:30,category:prefs.category==='all'?'work':prefs.category,priority:'normal',notes:''},1);e.target.elements.title.value='';if(data.date!==(prefs.anchor||today()))await api.widgetSettings({anchor:data.date});toast('已添加到日历');e.target.elements.title.focus();}
 catch(err){quickError=errorText(err);$('#quick-error').textContent=i18n.translateError(quickError);}
 finally{busy=false;$('#quick-submit').disabled=false;}
};
function acceptState(s){state=s;i18n.setLanguage(s.settings.language);render();}
window.addEventListener('weeklight-language-changed',()=>{if(state)render();});
api.onState(acceptState);api.onError(toast);api.get().then(acceptState).catch(e=>toast(errorText(e)));
setInterval(()=>{if(state)render();},30000);
