import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createServer} from "node:http";
import { _electron as electron } from "playwright";
import { emptyScene,layer,addVisual } from "../src/theater/schema.ts";
import { emptyMontage,montageClip } from "../src/theater/montage.ts";
import { parseAsset } from "../src/engine.ts";

const root=process.cwd(),old=path.resolve(process.argv[2]??"release/FrameStudio-2.14.0-portable/resources/app/data");
const dir=await fs.mkdtemp(path.join(os.tmpdir(),"framestudio-model-qa-"));
let app,provider;
try{
  for(const part of ["dist","backend","electron","node_modules/fflate"])
    await fs.cp(path.join(root,part),path.join(dir,part),{recursive:true});
  await fs.copyFile(path.join(root,"package.json"),path.join(dir,"package.json"));
  const prior=JSON.parse(await fs.readFile(path.join(old,"autosave-scene.json"),"utf8"));
  const candidates=(prior.canvases??[{scene:prior}]).flatMap(c=>c.scene.models);
  const chosen=candidates.filter(m=>m.file.endsWith(".model3.json")).slice(0,2);
  assert.ok(chosen.length,"Need a local Cubism 3+ test model");
  if(chosen.length===1) chosen.push(chosen[0]);
  for(const id of new Set(chosen.map(m=>m.modelId))) await fs.cp(path.join(old,"models",id),path.join(dir,"data","models",id),{recursive:true});
  const scene=(name,res)=>{
    const s=emptyScene();s.name=name;s.width=480;s.height=320;s.duration=3;s.workArea.end=3;
    const resource={...res,preprocess:undefined,assets:[],textureOverrides:undefined};s.models=[resource];
    const model=layer("model",name);model.width=230;model.height=290;model.receiveLight=false;
    model.model={resourceId:resource.id,physics:false,parameterMap:{},groupOverrides:{},baseValues:{},keys:[],lipOpen:"",lipForm:""};
    addVisual(s,model,0,3);
    s.tracks[0].clips[0].fadeOut=0;
    return s;
  };
  const first=scene("模型 A",chosen[0]),unplaced=scene("未排片画布",chosen[1]);
  const master=emptyMontage(first);
  const other="unplaced";
  master.canvases.push({id:other,scene:unplaced});
  await fs.writeFile(path.join(dir,"data","autosave-scene.json"),JSON.stringify(master));
  app=await electron.launch({args:[dir],env:{...process.env,STUDIO_TEST_MODE:"1"}});
  const page=await app.firstWindow(),errors=[];
  page.setDefaultTimeout(32000);
  page.on("pageerror",error=>errors.push(error.message));
  page.on("console",m=>{if(m.type()==="error")console.error(m.text().slice(0,400));});
  await page.waitForFunction(()=>window.theater?.ready);
  async function count(mode){
    return page.evaluate(async mode=>{
      const r=window.theater.renderer,p=window.theater.displayScene;
      const stage=document.querySelector('canvas[aria-label="总成片画布"]');
      let target=stage;
      if(mode==="scene"){
        await r.ensure(p);
        r.renderAt(p,1,true);
        target=document.createElement("canvas");
        target.width=p.width;target.height=p.height;target.getContext("2d").drawImage(r.app.view,0,0);
      }
      const data=target.getContext("2d").getImageData(0,0,target.width,target.height).data;
      let alpha=0,colored=0;
      for(let i=0;i<data.length;i+=4)if(data[i+3]>120){alpha++;if(data[i]+data[i+1]+data[i+2]>110)colored++;}
      return {alpha,colored};
    },mode);
  }
  async function verify(mode){
    for(let i=0;i<40;i++){
      const pixels=await count(mode);
      if(pixels.alpha>300 && pixels.colored>100) return pixels;
      await page.waitForTimeout(80);
    }
    assert.fail(JSON.stringify(await count(mode)));
  }
  await verify("master");
  await page.getByRole("button",{name:/未排片画布/}).first().click();
  await page.waitForFunction(()=>window.theater.ready && window.theater.scene.name==="未排片画布");
  await verify("scene");
  await page.getByRole("button",{name:"总时间线",exact:true}).click();
  await verify("master");
  console.log("PASS: real Live2D pixels in total preview and an unplaced independent canvas, then back");

  await page.getByRole("button",{name:/未排片画布/}).first().click();
  await page.waitForFunction(()=>window.theater.ready && window.theater.scene.name==="未排片画布");
  await page.getByRole("button",{name:"动作 / 参数",exact:true}).click();
  await page.getByRole("button",{name:"编辑源模型素材",exact:true}).click();
  await page.getByLabel("模型名称",{exact:true}).fill("工作台验证模型");
  await page.getByLabel("模型名称",{exact:true}).press("Enter");
  await page.getByRole("button",{name:"贴图",exact:true}).click();
  const texture=page.getByLabel("贴图画布",{exact:true});
  await texture.waitFor();
  const rect=await texture.boundingBox();
  await page.mouse.move(rect.x+rect.width*.4,rect.y+rect.height*.4);
  await page.mouse.down();
  await page.mouse.move(rect.x+rect.width*.5,rect.y+rect.height*.5,{steps:5});await page.mouse.up();
  await page.getByRole("button",{name:"保存贴图副本",exact:true}).click();
  await page.waitForFunction(()=>window.theater.scene.models[0].textureOverrides?.[0]);
  const image=await page.evaluate(()=>window.theater.scene.assets.find(a=>a.id===window.theater.scene.models[0].textureOverrides[0]));
  assert.ok((await fs.stat(path.join(dir,"data",image.path))).size>1000);
  await page.getByRole("button",{name:"预设动作",exact:true}).click();
  await page.getByRole("button",{name:"新建动作",exact:true}).click();
  await page.getByLabel("动作名称",{exact:true}).fill("工作台验证动作");
  await page.getByRole("button",{name:"记录关键帧",exact:true}).click();
  await page.getByRole("button",{name:"保存动作",exact:true}).click();
  await page.waitForFunction(()=>window.theater.scene.models[0].assets.some(a=>a.motionFile));
  const asset=await page.evaluate(()=>window.theater.scene.models[0].assets[0]);
  const doc=JSON.parse(await fs.readFile(path.join(dir,"data",asset.motionFile),"utf8"));
  assert.equal(doc.Meta.CurveCount,1);
  assert.equal(parseAsset(doc,asset.name).curves[0].keys.length,1);
  console.log("PASS: model rename, brush texture copy and standard motion file");

  await page.getByRole("button",{name:"软件设置",exact:true}).click();
  await page.getByLabel("软件关闭行为",{exact:true}).selectOption("save");
  await page.getByRole("button",{name:"Agent 与 MCP",exact:true}).click();
  await page.getByLabel("启用本地 MCP",{exact:true}).waitFor();
  await page.getByRole("button",{name:"关闭对话框",exact:true}).click();
  const results=[];
  const shader={format:"framestudio-glsl",version:1,name:"验收着色节点",passes:[{id:"mainPass",source:"vec4 shade(vec2 uv){return source(uv);}"}]};
  provider=createServer(async(req,res)=>{
    let body="";for await(const chunk of req)body+=chunk;
    const input=JSON.parse(body),i=results.push(input)-1;
    const calls=[
      ["model_inspect",{resourceId:unplaced.models[0].id}],
      ["model_edit",{resourceId:unplaced.models[0].id,action:"rename",values:{name:"Agent 工作台模型"}}],
      ["model_edit",{resourceId:unplaced.models[0].id,action:"motion",values:{id:asset.id,name:"Agent 修改动作"}}],
      ["model_edit",{resourceId:unplaced.models[0].id,action:"paint",values:{index:0,strokes:[{
        mode:"erase",color:"#000000",size:10,points:[[.02,.02],[.03,.03]],
      }]}}],
      ["editor_render",{time:3}],
      ["editor_shader",{target:"output",shader}],
    ];
    const call=calls[i];
    const message=call?{role:"assistant",content:null,tool_calls:[{id:"workbench_"+i,type:"function",
      function:{name:call[0],arguments:JSON.stringify(call[1])}}]}:{role:"assistant",content:"Workbench complete"};
    res.writeHead(200,{"Content-Type":"application/json"}).end(JSON.stringify({choices:[{message}]}));
  });
  await new Promise(resolve=>provider.listen(0,"127.0.0.1",resolve));
  await page.evaluate(port=>window.studioAgent.configure({endpoint:"http://127.0.0.1:"+port,model:"workbench-test",key:"qa-only",stream:false}),provider.address().port);
  await page.getByRole("button",{name:"Agent",exact:true}).click();
  const chat=page.getByRole("region",{name:"FrameStudio Agent"});
  await chat.getByRole("textbox",{name:"给 Agent 的消息"}).fill("Test model tools and add a pass.");
  await chat.getByRole("button",{name:"发送给 Agent"}).click();
  await chat.getByText("Workbench complete",{exact:true}).waitFor().catch(async err=>{
    throw Error(JSON.stringify({requests:results.length,alerts:await page.getByRole("alert").allTextContents(),errors}),{cause:err});
  });
  const tools=results.at(-1).messages.filter(m=>m.role==="tool").map(m=>JSON.parse(m.content));
  assert.ok(tools.every(x=>!x.error),JSON.stringify(tools));
  assert.equal(tools[2].result.format,"motion3.json");
  assert.equal(tools[3].result.index,0);
  await chat.getByRole("img",{name:"画布预览.jpg"}).waitFor();
  const picture=await chat.getByRole("img",{name:"画布预览.jpg"}).evaluate(async image=>{
    await image.decode();
    const cv=document.createElement("canvas");cv.width=image.naturalWidth;cv.height=image.naturalHeight;
    const ctx=cv.getContext("2d");ctx.drawImage(image,0,0);
    const data=ctx.getImageData(0,0,cv.width,cv.height).data;
    let count=0;for(let i=0;i<data.length;i+=4)if(data[i]+data[i+1]+data[i+2]>110)count++;
    return count;
  });
  assert.ok(picture>100,"Agent should receive a visible preview at the scene endpoint, pixels="+picture);
  const initialName=await page.evaluate(()=>window.theater.scene.name);
  await page.evaluate(()=>window.theater.change(s=>{s.name="Must not commit while a draft is pending";}));
  assert.equal(await page.evaluate(()=>window.theater.scene.name),initialName);
  await chat.getByRole("button",{name:"应用草稿",exact:true}).click();
  await chat.getByRole("button",{name:"收起 Agent",exact:true}).click();
  await page.getByRole("button",{name:"画布输出效果",exact:true}).click();
  const graph=page.getByRole("region",{name:"效果节点编辑器"});
  await graph.getByLabel("节点处理范围",{exact:true}).selectOption("output");
  await graph.getByText("验收着色节点 · 输出",{exact:true}).waitFor();
  await graph.getByRole("button",{name:"关闭节点编辑器",exact:true}).click();
  await page.getByRole("button",{name:"Agent",exact:true}).click();
  await page.keyboard.press("Control+z");
  await chat.getByRole("button",{name:"应用草稿",exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.theater.scene.outputGraph),undefined);
  assert.deepEqual(errors,[]);
  console.log("PASS: unified settings and MCP, model Agent, persistent graph entry, undo restores draft");
  const ready=await page.evaluate(async()=>{
    const response=await fetch("/api/preferences",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({closeBehavior:"ask",autoSave:false})});
    return response.ok;
  });
  assert.equal(ready,true);
  const canceled=await app.evaluate(async ({dialog,BrowserWindow})=>{
    const original=dialog.showMessageBox,mode=process.env.STUDIO_TEST_MODE;
    let shown=0;const win=BrowserWindow.getAllWindows()[0];
    try {
      delete process.env.STUDIO_TEST_MODE;
      dialog.showMessageBox=async()=>{shown++;return {response:2};};
      win.close();
      for(let i=0;i<40 && !shown;i++) await new Promise(r=>setTimeout(r,25));
      return {shown,closed:win.isDestroyed()};
    }finally{process.env.STUDIO_TEST_MODE=mode;dialog.showMessageBox=original;}
  });
  assert.deepEqual(canceled,{shown:1,closed:false});
  console.log("PASS: native close confirmation can be canceled");
}finally{
  provider?.close();
  await app?.close();
  await fs.rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:200});
}
