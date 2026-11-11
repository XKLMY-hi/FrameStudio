import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { _electron as electron } from "playwright";
import { emptyScene, layer, addVisual } from "../src/theater/schema.ts";

const root = process.cwd();
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "framestudio-shader-qa-"));
let app, bridge, provider;
try {
  for (const part of ["dist", "backend", "electron", "node_modules/fflate"]) {
    await fs.cp(path.join(root, part), path.join(dir, part), { recursive: true });
  }
  await fs.copyFile(path.join(root, "package.json"), path.join(dir, "package.json"));
  const ffmpeg = path.join(root, "tools", "ffmpeg.exe");
  await fs.mkdir(path.join(dir, "tools"));
  await fs.copyFile(ffmpeg, path.join(dir, "tools", "ffmpeg.exe"));
  app = await electron.launch({ args: [dir], env: { ...process.env, STUDIO_TEST_MODE: "1" } });
  const page = await app.firstWindow();
  page.setDefaultTimeout(25000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", event => { if (event.type() === "error") console.error(event.text()); });
  await page.waitForFunction(() => window.theater?.ready);
  const scene = emptyScene();
  Object.assign(scene, { width: 360, height: 200, fps: 6, duration: 1, workArea: { start: 0, end: 1, loop: false } });
  const left = layer("color", "左色块"), right = layer("color", "右色块");
  Object.assign(left, { width: 100, height: 80, color: "#cc2020" });
  Object.assign(right, { width: 100, height: 80, color: "#2060cc" });
  left.transform.x = -75;
  left.receiveLight = true;
  right.receiveLight = true;
  right.transform.x = 75;
  addVisual(scene, left);
  addVisual(scene, right);
  await page.evaluate(async scene => window.theater.loadScene(scene), scene);
  const frame = (exact, t = 0) => page.evaluate(async ([exact, t]) => {
    const r = window.theater.renderer, s = exact ? window.theater.scene : window.theater.displayScene;
    r.renderAt(s, t, exact, !exact);
    const bitmap = await createImageBitmap(await r.png());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return [[105, 100], [255, 100], [10, 10]].map(([x, y]) =>
      Array.from(ctx.getImageData(x, y, 1, 1).data));
  }, [exact, t]);
  const original = await frame(true);
  assert.deepEqual(original, [[204, 32, 32, 255], [32, 96, 204, 255], [0, 0, 0, 0]]);

  bridge = spawn(process.execPath, [path.join(dir, "backend", "framestudio-mcp.mjs")], { stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: bridge.stdout })[Symbol.asyncIterator]();
  let request = 0;
  async function rpc(method, params) {
    const id = ++request;
    bridge.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    const { value } = await lines.next();
    const result = JSON.parse(value);
    assert.equal(result.id, id);
    assert.ok(!result.error, JSON.stringify(result.error));
    return result.result;
  }
  const tool = (name, args = {}) => rpc("tools/call", { name, arguments: args });
  async function ok(name, args) {
    const result = await tool(name, args);
    assert.ok(!result.isError, result.content?.[0]?.text);
    return result;
  }
  async function wait(id, expected) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const result = await ok("shader_status", { id });
      if (result.structuredContent.status === expected) return result;
      assert.notEqual(result.structuredContent.status, "failed", result.structuredContent.error);
      await new Promise(r => setTimeout(r, 125));
    }
    assert.fail("Timed out waiting for " + expected);
  }
  const hello = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "qa", version: "1" } });
  assert.equal(hello.protocolVersion, "2025-11-25");
  bridge.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  assert.equal((await rpc("tools/list", {})).tools.length, 7);
  assert.equal((await tool("shader_context")).isError, true);
  await page.getByRole("button",{name:"Agent",exact:true}).click();
  const panel=page.getByRole("region",{name:"FrameStudio Agent"});
  await panel.getByRole("button",{name:"MCP",exact:true}).click();
  await panel.getByRole("checkbox", { name: "启用本地 MCP" }).check();
  await page.waitForTimeout(700);
  const context = (await ok("shader_context")).structuredContent;
  assert.equal(context.width, 360);
  assert.ok(context.targets.some(t => t.id === left.id));
  const manifest = (name, passes, parameters) => ({ format: "framestudio-glsl", version: 1, name, passes, parameters });
  const candidate = manifest("多通道合成", [
    { id: "swap", scale: .5, source: "vec4 shade(vec2 uv) { vec4 c = source(uv); return c.bgra; }" },
    { id: "out", source: "vec4 shade(vec2 uv) { vec4 c = sample_swap(uv); return vec4(c.r, c.g * p_green * (1.0-uTime), c.b, source(uv).a); }" },
  ], { green: { label: "绿色", min: 0, max: 2, value: 1 } });
  let id = (await ok("shader_submit", { target: "output", shader: candidate })).structuredContent.id;
  assert.equal((await wait(id, "ready")).content.length, 1);
  const draft = await frame(false);
  assert.deepEqual(draft, [[32, 32, 204, 255], [204, 96, 32, 255], [0, 0, 0, 0]]);
  assert.deepEqual(await frame(true), original, "Draft must not leak into exact/export rendering");
  await ok("shader_apply", { id });
  await wait(id, "applied");
  assert.deepEqual(await frame(true), draft);
  assert.equal((await frame(true, .5))[1][1], 48);
  await panel.getByRole("checkbox", { name: "允许 Agent 读取预览画面" }).check();
  await page.waitForTimeout(650);
  const layerShader = manifest("图层绿", [{ id: "final", source: "vec4 shade(vec2 uv){return vec4(0.0,1.0,0.0,source(uv).a);}" }]);
  id = (await ok("shader_submit", { target: left.id, shader: layerShader })).structuredContent.id;
  const withImage = await wait(id, "ready");
  assert.equal(withImage.content[1]?.mimeType, "image/jpeg");
  assert.ok(Buffer.from(withImage.content[1].data, "base64").length > 100);
  await ok("shader_apply", { id });
  await wait(id, "applied");
  const both = await frame(true);
  assert.deepEqual(both, [[0, 255, 0, 255], draft[1], draft[2]]);
  const graphRead = (await ok("graph_read",{target:"output"})).structuredContent;
  assert.equal(graphRead.graph.nodes[0].op,"glsl");
  const graphNode = graphRead.graph.nodes[0].id;
  const edits = [
    {op:"add",id:"dim",type:"exposure",inputs:{image:"$source",stops:-1}},
    {op:"connect",id:graphNode,port:"image",value:"@dim"},
    {op:"add",id:"blend",type:"mix",inputs:{a:"@"+graphNode,b:"$source",amount:.25}},
    {op:"output",value:"@blend"},
  ];
  id = (await ok("graph_edit",{target:"output",edits,revision:graphRead.revision})).structuredContent.id;
  await wait(id,"ready");
  const rewired = await frame(false);
  assert.ok(Math.abs(rewired[0][1]-159)<=1, JSON.stringify(rewired));
  assert.ok(Math.abs(rewired[1][0]-85)<=1, JSON.stringify(rewired));
  assert.deepEqual(rewired[2],both[2]);
  assert.deepEqual(await frame(true),both);
  await ok("shader_discard",{id});
  const invalidLinks = [...edits,{op:"connect",id:graphNode,port:"image",value:"@blend"}];
  id = (await ok("graph_edit",{target:"output",edits:invalidLinks,revision:graphRead.revision})).structuredContent.id;
  assert.match((await wait(id,"failed")).structuredContent.error,/循环/);
  const invalid = manifest("编译失败", [{ id: "final", source: "vec4 shade(vec2 uv){return missingSymbol(uv);}" }]);
  id = (await ok("shader_submit", { target: "output", shader: invalid })).structuredContent.id;
  const failed = await wait(id, "failed");
  assert.match(failed.structuredContent.error, /missingSymbol/);
  assert.equal((await tool("shader_apply", { id })).isError, true);
  assert.deepEqual(await frame(true), both);
  const reopened = await page.evaluate(async () => {
    const saved = await fetch("/api/project-save?format=livemg", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(window.theater.scene),
    });
    if (!saved.ok) throw Error(await saved.text());
    const response = await fetch("/api/project-open?format=livemg", { method: "POST", body: await saved.blob() });
    if (!response.ok) throw Error(await response.text());
    const project = await response.json();
    await window.theater.loadScene(project);
    return project;
  });
  assert.equal(reopened.outputGraph.nodes[0].inputs.shader.name, candidate.name);
  assert.equal(reopened.layers.find(l => l.id === left.id).effects.graph.nodes[0].inputs.shader.name, layerShader.name);
  assert.deepEqual(await frame(true), both);
  await panel.getByRole("checkbox", { name: "启用本地 MCP" }).uncheck();
  await page.waitForTimeout(200);
  assert.equal((await tool("shader_context")).isError, true);
  await panel.getByRole("button",{name:"收起 Agent",exact:true}).click();
  await page.getByRole("button",{name:"画布输出效果",exact:true}).click();
  const unified=page.getByRole("region",{name:"效果节点编辑器"});
  await unified.getByRole("button",{name:"暖光泛光",exact:true}).click();
  await unified.getByRole("button",{name:"关闭节点编辑器",exact:true}).click();
  await page.keyboard.press("Control+z");
  assert.deepEqual(await frame(true),both);
  await page.getByRole("button", { name: "导出成片", exact: true }).click();
  await page.getByRole("button", { name: /ProRes 4444/ }).click();
  const exported = page.waitForResponse(res => res.url().endsWith("/api/export-finish"));
  void page.evaluate(() => window.theater.exportVideo());
  const response = await exported;
  assert.ok(response.ok(), await response.text());
  const { path: movie, frames } = await response.json();
  assert.equal(frames, 6);
  const rgba = execFileSync(ffmpeg, ["-v", "error", "-i", movie, "-frames:v", "1",
    "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"]);
  const pixel = (x, y) => Array.from(rgba.subarray(4 * (360 * y + x), 4 * (360 * y + x + 1)));
  const [r, g, b, a] = pixel(105, 100);
  assert.ok(r < 10 && g > 245 && b < 10 && a === 255, JSON.stringify(pixel(105, 100)));
  assert.equal(pixel(10, 10)[3], 0);
  await page.getByRole("button",{name:"关闭对话框"}).click();
  console.log("Canvas and external graph export verified");
  const fakeKey = "fs-qa-only-secret-93805";
  const requests = [];
  const extended=[];
  let deniedStreams=0;
  let releaseFirst;
  const handlePause=Promise.withResolvers(), lightPause=Promise.withResolvers();
  function pauseResponse(res, assign) {
    return new Promise(resolve=>{
      const release=()=>{clearTimeout(timer);res.off("close",release);resolve();};
      const timer=setTimeout(release,14000);
      res.once("close",release);
      assign(release);
    });
  }
  const providerErrors = [];
  const providerShader = manifest("内置 Agent GLSL",[{id:"tint",source:"vec4 shade(vec2 uv){vec4 c=source(uv);return vec4(c.rgb * 0.5,c.a);}"}]);
  provider = createServer(async (req,res) => {
    try {
      assert.equal(req.url,"/chat/completions");
      assert.equal(req.headers.authorization,"Bearer "+fakeKey);
      let body="";
      for await (const chunk of req) body+=chunk;
      const input = JSON.parse(body);
      const user=input.messages.find(message=>message.role==="user");
      if (user?.content==="Cancel cursor test") {
        res.writeHead(200,{"Content-Type":"text/event-stream"});
        res.write('data: {"choices":[{"index":0,"delta":{"reasoning_content":"waiting"}}]}\n\n');
        await pauseResponse(res,()=>{});
        if (!res.destroyed) res.end("data: [DONE]\n\n");
        return;
      }
      if (Array.isArray(user?.content)) {
        assert.equal(user.content[0].text,"Stage and deliver the selected object.");
        assert.match(user.content[1].image_url.url,/^data:image\/jpeg;base64,/);
        assert.equal(input.messages.some(m=>m.role==="tool" && Array.isArray(m.content)),false);
        const step=extended.length;
        extended.push(input);
        const call=(name,args,i)=>({id:"ext_"+step+"_"+i,type:"function",function:{name,arguments:JSON.stringify(args)}});
        const batches=[
          [["editor_inspect",{section:"selection"}]],
          [["editor_edit",{edits:[{op:"property",value:-62}]}]],
          [["editor_edit",{edits:[
              {op:"add_layer",kind:"shape",name:"表达式图形",as:"star",shape:{kind:"expression",fill:"#eedd44",
                x:["add",50,["mul",38,["cos","t"]]],y:["add",50,["mul",40,["sin","t"]]],samples:48}},
              {op:"layer",id:"$star",values:{width:30,height:30}},
              {op:"graph",id:"output",edits:[{op:"add",id:"newShade",type:"glsl",inputs:{shader:providerShader}}]},
            ]}],["editor_light",{name:"暖色场景灯",type:"area",position:{x:-20,y:-50,z:-150},range:1200,color:"#ffb779"}]],
          [["editor_inspect",{section:"spatial"}],["editor_render",{}],["editor_deliver",{format:"png",name:"灯光测试"}]],
        ];
        if(step===1) {
          const report=JSON.parse(input.messages.at(-1).content);
          assert.equal(report.primary,left.id);
          assert.equal(report.binding.channel,"x");
        }
        if(step===2) await pauseResponse(res,handlePause.resolve);
        if(step===3) {
          const reports=input.messages.filter(m=>m.role==="tool").slice(-2).map(m=>JSON.parse(m.content));
          assert.equal(reports[1].light.active,true);
          assert.deepEqual(reports[1].light.receivers,[left.id,right.id]);
          assert.equal(reports[0].graph.output,"@newShade");
          assert.ok(reports[0].graph.activeNodes.includes("newShade"));
          await pauseResponse(res,lightPause.resolve);
        }
        if(step===4) {
          const reports=input.messages.filter(m=>m.role==="tool").slice(-3).map(m=>JSON.parse(m.content));
          assert.equal(reports[0].lights.items[0].active,true);
          assert.equal(reports[2].delivery.mime,"image/png");
          assert.ok(reports[2].delivery.size>100);
          assert.equal(JSON.stringify(reports).includes("base64"),false);
        }
        const batch=batches[step];
        const message={role:"assistant",reasoning_content:"extend-"+step,content:batch ? "" : "Stage and delivery complete.",
          ...(batch ? {tool_calls:batch.map(([name,args],i)=>call(name,args,i))} : {})};
        res.writeHead(200,{"Content-Type":"application/json"});
        res.end(JSON.stringify({choices:[{message}]}));
        return;
      }
      const past = input.messages.filter(message=>message.role==="assistant");
      if (past.length===4 && input.stream===true) {
        deniedStreams++;
        res.writeHead(400,{"Content-Type":"application/json"});
        res.end(JSON.stringify({error:{code:"streaming_not_supported",message:"Streaming is not supported."}}));
        return;
      }
      requests.push(input);
      assert.equal(input.model,"deepseek-flash");
      assert.deepEqual(input.thinking,{type:"enabled"});
      assert.ok(!Object.hasOwn(input,"tool_choice"));
      assert.ok(input.tools.some(t=>t.function.name==="graph_edit"));
      assert.equal(body.includes(fakeKey),false);
      for (const [i,message] of past.entries()) {
        assert.equal(message.reasoning_content,"reasoning-"+(i+1));
        if (message.tool_calls) assert.equal(message.content,"");
      }
      const calls = [
        ["graph_context",{}],
        ["graph_read",{target:"output"}],
        ["graph_edit",{target:"output",edits:[
          {op:"add",id:"agentTint",type:"glsl",inputs:{image:"@"+graphNode,shader:providerShader}},
          {op:"output",value:"@agentTint"},
        ]}],
      ];
      const call = calls[requests.length-1];
      const reasoning_content = "reasoning-"+requests.length;
      const message = call ? {role:"assistant",content:null,reasoning_content,tool_calls:[
        {id:"call_"+requests.length,type:"function",function:{name:call[0],arguments:JSON.stringify(call[1])}},
      ]} : {role:"assistant",reasoning_content,content:requests.length===4 ? "Agent mock completed" : "DeepSeek follow-up completed"};
      if (requests.length===4) assert.equal(JSON.parse(input.messages.at(-1).content).status,"ready");
      if (requests.length===5) assert.equal(past.length,4);
      if (!input.stream) {
        res.writeHead(200,{"Content-Type":"application/json"});
        res.end(JSON.stringify({choices:[{message}]}));
        return;
      }
      res.writeHead(200,{"Content-Type":"text/event-stream; charset=utf-8"});
      const emit=(delta,finish_reason=null)=>res.write("data: "+JSON.stringify({choices:[{index:0,delta,finish_reason}]})+"\r\n\r\n");
      emit({role:"assistant",reasoning_content});
      if (requests.length===1) await new Promise(resolve=>{
        const timer=setTimeout(resolve,18000);
        releaseFirst=()=>{clearTimeout(timer);resolve();};
        res.once("close",releaseFirst);
      });
      if (requests.length===1) res.write((": "+ "x".repeat(1024)+"\r\n\r\n").repeat(1100));
      if (call) {
        const tool=message.tool_calls[0];
        emit({tool_calls:[{index:0,id:tool.id,type:"function",function:{name:tool.function.name.slice(0,6),arguments:tool.function.arguments.slice(0,1)}}]});
        emit({tool_calls:[{index:0,function:{name:tool.function.name.slice(6),arguments:tool.function.arguments.slice(1)}}]});
      } else emit({content:message.content});
      emit({},call ? "tool_calls" : "stop");
      res.end("data: [DONE]\r\n\r\n");
    } catch (err) {
      providerErrors.push(err.message);
      res.writeHead(500).end();
    }
  });
  await new Promise(resolve=>provider.listen(0,"127.0.0.1",resolve));
  await app.evaluate((_,port)=>{
    const fetch = globalThis.fetch;
    globalThis.fetch = (url,options) => {
      if (url !== "https://api.deepseek.com/chat/completions") throw Error("Unexpected provider URL");
      return fetch("http://127.0.0.1:"+port+"/chat/completions",options);
    };
  },provider.address().port);
  await app.evaluate(async ({safeStorage},data)=>{
    const fs=process.getBuiltinModule("node:fs/promises");
    const endpoint="https://api.deepseek.com";
    const secret=await safeStorage.encryptStringAsync(JSON.stringify({endpoint,key:data.key}));
    await fs.writeFile(data.file,JSON.stringify({endpoint,model:"deepseek-flash",secret:secret.toString("base64")}));
  },{key:fakeKey,file:path.join(dir,"data","browser-profile","agent-vault.json")});
  await page.getByRole("button",{name:"Agent",exact:true}).click();
  const chat = page.getByRole("region",{name:"FrameStudio Agent"});
  await chat.getByRole("button",{name:"Agent 设置"}).click();
  const settings=page.locator(".settings-modal");
  await settings.getByRole("button",{name:"使用 DeepSeek 预设"}).click();
  assert.equal(await settings.getByRole("textbox",{name:"Agent API 地址"}).inputValue(),"https://api.deepseek.com");
  assert.equal(await settings.locator('input[aria-label="Agent 模型 ID"]').inputValue(),"deepseek-flash");
  assert.equal(await settings.getByRole("checkbox",{name:"深度思考"}).isChecked(),true);
  await settings.getByRole("button",{name:"保存设置"}).click();
  await chat.getByRole("textbox",{name:"给 Agent 的消息"}).waitFor();
  const credential = await fs.readFile(path.join(dir,"data","browser-profile","agent-config.json"),"utf8");
  assert.equal(JSON.parse(credential).key,fakeKey);
  assert.equal(await page.evaluate(async()=>JSON.stringify(await window.studioAgent.settings()).includes("fs-qa-only-secret")),false);
  const cursor=page.locator(".viewport-panes .studio-agent-canvas");
  await page.evaluate(id=>window.theater.selectLayer(id),left.id);
  await chat.getByRole("textbox",{name:"给 Agent 的消息"}).fill("Make the output darker and preview.");
  await chat.getByRole("button",{name:"发送给 Agent"}).click();
  await chat.getByText("reasoning-1",{exact:true}).waitFor();
  const firstTarget=cursor.locator('[data-target="'+left.id+'"]');
  await firstTarget.waitFor();
  await page.waitForTimeout(1800);
  assert.equal(await firstTarget.isVisible(),true);
  assert.equal(await cursor.getAttribute("data-active"),"true");
  assert.equal(await chat.getByText("Agent mock completed").count(),0);
  releaseFirst();
  await chat.getByText("Agent mock completed").waitFor();
  await cursor.waitFor({state:"hidden"});
  await chat.locator(".studio-agent-tool summary").filter({hasText:"编辑节点图"}).click();
  await chat.locator(".studio-agent-tool[open]").getByText("graph_edit",{exact:true}).waitFor();
  await chat.getByRole("textbox",{name:"给 Agent 的消息"}).fill("Keep the draft and confirm.");
  await chat.getByRole("button",{name:"发送给 Agent"}).click();
  await chat.getByText("DeepSeek follow-up completed").waitFor().catch(async error=>{
    throw Error(JSON.stringify({providerErrors,alerts:await chat.getByRole("alert").allTextContents(),requests:requests.length,deniedStreams}),{cause:error});
  });
  assert.deepEqual(providerErrors,[]);
  assert.equal(requests.length,5);
  assert.equal(deniedStreams,1);
  assert.deepEqual(await frame(true),both);
  assert.ok(Math.abs((await frame(false))[0][1]-128)<=1);
  await chat.getByRole("button",{name:"查看节点"}).click();
  const graphEditor = page.getByRole("region",{name:"效果节点编辑器"});
  await graphEditor.getByText("内置 Agent GLSL · 输出",{exact:true}).waitFor();
  await graphEditor.getByRole("button",{name:"关闭节点编辑器"}).click();
  await page.getByRole("button",{name:"Agent",exact:true}).click();
  await chat.getByRole("button",{name:"应用草稿"}).click();
  assert.ok(Math.abs((await frame(true))[0][1]-128)<=1);
  await chat.getByRole("button",{name:"收起 Agent"}).click();
  await page.getByRole("button",{name:"Agent",exact:true}).click();
  await chat.getByText("Agent mock completed").waitFor();
  console.log("Built-in graph draft and streaming verified");
  await chat.getByRole("button",{name:"新建 Agent 对话"}).click();
  await page.evaluate(id=>window.theater.selectProperty({layerId:id,channel:"x"}),left.id);
  const reference=await page.evaluate(()=>{
    const canvas=document.createElement("canvas");
    canvas.width=canvas.height=100;
    const ctx=canvas.getContext("2d");
    ctx.fillStyle="#2222dd";ctx.fillRect(0,0,100,100);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await chat.locator('input[type=file]').setInputFiles({name:"参考.png",mimeType:"image/png",buffer:Buffer.from(reference,"base64")});
  await chat.getByRole("button",{name:"标注 参考.png"}).click();
  const annotate=page.getByRole("dialog",{name:"标注参考图"});
  const paint=annotate.locator('canvas[data-ready="true"]');
  await paint.waitFor();
  const box=await paint.boundingBox();
  await page.mouse.move(box.x+10,box.y+10);
  await page.mouse.down();
  await page.mouse.move(box.x+70,box.y+70,{steps:8});
  await page.mouse.up();
  await annotate.getByRole("button",{name:"撤销画笔"}).and(annotate.locator("button:enabled")).waitFor();
  await annotate.getByRole("button",{name:"完成标注"}).click();
  await chat.getByRole("textbox",{name:"给 Agent 的消息"}).fill("Stage and deliver the selected object.");
  await chat.getByRole("button",{name:"发送给 Agent"}).click();
  const handle=cursor.locator('[data-target="'+left.id+'"][data-target-handle="move-x"]');
  await handle.waitFor().catch(async error=>{
    throw Error(JSON.stringify({providerErrors,alerts:await chat.getByRole("alert").allTextContents(),extended:extended.length}),{cause:error});
  });
  const atHandle=await handle.evaluate(el=>el.style.transform);
  await page.evaluate(()=>{
    const r=window.theater.renderer;
    r.view.zoom*=1.3;
    r.invalidate();
  });
  await page.waitForFunction(({id,atHandle})=>{
    const el=document.querySelector('.studio-agent-cursor[data-target="'+id+'"]');
    return el?.dataset.targetHandle==="move-x" && el.style.transform!==atHandle;
  },{id:left.id,atHandle});
  assert.equal(await cursor.getAttribute("data-active"),"true");
  (await handlePause.promise)();
  const lightId=await page.waitForFunction(()=>window.theater.displayScene.layers.find(l=>l.name==="暖色场景灯")?.id).then(h=>h.jsonValue());
  const lightPointer=cursor.locator('[data-target="'+lightId+'"]');
  await lightPointer.waitFor();
  assert.equal(await lightPointer.isVisible(),true);
  const beforeOrbit=await lightPointer.evaluate(el=>el.style.transform);
  await page.getByRole("button",{name:"三维预览",exact:true}).click();
  await page.locator(".scene-canvas.is-spatial").first().waitFor();
  await page.waitForFunction(({id,beforeOrbit})=>{
    const el=document.querySelector('.studio-agent-cursor[data-target="'+id+'"]');
    return el && el.style.transform!==beforeOrbit;
  },{id:lightId,beforeOrbit});
  (await lightPause.promise)();
  await chat.getByText("Stage and delivery complete.",{exact:true}).waitFor().catch(async error=>{
    throw Error(JSON.stringify({providerErrors,alerts:await chat.getByRole("alert").allTextContents(),extended:extended.length}),{cause:error});
  });
  assert.equal(extended.length,5);
  await cursor.waitFor({state:"hidden"});
  await page.locator(".layer-row").getByRole("button",{name:"暖色场景灯",exact:true}).waitFor();
  await chat.getByRole("img",{name:"画布预览.jpg"}).waitFor();
  await chat.getByRole("button",{name:"灯光测试.png"}).waitFor();
  assert.equal(await page.evaluate(id=>window.theater.displayScene.layers.find(l=>l.id===id).animation.x.at(-1).v,left.id),-62);
  const png=await page.evaluate(async()=>{
    const r=window.theater.renderer,s=window.theater.displayScene;
    r.renderAt(s,0,true);
    const bitmap=await createImageBitmap(await r.png());
    const c=new OffscreenCanvas(bitmap.width,bitmap.height);
    const ctx=c.getContext("2d");
    ctx.drawImage(bitmap,0,0);
    const center=Array.from(ctx.getImageData(187,100,1,1).data);
    const transparent=ctx.getImageData(10,10,1,1).data[3];
    bitmap.close();
    return {center,transparent};
  });
  assert.ok(png.center[3]>200,JSON.stringify(png));
  assert.equal(png.transparent,0);
  await chat.getByRole("button",{name:"查看节点"}).click();
  await graphEditor.locator('[data-effect-node="newShade"]').getByText("内置 Agent GLSL · 输出",{exact:true}).waitFor();
  await graphEditor.getByRole("button",{name:"关闭节点编辑器"}).click();
  await page.getByRole("button",{name:"Agent",exact:true}).click();
  await chat.getByRole("button",{name:"应用草稿"}).click();
  await chat.getByRole("button",{name:"收起 Agent"}).click();
  await page.evaluate(()=>window.theater.addLayer("text"));
  await page.getByRole("button",{name:"编辑文本动画 JSON"}).click();
  const editor=page.getByRole("dialog",{name:"文本动画 JSON"});
  const json=JSON.parse(await editor.getByRole("textbox").inputValue());
  assert.equal(json.kind,"text");
  json.data.style.animation="none";
  await editor.getByRole("textbox").fill(JSON.stringify(json));
  await editor.getByRole("button",{name:"应用",exact:true}).click();
  await editor.waitFor({state:"hidden"});
  await page.evaluate(()=>window.theater.addLayer("color",true));
  await page.getByRole("button",{name:"编辑图形 JSON"}).click();
  const shapeEditor=page.getByRole("dialog",{name:"图形 JSON"});
  await shapeEditor.getByRole("textbox").fill(JSON.stringify({kind:"svg",svg:'<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'}));
  await shapeEditor.getByRole("button",{name:"应用",exact:true}).click();
  await shapeEditor.getByRole("alert").filter({hasText:/不支持的元素/}).waitFor();
  await shapeEditor.getByRole("button",{name:"SVG 示例"}).click();
  await shapeEditor.getByRole("button",{name:"应用",exact:true}).click();
  await shapeEditor.waitFor({state:"hidden"});
  assert.equal(await page.evaluate(()=>window.theater.scene.layers.at(-1).shape.kind),"svg");
  await page.getByRole("button",{name:"Agent",exact:true}).click();
  await chat.getByRole("button",{name:"新建 Agent 对话"}).click();
  await chat.getByRole("textbox",{name:"给 Agent 的消息"}).fill("Cancel cursor test");
  await chat.getByRole("button",{name:"发送给 Agent"}).click();
  await chat.getByText("waiting",{exact:true}).waitFor();
  assert.equal(await cursor.isVisible(),true);
  await chat.getByRole("button",{name:"停止 Agent"}).click();
  await cursor.waitFor({state:"hidden"});
  assert.deepEqual(providerErrors,[]);
  assert.deepEqual(errors, []);
  console.log("PASS: selected binding, 3D light, linked GLSL, shape render, annotated image, file attachment, cursor, text JSON, and a canvas cursor that persists between tool calls");
  console.log("PASS: graph and export regression, migrated local key, live reasoning and tool log, streamed tool arguments, and JSON fallback");
} finally {
  bridge?.kill();
  provider?.close();
  await app?.close();
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
}
