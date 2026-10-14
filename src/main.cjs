const {app,BrowserWindow,ipcMain,Tray,Menu,nativeImage,Notification,dialog,shell,powerMonitor,net}=require('electron');
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {cleanTask,dueTasks,makeSeries,validateState,at}=require('./core.cjs');
const {validateSeriesTasks,previewTaskAction,applyTaskAction}=require('./task-series.cjs');
const {createWidgetController}=require('./widget-controller.cjs');
const {normalizePrefs}=require('./widget-model.cjs');
const {messages,normalizeRotation,getCurrentMessage,advanceMessage}=require('./reminder-copy.cjs');
const {APP_ID,resolveAppId,createWindowBranding}=require('./window-branding.cjs');
const windowBranding=createWindowBranding({app});
const {createLoginSettings}=require('./login-settings.cjs');
const loginSettings=createLoginSettings({app,loginItemName:APP_ID});
const {resolveDataPath}=require('./data-path.cjs');
const {createUpdateController}=require('./update-controller.cjs');
const {REPOSITORY_URL}=require('./update-checker.cjs');
const i18n=require('./i18n.js');
i18n.register(require('./locale-core.js'));
i18n.register({'桌面便签':'Desktop note','新建计划':'New task','取消':'Cancel'});
const {readInstallerLanguage,resolveInitialLanguage}=require('./installation-language.cjs');
const dataDir=resolveDataPath(app.getPath('userData'),process.env.WEEKLIGHT_DATA_DIR);
fs.mkdirSync(dataDir,{recursive:true});app.setPath('userData',dataDir);
app.setAppUserModelId(resolveAppId(app));
const dataFile=path.join(dataDir,'plans.json');
let state={version:1,tasks:[],settings:{language:'zh-CN',sound:true,popup:true,checkUpdates:true,widget:normalizePrefs(),reminderRotation:normalizeRotation()},history:[]};
let savedLanguage;const hasExistingData=fs.existsSync(dataFile);
let startupError='',startupPreferenceError='';let win,tray,popup,widgetController,quitting=false;const notifications=new Set();
const updateController=createUpdateController({currentVersion:app.getVersion(),fetchImpl:(url,options)=>net.fetch(url,options),onChange:()=>broadcast()});
try{if(hasExistingData){const raw=JSON.parse(fs.readFileSync(dataFile,'utf8'));state=validateState(raw);savedLanguage=raw.settings?.language;}}
catch(e){startupError=e.message;fs.copyFileSync(dataFile,path.join(dataDir,'plans-recovery-'+Date.now()+'.json'));}
const t=(key,values)=>i18n.t(key,values,state.settings.language);
const errorText=error=>i18n.translateError(error,state.settings.language);
function persist(next){const temp=dataFile+'.tmp';fs.writeFileSync(temp,JSON.stringify(next,null,2),'utf8');if(fs.existsSync(dataFile))fs.copyFileSync(dataFile,dataFile+'.bak');fs.renameSync(temp,dataFile);state=next;}
function startupStatus(){try{return {autostart:loginSettings.getOpenAtLogin(),autostartError:''};}catch(e){return {autostart:false,autostartError:t('无法读取 Windows 开机启动状态：{error}',{error:errorText(e)})};}}
function updateSnapshot(){const update=updateController.snapshot();return {...update,error:update.error?errorText(update.error):update.error};}
function snapshot(){return {...state,update:updateSnapshot(),dataDir,startupError:startupError?t('计划文件无法读取，已保留原文件。请从设置导入备份。{error}',{error:errorText(startupError)}):startupPreferenceError?t('语言设置暂未保存：{error}',{error:errorText(startupPreferenceError)}):'',...startupStatus(),packaged:app.isPackaged,reminderMessage:getCurrentMessage(state.settings.reminderRotation,state.settings.language),reminderMessageCount:messages.length};}
function broadcast(){for(const w of [win,popup,widgetController?.getWindow()])if(w&&!w.isDestroyed())w.webContents.send('state',snapshot());}
function change(fn){const next=structuredClone(state);fn(next);persist(next);broadcast();return snapshot();}
function nextReminderMessage(next){next.settings.reminderRotation=advanceMessage(next.settings.reminderRotation).rotation;}
function notificationEncouragement(){const m=getCurrentMessage(state.settings.reminderRotation,state.settings.language);return m.text+(m.url?' — '+m.source:'');}
function refreshShellLanguage(){
 for(const [window,key] of [[win,'橙子日程 · 计划你的每一周'],[popup,'橙子日程 · 提醒'],[widgetController?.getWindow(),'橙子日程 · 桌面便签']])if(window&&!window.isDestroyed()){window.setTitle(t(key));windowBranding.apply(window,t('橙子日程'));}
 if(!tray)return;
 tray.setToolTip(t('橙子日程 · 提醒在后台运行'));
 tray.setContextMenu(Menu.buildFromTemplate([{label:t('打开橙子日程'),click:showMain},{label:t('桌面便签'),click:()=>widgetController.open()},{label:t('新建计划'),click:()=>{showMain();win.webContents.send('new-task');}},{type:'separator'},{label:t('退出橙子日程（停止提醒）'),click:()=>{quitting=true;app.quit();}}]));
}
function showMain(){if(win?.isMinimized())win.restore();win?.show();win?.focus();}
function createWindow(){
  win=new BrowserWindow({width:1450,height:950,minWidth:1050,minHeight:720,title:t('橙子日程 · 计划你的每一周'),backgroundColor:'#f7f8fa',icon:windowBranding.iconPath,autoHideMenuBar:true,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  windowBranding.apply(win,t('橙子日程'));
  win.loadFile(path.join(__dirname,'index.html'));
  win.on('close',e=>{if(!quitting){e.preventDefault();win.hide();}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',e=>e.preventDefault());
  if(!process.argv.includes('--hidden')&&!process.argv.includes('--widget'))win.show();
}
function showReminder(){
  if(!state.settings.popup)return;
  if(popup&&!popup.isDestroyed()){popup.showInactive();return;}
  popup=new BrowserWindow({width:460,height:550,minWidth:400,minHeight:440,resizable:true,alwaysOnTop:true,title:t('橙子日程 · 提醒'),autoHideMenuBar:true,show:false,icon:windowBranding.iconPath,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  windowBranding.apply(popup,t('橙子日程'));
  popup.loadFile(path.join(__dirname,'reminder.html'));popup.on('closed',()=>{popup=null;});
  popup.webContents.setWindowOpenHandler(()=>({action:'deny'}));popup.webContents.on('will-navigate',e=>e.preventDefault());
  popup.show();
}
function notify(title,body){if(Notification.isSupported()){const n=new Notification({title,body,silent:!state.settings.sound,icon:path.join(__dirname,'assets/icon.png')});notifications.add(n);n.on('click',showMain);n.on('close',()=>notifications.delete(n));n.on('failed',()=>notifications.delete(n));n.show();setTimeout(()=>notifications.delete(n),60000).unref();}}
function tick(){
 try{
  const due=dueTasks(state.tasks);
  if(!due.length)return;
  change(next=>{
   nextReminderMessage(next);
   for(const task of due){
    const t=next.tasks.find(x=>x.id===task.id);t.notifiedAt=Date.now();t.snoozeUntil=null;
    next.history=next.history.filter(h=>h.taskId!==t.id||h.dismissed);
    next.history.push({id:crypto.randomUUID(),taskId:t.id,at:Date.now(),dismissed:false});
   }
   next.history=next.history.slice(-300);
  });
  const details=due.length>1?due.slice(0,3).map(task=>task.title.length>24?task.title.slice(0,24)+'…':task.title).join(' · '):due[0].date+' '+due[0].time+' · '+t(at(due[0])<Date.now()?'计划时间已到':'即将开始');
  notify(due.length>1?t('{count} 项计划等待处理',{count:due.length}):due[0].title,details+'\n'+notificationEncouragement());
  showReminder();
 }catch(e){win?.webContents.send('app-error',t('提醒状态保存失败：{error}',{error:errorText(e)}));}
}
function handle(name,fn){ipcMain.handle(name,async(e,...args)=>{
 try{
  if(![win,popup,widgetController?.getWindow()].some(w=>w&&!w.isDestroyed()&&w.webContents===e.sender))throw new Error('未知窗口');
  return await fn(...args);
 }catch(error){throw new Error(errorText(error));}
});}
if(!app.requestSingleInstanceLock()){app.quit();}
else{
app.on('second-instance',(_event,args)=>{if(args.includes('--widget'))widgetController?.open();else showMain();});
app.whenReady().then(()=>{
 state.settings.language=resolveInitialLanguage({savedLanguage,installerLanguage:app.isPackaged?readInstallerLanguage(process.resourcesPath):undefined,systemLocale:app.getLocale(),hasExistingData});
 if(!startupError&&savedLanguage!==state.settings.language){try{persist(state);}catch(error){startupPreferenceError=error.message;}}
 try{loginSettings.migrateLegacyOnce();}catch(e){console.error('Startup shortcut migration skipped:',e.message);}
 Menu.setApplicationMenu(null);createWindow();
 widgetController=createWidgetController({getState:()=>state,change,isQuitting:()=>quitting});
 tray=new Tray(nativeImage.createFromPath(path.join(__dirname,'assets/icon.png')).resize({width:20,height:20}));
 refreshShellLanguage();
 tray.on('double-click',showMain);tray.on('click',showMain);
 handle('get',()=>snapshot());
 handle('save-task',(input,repeat=1)=>{const old=state.tasks.find(t=>t.id===input.id);if(input.id&&!old)throw new Error('计划已被删除，无法保存旧编辑内容');const t=cleanTask({...input,done:old?old.done:input.done},old);const created=old?[]:makeSeries(t,typeof repeat==='object'?repeat:Number(repeat));if(state.tasks.length+created.length>10000)throw new Error('计划总数不能超过 10000 项，请缩短重复范围或先导出归档');return change(s=>{if(old){s.tasks=s.tasks.map(x=>x.id===t.id?t:x);if(t.done)s.history.forEach(h=>{if(h.taskId===t.id)h.dismissed=true;});}else s.tasks.push(...created);});});
 handle('preview-task-action',(id,action)=>previewTaskAction(state.tasks,id,action));
 handle('apply-task-action',request=>change(s=>applyTaskAction(s,request)));
 handle('toggle-task',id=>change(s=>{const t=s.tasks.find(x=>x.id===id);if(!t)throw new Error('计划不存在');t.done=!t.done;if(t.done){t.snoozeUntil=null;s.history.forEach(h=>{if(h.taskId===id)h.dismissed=true;});}}));
 handle('delete-task',id=>change(s=>{s.tasks=s.tasks.filter(t=>t.id!==id);s.history=s.history.filter(h=>h.taskId!==id);}));
 handle('move-task',(id,date,time)=>{const old=state.tasks.find(x=>x.id===id);if(!old)throw new Error('计划不存在');const t=cleanTask({...old,date,time:time||old.time},old);return change(s=>{s.tasks=s.tasks.map(x=>x.id===id?t:x);s.history.forEach(h=>{if(h.taskId===id)h.dismissed=true;});});});
 handle('reminder-action',(id,action)=>change(s=>{const t=s.tasks.find(x=>x.id===id);if(!t)return;if(action==='snooze'){t.snoozeUntil=Date.now()+600000;}else if(action==='done'){t.done=true;t.snoozeUntil=null;}else if(action!=='dismiss')throw new Error('操作无效');s.history.forEach(h=>{if(h.taskId===id)h.dismissed=true;});}));
 handle('settings',settings=>{if('language' in settings&&!['zh-CN','en'].includes(settings.language))throw new Error('不支持的界面语言');if(typeof settings.autostart==='boolean')loginSettings.setOpenAtLogin(settings.autostart);const result=change(s=>{if(settings.language)s.settings.language=settings.language;if(typeof settings.sound==='boolean')s.settings.sound=settings.sound;if(typeof settings.popup==='boolean')s.settings.popup=settings.popup;if(typeof settings.checkUpdates==='boolean')s.settings.checkUpdates=settings.checkUpdates;});if(settings.language)refreshShellLanguage();return result;});
 handle('check-updates',async()=>{await updateController.check({manual:true});return updateSnapshot();});
 handle('dismiss-update',()=>{updateController.dismiss();return updateSnapshot();});
 handle('open-update-page',async()=>{await shell.openExternal(REPOSITORY_URL+'/releases/latest');return true;});
 handle('download-update',async()=>{const release=updateController.snapshot().release;if(!release)throw new Error('请先检查是否有可用更新');await shell.openExternal(release.url);return true;});
 handle('test-reminder',()=>{change(nextReminderMessage);notify(t('橙子日程提醒已准备好'),t('这是一条测试通知。')+'\n'+notificationEncouragement());showReminder();return true;});
 handle('next-reminder-message',()=>change(nextReminderMessage));
 handle('export',async()=>{const r=await dialog.showSaveDialog(win,{title:t('导出橙子日程备份'),defaultPath:path.join(dataDir,t('橙子日程备份')+'-'+new Date().toISOString().slice(0,10)+'.json'),filters:[{name:t('JSON 备份'),extensions:['json']}]});if(!r.canceled){fs.writeFileSync(r.filePath,JSON.stringify(state,null,2),'utf8');return r.filePath;}return null;});
 handle('import',async()=>{const r=await dialog.showOpenDialog(win,{title:t('导入橙子日程备份'),properties:['openFile'],filters:[{name:t('JSON 备份'),extensions:['json']}]});if(r.canceled)return null;if(fs.statSync(r.filePaths[0]).size>20*1024*1024)throw new Error('备份文件超过 20 MB');const incoming=validateState(JSON.parse(fs.readFileSync(r.filePaths[0],'utf8').replace(/^\uFEFF/,'')));const confirm=await dialog.showMessageBox(win,{type:'question',buttons:[t('取消'),t('导入并合并')],defaultId:0,cancelId:0,message:t('导入 {count} 项计划？',{count:incoming.tasks.length}),detail:t('相同 ID 的计划将使用备份中的内容，其余现有计划保留。导入前会自动保存完整备份。')});if(confirm.response!==1)return null;fs.writeFileSync(path.join(dataDir,'before-import-'+Date.now()+'.json'),JSON.stringify(state,null,2),'utf8');return change(s=>{const map=new Map(s.tasks.map(task=>[task.id,task]));incoming.tasks.forEach(task=>{const old=map.get(task.id);if(old?.seriesId&&task.seriesId===undefined)task={...task,seriesId:old.seriesId,seriesIndex:old.seriesIndex};map.set(task.id,task);});validateSeriesTasks([...map.values()]);if(map.size>10000)throw new Error('合并后超过 10000 项上限');s.tasks=[...map.values()];});});
 handle('open-data',()=>shell.openPath(dataDir));
 handle('show-main',()=>showMain());
 handle('open-widget',()=>{widgetController.open();return snapshot();});
 handle('close-widget',()=>{widgetController.close();return snapshot();});
 handle('widget-settings',patch=>widgetController.settings(patch));
 handle('edit-task',id=>{if(!state.tasks.some(t=>t.id===id))throw new Error('该计划已被删除');showMain();win.webContents.send('edit-task',id);});
 if(process.argv.includes('--widget'))widgetController.open();else widgetController.restore();
 handle('quit',()=>{quitting=true;app.quit();});
 const automaticUpdateCheck=()=>{if(state.settings.checkUpdates)updateController.check({manual:false});};
 setTimeout(()=>{automaticUpdateCheck();setInterval(automaticUpdateCheck,6*60*60*1000).unref();},7000).unref();
 setTimeout(tick,3000);setInterval(tick,5000);powerMonitor.on('resume',()=>setTimeout(tick,1500));
});
app.on('before-quit',()=>{quitting=true;try{widgetController?.shutdown();}catch(e){console.error('Widget bounds not saved:',e.message);}});
app.on('window-all-closed',()=>{});
}

