const {_electron:electron}=require('playwright');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');
const root=path.resolve(__dirname,'..'), dataDir=path.join(root,'_work','ui-test-'+Date.now()),output=path.join(root,'outputs','verification');
const env={...process.env,WEEKLIGHT_DATA_DIR:dataDir};delete env.ELECTRON_RUN_AS_NODE;
(async()=>{await fs.mkdir(output,{recursive:true});let app;
try{
 app=await electron.launch({args:[root],env});const page=await app.firstWindow();await page.waitForSelector('.month-grid');
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 assert.equal(await page.locator('.day-cell').count(),28);
 await page.locator('.new-button').click();await page.locator('[name=title]').fill('UI 验证：阶段规划');
 await page.locator('[name=date]').fill('2026-12-28');await page.locator('[name=time]').fill('10:00');
 await page.locator('[name=reminder]').selectOption('-1');await page.locator('[name=repeat]').selectOption('4');
 await page.locator('[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);
 let s=await page.evaluate(()=>window.weeklight.get());assert.equal(s.tasks.length,4);assert.equal(s.tasks[3].date,'2027-01-18');
 await page.locator('#settings-button').click();await page.locator('#load-samples').click();await page.waitForFunction(()=>!document.querySelector('#settings-dialog').open);
 await page.waitForTimeout(500);await page.screenshot({path:path.join(output,'weeklight-four-weeks.png'),fullPage:true});
 // Edit a sample through UI.
 await page.locator('.event').first().click();await page.locator('[name=title]').fill('修改后的计划');await page.locator('[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);
 s=await page.evaluate(()=>window.weeklight.get());assert(s.tasks.some(t=>t.title==='修改后的计划'));
 // Drag a task onto another day.
 const movingId=await page.locator('.event').first().getAttribute('data-task');const target=page.locator('.day-cell').nth(5);const targetDate=await target.getAttribute('data-date');await page.locator('.event').first().dragTo(target);
 await page.waitForTimeout(200);assert.equal((await page.evaluate(()=>window.weeklight.get())).tasks.find(t=>t.id===movingId).date,targetDate);
 await page.locator('[data-mode=week]').click();assert.equal(await page.locator('.hour-cell').count(),168);await page.screenshot({path:path.join(output,'weeklight-week.png'),fullPage:true});
 await page.locator('[data-mode=list]').click();await page.locator('.list-view [data-toggle]').first().click();
 s=await page.evaluate(()=>window.weeklight.get());assert(s.tasks.some(t=>t.done));
 await page.locator('#search-button').click();await page.locator('#search').fill('不存在的搜索文本');assert.equal(await page.locator('.list-view .task-row').count(),0);await page.locator('#clear-search').click();
 // Real background trigger, persistence and snooze.
 const now=new Date(Date.now()-60000);const date=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
 const time=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
 const reminderWindowPromise=app.waitForEvent('window',{timeout:15000}); await page.evaluate(({date,time})=>window.weeklight.saveTask({title:'验证后台提醒',date,time,duration:30,category:'life',reminder:0},1),{date,time});
 await page.waitForFunction(()=>document.querySelector('#reminder-count').textContent==='1',null,{timeout:15000});
 s=await page.evaluate(()=>window.weeklight.get());const reminderTask=s.tasks.find(t=>t.title==='验证后台提醒');assert(reminderTask.notifiedAt); const reminderWindow=await reminderWindowPromise; await reminderWindow.waitForSelector('[data-action=snooze]'); assert(app.windows().length>=2);
 await page.evaluate(id=>window.weeklight.reminderAction(id,'snooze'),reminderTask.id);
 s=await page.evaluate(()=>window.weeklight.get());assert(s.tasks.find(t=>t.id===reminderTask.id).snoozeUntil>Date.now()+590000);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).close());assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).isVisible()),false);
 const before=s.tasks.length;
 await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path.join(dataDir,'export.json'));
 await page.evaluate(()=>window.weeklight.exportData());
 const backup=JSON.parse(await fs.readFile(path.join(dataDir,'export.json'),'utf8'));assert.equal(backup.tasks.length,before);
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:1});},path.join(dataDir,'export.json'));
 await page.evaluate(()=>window.weeklight.importData());
 assert((await fs.readdir(dataDir)).some(f=>f.startsWith('before-import-')));
 await fs.writeFile(path.join(dataDir,'export.json'),'{"version":1,"tasks":[{"title":"invalid"}]}');
 const rejected=await page.evaluate(()=>window.weeklight.importData().then(()=>false).catch(()=>true));assert.equal(rejected,true);
 assert.equal((await page.evaluate(()=>window.weeklight.get())).tasks.length,before);
 await app.close();app=null;
 app=await electron.launch({args:[root],env});const page2=await app.firstWindow();await page2.waitForSelector('.month-grid');s=await page2.evaluate(()=>window.weeklight.get());assert.equal(s.tasks.length,before);assert(s.tasks.find(t=>t.id===reminderTask.id).snoozeUntil);
 // Delete via confirmation.
 await page2.locator('.event').first().click();await page2.locator('#delete-task').click();await page2.locator('#confirm-yes').click();await page2.waitForFunction(()=>!document.querySelector('#editor').open);s=await page2.evaluate(()=>window.weeklight.get());assert.equal(s.tasks.length,before-1);
 await page2.setViewportSize({width:1050,height:720});await page2.screenshot({path:path.join(output,'weeklight-compact.png'),fullPage:true});
 assert.deepEqual(errors,[]);const result={passed:true,checks:['28 day calendar','form save and weekly repeat across year','sample data','edit','drag reschedule','168 hourly cells','complete task','search','real background scheduler','snooze persistence','close to tray','restart recovery','delete confirmation','1050 px layout','export backup','merge import','invalid import rollback','independent reminder window'],tasksPersisted:s.tasks.length};await fs.writeFile(path.join(output,'desktop-tests.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(app)await app.close();await fs.rm(dataDir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
