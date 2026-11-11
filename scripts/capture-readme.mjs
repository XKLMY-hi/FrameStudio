import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createStudioServer } from "../backend/server.mjs";
import { saveLivemg } from "../backend/livemg.mjs";
import { addVisual, emptyScene, layer } from "../src/theater/schema.ts";
import { emptyMontage, montageClip } from "../src/theater/montage.ts";

const root=process.cwd();
const sample=path.resolve(process.argv[2]??"qa/readme-capture/Hiyori.zip");
const out=path.join(root,"docs","screenshots");
const scratch=await fs.mkdtemp(path.join(os.tmpdir(),"framestudio-readme-"));
await fs.access(sample);
await fs.mkdir(out,{recursive:true});
await fs.cp(path.join(root,"dist"),path.join(scratch,"dist"),{recursive:true});
await fs.mkdir(path.join(scratch,"data"),{recursive:true});
await fs.writeFile(path.join(scratch,"data","preferences.json"),JSON.stringify({
  appearance:"dark",accent:"violet",autoSave:false,closeBehavior:"ask",
}));

function stage(name,palette) {
  const scene=emptyScene();
  scene.name=name;scene.duration=6;scene.workArea.end=6;
  const sky=layer("color","月面与远山");
  const [night,dusk,moon]=palette;
  sky.width=1280;sky.height=720;sky.locked=true;
  sky.shape={kind:"svg",fill:"none",svg:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">'+
    '<defs><linearGradient id="sky" x2="0" y2="100%"><stop stop-color="'+night+'"/><stop offset="1" stop-color="'+dusk+'"/></linearGradient>'+
    '<linearGradient id="moon" x2="0" y2="100%"><stop stop-color="#ffe7f1"/><stop offset="1" stop-color="'+moon+'"/></linearGradient>'+
    '<linearGradient id="water" x2="0" y2="100%"><stop stop-color="'+dusk+'"/><stop offset="1" stop-color="#101425"/></linearGradient></defs>'+
    '<path d="M0 0h1280v720H0z" fill="url(#sky)"/>'+
    Array.from({length:100},(_,i)=>'<circle cx="'+((i*18931+97)%1280)+'" cy="'+((i*2741+29)%430)+'" r="'+(i%16===0?1.6:.7)+'" fill="#f7e9ff" opacity="'+(.2+(i%7)*.08)+'"/>').join("")+
    '<circle cx="873" cy="276" r="119" fill="url(#moon)"/>'+
    '<circle cx="873" cy="276" r="155" fill="none" stroke="'+moon+'" opacity=".3"/>'+
    '<circle cx="873" cy="276" r="195" fill="none" stroke="'+moon+'" opacity=".15"/>'+
    '<path d="M0 464l122-84 107 29 87-56 127 45 99 17 126 49 144-26 143 21 101-89 80 21 144-101v430H0z" fill="#312743"/>'+
    '<path d="M0 510l174-68 115 19 155-16 146 50 167-8 181-13 179-49 163 21v274H0z" fill="#201d36"/>'+
    '<path d="M0 510q315-25 630-17t650 0v227H0z" fill="url(#water)"/>'+
    Array.from({length:57},(_,i)=>{
      const y=512+(i*43)%183,w=15+(i*13)%89;
      return '<path d="M'+(821+(i*53)%209-(y-512)*.9)+' '+y+'h'+w+'" stroke="'+moon+'" opacity="'+(.12+(i%5)*.04)+'"/>';
    }).join("")+
    '<path d="M0 618l122-40 121 30 119-12 97 36 153 88H0zM1280 530l-128 54-74 85-112 51h314z" fill="#111421"/>'+
    '<path d="M38 76V40h36M1206 40h36v36M38 644v36h36M1206 680h36v-36" fill="none" stroke="#fff" opacity=".3"/>'+
    '</svg>'};
  addVisual(scene,sky);
  function text(name,value,fontSize,x,y,width) {
    const item=layer("text",name);
    item.width=width;item.height=fontSize+45;
    Object.assign(item.transform,{x,y});
    Object.assign(item.text,{value,fontSize,fill:"#fff0ef",align:"left",fontFamily:"Microsoft YaHei UI",animation:"none"});
    addVisual(scene,item);return item;
  }
  text("片名 · 月潮","月 潮",89,-300,40,460);
  text("副标题 · LUNAR TIDE","L U N A R   T I D E",23,-295,125,470);
  return scene;
}
const first=stage("序章 · 观月",["#11192e","#733d5d","#d984be"]);
const second=stage("第二幕 · 潮汐",["#111b32","#473760","#b49aef"]);
const third=stage("尾声 · 归航",["#111c30","#345473","#8bb9ed"]);
const master=emptyMontage(first);
master.name="月潮 / Lunar Tide";
master.canvases.push({id:"tide",scene:second},{id:"return",scene:third});
master.clips.push(montageClip("tide",6,6),montageClip("return",6,12,1));
master.joins=[{from:master.clips[0].id,to:master.clips[1].id,kind:"fade",duration:.6}];
const archive=path.join(scratch,"readme.livemgs");
await fs.writeFile(archive,await saveLivemg(master,path.join(scratch,"data"),undefined,{container:true}));

