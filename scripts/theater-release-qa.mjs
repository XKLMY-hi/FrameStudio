import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {unzipSync} from 'fflate';import {_electron as electron} from 'playwright';
const root=process.cwd(),release=path.join(root,'release/FrameStudio-2.0.0-portable'),copy=path.join(os.tmpdir(),'FrameStudio-2.0-qa-'+Date.now());
await fs.cp(release,copy,{recursive:true});const appRoot=path.join(copy,'resources/app');const out={copy};
let app=await electron.launch({executablePath:path.join(copy,'帧间.exe'),args:[],env:{...process.env,STUDIO_TEST_MODE:''}});
try{
 const p=await app.firstWindow(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await p.waitForFunction(()=>window.theater?.ready,null,{timeout:90000});assert.equal(await p.evaluate(()=>theater.scene.layers.filter(l=>l.model).length),1);
 await p.locator('input[type=file][accept=".livemg,.l2dstudio"]').setInputFiles(path.join(copy,'示例工程_街角对白.livemg'));
 await p.waitForFunction(()=>theater.ready&&theater.scene.layers.filter(l=>l.model).length===2,null,{timeout:60000});
 await p.evaluate(()=>theater.seek(1.8));await p.waitForTimeout(200);const actors=await p.evaluate(()=>theater.scene.layers.filter(l=>l.model).map(l=>l.id));await p.evaluate(id=>theater.selectLayer(id),actors[0]);
 await p.getByRole('button',{name:'动作 / 参数',exact:true}).click();await p.getByRole('button',{name:'打开模型参数曲线'}).click();assert.ok(await p.getByRole('button',{name:'关闭关键帧编辑器'}).isVisible());await p.getByRole('button',{name:'关闭关键帧编辑器'}).click();assert.equal(await p.getByRole('button',{name:'关闭关键帧编辑器'}).count(),0);
 await p.getByRole('button',{name:'动作 / 参数',exact:true}).click();
 await p.locator('.scene-transport .play-round').click();const start=await p.evaluate(()=>({t:performance.now(),n:theater.renderer.frameCount}));await p.waitForTimeout(3000);const end=await p.evaluate(()=>({t:performance.now(),n:theater.renderer.frameCount}));out.twoActorFps=(end.n-start.n)*1000/(end.t-start.t);await p.locator('.scene-transport .play-round').click();await p.waitForTimeout(150);
 const n=await p.evaluate(()=>theater.renderer.frameCount);await p.waitForTimeout(700);out.pausedRenders=(await p.evaluate(()=>theater.renderer.frameCount))-n;assert.equal(out.pausedRenders,0);assert.ok(out.twoActorFps>8);
 await p.evaluate(()=>theater.seek(1.8));await p.waitForTimeout(200);await p.screenshot({path:'qa/theater-release.png'});assert.deepEqual(errors,[]);out.nativePortable=true;out.errors=errors;
}finally{await app.close();}
// Overlay the actual ZIP on old application files and a legacy draft, outside the workspace dependency tree.
for(const d of ['dist','backend','electron'])await fs.cp(path.join(root,'release/FrameStudio-1.1.0-portable/resources/app',d),path.join(appRoot,d),{recursive:true});
const draft=JSON.parse(await fs.readFile(path.join(root,'qa/v11-app-1793969487322/data/autosave.json'),'utf8'));draft.name='旧版草稿 · 升级保留';draft.tracks[0].name='自定义通用轨道';
await fs.writeFile(path.join(appRoot,'data/autosave.json'),JSON.stringify(draft));const sceneFile=path.join(appRoot,'data/autosave-scene.json');try{await fs.rename(sceneFile,sceneFile+'.qa-backup')}catch(e){if(e.code!=='ENOENT')throw e}
await fs.writeFile(path.join(appRoot,'data/keep-me.txt'),'user data must remain');
const digest=async f=>createHash('sha256').update(await fs.readFile(f)).digest('hex'),before=await digest(path.join(appRoot,'data/autosave.json'));
const files=unzipSync(await fs.readFile(path.join(root,'release/帧间_2.0_轻量更新补丁.zip')));
for(const [k,v] of Object.entries(files)){assert.ok(!k.includes('/data/'));const dest=path.resolve(copy,k);assert.ok(dest.startsWith(copy+path.sep));await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,v)}
assert.equal(await digest(path.join(appRoot,'data/autosave.json')),before);assert.equal(await fs.readFile(path.join(appRoot,'data/keep-me.txt'),'utf8'),'user data must remain');
app=await electron.launch({executablePath:path.join(copy,'帧间.exe'),args:[],env:{...process.env,STUDIO_TEST_MODE:''}});
try{const p=await app.firstWindow();await p.waitForFunction(()=>window.theater?.ready,null,{timeout:90000});out.migration=await p.evaluate(()=>({name:theater.scene.name,version:theater.scene.version,tracks:theater.scene.tracks.map(t=>t.name),parameters:[...theater.renderer.nodes.values()].find(n=>n.runtime)?.runtime.params.length}));assert.equal(out.migration.name,draft.name);assert.equal(out.migration.version,2);assert.ok(out.migration.tracks.includes('自定义通用轨道'));assert.equal(out.migration.parameters,184);out.patchPreservesData=true;}finally{await app.close()}
await fs.writeFile('qa/theater-release-report.json',JSON.stringify(out,null,2));console.log('RELEASE_PASS',JSON.stringify(out));
