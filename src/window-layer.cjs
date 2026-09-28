const {app}=require('electron');
const {execFile}=require('node:child_process');const path=require('node:path');
function helperPath(){return app.isPackaged?path.join(process.resourcesPath,'native','WeeklightLayer.exe'):path.join(__dirname,'native','WeeklightLayer.exe');}
function nativeHandle(window){const h=window.getNativeWindowHandle();return (h.length===8?h.readBigUInt64LE(0):BigInt(h.readUInt32LE(0))).toString();}
function sendToBottom(window){
 if(process.platform!=='win32'||!window||window.isDestroyed()||!window.isVisible())return Promise.resolve();
 return new Promise((resolve,reject)=>execFile(helperPath(),['bottom',nativeHandle(window),String(process.pid)],{windowsHide:true,timeout:3000},error=>error?reject(error):resolve()));
}
module.exports={sendToBottom,nativeHandle,helperPath};
