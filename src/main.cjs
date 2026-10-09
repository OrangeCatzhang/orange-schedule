const {app,BrowserWindow,ipcMain,Tray,Menu,nativeImage,Notification,dialog,shell,powerMonitor}=require('electron');
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {cleanTask,dueTasks,makeSeries,validateState,at}=require('./core.cjs');
const {createWidgetController}=require('./widget-controller.cjs');
const {normalizePrefs}=require('./widget-model.cjs');
const {messages,normalizeRotation,getCurrentMessage,advanceMessage}=require('./reminder-copy.cjs');
const APP_ID='local.weeklight.planner';
const {createLoginSettings}=require('./login-settings.cjs');
const loginSettings=createLoginSettings({app,loginItemName:APP_ID});
const {resolveDataPath}=require('./data-path.cjs');
const dataDir=resolveDataPath(app.getPath('userData'),process.env.WEEKLIGHT_DATA_DIR);
fs.mkdirSync(dataDir,{recursive:true});app.setPath('userData',dataDir);
app.setAppUserModelId(APP_ID);
const dataFile=path.join(dataDir,'plans.json');
let state={version:1,tasks:[],settings:{sound:true,popup:true,widget:normalizePrefs(),reminderRotation:normalizeRotation()},history:[]};
let startupError='';let win,tray,popup,widgetController,quitting=false;const notifications=new Set();
try{if(fs.existsSync(dataFile))state=validateState(JSON.parse(fs.readFileSync(dataFile,'utf8')));}
catch(e){startupError='计划文件无法读取，已保留原文件。请从设置导入备份。'+e.message;fs.copyFileSync(dataFile,path.join(dataDir,'plans-recovery-'+Date.now()+'.json'));}
function persist(next){const temp=dataFile+'.tmp';fs.writeFileSync(temp,JSON.stringify(next,null,2),'utf8');if(fs.existsSync(dataFile))fs.copyFileSync(dataFile,dataFile+'.bak');fs.renameSync(temp,dataFile);state=next;}
function startupStatus(){try{return {autostart:loginSettings.getOpenAtLogin(),autostartError:''};}catch(e){return {autostart:false,autostartError:'无法读取 Windows 开机启动状态：'+e.message};}}
function snapshot(){return {...state,dataDir,startupError,...startupStatus(),packaged:app.isPackaged,reminderMessage:getCurrentMessage(state.settings.reminderRotation),reminderMessageCount:messages.length};}
function broadcast(){for(const w of [win,popup,widgetController?.getWindow()])if(w&&!w.isDestroyed())w.webContents.send('state',snapshot());}
function change(fn){const next=structuredClone(state);fn(next);persist(next);broadcast();return snapshot();}
function nextReminderMessage(next){next.settings.reminderRotation=advanceMessage(next.settings.reminderRotation).rotation;}
function notificationEncouragement(){const m=getCurrentMessage(state.settings.reminderRotation);return m.text+(m.url?' — '+m.source:'');}
function showMain(){if(win?.isMinimized())win.restore();win?.show();win?.focus();}
function createWindow(){
  win=new BrowserWindow({width:1450,height:950,minWidth:1050,minHeight:720,title:'橙子日程 · 计划你的每一周',backgroundColor:'#f7f8fa',icon:path.join(__dirname,'assets/icon.png'),autoHideMenuBar:true,show:!process.argv.includes('--hidden')&&!process.argv.includes('--widget'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.loadFile(path.join(__dirname,'index.html'));
  win.on('close',e=>{if(!quitting){e.preventDefault();win.hide();}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',e=>e.preventDefault());
}
function showReminder(){
  if(!state.settings.popup)return;
  if(popup&&!popup.isDestroyed()){popup.showInactive();return;}
  popup=new BrowserWindow({width:460,height:550,minWidth:400,minHeight:440,resizable:true,alwaysOnTop:true,title:'橙子日程 · 提醒',autoHideMenuBar:true,icon:path.join(__dirname,'assets/icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  popup.loadFile(path.join(__dirname,'reminder.html'));popup.on('closed',()=>{popup=null;});
  popup.webContents.setWindowOpenHandler(()=>({action:'deny'}));popup.webContents.on('will-navigate',e=>e.preventDefault());
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
  const details=due.length>1?due.slice(0,3).map(t=>t.title.length>24?t.title.slice(0,24)+'…':t.title).join(' · '):due[0].date+' '+due[0].time+' · '+(at(due[0])<Date.now()?'计划时间已到':'即将开始');
  notify(due.length>1?due.length+' 项计划等待处理':due[0].title,details+'\n'+notificationEncouragement());
  showReminder();
 }catch(e){win?.webContents.send('app-error','提醒状态保存失败：'+e.message);}
}
function handle(name,fn){ipcMain.handle(name,async(e,...args)=>{
 if(![win,popup,widgetController?.getWindow()].some(w=>w&&!w.isDestroyed()&&w.webContents===e.sender))throw new Error('未知窗口');
 return fn(...args);
});}
if(!app.requestSingleInstanceLock()){app.quit();}
else{
app.on('second-instance',(_event,args)=>{if(args.includes('--widget'))widgetController?.open();else showMain();});
app.whenReady().then(()=>{
 try{loginSettings.migrateLegacyOnce();}catch(e){console.error('Startup shortcut migration skipped:',e.message);}
 Menu.setApplicationMenu(null);createWindow();
 widgetController=createWidgetController({getState:()=>state,change,isQuitting:()=>quitting});
 tray=new Tray(nativeImage.createFromPath(path.join(__dirname,'assets/icon.png')).resize({width:20,height:20}));
 tray.setToolTip('橙子日程 · 提醒在后台运行');
 tray.setContextMenu(Menu.buildFromTemplate([{label:'打开橙子日程',click:showMain},{label:'桌面便签',click:()=>widgetController.open()},{label:'新建计划',click:()=>{showMain();win.webContents.send('new-task');}},{type:'separator'},{label:'退出橙子日程（停止提醒）',click:()=>{quitting=true;app.quit();}}]));
 tray.on('double-click',showMain);tray.on('click',showMain);
 handle('get',()=>snapshot());
 handle('save-task',(input,repeat=1)=>{const old=state.tasks.find(t=>t.id===input.id);const t=cleanTask({...input,done:old?old.done:input.done},old);const created=old?[]:makeSeries(t,typeof repeat==='object'?repeat:Number(repeat));if(state.tasks.length+created.length>10000)throw new Error('计划总数不能超过 10000 项，请缩短重复范围或先导出归档');return change(s=>{if(old){s.tasks=s.tasks.map(x=>x.id===t.id?t:x);if(t.done)s.history.forEach(h=>{if(h.taskId===t.id)h.dismissed=true;});}else s.tasks.push(...created);});});
 handle('toggle-task',id=>change(s=>{const t=s.tasks.find(x=>x.id===id);if(!t)throw new Error('计划不存在');t.done=!t.done;if(t.done){t.snoozeUntil=null;s.history.forEach(h=>{if(h.taskId===id)h.dismissed=true;});}}));
 handle('delete-task',id=>change(s=>{s.tasks=s.tasks.filter(t=>t.id!==id);s.history=s.history.filter(h=>h.taskId!==id);}));
 handle('move-task',(id,date,time)=>{const old=state.tasks.find(x=>x.id===id);if(!old)throw new Error('计划不存在');const t=cleanTask({...old,date,time:time||old.time},old);return change(s=>{s.tasks=s.tasks.map(x=>x.id===id?t:x);s.history.forEach(h=>{if(h.taskId===id)h.dismissed=true;});});});
 handle('reminder-action',(id,action)=>change(s=>{const t=s.tasks.find(x=>x.id===id);if(!t)return;if(action==='snooze'){t.snoozeUntil=Date.now()+600000;}else if(action==='done'){t.done=true;t.snoozeUntil=null;}else if(action!=='dismiss')throw new Error('操作无效');s.history.forEach(h=>{if(h.taskId===id)h.dismissed=true;});}));
 handle('settings',settings=>{if(typeof settings.autostart==='boolean')loginSettings.setOpenAtLogin(settings.autostart);return change(s=>{if(typeof settings.sound==='boolean')s.settings.sound=settings.sound;if(typeof settings.popup==='boolean')s.settings.popup=settings.popup;});});
 handle('test-reminder',()=>{change(nextReminderMessage);notify('橙子日程提醒已准备好','这是一条测试通知。\n'+notificationEncouragement());showReminder();return true;});
 handle('next-reminder-message',()=>change(nextReminderMessage));
 handle('export',async()=>{const r=await dialog.showSaveDialog(win,{title:'导出橙子日程备份',defaultPath:path.join(dataDir,'橙子日程备份-'+new Date().toISOString().slice(0,10)+'.json'),filters:[{name:'JSON 备份',extensions:['json']}]});if(!r.canceled){fs.writeFileSync(r.filePath,JSON.stringify(state,null,2),'utf8');return r.filePath;}return null;});
 handle('import',async()=>{const r=await dialog.showOpenDialog(win,{title:'导入橙子日程备份',properties:['openFile'],filters:[{name:'JSON 备份',extensions:['json']}]});if(r.canceled)return null;if(fs.statSync(r.filePaths[0]).size>20*1024*1024)throw new Error('备份文件超过 20 MB');const incoming=validateState(JSON.parse(fs.readFileSync(r.filePaths[0],'utf8').replace(/^\uFEFF/,'')));const confirm=await dialog.showMessageBox(win,{type:'question',buttons:['取消','导入并合并'],defaultId:0,cancelId:0,message:'导入 '+incoming.tasks.length+' 项计划？',detail:'相同 ID 的计划将使用备份中的内容，其余现有计划保留。导入前会自动保存完整备份。'});if(confirm.response!==1)return null;fs.writeFileSync(path.join(dataDir,'before-import-'+Date.now()+'.json'),JSON.stringify(state,null,2),'utf8');return change(s=>{const map=new Map(s.tasks.map(t=>[t.id,t]));incoming.tasks.forEach(t=>map.set(t.id,t));if(map.size>10000)throw new Error('合并后超过 10000 项上限');s.tasks=[...map.values()];});});
 handle('open-data',()=>shell.openPath(dataDir));
 handle('show-main',()=>showMain());
 handle('open-widget',()=>{widgetController.open();return snapshot();});
 handle('close-widget',()=>{widgetController.close();return snapshot();});
 handle('widget-settings',patch=>widgetController.settings(patch));
 handle('edit-task',id=>{if(!state.tasks.some(t=>t.id===id))throw new Error('该计划已被删除');showMain();win.webContents.send('edit-task',id);});
 if(process.argv.includes('--widget'))widgetController.open();else widgetController.restore();
 handle('quit',()=>{quitting=true;app.quit();});
 setTimeout(tick,3000);setInterval(tick,5000);powerMonitor.on('resume',()=>setTimeout(tick,1500));
});
app.on('before-quit',()=>{quitting=true;try{widgetController?.shutdown();}catch(e){console.error('Widget bounds not saved:',e.message);}});
app.on('window-all-closed',()=>{});
}

