import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {_electron as electron} from 'playwright';

const root=process.cwd();
const copy=JSON.parse(await fs.readFile('qa/v21-release-report.json','utf8')).copy;
assert.ok(path.basename(copy).startsWith('FrameStudio-2.1-qa-'));
const data=path.join(copy,'resources/app/data');
const draft=await fs.readFile(path.join(data,'autosave.json'));
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const [name,bytes] of Object.entries(unzipSync(await fs.readFile('release/帧间_2.2_轻量更新补丁.zip')))){
  assert.ok(!name.includes('/data/')&&!name.includes('/tools/'));
  const dest=path.resolve(copy,name);assert.ok(dest.startsWith(copy+path.sep));
  await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,bytes);
}
assert.equal(hash(await fs.readFile(path.join(data,'autosave.json'))),hash(draft));
const out={patchPreservesData:true,copy};
async function checkNative(dir,label){
  const app=await electron.launch({executablePath:path.join(dir,'帧间.exe'),args:[],env:{...process.env,STUDIO_TEST_MODE:''}});
  const p=await app.firstWindow(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  try{
    await p.waitForFunction(()=>window.theater?.ready,null,{timeout:90000});assert.ok((await p.title()).includes('2.2'));
    const file=path.join(root,'qa/场景灯光与模型预处理.livemg');
    const previousModel=await p.evaluate(()=>theater.scene.models[0]?.modelId);
    await p.locator('input[type=file][accept=".livemg,.l2dstudio"]').setInputFiles(file);
    await p.waitForFunction(old=>theater.ready&&theater.scene.models[0]?.modelId!==old&&theater.renderer.loading.size===0&&theater.scene.layers.filter(l=>l.light).length===2&&theater.scene.layers.filter(l=>l.model).every(l=>{const n=theater.renderer.nodes.get(l.id),r=theater.scene.models.find(r=>r.id===l.model.resourceId);return n?.defaults&&n.runtime?.model&&n.source===r.modelId+'/'+r.file}),previousModel,{timeout:90000});
    await p.evaluate(()=>{theater.seek(.75);theater.renderer.invalidate()});await p.waitForTimeout(200);
    const actors=await p.evaluate(()=>theater.scene.layers.filter(l=>l.model).map(l=>l.id));
    const lights=await p.evaluate(()=>theater.scene.layers.filter(l=>l.light).map(l=>l.id));
    const shading=await p.evaluate(ids=>{theater.renderer.renderAt(theater.scene,.75,false);return ids.map(id=>{const u=theater.renderer.nodes.get(id).mesh.shader.uniforms;return {enabled:u.uLighting,lights:u.uLightCount}})},actors);
    assert.deepEqual(shading,[{enabled:1,lights:2},{enabled:1,lights:2}]);
    const before=await p.evaluate(id=>theater.scene.layers.find(l=>l.id===id).transform.x,lights[1]);
    const point=await p.evaluate(id=>{const r=theater.renderer,h=r.hits.find(h=>h.id===id),rect=r.host.getBoundingClientRect(),res=r.app.screen.width/rect.width;return {x:rect.left+h.points.reduce((s,p)=>s+p.x,0)/4/res,y:rect.top+h.points.reduce((s,p)=>s+p.y,0)/4/res}},lights[1]);
    await p.mouse.move(point.x,point.y);await p.mouse.down();await p.mouse.move(point.x+24,point.y+16,{steps:5});await p.mouse.up();
    const after=await p.evaluate(id=>theater.scene.layers.find(l=>l.id===id).transform.x,lights[1]);assert.ok(Math.abs(after-before)>1);
    await p.evaluate(id=>theater.selectLayer(id),actors[0]);const instancePost=await p.evaluate(id=>theater.scene.layers.find(l=>l.id===id).effects.brightness,actors[0]);
    await p.locator('.scene-view-toolbar').getByRole('button',{name:'模型预处理',exact:true}).click();
    await p.waitForFunction(()=>theater.displayScene.id==='@preprocessing'&&theater.renderer.nodes.get(theater.displayScene.layers.at(-1).id)?.mesh,null,{timeout:60000});
    await p.getByLabel('预处理 亮度 数值',{exact:true}).fill('.9');await p.waitForTimeout(150);
    assert.equal(await p.evaluate(()=>theater.renderer.nodes.get(theater.displayScene.layers.at(-1).id).mesh.shader.uniforms.uLighting),0);
    assert.equal(await p.evaluate(id=>theater.scene.layers.find(l=>l.id===id).effects.brightness,actors[0]),instancePost);
    await p.getByLabel('预处理 亮度 数值',{exact:true}).blur();await p.keyboard.press('Escape');
    await p.waitForFunction(()=>theater.displayScene.id!=='@preprocessing');
    await p.locator('.layer-title summary').click();await p.getByRole('button',{name:'日光 / 平行光',exact:true}).click();
    assert.equal(await p.evaluate(()=>theater.scene.layers.filter(l=>l.light).length),3);
    await p.screenshot({path:'qa/v22-native-'+label+'.png'});
    assert.deepEqual(errors,[]);
    const result={title:await p.title(),sharedSceneLighting:shading,gizmoDrag:Math.abs(after-before),neutralPreprocessing:true,instancePostPreserved:true,addThirdLight:true,errors};console.log('NATIVE_'+label.toUpperCase()+'_PASS',JSON.stringify(result));return result;
  }finally{await app.close()}
}
out.patch=await checkNative(copy,'patch');
const fullCopy=path.join(os.tmpdir(),'FrameStudio-2.2-full-qa-'+Date.now());
await fs.cp(path.join(root,'release/FrameStudio-2.2.0-portable'),fullCopy,{recursive:true});
out.fullCopy=fullCopy;out.full=await checkNative(fullCopy,'full');
await fs.writeFile('qa/release-v22-report.json',JSON.stringify(out,null,2));console.log('NATIVE_RELEASE_V22_PASS',JSON.stringify(out));