let browser,service;
try {
  service=await createStudioServer({root:scratch});
  browser=await chromium.launch({
    ...(process.env.STUDIO_BROWSER_EXECUTABLE ? {executablePath:process.env.STUDIO_BROWSER_EXECUTABLE}
      : process.platform==="win32" ? {channel:"msedge"} : {}),
    args:["--enable-unsafe-swiftshader"],
  });
  const page=await browser.newPage({viewport:{width:1600,height:1000}});
  page.setDefaultTimeout(22000);
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  page.on("dialog",dialog=>dialog.accept());
  await page.goto(service.url);
  await page.waitForFunction(()=>window.theater?.ready);
  const button=name=>page.getByRole("button",{name,exact:true});
  async function capture(file) {
    await page.mouse.move(3,3);
    await page.locator(".toast").waitFor({state:"hidden",timeout:6000});
    await page.evaluate(()=>document.fonts.ready);
    await page.waitForTimeout(180);
    await page.screenshot({path:path.join(out,file)});
    console.log("Captured",file);
  }

  await page.locator('input[accept=".livemgs,.livemg,.l2dstudio"]:not([aria-label])').setInputFiles(archive);
  await page.waitForFunction(()=>window.theater.montage?.canvases.length===3);
  await button("适合总时间线宽度").click();
  await page.locator("[data-montage-clip]").first().click();
  await page.waitForFunction(()=>{
    const canvas=document.querySelector(".montage-stage canvas");
    return canvas?.width===768 && canvas.getContext("2d").getImageData(524,166,1,1).data[0]>100;
  });
  await capture("montage.png");

  await button("返回当前画布").click();
  await page.locator('input[type=file][accept=".zip"]').setInputFiles(sample);
  await page.waitForFunction(()=>window.theater.scene.models.length===1 && window.theater.ready && !window.theater.renderer.loading.size);
  const loaded=await page.evaluate(()=>{
    const scene=window.theater.scene,resource=scene.models[0],actor=scene.layers.find(l=>l.model);
    return {resource,actor,params:window.theater.renderer.nodes.get(actor.id).runtime.params};
  });
  assert.match(loaded.resource.file,/(^|\/)Hiyori\.model3\.json$/);
  assert.ok(loaded.params.some(p=>p.id==="ParamAngleX"));
  const resource={...loaded.resource,name:"桃濑日和 · Hiyori",
    controls:[
      {id:"body",name:"身体",x:.5,y:.47,xParam:"ParamBodyAngleX",yParam:"ParamBodyAngleY"},
      {id:"head",name:"头部",x:.5,y:.16,xParam:"ParamAngleX",yParam:"ParamAngleY",parentId:"body"},
    ],
    assets:[{
      id:"readme-motion",name:"视线与转身",kind:"motion",duration:4,fps:30,
      curves:[
        {id:"ParamAngleX",target:"Parameter",keys:[
          {t:0,v:-12,mode:"bezier",out:[.4,-12]},{t:1,v:16,mode:"bezier",in:[.6,16],out:[1.5,16]},
          {t:2.5,v:-7,mode:"bezier",in:[1.9,-7],out:[2.9,-7]},{t:4,v:9,mode:"bezier",in:[3.6,9]}]},
        {id:"ParamAngleY",target:"Parameter",keys:[{t:0,v:-3,mode:"bezier"},{t:1.5,v:7,mode:"bezier"},{t:4,v:0,mode:"linear"}]},
        {id:"ParamBodyAngleX",target:"Parameter",keys:[{t:0,v:-3,mode:"bezier"},{t:2,v:5,mode:"bezier"},{t:4,v:0,mode:"linear"}]},
      ],
    },...loaded.resource.assets],
  };
  const scene=stage("暮色放送 · 桃濑日和",["#11192e","#493255","#bfa0e7"]);
  const title=scene.layers.find(l=>l.text?.fontSize===89);
  title.name="片名 · 暮色放送";title.text.value="暮色放送";title.text.fontSize=71;title.width=550;title.transform.x=-245;
  const sub=scene.layers.find(l=>l.text?.fontSize===23);
  sub.name="副标题 · After the Lights";sub.text.value="A F T E R   T H E   L I G H T S";sub.width=550;sub.transform.x=-242;
  scene.models=[resource];
  const actor=loaded.actor;
  actor.name="桃濑日和";actor.width=450;actor.height=660;
  actor.transform={...actor.transform,x:300,y:10};
  actor.model.physics=false;
  actor.model.keys=resource.assets[0].curves;
  addVisual(scene,actor);
  await page.evaluate(async s=>{await window.theater.loadScene(s);window.theater.selectLayer(s.layers.find(l=>l.model).id);window.theater.seek(1.3);},scene);
  await page.waitForFunction(()=>window.theater.ready && !window.theater.renderer.loading.size);
  await capture("workspace.png");

  await button("动作 / 参数").click();
  await button("编辑源模型素材").click();
  await button("预设动作").click();
  const dock=page.getByRole("region",{name:"Live2D 动作时间线"});
  await dock.waitFor();
  await dock.getByLabel("动作播放头").fill("1");
  await page.getByRole("button",{name:"拖动控制点 头部"}).waitFor();
  await capture("model-workbench.png");
  await dock.getByRole("button",{name:"曲线",exact:true}).click();
  await dock.locator(".curve-plot-wrap").waitFor();
  await dock.locator("[data-plot-channel]").first().waitFor();
  const point=await dock.locator("[data-curve-path]").first().evaluate(path=>{
    const point=path.getPointAtLength(path.getTotalLength()*.15);
    const transformed=new DOMPoint(point.x,point.y).matrixTransform(path.getScreenCTM());
    return {x:transformed.x,y:transformed.y};
  });
  await page.mouse.click(point.x,point.y);
  await capture("curve-editor.png");
  await dock.getByTitle("关闭关键帧编辑器",{exact:true}).click();

  await button("贴图").click();
  await page.getByLabel("贴图画布",{exact:true}).waitFor();
  assert.ok((await page.getByLabel("贴图画布",{exact:true}).boundingBox()).width>300);
  await capture("texture-board.png");

  await button("软件设置").click();
  await button("工程与保存").click();
  await capture("settings.png");
  await button("关闭对话框").click();
  await button("返回场景").click();
  await button("软件设置").click();
  await page.getByLabel("外观",{exact:true}).selectOption("light");
  await button("关闭对话框").click();
  await page.waitForFunction(()=>getComputedStyle(document.documentElement).colorScheme==="light");
  await capture("workspace-light.png");
  assert.deepEqual(errors,[]);
} finally {
  await browser?.close();
  service?.server.close();
}
