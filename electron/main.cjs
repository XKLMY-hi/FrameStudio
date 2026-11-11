const {app,BrowserWindow,shell,ipcMain,dialog,nativeTheme}=require('electron');
const path=require('node:path');const {pathToFileURL}=require('node:url');
const fs=require('node:fs');
const profile=path.join(app.getAppPath(),'data','browser-profile');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);app.setName('FrameStudio');
if(process.platform==='win32')app.setAppUserModelId('FrameStudio');
let service;
app.whenReady().then(async()=>{
 const root=app.getAppPath();service=await (await import(pathToFileURL(path.join(root,'backend/server.mjs')).href)).createStudioServer({root});
 const win=new BrowserWindow({icon:path.join(root,'dist','framestudio.ico'),width:1580,height:1000,minWidth:1150,minHeight:760,show:!process.env.STUDIO_TEST_MODE,backgroundColor:nativeTheme.shouldUseDarkColors?'#121217':'#eae9ed',title:'FrameStudio '+app.getVersion(),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,spellcheck:false}});
 win.on('page-title-updated',event=>event.preventDefault());
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(`http://127.0.0.1:${service.port}/`))event.preventDefault();});
 ipcMain.handle('studio:reveal',async(event,p)=>{if(event.sender!==win.webContents)return;if(typeof p!=='string'||!path.resolve(p).startsWith(path.join(root,'data')+path.sep))return;shell.showItemInFolder(p);});
 ipcMain.handle('studio:save-file',async(event,name,bytes)=>{if(event.sender!==win.webContents)throw Error('Unknown window');if(!bytes||bytes.byteLength>1024*1024*1024)throw Error('File too large');const filename=path.basename(String(name)).replace(/[<>:"/\\|?*]/g,'_');const picked=await dialog.showSaveDialog(win,{title:'保存文件',defaultPath:path.join(app.getPath('documents'),filename),properties:['showOverwriteConfirmation','createDirectory']});if(picked.canceled||!picked.filePath)return {canceled:true};await fs.promises.writeFile(picked.filePath,Buffer.from(bytes));return {canceled:false,path:picked.filePath};});
 ipcMain.handle('studio:save-export',async(event,p,name)=>{if(event.sender!==win.webContents||typeof p!=='string'||!path.resolve(p).startsWith(path.join(root,'data','exports')+path.sep))throw Error('Invalid export path');const filename=path.basename(String(name)).replace(/[<>:"/\\|?*]/g,'_');const picked=await dialog.showSaveDialog(win,{title:'保存导出文件',defaultPath:path.join(app.getPath('documents'),filename),properties:['showOverwriteConfirmation','createDirectory']});if(picked.canceled||!picked.filePath)return {canceled:true};if(path.resolve(p)!==path.resolve(picked.filePath))await fs.promises.copyFile(p,picked.filePath);return {canceled:false,path:picked.filePath};});
 ipcMain.on('studio:appearance',(event,value)=>{if(event.sender===win.webContents&&['system','light','dark'].includes(value))nativeTheme.themeSource=value;});
 const {installStudioAgent}=await import(pathToFileURL(path.join(root,'electron/studio-agent.mjs')).href);
 const agentProfile=process.env.STUDIO_TEST_MODE?profile:path.join(app.getPath('appData'),'FrameStudio');
 installStudioAgent(win,new URL(service.url).origin,agentProfile);
 let allowClose=false,asking=false,flushResult;
 ipcMain.on('studio:flush-result',(event,id,error)=>{
   if(event.sender===win.webContents && flushResult?.id===id) flushResult.done(error);
 });
 function flushProject(){
   return new Promise((resolve,reject)=>{
     const id=require('node:crypto').randomUUID();
     const timer=setTimeout(()=>done('保存工程超时'),15000);
     function done(error){clearTimeout(timer);flushResult=undefined;error?reject(Error(error)):resolve();}
     flushResult={id,done};
     win.webContents.send('studio:flush-project',id);
   });
 }
 win.on('close',event=>{
   if(allowClose || process.env.STUDIO_TEST_MODE)return;
   event.preventDefault();
   if(asking)return;
   asking=true;
   void (async()=>{
     try{
       let behavior='ask';
       try{behavior=JSON.parse(await fs.promises.readFile(path.join(root,'data','preferences.json'),'utf8')).closeBehavior||'ask';}catch{}
       if(behavior==='ask'){
         const {response}=await dialog.showMessageBox(win,{type:'question',title:'退出 FrameStudio',message:'关闭 FrameStudio？',
           detail:'保存草稿会写入当前已应用的工程状态。',buttons:['保存草稿并退出','直接退出','取消'],defaultId:0,cancelId:2});
         if(response===2)return;
         behavior=response===0?'save':'discard';
       }
       if(behavior==='save')await flushProject();
       allowClose=true;win.close();
     }catch(error){dialog.showErrorBox('无法保存草稿',error.message);}
     finally{asking=false;}
   })();
 });
 win.loadURL(service.url);
});
app.on('window-all-closed',()=>{service?.server.close();app.quit();});
