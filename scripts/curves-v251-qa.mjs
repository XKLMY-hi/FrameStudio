import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import { _electron as electron } from "playwright";
import { emptyScene,layer,addVisual,sceneClip,track } from "../src/theater/schema.ts";

const root=process.cwd(),baseline=process.argv.includes("--baseline"),patch=process.argv.includes("--patch"),full=process.argv.includes("--full");
const tag=baseline?"baseline-":patch?"patch-":full?"full-":"";
let appRoot,executablePath,args;
if(baseline||patch||full){
  const copy=path.join(os.tmpdir(),"FrameStudio-2.5.1-"+tag+"qa-"+Date.now());
  await fs.cp(path.join(root,"release",full?"FrameStudio-2.5.1-portable":"FrameStudio-2.5.0-portable"),copy,{recursive:true});
  appRoot=path.join(copy,"resources/app");executablePath=path.join(copy,"FrameStudio.exe");args=[];
  if(patch){
    const old=emptyScene();old.name="2.5 草稿保留";addVisual(old,layer("text","原有图层"));
    const f=path.join(appRoot,"data/autosave-scene.json"),raw=JSON.stringify(old);await fs.writeFile(f,raw);
    for(const [name,bytes] of Object.entries(unzipSync(await fs.readFile("release/FrameStudio_2.5.1_轻量更新补丁.zip")))){
      assert.ok(!name.includes("/data/")&&!name.includes("/tools/"));
      const target=path.resolve(copy,name);assert.ok(target.startsWith(copy+path.sep));
      await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);
    }
    assert.equal(await fs.readFile(f,"utf8"),raw);
  }
}else{
  ({appRoot}=JSON.parse(await fs.readFile("qa/theater-smoke-report.json","utf8")));
  assert.ok(appRoot.startsWith(path.join(root,"qa")+path.sep));
  for(const d of ["dist","backend","electron"])await fs.cp(path.join(root,d),path.join(appRoot,d),{recursive:true});
  await fs.writeFile(path.join(appRoot,"data/autosave-scene.json"),JSON.stringify(emptyScene()));
  executablePath=path.join(root,"node_modules/electron/dist/electron.exe");args=[appRoot];
}
await fs.writeFile(path.join(appRoot,"data/preferences.json"),'{"appearance":"dark"}');
const wav=Buffer.alloc(44+32000);wav.write("RIFF");wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);
wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);
wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(32000,40);
await fs.mkdir(path.join(appRoot,"data/assets"),{recursive:true});await fs.writeFile(path.join(appRoot,"data/assets/qa-curve-audio.wav"),wav);
const app=await electron.launch({executablePath,args,env:{...process.env,STUDIO_TEST_MODE:""}});
const p=await app.firstWindow(),errors=[],out={baseline,patch,full};
p.on("pageerror",e=>errors.push(e.message));p.on("console",m=>{if(m.type()==="error")errors.push(m.text())});
const click=(name,scope=p)=>scope.getByRole("button",{name,exact:true}).click();
const curve=p.locator(".curve-workspace"),tree=curve.locator(".curve-channel-scroll");
const channel=(id,key)=>curve.locator('[data-curve-channel="'+id+'//'+key+'"]');
const choose=async(id,key,add=false)=>{
  const row=channel(id,key);
  await (baseline?row:row.locator(".curve-tree-name")).click({modifiers:add?["Control"]:[]});
};
const drag=async(x,y,dx,dy)=>{await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x+dx,y+dy,{steps:9});await p.mouse.up()};
const open=()=>click(baseline?"关键帧":"曲线",p.locator(".scene-transport"));
const close=()=>p.getByTitle("关闭关键帧编辑器",{exact:true}).click();
async function pickPoint(id){
  return p.evaluate(id=>{
    const r=theater.renderer,v=r.snapshot,h=v.hits.find(h=>h.id===id),rect=v.host.getBoundingClientRect();
    const x=rect.left+h.points.reduce((s,p)=>s+p.x,0)/h.points.length*rect.width/v.width,
      y=rect.top+h.points.reduce((s,p)=>s+p.y,0)/h.points.length*rect.height/v.height;
    for(const dy of [0,-12,12,-25,25,-44,44])for(const dx of [0,-8,8,-16,16])if(r.pick(x+dx,y+dy,theater.scene,v,true)===id)return {x:x+dx,y:y+dy};
    throw Error("pick point not found");
  },id);
}
async function menuBounds(){
  const menu=p.getByRole("menu");
  await menu.waitFor({state:"visible"});
  const bounds=await menu.evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,vw:innerWidth,vh:innerHeight,position:getComputedStyle(e).position}});
  assert.equal(bounds.position,"fixed");assert.ok(bounds.w>=170&&bounds.w<=200,JSON.stringify(bounds));
  assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.w<=bounds.vw&&bounds.y+bounds.h<=bounds.vh,JSON.stringify(bounds));
  return bounds;
}
try{
  await p.waitForFunction(()=>window.theater?.ready,null,{timeout:90000});
  const {version}=JSON.parse(await fs.readFile(path.join(root,"package.json"),"utf8"));
  assert.equal(await p.title(),baseline?"FrameStudio 2.5":patch||full?"FrameStudio 2.5.1":"FrameStudio "+version);
  if(patch){assert.equal(await p.evaluate(()=>theater.scene.name),"2.5 草稿保留");out.draftPreserved=true}
  const old=await p.evaluate(()=>theater.scene.models[0]?.modelId);
  await p.locator('input[accept=".livemgs,.livemg,.l2dstudio"]').setInputFiles(path.join(root,"qa/场景灯光与模型预处理.livemg"));
  await p.waitForFunction(old=>theater.ready&&theater.scene.models[0]?.modelId!==old&&theater.scene.layers.filter(l=>l.model).length===2&&theater.renderer.loading.size===0&&theater.scene.layers.filter(l=>l.model).every(l=>theater.renderer.nodes.get(l.id)?.runtime?.model),old,{timeout:90000});
  const ids=await p.evaluate(()=>theater.scene.layers.filter(l=>l.model).map(l=>l.id)),actor=ids[0];
  await p.evaluate(id=>{theater.seek(.75);theater.selectLayer(id)},actor);
  if(!baseline){
    await p.waitForFunction(id=>theater.renderer.snapshot?.hits.some(h=>h.id===id),actor);
    const at=await pickPoint(actor);await p.mouse.click(at.x,at.y,{button:"right"});
    out.menu=await menuBounds();
    await p.screenshot({path:"qa/v251-"+tag+"menu.png"});
    await p.getByRole("menuitem",{name:"锁定",exact:true}).click();
    assert.equal(await p.evaluate(id=>theater.scene.layers.find(l=>l.id===id).locked,actor),true);
    await p.mouse.click(at.x,at.y,{button:"right"});await p.getByRole("menuitem",{name:"解锁",exact:true}).click();
    await click("三维预览",p.locator(".scene-view-toolbar"));
    await p.getByTitle("放大预览",{exact:true}).click();
    const canvas=await p.locator(".scene-canvas").first().boundingBox();
    await p.mouse.click(canvas.x+canvas.width-10,canvas.y+canvas.height-10,{button:"right"});
    out.edgeMenu=await menuBounds();
    await p.keyboard.press("Escape");await p.keyboard.press("Escape");
    await click("成片",p.locator(".scene-view-toolbar"));
    const folder=layer("group","演员组");
    await p.evaluate(({folder,actor})=>theater.change(s=>{
      s.layers.push(folder);const l=s.layers.find(l=>l.id===actor);l.parentId=folder.id;
      l.animation.x=[{t:0,v:-220,mode:"linear"},{t:1,v:-130,mode:"linear"},{t:2,v:-210,mode:"linear"}];
      l.animation.y=[{t:0,v:0,mode:"linear"},{t:2,v:30,mode:"linear"}];
    }),{folder,actor});
    await open();assert.equal(await curve.locator("[data-plot-channel]").count(),0);
    assert.ok(await tree.getByRole("button",{name:/演员组/}).isVisible());
    assert.ok(await tree.getByRole("button",{name:/相机/}).isVisible());
    assert.ok(await channel(actor,"scaleX").locator("input").isVisible());
    await click("模型参数",tree);assert.ok((await tree.locator('[data-curve-channel*="/param:"]').count())>100);
    assert.equal(await curve.locator("[data-plot-channel]").count(),0);
    await click("模型参数",tree);
    await choose(actor,"x");assert.equal(await curve.locator("[data-plot-channel]").count(),1);
    await choose(actor,"y",true);assert.equal(await curve.locator("[data-plot-channel]").count(),2);
    const rows=await curve.locator('[data-curve-channel="'+actor+'//x"],[data-curve-channel="'+actor+'//y"]').evaluateAll(els=>els.map(el=>{
      const r=el.querySelector(".curve-tree-name").getBoundingClientRect();return {x:r.left+12,y:r.top+r.height/2};
    }));
    await choose(actor,"x");
    await drag(rows[0].x,rows[0].y,18,rows[1].y-rows[0].y);
    assert.equal(await curve.locator("[data-plot-channel]").count(),2);
    await choose(actor,"x");await p.getByLabel("选择曲线段",{exact:true}).selectOption("1");
    await p.getByLabel("曲线预设",{exact:true}).selectOption("overshoot");
    assert.equal(await p.evaluate(id=>theater.scene.layers.find(l=>l.id===id).animation.x[1].mode,actor),"bezier");
    const keyPoint=await curve.locator("[data-key-targets]").evaluate(el=>{
      const m=[...el.getAttribute("d").matchAll(/M([0-9.e-]+) ([0-9.e-]+)/g)][1];
      const pos=new DOMPoint(+m[1],+m[2]+8).matrixTransform(el.getScreenCTM());return {x:pos.x,y:pos.y};
    });
    await drag(keyPoint.x,keyPoint.y,40,-5);
    assert.ok(await p.evaluate(id=>theater.scene.layers.find(l=>l.id===id).animation.x[1].t>1,actor));
    out.groupedAndEditable=true;
    await tree.evaluate(el=>el.scrollTop=0);
    await p.screenshot({path:"qa/v251-"+tag+"curves.png"});
    await close();
    const audio=layer("audio","音频验证"),c=sceneClip("audio",audio.id,"qa-tone","配音片段",0,1),t=track("音频");t.clips.push(c);
    await p.evaluate(({audio,c,t})=>{
      theater.change(s=>{s.layers.push(audio);s.tracks.push(t);s.assets.push({id:"qa-tone",name:"配音",kind:"audio",path:"assets/qa-curve-audio.wav",duration:1,waveform:[.2,.3,.5,.2]})});
      theater.selectClips([c.id]);
    },{audio,c,t});
    await click("编辑音量关键帧");
    await curve.locator(".graph-wave").waitFor();
    await p.getByLabel("曲线 淡入秒数",{exact:true}).fill(".23");
    assert.equal(await p.evaluate(id=>theater.scene.tracks.flatMap(t=>t.clips).find(c=>c.id===id).fadeIn,c.id),.23);
    await close();out.audioCurve=true;
  }
  // Same two models and 1,440 selected keys for both releases.
  const axes=["x","y","z","rotation","scaleX","scaleY"];
  await p.evaluate(({actor,axes})=>{
    theater.change(s=>{
      s.duration=12;s.workArea={start:0,end:12,loop:true};
      s.layers=s.layers.filter(l=>l.kind!=="audio"&&l.kind!=="group");
      const owners=new Set(s.layers.map(l=>l.id));
      s.tracks=s.tracks.filter(t=>t.clips.every(c=>owners.has(c.layerId)));
      const l=s.layers.find(l=>l.id===actor);l.parentId=null;
      for(const c of s.tracks.flatMap(t=>t.clips))if(c.kind==="visual"){c.start=0;c.duration=12}
      for(const key of axes)l.animation[key]=Array.from({length:240},(_,i)=>({
        t:i/20,v:l.transform[key]+Math.sin(i*.065)*(key.startsWith("scale")?.08:10),mode:"linear"}));
    });theater.seek(.4);theater.selectProperty({layerId:actor,channel:"x"});
  },{actor,axes});
  await open();
  for(let i=0;i<axes.length;i++)await choose(actor,axes[i],i>0);
  const elements=await curve.locator(".curve-plot *").count();
  if(!baseline){assert.equal(await curve.locator("[data-plot-channel]").count(),6);assert.ok(elements<120,elements)}
  const devtools=await p.context().newCDPSession(p);await devtools.send("Performance.enable");
  const metrics=async()=>Object.fromEntries((await devtools.send("Performance.getMetrics")).metrics.map(m=>[m.name,m.value]));
  await p.keyboard.press("Space");await p.waitForTimeout(300);
  const start=await metrics(),clock=await p.evaluate(()=>({t:performance.now(),frames:theater.renderer.frameCount}));
  await p.waitForTimeout(1800);
  const end=await metrics(),stop=await p.evaluate(()=>({t:performance.now(),frames:theater.renderer.frameCount}));
  await p.keyboard.press("Space");
  out.stress={keys:1440,plotElements:elements,fps:(stop.frames-clock.frames)*1000/(stop.t-clock.t),
    scriptMs:(end.ScriptDuration-start.ScriptDuration)*1000,taskMs:(end.TaskDuration-start.TaskDuration)*1000};
  await devtools.detach();
  assert.deepEqual(errors,[]);
  await fs.writeFile("qa/v251-"+tag+"report.json",JSON.stringify(out,null,2));
  console.log("CURVES_V251_PASS",JSON.stringify(out));
}catch(e){await p.screenshot({path:"qa/v251-"+tag+"failure.png"}).catch(()=>{});console.log("ERRORS",errors);throw e}
finally{await app.close()}
