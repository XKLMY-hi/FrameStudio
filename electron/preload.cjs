const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('studioAgent',{
 settings:()=>ipcRenderer.invoke('studio-agent:settings'),
 configure:settings=>ipcRenderer.invoke('studio-agent:configure',settings),
 complete:(messages,requestId)=>ipcRenderer.invoke('studio-agent:complete',messages,requestId),
 onProgress:listener=>{
  const handler=(_event,update)=>listener(update);
  ipcRenderer.on('studio-agent:progress',handler);
  return ()=>ipcRenderer.removeListener('studio-agent:progress',handler);
 },
 abort:()=>ipcRenderer.invoke('studio-agent:abort'),
});
contextBridge.exposeInMainWorld('studioDesktop',{
 onSaveBeforeClose:callback=>{
  const handler=async(_event,id)=>{
   try{await callback();ipcRenderer.send('studio:flush-result',id);}
   catch(error){ipcRenderer.send('studio:flush-result',id,String(error?.message||error));}
  };
  ipcRenderer.on('studio:flush-project',handler);
  return ()=>ipcRenderer.removeListener('studio:flush-project',handler);
 },
setAppearance:value=>ipcRenderer.send('studio:appearance',value),reveal:p=>ipcRenderer.invoke('studio:reveal',p),saveFile:(name,bytes)=>ipcRenderer.invoke('studio:save-file',name,bytes),saveExport:(p,name)=>ipcRenderer.invoke('studio:save-export',p,name)});
