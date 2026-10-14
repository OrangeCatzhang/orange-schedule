const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {cleanTask,makeSeries}=require('../src/core.cjs');
const root=path.resolve(__dirname,'..'),workRoot=path.join(root,'_work');
const dataDir=path.join(workRoot,'language-backend-'+randomUUID());
const output=path.join(root,'outputs/verification/language-backend.json');
const executable=process.env.WEEKLIGHT_EXECUTABLE&&path.resolve(process.env.WEEKLIGHT_EXECUTABLE);
const resourceFile=executable&&path.join(path.dirname(executable),'resources/installer-language.json');
const checks=[];let app,resourceBefore,resourceExisted=false,resourceTouched=false;
const env={...process.env,WEEKLIGHT_DATA_DIR:dataDir};delete env.ELECTRON_RUN_AS_NODE;
const guards=['--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND','--proxy-server=http://127.0.0.1:9'];
const task=cleanTask({title:'User task 中文',notes:'Keep my notes 原文',date:'2150-01-01',time:'09:00',duration:30,reminder:-1,category:'work'});
const initial={version:1,tasks:makeSeries(task,{frequency:'daily',until:'2150-01-03'}),settings:{language:'en',sound:false,popup:true,checkUpdates:false},history:[]};
async function launch(){
 app=await electron.launch(executable?{executablePath:executable,args:guards,env}:{args:[root,...guards],env});
 await app.evaluate(({Notification,app,net,dialog,Menu})=>{
  globalThis.__languageBackend={notifications:0,dialogs:[],menus:[],network:[]};const log=globalThis.__languageBackend;
  Notification.isSupported=()=>{log.notifications++;return false;};
  app.setLoginItemSettings=()=>{throw new Error('Startup writes blocked');};
  net.fetch=async url=>{log.network.push(String(url));return new Response('',{status:404});};
  dialog.showSaveDialog=async(_win,options)=>{log.dialogs.push({type:'save',...options});return {canceled:true};};
  dialog.showOpenDialog=async(_win,options)=>{log.dialogs.push({type:'open',...options});return {canceled:false,filePaths:[app.getPath('userData')+'/import.json']};};
  dialog.showMessageBox=async(_win,options)=>{log.dialogs.push({type:'confirm',...options});return {response:0};};
  const build=Menu.buildFromTemplate;Menu.buildFromTemplate=function(items){log.menus.push(items.map(item=>item.label).filter(Boolean));return build.call(this,items);};
 });
 const page=await app.firstWindow();await page.waitForSelector('#setting-language',{state:'attached'});
 return page;
}
async function stop(){if(app){await app.close();app=null;}}
async function get(page){return page.evaluate(()=>window.weeklight.get());}
async function language(page,value){return page.evaluate(language=>window.weeklight.settings({language}),value);}
async function seed(state){await fs.writeFile(path.join(dataDir,'plans.json'),JSON.stringify(state));}
async function marker(value){
 assert(resourceFile&&path.resolve(resourceFile).startsWith(path.join(root,'outputs')+path.sep),'Installer metadata may only be staged in this project output');
 if(!resourceTouched){try{resourceBefore=await fs.readFile(resourceFile);resourceExisted=true;}catch(error){if(error.code!=='ENOENT')throw error;}resourceTouched=true;}
 await fs.writeFile(resourceFile,JSON.stringify({language:value}));
}
(async()=>{
 await fs.mkdir(dataDir,{recursive:true});await fs.mkdir(path.dirname(output),{recursive:true});let failure;
 try{
  await seed(initial);await fs.writeFile(path.join(dataDir,'import.json'),JSON.stringify(initial));
  let page=await launch();assert.equal((await get(page)).settings.language,'en');
  const before=(await get(page)).tasks;
  await assert.rejects(page.evaluate(()=>window.weeklight.saveTask({title:'X',date:'bad'})),/Choose a valid date/);
  await assert.rejects(page.evaluate(()=>window.weeklight.settings({language:'fr',sound:true})),/Unsupported interface language/);
  assert.equal((await get(page)).settings.sound,false);
  await page.evaluate(()=>window.weeklight.exportData());await page.evaluate(()=>window.weeklight.importData());
  let log=await app.evaluate(()=>globalThis.__languageBackend);
  assert.equal(log.dialogs[0].title,'Export Orange Schedule backup');
  assert.equal(log.dialogs[1].title,'Import Orange Schedule backup');
  assert.equal(log.dialogs[2].message,'Import 3 tasks?');
  assert.deepEqual(log.dialogs[2].buttons,['Cancel','Import and merge']);
  assert.deepEqual((await get(page)).tasks,before);
  checks.push('English validation errors and native backup dialogs; canceled import preserves tasks; invalid language has no partial writes');
  const update=await page.evaluate(()=>window.weeklight.checkUpdates());
  assert.equal(update.phase,'error');assert.match(update.error,/No public release was found/);
  await language(page,'zh-CN');
  await assert.rejects(page.evaluate(()=>window.weeklight.saveTask({title:'X',date:'bad'})),/请选择有效日期/);
  assert.match((await get(page)).update.error,/暂未找到/);
  await language(page,'en');
  log=await app.evaluate(()=>globalThis.__languageBackend);
  assert.deepEqual(log.menus.at(-1),['Open Orange Schedule','Desktop note','New task','Quit Orange Schedule (stop reminders)']);
  assert.deepEqual((await get(page)).tasks,before);
  checks.push('Update errors and native tray labels follow language changes; user task titles and notes remain unchanged');
  const saved=JSON.parse(await fs.readFile(path.join(dataDir,'plans.json'),'utf8'));assert.equal(saved.settings.language,'en');
  await stop();page=await launch();assert.equal((await get(page)).settings.language,'en');await stop();
  checks.push('Language persists across restart');
  if(resourceFile){
   await marker('en');const legacy=structuredClone(initial);delete legacy.settings.language;
   await seed(legacy);page=await launch();assert.equal((await get(page)).settings.language,'en');assert.equal((await get(page)).tasks.length,3);await stop();
   await marker('zh-CN');page=await launch();assert.equal((await get(page)).settings.language,'en');await stop();
   await seed(legacy);page=await launch();assert.equal((await get(page)).settings.language,'zh-CN');await stop();
   await marker('en');await fs.unlink(path.join(dataDir,'plans.json'));page=await launch();assert.equal((await get(page)).settings.language,'en');assert.equal((await get(page)).tasks.length,0);await stop();
   checks.push('Packaged first run uses installer language; old profiles accept installer choice; later upgrades retain saved preference');
  }
 }catch(error){failure=error;}
 finally{
  try{await stop();if(resourceTouched){if(resourceExisted)await fs.writeFile(resourceFile,resourceBefore);else await fs.unlink(resourceFile);}
   assert.equal(path.dirname(dataDir),workRoot);assert(!(await fs.lstat(dataDir)).isSymbolicLink());assert.equal(path.dirname(await fs.realpath(dataDir)),await fs.realpath(workRoot));await fs.rm(dataDir,{recursive:true,force:true});
  }catch(error){failure||=error;}
  const report={passed:!failure,packaged:!!executable,checks,error:failure?.stack};await fs.writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }
 if(failure)throw failure;
})().catch(error=>{console.error(error);process.exitCode=1;});
