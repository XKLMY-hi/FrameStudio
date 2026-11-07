const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('studioDesktop',{setAppearance:value=>ipcRenderer.send('studio:appearance',value),reveal:p=>ipcRenderer.invoke('studio:reveal',p),saveFile:(name,bytes)=>ipcRenderer.invoke('studio:save-file',name,bytes),saveExport:(p,name)=>ipcRenderer.invoke('studio:save-export',p,name)});
