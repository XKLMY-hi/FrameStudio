import {_electron as electron} from 'playwright';import path from 'node:path';import fs from 'node:fs/promises';
const root=process.cwd();const appDir='qa/v11-app-1793968821292';
const dirs=(await fs.readdir('qa')).filter(n=>n.startsWith('v11-app-')).sort();const dir=path.join(root,'qa',dirs.at(-1));
const app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[dir],env:{...process.env,STUDIO_TEST_MODE:'1'}});const p=await app.firstWindow();p.on('pageerror',e=>console.log('PAGE_ERROR',e.message));
try{await p.waitForFunction(()=>window.studio?.ready,null,{timeout:60000});console.log('START',await p.evaluate(()=>({p:studio.project.duration,t:studio.time,last:studio.renderer.lastT,tick:studio.renderer.physicsTick})));
await p.evaluate(()=>{const d=structuredClone(studio.project);d.duration=60;d.tracks.forEach(t=>t.clips.forEach(c=>{c.duration=60;c.loop=true;}));studio.change(d);studio.seek(30);});
for(let i=0;i<8;i++){await p.waitForTimeout(500);console.log('WARM',await p.evaluate(()=>({t:studio.time,playing:studio.playing,last:studio.renderer.lastT,tick:studio.renderer.physicsTick,warm:studio.renderer.warming,snap:studio.renderer.snapshots.size})));}
}finally{await app.close();}
