const {_electron:electron}=require('playwright');const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');const data=path.join(root,'_work','package-test-'+Date.now());const exe=path.join(root,require('../package.json').build.directories.output,'win-unpacked','周光.exe');
const env={...process.env,WEEKLIGHT_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
(async()=>{let app;try{await fs.mkdir(path.join(root,'outputs','verification'),{recursive:true});app=await electron.launch({executablePath:exe,args:[],env});let p=await app.firstWindow();await p.waitForSelector('.month-grid');assert((await p.evaluate(()=>window.weeklight.get())).packaged);
await p.locator('#settings-button').click();await p.locator('#load-samples').click();await p.waitForFunction(()=>!document.querySelector('#settings-dialog').open);await p.waitForTimeout(3800);
await p.screenshot({path:path.join(root,'outputs','verification','周光-四周总览.png')});
await p.locator('[data-mode=week]').click();await p.screenshot({path:path.join(root,'outputs','verification','周光-周时间表.png')});
await p.locator('.new-button').click();await p.screenshot({path:path.join(root,'outputs','verification','周光-编辑计划.png')});await p.locator('#editor .close-dialog').first().click();
await app.close();app=null;app=await electron.launch({executablePath:exe,args:[],env});p=await app.firstWindow();await p.waitForSelector('.month-grid');assert.equal((await p.evaluate(()=>window.weeklight.get())).tasks.length,12);
await fs.writeFile(path.join(root,'outputs','verification','package-smoke.json'),JSON.stringify({passed:true,packagedExecutable:exe,checks:['packaged executable launches','isolated data persists through restart','12 sample plans restored','four week, hourly and editor screenshots']},null,2));
console.log('Packaged Windows executable: PASS');
}finally{if(app)await app.close();const resolved=path.resolve(data);if(!resolved.startsWith(path.join(root,'_work')+path.sep))throw new Error('Unsafe cleanup path');await fs.rm(resolved,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});

