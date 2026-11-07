import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {unzipSync} from 'fflate';import {_electron as electron} from 'playwright';
import {emptyScene,layer,addVisual,sceneClip,track} from '../src/theater/schema.ts';import {parseAsset} from '../src/engine.ts';
const root=process.cwd(),dir=JSON.parse(await fs.readFile('qa/theater-smoke-report.json','utf8')).appRoot,blackZip=path.resolve(root,'../008_casual_spring_01.zip');
for(const d of ['dist','backend','electron'])await fs.cp(path.join(root,d),path.join(dir,d),{recursive:true});
for(const [name,bytes] of Object.entries(unzipSync(await fs.readFile(blackZip)))){if(name.endsWith('/'))continue;const target=path.resolve(dir,'data/models/regression-008',name);assert.ok(target.startsWith(path.join(dir,'data/models/regression-008')+path.sep));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);}
const report={};
for(const reverse of [false,true]){
 await fs.writeFile(path.join(dir,'data/autosave-scene.json'),JSON.stringify(emptyScene()));
 const app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[dir],env:{...process.env,STUDIO_TEST_MODE:''}}),p=await app.firstWindow(),errors=[],out={};
 p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('CONSOLE',m.text().slice(0,200))}});
 const catalog=async(id,file)=>{const raw=await p.evaluate(async({id,file})=>{const token=new URL(location.href).searchParams.get('token'),res=await fetch('/api/model-catalog?id='+encodeURIComponent(id)+'&file='+encodeURIComponent(file),{headers:{Authorization:'Bearer '+token}});if(!res.ok)throw Error(await res.text());return res.json()},{id,file});return {id:crypto.randomUUID(),name:id,modelId:id,file,assets:raw.assets.map(a=>parseAsset(a.json,a.name))}};
 const snap=async(id,time,exact=false)=>p.evaluate(({id,time,exact})=>{const r=theater.renderer;r.renderAt(theater.scene,time,exact);const n=r.nodes.get(id),raw=n.runtime.model.internalModel.coreModel._model;return {pixels:Array.from(r.app.renderer.extract.pixels(n.rt)),vertices:raw.drawables.vertexPositions.flatMap(v=>Array.from(v)),param:raw.parameters.values[raw.parameters.ids.indexOf('ParamAngleX')]};},{id,time,exact});
 const delta=(a,b)=>{let pixels=0,geometry=0;assert.equal(a.pixels.length,b.pixels.length);for(let i=0;i<a.pixels.length;i++)pixels+=Math.abs(a.pixels[i]-b.pixels[i]);for(let i=0;i<a.vertices.length;i++)geometry=Math.max(geometry,Math.abs(a.vertices[i]-b.vertices[i]));assert.ok(pixels>100,'Actual model texture must move');assert.ok(geometry>1e-5,'Native drawable vertices must move');return {pixels,geometry};};
 try{
  await p.waitForFunction(()=>window.theater?.ready,null,{timeout:90000});
  const firstRes=reverse?await catalog('regression-008','008_casual_spring_01.model3.json'):await catalog('demo','coat/coat.model3.json');
  const s=emptyScene(),first=layer('model',reverse?'黑发少女':'粉发少女');s.models=[firstRes];first.width=486;first.height=648;first.transform.x=-240;first.transform.scaleX=first.transform.scaleY=.9;first.model={resourceId:firstRes.id,physics:false,parameterMap:{},groupOverrides:{},baseValues:{},keys:[{id:'ParamAngleX',target:'Parameter',keys:[{t:0,v:-25,mode:'linear'},{t:1,v:25,mode:'linear'}]}],lipOpen:'ParamMouthOpenY',lipForm:'ParamMouthForm'};addVisual(s,first,0,12);
  await p.evaluate(async s=>{await theater.loadScene(s);theater.seek(0)},s);out.single=delta(await snap(first.id,0),await snap(first.id,1));
  if(!reverse){await p.locator('input[type=file][accept=".zip"]').setInputFiles(blackZip);await p.waitForFunction(()=>theater.scene.layers.filter(l=>l.model).length===2&&[...theater.renderer.nodes.values()].filter(n=>n.runtime?.model&&n.defaults).length===2,null,{timeout:90000});await p.waitForTimeout(200);}
  else {const secondRes=await catalog('demo','coat/coat.model3.json'),scene=await p.evaluate(()=>structuredClone(theater.scene)),second=structuredClone(first);second.id=crypto.randomUUID();second.name='粉发少女';second.model.resourceId=secondRes.id;scene.models.push(secondRes);addVisual(scene,second,0,12);await p.evaluate(async s=>await theater.loadScene(s),scene);}
  const secondId=await p.evaluate(id=>theater.scene.layers.find(l=>l.model&&l.id!==id).id,first.id);
  await p.evaluate(({first,second})=>{theater.change(s=>{s.tracks=s.tracks.filter(t=>!t.clips.some(c=>c.kind==='motion'));for(const l of s.layers.filter(l=>l.model)){l.model.physics=false;l.model.keys=[{id:'ParamAngleX',target:'Parameter',keys:[{t:0,v:-25,mode:'linear'},{t:1,v:25,mode:'linear'}]}];l.transform.x=l.id===first?-240:240;l.transform.y=0;l.transform.scaleX=l.transform.scaleY=.9;l.is3D=false;}});},{first:first.id,second:secondId});
  out.first=delta(await snap(first.id,0),await snap(first.id,1));out.second=delta(await snap(secondId,0),await snap(secondId,1));out.exportFirst=delta(await snap(first.id,0,true),await snap(first.id,1,true));
  out.memory=await p.evaluate(()=>{const ns=[...theater.renderer.nodes.values()].filter(n=>n.runtime),raws=ns.map(n=>n.runtime.model.internalModel.coreModel._model),buffer=new Live2DCubismCore.Parameters(raws[0]._ptr).values.buffer;return {bytes:buffer.byteLength,allCurrent:raws.every(r=>r.parameters.values.buffer===buffer&&r.drawables.vertexPositions[0].buffer===buffer),growths:ns[0].runtime.memoryGuard.growths,repairs:ns[0].runtime.memoryGuard.repairs}});assert.ok(out.memory.allCurrent);if(!reverse)assert.ok(out.memory.growths>0);console.log('MIXED_MOVEMENT',reverse?'black-first':'pink-first',out.memory,out.first);
  // A real preset on each model, with physics enabled, must deform its own texture.
  out.timeline=[];
  for(const id of [first.id,secondId]){
   await p.evaluate(id=>theater.change(s=>{const l=s.layers.find(l=>l.id===id),asset=s.models.find(r=>r.id===l.model.resourceId).assets.find(a=>a.name==='mtn_angry01_C');l.model.keys=[];l.model.physics=true;const base=s.tracks.flatMap(t=>t.clips).find(c=>c.layerId===id&&c.kind==='visual');s.tracks=s.tracks.map(t=>({...t,clips:t.clips.filter(c=>c.layerId!==id||c.kind!=='motion')}));s.tracks.push({id:crypto.randomUUID(),name:'动作 '+l.name,muted:false,solo:false,locked:false,clips:[{...JSON.parse(JSON.stringify(base)),id:crypto.randomUUID(),kind:'motion',assetId:asset.id,name:asset.name,start:0,duration:asset.duration,trimIn:0,loop:false,fadeIn:0,fadeOut:0}]});}),id);
   out.timeline.push(delta(await snap(id,.25,true),await snap(id,1.2,true)));
  }
  // Single-click the actual motion-library card for each model; compare GPU output.
  out.auditions=[];
  for(const id of [first.id,secondId]){
   await p.evaluate(id=>{theater.selectLayer(id);theater.seek(.2)},id);await p.locator('.theater-library nav').getByRole('button',{name:'动作',exact:true}).click();await p.getByLabel('动作目标对象').selectOption(id);
   const before=await p.evaluate(()=>JSON.stringify(theater.scene));await p.locator('.motion-card').filter({hasText:'mtn_angry01_C'}).first().click();await p.waitForTimeout(220);const a=await snap(id,.2);await p.waitForTimeout(480);const b=await snap(id,.2);out.auditions.push(delta(a,b));await p.waitForFunction(()=>!theater.renderer.motionPreview,null,{timeout:10000});assert.equal(await p.evaluate(()=>JSON.stringify(theater.scene)),before);
  }
  // Recreate the reported mixed 2D/3D, enlarged and depth-offset arrangement.
  await p.evaluate(id=>theater.change(s=>{const l=s.layers.find(l=>l.id===id);l.is3D=true;l.transform.x=359;l.transform.y=1222;l.transform.scaleX=l.transform.scaleY=5;l.transform.z=1000;s.camera.dof=true;s.camera.aperture=.3;}),secondId);
  out.depthFirst=delta(await snap(first.id,.25,true),await snap(first.id,1.2,true));
  await p.evaluate(()=>{theater.change(s=>{s.duration=1.5;s.fps=8;s.workArea={start:0,end:1.5,loop:false};for(const t of s.tracks)for(const c of t.clips)if(c.kind==='visual')c.duration=1.5;});theater.seek(.6);});await p.waitForTimeout(200);await p.screenshot({path:'qa/mixed-fixed-'+(reverse?'black-first':'pink-first')+'.png'});
  if(!reverse){await p.getByRole('button',{name:'导出',exact:true}).click();await p.getByRole('button',{name:'WebM VP9',exact:false}).click();const response=p.waitForResponse(r=>r.url().includes('/api/export-finish'),{timeout:120000});await p.getByRole('button',{name:'开始导出',exact:true}).click();const encoded=await(await response).json();assert.ok(encoded.path,JSON.stringify(encoded));await fs.copyFile(encoded.path,'qa/mixed-model-fixed.webm');out.encodedFrames=encoded.frames;}
  assert.deepEqual(errors,[]);out.errors=errors;report[reverse?'blackFirst':'pinkFirst']=out;console.log('MIXED_CASE_PASS',reverse?'black-first':'pink-first');
 }finally{await app.close()}
}
await fs.writeFile('qa/mixed-model-regression-report.json',JSON.stringify(report,null,2));console.log('MIXED_REGRESSION_PASS');
