const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const i18n=require('../src/i18n.js');
const {validateState}=require('../src/core.cjs');
const dictionaries=['core','main','aux'].map(name=>require('../src/locale-'+name+'.js'));
for(const dictionary of dictionaries)i18n.register(dictionary);
const all=Object.assign({},...dictionaries);

test('all translations preserve template fields and have English values',()=>{
 const fields=text=>[...text.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map(match=>match[1]).sort();
 for(const [key,value]of Object.entries(all)){
  assert(value.trim(),key);
  assert(!/[\p{Script=Han}]/u.test(value),key+' contains Chinese in English text');
  assert.deepEqual(fields(value),fields(key),key+' template fields');
  assert.equal(i18n.t(key,{},'en'),value);
  assert.equal(i18n.t(key,{},'zh-CN'),key);
 }
});
test('all static localization attributes have registered translations',()=>{
 for(const file of ['index.html','widget.html','reminder.html']){
  const source=fs.readFileSync(path.join(__dirname,'../src',file),'utf8');
  for(const match of source.matchAll(/data-i18n(?:-placeholder|-title|-aria-label)?="([^"]+)"/g))assert(Object.hasOwn(all,match[1]),file+': '+match[1]);
 }
});
test('interpolation does not reinterpret user text and unknown text remains intact',()=>{
 assert.equal(i18n.t('{count} 项计划等待处理',{count:2},'en'),'2 tasks need your attention');
 assert.equal(i18n.t('导入 {count} 项计划？',{count:'{count}<b>中文</b>'},'en'),'Import {count}<b>中文</b> tasks?');
 assert.equal(i18n.t('My task: 中文',{},'en'),'My task: 中文');
 assert.equal(i18n.t('今天',{},'xx'),'今天');
});
test('legacy and invalid language settings remain Chinese; valid English survives validation',()=>{
 for(const language of [undefined,null,{},false,'en-US','fr'])assert.equal(validateState({version:1,tasks:[],settings:{language}}).settings.language,'zh-CN');
 const raw={version:1,tasks:[],settings:{language:'en'}};
 assert.equal(validateState(raw).settings.language,'en');
 assert.deepEqual(raw,{version:1,tasks:[],settings:{language:'en'}});
});
test('known validation, IPC and HTTP errors are localized without hiding unknown details',()=>{
 assert.equal(i18n.translateError("Error invoking remote method 'save-task': Error: 请选择有效日期",'en'),'Choose a valid date');
 assert.equal(i18n.translateError('更新服务暂时不可用（HTTP 502），请稍后重试，或打开官方下载页手动下载。','en'),'The update service is unavailable (HTTP 502). Try again later or download from the official releases page.');
 assert.equal(i18n.translateError('ENOENT: missing file','en'),'ENOENT: missing file');
 assert.equal(i18n.translateError('请选择有效日期','zh-CN'),'请选择有效日期');
 assert.equal(i18n.translateError('Choose a valid date','zh-CN'),'请选择有效日期');
 assert.equal(i18n.translateError('The update service is unavailable (HTTP 502). Try again later or download from the official releases page.','zh-CN'),'更新服务暂时不可用（HTTP 502），请稍后重试，或打开官方下载页手动下载。');
 assert.equal(i18n.translateError('Unable to open task: Task not found','zh-CN'),'无法打开计划：计划不存在');
});
test('date-only formatting uses the selected local calendar date',()=>{
 assert.equal(i18n.formatDate('2026-10-14',{month:'long',day:'numeric',year:'numeric'},'en'),'October 14, 2026');
 assert.match(i18n.formatDate('2026-10-14',{month:'long',day:'numeric'},'zh-CN'),/10月14日/);
});
test('every classic has a matching English rendering and language changes preserve rotation',()=>{
 const {messages,getCurrentMessage}=require('../src/reminder-copy.cjs');
 const english=require('../src/reminder-classics.en.json');
 assert.deepEqual(english.map(item=>item.id),messages.map(item=>item.id));
 for(const original of messages){
  const rotation={currentId:original.id,seen:[original.id]};
  const translated=getCurrentMessage(rotation,'en');
  assert.equal(translated.id,original.id);
  assert.equal(translated.url,original.url);
  assert(translated.text.trim()&&translated.source.trim());
  assert(!/[\p{Script=Han}]/u.test(translated.text+' '+translated.source));
  assert.equal(getCurrentMessage(rotation,'zh-CN'),original);
  assert.deepEqual(rotation,{currentId:original.id,seen:[original.id]});
 }
});
