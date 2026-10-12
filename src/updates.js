(()=>{
 const api=window.weeklight;
 const banner=document.createElement('section');banner.id='update-banner';banner.className='update-banner';banner.hidden=true;banner.setAttribute('aria-label','版本更新');
 banner.innerHTML='<div><strong id="update-banner-title"></strong><p>查看更新说明，按需下载安装。</p></div><div class="update-buttons"><button id="update-view" class="small-button">查看更新</button><button id="update-later" class="text-button">稍后</button></div>';
 document.querySelector('#summary').before(banner);
 const section=document.createElement('section');section.className='update-settings';section.setAttribute('aria-label','应用更新');
 section.innerHTML='<div class="setting-line"><div><strong>自动检查更新</strong><p>启动后及运行期间每 6 小时检查稳定版；只获取公开版本信息。</p></div><input type="checkbox" id="setting-updates" aria-label="自动检查更新"></div><div class="update-version-line"><span id="update-current"></span><button class="small-button" id="check-updates">检查更新</button></div><p id="update-status" role="status"></p><div class="update-manual-line"><button class="text-button" id="open-update-page">打开官方下载页 ↗</button><span>可随时手动查看版本与安装包</span></div><details id="update-details" hidden><summary id="update-release-title">更新说明</summary><pre id="update-notes"></pre><button class="secondary" id="download-update">下载安装包 ↗</button><p class="update-install-note">将在浏览器下载安装包。下载完成后，退出旧版并安装到原位置。</p></details>';
 document.querySelector('#test-reminder').before(section);
 const $=selector=>document.querySelector(selector);let currentState=null,settingBusy=false,settingError='';
 const errorText=error=>error.message.replace(/^Error invoking remote method '[^']+': Error: /,'');
 function render(s){
  currentState=s;const u=s.update;if(!u)return;
  if(!settingBusy)$('#setting-updates').checked=s.settings.checkUpdates!==false;
  $('#setting-updates').disabled=settingBusy;$('#check-updates').disabled=u.phase==='checking';
  $('#check-updates').textContent=u.phase==='checking'?'正在检查…':'检查更新';
  $('#update-current').textContent='当前版本 '+u.currentVersion;
  $('#update-status').classList.toggle('update-error',u.phase==='error');
  $('#update-status').textContent=settingError||(u.phase==='checking'?'正在获取最新版本信息…':u.phase==='available'?'发现新版本 '+u.release.version:u.phase==='current'?'当前已是最新稳定版。':u.phase==='error'?u.error:'可手动检查是否有新版本。');
  $('#update-details').hidden=!u.release;
  if(u.release){$('#update-release-title').textContent='版本 '+u.release.version+' · 更新说明';$('#update-notes').textContent=u.release.notes||'此版本未提供更新说明。';$('#update-banner-title').textContent='橙子日程 '+u.release.version+' 可更新';}
  banner.hidden=!u.release||u.dismissed;
 }
 $('#setting-updates').onchange=async event=>{
  if(settingBusy)return;const enabled=event.target.checked;settingBusy=true;settingError='';event.target.disabled=true;
  try{currentState=await api.settings({checkUpdates:enabled});}
  catch(error){settingError=errorText(error);}
  finally{settingBusy=false;if(currentState)render(currentState);}
 };
 $('#check-updates').onclick=async()=>{settingError='';try{const update=await api.checkUpdates();if(currentState)render({...currentState,update});}catch(error){$('#update-status').textContent=errorText(error);}};
 $('#update-later').onclick=async()=>{try{const update=await api.dismissUpdate();if(currentState)render({...currentState,update});}catch(error){$('#update-status').textContent=errorText(error);}};
 $('#update-view').onclick=()=>{$('#settings-button').click();$('#update-details').open=true;$('#update-details').scrollIntoView({block:'nearest'});};
 $('#open-update-page').onclick=async()=>{const button=$('#open-update-page');button.disabled=true;try{await api.openUpdatePage();$('#update-status').textContent='已在浏览器打开官方下载页。';}catch(error){$('#update-status').textContent=errorText(error);}finally{button.disabled=false;}};
 $('#download-update').onclick=async()=>{const button=$('#download-update');button.disabled=true;try{await api.downloadUpdate();$('#update-status').textContent='已在浏览器打开安装包下载。';}catch(error){$('#update-status').textContent=errorText(error);}finally{button.disabled=false;}};
 api.onState(render);api.get().then(render).catch(error=>{$('#update-status').textContent=errorText(error);});
})();
