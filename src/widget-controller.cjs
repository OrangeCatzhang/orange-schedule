const {BrowserWindow,screen}=require('electron');
const {sendToBottom}=require('./window-layer.cjs');
const path=require('node:path');const {normalizePrefs}=require('./widget-model.cjs');
function createWidgetController({getState,change,isQuitting}){
 let window=null,timer,layerUpdate=Promise.resolve();
 const preferences=()=>normalizePrefs(getState().settings.widget);
 // Serialize native calls so a late bottom operation cannot undo a newer pin setting.
 function updateLayer(){
  layerUpdate=layerUpdate.catch(()=>{}).then(async()=>{
   const target=window;if(!target||target.isDestroyed())return;
   target.setAlwaysOnTop(preferences().onTop);
   if(!preferences().onTop)await sendToBottom(target);
   if(!target.isDestroyed()&&preferences().onTop)target.setAlwaysOnTop(true);
  });
  return layerUpdate;
 }
 function settleLayer(){updateLayer().catch(e=>{if(window&&!window.isDestroyed())window.webContents.send('app-error','便签层级设置失败：'+e.message);});}
 function bounds(){
  const saved=preferences().bounds,primary=screen.getPrimaryDisplay().workArea;
  let r=saved||{width:410,height:650,x:primary.x+primary.width-438,y:primary.y+44};
  const display=screen.getAllDisplays().find(d=>{const a=d.workArea;return r.x+r.width>a.x+40&&r.x<a.x+a.width-40&&r.y+r.height>a.y+40&&r.y<a.y+a.height-40;});
  const a=display?.workArea||primary;const width=Math.max(340,Math.min(r.width,a.width)),height=Math.max(380,Math.min(r.height,a.height));
  return {width,height,x:Math.round(Math.min(Math.max(r.x,a.x),a.x+a.width-width)),y:Math.round(Math.min(Math.max(r.y,a.y),a.y+a.height-height))};
 }
 function saveBounds(){clearTimeout(timer);if(!window||window.isDestroyed())return;const b=window.getBounds();if(JSON.stringify(preferences().bounds)!==JSON.stringify(b))change(s=>{s.settings.widget=normalizePrefs({...s.settings.widget,bounds:b});});}
 function debounce(){clearTimeout(timer);timer=setTimeout(()=>{try{saveBounds();}catch(e){window?.webContents.send('app-error','便签位置未保存：'+e.message);}},400);}
 function open(){
  if(!preferences().enabled)change(s=>{s.settings.widget=normalizePrefs({...s.settings.widget,enabled:true});});
  if(window&&!window.isDestroyed()){if(window.isMinimized())window.restore();window.showInactive();settleLayer();return;}
  window=new BrowserWindow({...bounds(),minWidth:340,minHeight:380,maxWidth:680,maxHeight:1000,frame:false,transparent:true,backgroundColor:'#00000000',resizable:true,maximizable:false,fullscreenable:false,skipTaskbar:true,alwaysOnTop:preferences().onTop,hasShadow:true,show:false,title:'周光 · 桌面便签',icon:path.join(__dirname,'assets/icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  window.loadFile(path.join(__dirname,'widget.html'));window.once('ready-to-show',()=>{window?.showInactive();settleLayer();});
  window.on('blur',()=>{if(!preferences().onTop)settleLayer();});
  window.on('move',debounce);window.on('resize',debounce);
  window.on('close',e=>{if(!isQuitting()){e.preventDefault();close();}});
  window.on('closed',()=>{window=null;});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
 }
 function close(){saveBounds();if(preferences().enabled)change(s=>{s.settings.widget=normalizePrefs({...s.settings.widget,enabled:false});});window?.hide();}
 async function settings(patch){
  if(!patch||typeof patch!=='object')throw new Error('便签设置格式无效');
  const allowed=Object.fromEntries(Object.entries(patch).filter(([k])=>['mode','anchor','category','onTop','theme','showCompleted'].includes(k)));
  const result=change(s=>{s.settings.widget=normalizePrefs({...s.settings.widget,...allowed});});
  if(Object.hasOwn(allowed,'onTop'))await updateLayer();
  return result;
 }
 return {open,close,settings,getWindow:()=>window,restore:()=>{if(preferences().enabled)open();},shutdown:saveBounds};
}
module.exports={createWidgetController};

