(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WeeklightWidget=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 function dateKey(d){return[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
 function dateValid(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T12:00:00');return Number.isFinite(d.getTime())&&dateKey(d)===s;}
 function normalizePrefs(input){const p=input&&typeof input==='object'?input:{};let bounds=null;
 if(p.bounds&&['x','y','width','height'].every(k=>Number.isFinite(p.bounds[k]))&&Math.abs(p.bounds.x)<50000&&Math.abs(p.bounds.y)<50000&&p.bounds.width>=340&&p.bounds.width<=680&&p.bounds.height>=380&&p.bounds.height<=1000)bounds=Object.fromEntries(['x','y','width','height'].map(k=>[k,Math.round(p.bounds[k])]));
 return {enabled:p.enabled===true,mode:p.mode==='week'?'week':'day',anchor:dateValid(p.anchor)?p.anchor:null,category:['work','study','life'].includes(p.category)?p.category:'all',onTop:p.onTop===true,theme:['cream','lavender'].includes(p.theme)?p.theme:'sage',showCompleted:p.showCompleted!==false,bounds};}
 function getRange(prefs,now=new Date()){const p=normalizePrefs(prefs),d=new Date((p.anchor||dateKey(now))+'T12:00:00');if(p.mode==='week')d.setDate(d.getDate()-(d.getDay()+6)%7);const end=new Date(d);end.setDate(end.getDate()+(p.mode==='week'?7:1));return {start:dateKey(d),end:dateKey(end)};}
 function selectTasks(tasks,prefs,now=new Date()){const p=normalizePrefs(prefs),range=getRange(p,now);const selected=tasks.filter(t=>t.date>=range.start&&t.date<range.end&&(p.category==='all'||t.category===p.category)).slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)||a.title.localeCompare(b.title));return {...range,tasks:selected,pending:selected.filter(t=>!t.done),done:selected.filter(t=>t.done)};}
 return {dateKey,normalizePrefs,getRange,selectTasks};
});
