import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { addVisual, emptyScene, layer, sceneClip, track } from "../src/theater/schema";
import { editMontage, emptyMontage, loadMontage, montageAudio, montageEnd, montageSamples, montageVisuals, snapMontageStart, transitionAmount, withMontageCanvas } from "../src/theater/montage";
import { previewFrameTime } from "../src/theater/scene-engine";
import { openLivemg, saveLivemg } from "../backend/livemg.mjs";

test("master timing keeps independent source time and sorts overlapping clips by lane",()=>{
  const scene=emptyScene();
  scene.duration=2;scene.workArea.end=2;
  const base=emptyMontage(scene);
  const {montage:p,created}=editMontage(base,[
    {op:"add_canvas",name:"B",duration:2,as:"b"},
    {op:"add_clip",canvasId:"$b",as:"second",values:{start:1,trimIn:.25,duration:1,lane:2,enter:{kind:"fade",duration:.5}}},
    {op:"add_clip",canvasId:base.activeCanvasId,values:{start:3,duration:1}},
  ]);
  const shots=montageSamples(p,1.25);
  assert.equal(shots[0].scene,scene);
  assert.equal(shots[1].clip.id,created.second);
  assert.equal(shots[1].time,.5);
  assert.deepEqual(transitionAmount(shots[1].clip,shots[1].elapsed,"fade"),[.5,1]);
  assert.equal(montageSamples(p,2).length,0);
  assert.equal(montageEnd(p),4);
  assert.throws(()=>editMontage(p,[{op:"clip",id:created.second,values:{duration:3}}]),/时长/);
  const shortened={...p.canvases[1].scene,duration:.5};
  const next=withMontageCanvas(p,created.b,shortened);
  assert.equal(next.clips[1].duration,.25);
  assert.equal(p.clips[1].duration,1);
});

test("total export audio follows the clip trim, shift and fade",()=>{
  const scene=emptyScene(), audio=layer("audio","tone");
  audio.assetId="tone";scene.layers.push(audio);
  scene.assets.push({id:"tone",name:"tone",kind:"audio",duration:8,path:"audio/tone.wav"});
  const t=track("audio"), c=sceneClip("audio",audio.id,"tone","tone",0,8);
  t.clips.push(c);scene.tracks.push(t);
  const base=emptyMontage(scene);
  const {montage}=editMontage(base,[{op:"clip",id:base.clips[0].id,values:{
    start:1.5,trimIn:2,duration:2,volume:.5,enter:{kind:"fade",duration:1},
  }}]);
  const [result]=montageAudio(montage);
  assert.equal(result.start,1.5);assert.equal(result.trimIn,2);assert.equal(result.duration,2);
  assert.equal(result.volumeSamples[0].v,0);assert.equal(result.volumeSamples[30].v,.25);assert.equal(result.volumeSamples[60].v,.5);
});

test("total livemg archives deduplicate resource bytes and reopen isolated scenes",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"montage-unit-"));
  try{
    await fs.mkdir(path.join(dir,"audio"));
    await fs.writeFile(path.join(dir,"audio","tone.wav"),"data");
    const scene=emptyScene();
    scene.assets.push({id:"one",path:"audio/tone.wav",name:"one",kind:"audio",duration:1});
    addVisual(scene,layer("color","red"));
    const base=emptyMontage(scene);
    const {montage:p,created}=editMontage(base,[{op:"add_canvas",as:"second"},{op:"add_clip",canvasId:"$second"}]);
    const second={...scene,layers:[layer("color","blue")],assets:[{...scene.assets[0],id:"two"}]};
    const next=withMontageCanvas(p,created.second,second);
    const bytes=await saveLivemg(next,dir,undefined,{container:true});
    const files=unzipSync(bytes);
    assert.equal(Object.keys(files).filter(f=>f.startsWith("assets/")).length,1);
    assert.equal(Object.keys(files).filter(f=>f.startsWith("canvases/")).length,2);
    assert.equal(Object.keys(unzipSync(files["canvases/001.livemg"])).filter(f=>f.startsWith("assets/")).length,0);
    const embedded=unzipSync(await saveLivemg(next,dir,undefined,{container:true,embedCanvases:true}));
    assert.ok(unzipSync(embedded["canvases/001.livemg"])["assets/audio/tone.wav"]);
    const restored=await openLivemg(bytes,dir);
    assert.equal(restored.format,"framestudio-montage");
    const opened=loadMontage(restored);
    assert.equal(opened.canvases[0].scene.assets[0].path,opened.canvases[1].scene.assets[0].path);
    assert.deepEqual(opened.canvases.map(c=>c.scene.layers[0].name),["red","blue"]);
    assert.notEqual(opened.canvases[0].scene,opened.canvases[1].scene);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test("touching shots snap and dissolve without changing the edit duration",()=>{
  const p=emptyMontage(emptyScene()),a=p.clips[0];
  const second=editMontage(p,[{op:"add_clip",canvasId:a.canvasId,as:"b"}]);
  const b=second.montage.clips[1];
  assert.equal(snapMontageStart(second.montage,b,b.start+.06,0,100),b.start);
  const p2=editMontage(second.montage,[{op:"join",from:a.id,to:b.id,transition:{kind:"fade",duration:1}}]).montage;
  const [mix]=montageVisuals(p2,b.start);
  assert.equal(mix.shots.length,2);assert.equal(mix.transition?.progress,.5);
  assert.equal(montageEnd(p2),montageEnd(second.montage));
  const moved=editMontage(p2,[{op:"clip",id:b.id,values:{start:b.start+1}}]).montage;
  assert.equal(moved.joins?.length,0);
});

test("endpoint previews use the last actual frame and preserve subframe seeks inside the scene",()=>{
  assert.equal(previewFrameTime(3,30,3),89/30);
  assert.equal(previewFrameTime(3.01,30,3.01),3);
  assert.equal(previewFrameTime(3,30,2.99),2.99);
  assert.equal(previewFrameTime(.001,30,.001),0);
});
