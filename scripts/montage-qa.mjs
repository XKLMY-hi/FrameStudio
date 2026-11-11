import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { _electron as electron } from "playwright";
import { emptyScene, layer, addVisual, sceneClip, track } from "../src/theater/schema.ts";
import { saveLivemg } from "../backend/livemg.mjs";

const root=process.cwd(),dir=await fs.mkdtemp(path.join(os.tmpdir(),"framestudio-montage-qa-"));
let app,provider;
try{
  for(const part of ["dist","backend","electron","node_modules/fflate"])
    await fs.cp(path.join(root,part),path.join(dir,part),{recursive:true});
  await fs.copyFile(path.join(root,"package.json"),path.join(dir,"package.json"));
  await fs.mkdir(path.join(dir,"tools"));
  const ffmpeg=path.join(dir,"tools","ffmpeg.exe");
  await fs.copyFile(path.join(root,"tools","ffmpeg.exe"),ffmpeg);
  app=await electron.launch({args:[dir],env:{...process.env,STUDIO_TEST_MODE:"1"}});
  const page=await app.firstWindow(),errors=[];
  page.setDefaultTimeout(22000);
  page.on("pageerror",error=>errors.push(error.message));
  await page.waitForFunction(()=>window.theater?.ready);
  const scene=(name,color)=>{
    const p=emptyScene();
    Object.assign(p,{name,width:128,height:96,fps:10,duration:1,workArea:{start:0,end:1,loop:false}});
    const l=layer("color",name);
    Object.assign(l,{width:88,height:64,color});
    addVisual(p,l);
    return p;
  };
  const red=scene("Red Canvas","#e02020"),blue=scene("Blue Canvas","#2020e0");
  const tone=layer("audio","Synthetic tone"),audioTrack=track("Audio");
  tone.assetId="tone";blue.layers.push(tone);
  blue.assets.push({id:"tone",name:"tone",kind:"audio",duration:1,path:"audio/qa-tone.wav"});
  audioTrack.clips.push(sceneClip("audio",tone.id,"tone","Synthetic tone",0,1));
  blue.tracks.push(audioTrack);
  await fs.mkdir(path.join(dir,"data","audio"),{recursive:true});
  execFileSync(ffmpeg,["-y","-v","error","-f","lavfi","-i","sine=frequency=440:duration=1","-c:a","pcm_s16le",path.join(dir,"data",blue.assets[0].path)]);
  const source=path.join(dir,"canvas.livemg");
  await fs.writeFile(source,await saveLivemg(blue,path.join(dir,"data")));
  await page.evaluate(s=>window.theater.loadScene(s),red);
  await page.getByRole("button",{name:"总时间线",exact:true}).click();
  assert.equal(await page.evaluate(()=>window.theater.montage),undefined);
  await page.getByRole("button",{name:"创建总时间线并加入当前画布",exact:true}).click();
  await page.getByLabel("导入画布工程",{exact:true}).setInputFiles(source);
  await page.waitForFunction(()=>window.theater.montage?.canvases.length===2);
  const master=()=>page.evaluate(()=>window.theater.montage);
  assert.equal((await master()).clips.length,1);
  await page.getByRole("button",{name:"加入总时间线 Blue Canvas",exact:true}).click();
  const start=await master(),first=start.clips[0],second=start.clips[1];
  const addTransition=page.getByRole("button",{name:"添加接缝转场",exact:true});
  await addTransition.click();
  const junction=page.getByRole("group",{name:"接缝转场"});
  await junction.getByRole("button",{name:"淡入淡出",exact:true}).click();
  await page.waitForFunction(()=>window.theater.montage.joins?.length===1);
  await junction.getByRole("button",{name:"完成",exact:true}).click();
  const block=page.locator('[data-montage-clip="'+second.id+'"]');
  const box=await block.boundingBox();
  await page.mouse.move(box.x+20,box.y+12);await page.mouse.down();
  await page.mouse.move(box.x-23,box.y-30,{steps:10});await page.mouse.up();
  await page.waitForFunction(id=>window.theater.montage.clips.some(c=>c.id===id && c.start===.5 && c.lane===1),second.id);
  assert.equal((await master()).joins.length,0);
  await page.getByLabel("入场转场").selectOption("fade");
  await page.getByLabel("入场时长").fill("0.4");
  await page.getByLabel("入场时长").press("Enter");
  const setTime=at=>page.getByRole("slider",{name:"总时间线播放头"}).evaluate((el,at)=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,String(at));
    el.dispatchEvent(new Event("input",{bubbles:true}));
    el.dispatchEvent(new Event("change",{bubbles:true}));
  },at);
  const sample=()=>page.evaluate(()=>{
    const cv=document.querySelector('canvas[aria-label="总成片画布"]');
    return Array.from(cv.getContext("2d").getImageData(cv.width/2,cv.height/2,1,1).data);
  });
  async function pixel(at,match){
    await setTime(at);
    await page.waitForFunction(({at})=>document.querySelector('input[aria-label="总时间线播放头"]').valueAsNumber===at,{at});
    for(let i=0;i<40;i++){
      if(match(await sample())) return;
      await page.waitForTimeout(25);
    }
    assert.fail(JSON.stringify({at,pixel:await sample(),project:await master()}));
  }
  await pixel(.2,([r,g,b,a])=>r>200 && b<60 && a===255);
  await pixel(.7,([r,g,b,a])=>r>105 && r<150 && b>105 && b<150 && a===255);
  await pixel(1.2,([r,g,b,a])=>r<60 && b>200 && a===255);
  const play=page.getByRole("button",{name:"播放总时间线",exact:true});
  await play.click();
  await page.getByRole("button",{name:"暂停总时间线",exact:true}).waitFor();
  await play.waitFor();
  console.log("PASS: import, drag, stacking, preview transition and transport");

  const mock=[];
  const glsl={format:"framestudio-glsl",version:1,name:"Master green tint",passes:[
    {id:"grade",source:"vec4 shade(vec2 uv){vec4 c=source(uv);return vec4(c.r,c.g*0.5,c.b,c.a);}"},
  ]};
  provider=createServer(async(req,res)=>{
    let body="";for await(const chunk of req) body+=chunk;
    const input=JSON.parse(body);
    const i=mock.push(input)-1;
    const calls=[
      ["montage_inspect",{}],
      ["editor_inspect",{section:"layers",canvasId:second.canvasId}],
      ["editor_edit",{canvasId:second.canvasId,edits:[{op:"layer",id:blue.layers[0].id,values:{color:"#20e020"}}]}],
      ["montage_edit",{edits:[{op:"clip",id:second.id,values:{lane:2}},{op:"shader",shader:glsl}]}],
      ["montage_render",{time:1.2}],
    ];
    const call=calls[i];
    const message=call ? {role:"assistant",content:null,tool_calls:[{id:"shot_"+i,type:"function",function:{name:call[0],arguments:JSON.stringify(call[1])}}]}
      : {role:"assistant",content:"Montage complete"};
    res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({choices:[{message}]}));
  });
  await new Promise(resolve=>provider.listen(0,"127.0.0.1",resolve));
  await page.evaluate(port=>window.studioAgent.configure({endpoint:"http://127.0.0.1:"+port,model:"montage-test",key:"qa-only",stream:false}),provider.address().port);
  await page.getByRole("button",{name:"Agent",exact:true}).click();
  const chat=page.getByRole("region",{name:"FrameStudio Agent"});
  await chat.getByRole("textbox",{name:"给 Agent 的消息"}).fill("Edit the independent canvas, raise it and grade the final cut.");
  await chat.getByRole("button",{name:"发送给 Agent"}).click();
  await chat.getByText("Montage complete",{exact:true}).waitFor();
  const toolResults=mock.at(-1).messages.filter(m=>m.role==="tool").map(m=>JSON.parse(m.content));
  assert.ok(toolResults.every(result=>!result.error),JSON.stringify(toolResults));
  assert.equal(toolResults[1].items[0].id,blue.layers[0].id);
  assert.equal((await master()).canvases[1].scene.layers[0].color,"#2020e0");
  await chat.getByRole("img",{name:"总成片预览.jpg"}).waitFor();
  await chat.getByRole("button",{name:"应用草稿"}).click();
  await chat.getByRole("button",{name:"收起 Agent"}).click();
  const applied=await master();
  assert.equal(applied.canvases[0].scene.layers[0].color,"#e02020");
  assert.equal(applied.canvases[1].scene.layers[0].color,"#20e020");
  assert.equal(applied.clips[1].lane,2);
  assert.ok(applied.outputGraph.output.startsWith("@"));
  await pixel(1.2,([r,g,b,a])=>r<60 && g>100 && g<125 && b<60 && a===255);
  console.log("PASS: one Agent draft edits inactive canvas, stack and master GLSL");
  const archive=await page.evaluate(async()=>{
    const url=new URL(location.href),token=url.searchParams.get("token");
    const response=await fetch("/api/project-save?format=livemg",{method:"POST",headers:{
      Authorization:"Bearer "+token,"Content-Type":"application/json",
    },body:JSON.stringify({project:window.theater.montage,options:{container:true}})});
    if(!response.ok) throw Error(await response.text());
    return Array.from(new Uint8Array(await response.arrayBuffer()));
  });
  const whole=path.join(dir,"whole.livemgs");await fs.writeFile(whole,Buffer.from(archive));
  await page.locator('input[accept=".livemgs,.livemg,.l2dstudio"]:not([aria-label])').setInputFiles(whole);
  await page.waitForFunction(old=>window.theater.ready && window.theater.montage?.canvases[1].scene.assets[0].path!==old,
    applied.canvases[1].scene.assets[0].path);
  const reopened=await master();
  assert.equal(reopened.clips[1].start,.5);assert.equal(reopened.outputGraph.output,applied.outputGraph.output);
  await page.getByRole("button",{name:/Blue Canvas/}).first().click();
  await page.waitForFunction(()=>window.theater.ready && window.theater.scene.name==="Blue Canvas");
  await page.getByRole("button",{name:"总时间线",exact:true}).click();
  await page.getByRole("button",{name:"导出成片",exact:true}).click();
  await page.getByRole("button",{name:/ProRes 4444/}).click();
  const masterExport=page.waitForResponse(res=>res.url().endsWith("/api/export-finish"));
  void page.evaluate(()=>window.theater.exportVideo());
  const response=await masterExport;
  assert.ok(response.ok(),await response.text());
  const movie=await response.json();
  assert.equal(movie.frames,15);
  const raw=execFileSync(ffmpeg,["-v","error","-i",movie.path,"-frames:v","1","-f","rawvideo","-pix_fmt","rgba","pipe:1"]);
  const firstPixel=[...raw.subarray((48*128+64)*4,(48*128+64)*4+4)];
  assert.ok(firstPixel[0]>180 && firstPixel[3]===255,JSON.stringify(firstPixel));
  assert.equal(raw[3],0);
  const audio=execFileSync(ffmpeg,["-v","error","-i",movie.path,"-map","0:a:0","-f","s16le","pipe:1"]);
  assert.ok(audio.subarray(Math.floor(audio.length*.5)).some(v=>v!==0));
  await page.getByRole("button",{name:"当前画布",exact:true}).click();
  await page.getByRole("button",{name:/PNG 序列/}).click();
  const singleExport=page.waitForResponse(res=>res.url().endsWith("/api/export-finish"));
  void page.evaluate(()=>window.theater.exportVideo());
  const single=await singleExport;
  assert.ok(single.ok(),await single.text());
  assert.equal((await single.json()).frames,10);
  assert.deepEqual(errors,[]);
  console.log("PASS: packed reopen, standalone scene switch and export, master video with alpha and audio");
}finally{
  provider?.close();
  await app?.close();
  await fs.rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:200});
}
