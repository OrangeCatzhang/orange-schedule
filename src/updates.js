(()=>{
 const api=window.weeklight,i18n=window.WeeklightI18n,tr=(key,values)=>i18n.t(key,values);
 const banner=document.createElement('section');banner.id='update-banner';banner.className='update-banner';banner.hidden=true;banner.setAttribute('data-i18n-aria-label','版本更新');
 banner.innerHTML='<div><strong id="update-banner-title"></strong><p data-i18n="查看更新说明，按需下载安装。">查看更新说明，按需下载安装。</p></div><div class="update-buttons"><button id="update-view" class="small-button" data-i18n="查看更新">查看更新</button><button id="update-later" class="text-button" data-i18n="稍后">稍后</button></div>';
 document.querySelector('#summary').before(banner);
 const section=document.createElement('section');section.className='update-settings';section.setAttribute('data-i18n-aria-label','应用更新');
 section.innerHTML='<div class="setting-line"><div><strong data-i18n="自动检查更新">自动检查更新</strong><p data-i18n="启动后及运行期间每 6 小时检查稳定版；只获取公开版本信息。">启动后及运行期间每 6 小时检查稳定版；只获取公开版本信息。</p></div><input type="checkbox" id="setting-updates" data-i18n-aria-label="自动检查更新"></div><div class="update-version-line"><span id="update-current"></span><button class="small-button" id="check-updates">检查更新</button></div><p id="update-status" role="status"></p><div class="update-manual-line"><button class="text-button" id="open-update-page" data-i18n="打开官方下载页 ↗">打开官方下载页 ↗</button><span data-i18n="可随时手动查看版本与安装包">可随时手动查看版本与安装包</span></div><details id="update-details" hidden><summary id="update-release-title">更新说明</summary><pre id="update-notes"></pre><button class="secondary" id="download-update" data-i18n="下载安装包 ↗">下载安装包 ↗</button><p class="update-install-note" data-i18n="将在浏览器下载安装包。下载完成后，退出旧版并安装到原位置。">将在浏览器下载安装包。下载完成后，退出旧版并安装到原位置。</p></details>';
 document.querySelector('#test-reminder').before(section);
 const $=selector=>document.querySelector(selector);let currentState=null,settingBusy=false,settingError='',actionStatus='';
 const errorText=error=>String(error?.message||error).replace(/^Error invoking remote method '[^']+': Error: /,'');
 function render(s){
  currentState=s;i18n.apply(banner);i18n.apply(section);const u=s.update;if(!u)return;
  if(!settingBusy)$('#setting-updates').checked=s.settings.checkUpdates!==false;
  $('#setting-updates').disabled=settingBusy;$('#check-updates').disabled=u.phase==='checking';
  $('#check-updates').textContent=tr(u.phase==='checking'?'正在检查…':'检查更新');
  $('#update-current').textContent=tr('当前版本 {version}',{version:u.currentVersion});
  $('#update-status').classList.toggle('update-error',u.phase==='error'||!!settingError);
  $('#update-status').textContent=settingError?i18n.translateError(settingError):actionStatus?tr(actionStatus):u.phase==='checking'?tr('正在获取最新版本信息…'):u.phase==='available'?tr('发现新版本 {version}',{version:u.release.version}):u.phase==='current'?tr('当前已是最新稳定版。'):u.phase==='error'?i18n.translateError(u.error):tr('可手动检查是否有新版本。');
  $('#update-details').hidden=!u.release;
  if(u.release){$('#update-release-title').textContent=tr('版本 {version} · 更新说明',{version:u.release.version});$('#update-notes').textContent=u.release.notes||tr('此版本未提供更新说明。');$('#update-banner-title').textContent=tr('橙子日程 {version} 可更新',{version:u.release.version});}
  banner.hidden=!u.release||u.dismissed;
 }
 function acceptState(s){currentState=s;i18n.setLanguage(s.settings.language);render(s);}
 function showStatus(key,error){actionStatus=key||'';settingError=error?errorText(error):'';if(currentState)render(currentState);else $('#update-status').textContent=settingError?i18n.translateError(settingError):tr(actionStatus);}
 window.addEventListener('weeklight-language-changed',()=>{if(currentState)render(currentState);else{i18n.apply(banner);i18n.apply(section);}});
 $('#setting-updates').onchange=async event=>{
  if(settingBusy)return;const enabled=event.target.checked;settingBusy=true;settingError='';actionStatus='';event.target.disabled=true;
  try{currentState=await api.settings({checkUpdates:enabled});}
  catch(error){settingError=errorText(error);}
  finally{settingBusy=false;if(currentState)acceptState(currentState);}
 };
 $('#check-updates').onclick=async()=>{showStatus();try{const update=await api.checkUpdates();if(currentState)render({...currentState,update});}catch(error){showStatus('',error);}};
 $('#update-later').onclick=async()=>{try{const update=await api.dismissUpdate();if(currentState)render({...currentState,update});}catch(error){showStatus('',error);}};
 $('#update-view').onclick=()=>{$('#settings-button').click();$('#update-details').open=true;$('#update-details').scrollIntoView({block:'nearest'});};
 $('#open-update-page').onclick=async()=>{const button=$('#open-update-page');button.disabled=true;try{await api.openUpdatePage();showStatus('已在浏览器打开官方下载页。');}catch(error){showStatus('',error);}finally{button.disabled=false;}};
 $('#download-update').onclick=async()=>{const button=$('#download-update');button.disabled=true;try{await api.downloadUpdate();showStatus('已在浏览器打开安装包下载。');}catch(error){showStatus('',error);}finally{button.disabled=false;}};
 api.onState(acceptState);api.get().then(acceptState).catch(error=>showStatus('',error));
})();
