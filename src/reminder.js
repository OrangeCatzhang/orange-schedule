const api=window.weeklight,i18n=window.WeeklightI18n,tr=(key,values)=>i18n.t(key,values),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let currentState=null,displayError=null;
const errorText=e=>String(e?.message||e).replace(/^Error invoking remote method '[^']+': Error: /,'');
function showError(key,error){displayError=error?{key,error:errorText(error)}:null;renderError();}
function renderError(){document.querySelector('#reminder-error').textContent=displayError?tr(displayError.key,{error:i18n.translateError(displayError.error)}):'';}
function render(s){
 currentState=s;i18n.apply();renderError();
 document.querySelector('#quote-translation-note').hidden=i18n.getLanguage()!=='en';
 const message=s.reminderMessage;if(message){document.querySelector('#quote-text').textContent=message.text;document.querySelector('#quote-text').dataset.id=message.id;document.querySelector('#quote-source').textContent=message.source;}
 document.querySelector('#quote-count').textContent=tr('{count} 条名句',{count:s.reminderMessageCount||''});
 const pending=s.history.filter(h=>!h.dismissed&&s.tasks.some(t=>t.id===h.taskId&&!t.done)).reverse();
 const list=document.querySelector('#reminders'),scroll=list.scrollTop;
 list.innerHTML=pending.length?pending.map(h=>{const t=s.tasks.find(t=>t.id===h.taskId);return '<div class="reminder-row"><h3>'+esc(t.title)+'</h3><p>'+t.date+' '+t.time+'</p><div class="actions"><button class="small-button" data-id="'+esc(t.id)+'" data-action="done">'+esc(tr('✓ 完成'))+'</button><button class="small-button" data-id="'+esc(t.id)+'" data-action="snooze">'+esc(tr('10 分钟后提醒'))+'</button><button class="text-button" data-id="'+esc(t.id)+'" data-action="dismiss">'+esc(tr('知道了'))+'</button></div></div>';}).join(''):'<div class="notice" style="margin-top:25px"><strong>'+esc(tr('提醒窗口已就绪'))+'</strong><p>'+esc(tr('当前没有待处理提醒。计划到时后会显示在这里。'))+'</p></div>';
 list.scrollTop=scroll;
}
function acceptState(s){currentState=s;i18n.setLanguage(s.settings.language);render(s);}
window.addEventListener('weeklight-language-changed',()=>{if(currentState)render(currentState);});
document.addEventListener('click',async e=>{const b=e.target.closest('[data-id][data-action]');if(b){try{showError();if(b.dataset.action==='done')await window.WeeklightTaskActions.act(b.dataset.id,'complete');else await api.reminderAction(b.dataset.id,b.dataset.action);}catch(err){showError('操作未保存：{error}',err);}}});
document.querySelector('#quote-next').onclick=async()=>{const button=document.querySelector('#quote-next');button.disabled=true;showError();try{acceptState(await api.nextReminderMessage());}catch(e){showError('暂时无法更换：{error}',e);}finally{button.disabled=false;}};
document.querySelector('#open-main').onclick=async()=>{try{await api.showMain();}catch(e){showError('操作未保存：{error}',e);}};
api.onState(acceptState);api.get().then(acceptState).catch(e=>showError('无法读取提醒：{error}',e));
