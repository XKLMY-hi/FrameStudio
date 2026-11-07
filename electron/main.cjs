const {app,BrowserWindow,shell,ipcMain,dialog,nativeTheme}=require('electron');
const path=require('node:path');const {pathToFileURL}=require('node:url');
const fs=require('node:fs');
const profile=path.join(app.getAppPath(),'data','browser-profile');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);app.setName('FrameStudio');
let service;
app.whenReady().then(async()=>{
 const root=app.getAppPath();service=await (await import(pathToFileURL(path.join(root,'backend/server.mjs')).href)).createStudioServer({root});
 const win=new BrowserWindow({width:1580,height:1000,minWidth:1150,minHeight:760,show:!process.env.STUDIO_TEST_MODE,backgroundColor:nativeTheme.shouldUseDarkColors?'#101010':'#f0f0f0',title:'FrameStudio 2.7.0',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,spellcheck:false}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(`http://127.0.0.1:${service.port}/`))event.preventDefault();});
 ipcMain.handle('studio:reveal',async(event,p)=>{if(event.sender!==win.webContents)return;if(typeof p!=='string'||!path.resolve(p).startsWith(path.join(root,'data')+path.sep))return;shell.showItemInFolder(p);});
 ipcMain.handle('studio:save-file',async(event,name,bytes)=>{if(event.sender!==win.webContents)throw Error('Unknown window');if(!bytes||bytes.byteLength>1024*1024*1024)throw Error('File too large');const filename=path.basename(String(name)).replace(/[<>:"/\\|?*]/g,'_');const picked=await dialog.showSaveDialog(win,{title:'保存文件',defaultPath:path.join(app.getPath('documents'),filename),properties:['showOverwriteConfirmation','createDirectory']});if(picked.canceled||!picked.filePath)return {canceled:true};await fs.promises.writeFile(picked.filePath,Buffer.from(bytes));return {canceled:false,path:picked.filePath};});
 ipcMain.handle('studio:save-export',async(event,p,name)=>{if(event.sender!==win.webContents||typeof p!=='string'||!path.resolve(p).startsWith(path.join(root,'data','exports')+path.sep))throw Error('Invalid export path');const filename=path.basename(String(name)).replace(/[<>:"/\\|?*]/g,'_');const picked=await dialog.showSaveDialog(win,{title:'保存导出文件',defaultPath:path.join(app.getPath('documents'),filename),properties:['showOverwriteConfirmation','createDirectory']});if(picked.canceled||!picked.filePath)return {canceled:true};if(path.resolve(p)!==path.resolve(picked.filePath))await fs.promises.copyFile(p,picked.filePath);return {canceled:false,path:picked.filePath};});
 ipcMain.on('studio:appearance',(event,value)=>{if(event.sender===win.webContents&&['system','light','dark'].includes(value))nativeTheme.themeSource=value;});
 win.loadURL(service.url);
});
app.on('window-all-closed',()=>{service?.server.close();app.quit();});
