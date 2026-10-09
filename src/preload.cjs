const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('weeklight',{
 get:()=>ipcRenderer.invoke('get'),saveTask:(task,repeat)=>ipcRenderer.invoke('save-task',task,repeat),
 toggleTask:id=>ipcRenderer.invoke('toggle-task',id),deleteTask:id=>ipcRenderer.invoke('delete-task',id),
 moveTask:(id,date,time)=>ipcRenderer.invoke('move-task',id,date,time),
 reminderAction:(id,action)=>ipcRenderer.invoke('reminder-action',id,action),
 settings:s=>ipcRenderer.invoke('settings',s),testReminder:()=>ipcRenderer.invoke('test-reminder'),nextReminderMessage:()=>ipcRenderer.invoke('next-reminder-message'),
 exportData:()=>ipcRenderer.invoke('export'),importData:()=>ipcRenderer.invoke('import'),openData:()=>ipcRenderer.invoke('open-data'),
 openWidget:()=>ipcRenderer.invoke('open-widget'),closeWidget:()=>ipcRenderer.invoke('close-widget'),
 widgetSettings:p=>ipcRenderer.invoke('widget-settings',p),editTask:id=>ipcRenderer.invoke('edit-task',id),
 onEditTask:fn=>{ipcRenderer.on('edit-task',(_,id)=>fn(id));},
 showMain:()=>ipcRenderer.invoke('show-main'),quit:()=>ipcRenderer.invoke('quit'),
 onState:fn=>{ipcRenderer.on('state',(_,s)=>fn(s));},
 onNew:fn=>{ipcRenderer.on('new-task',fn);},
 onError:fn=>{ipcRenderer.on('app-error',(_,message)=>fn(message));}
});
