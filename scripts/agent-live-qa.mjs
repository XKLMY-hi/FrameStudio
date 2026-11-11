import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { _electron as electron } from "playwright";
import { emptyScene } from "../src/theater/schema.ts";

const profile = process.argv[2];
const streamCheck = process.argv.includes("--stream-check");
const visionCheck = process.argv.includes("--vision-check");
if (!profile || !process.env.APPDATA) throw Error("Pass the current portable resources/app/data/browser-profile directory.");
const root = process.cwd();
const dir = await fs.mkdtemp(path.join(os.tmpdir(),"framestudio-live-design-"));
let app;
try {
  for (const part of ["dist","backend","electron","node_modules/fflate"]) {
    await fs.cp(path.join(root,part),path.join(dir,part),{recursive:true});
  }
  await fs.copyFile(path.join(root,"package.json"),path.join(dir,"package.json"));
  const isolated = path.join(dir,"data","browser-profile");
  await fs.mkdir(isolated,{recursive:true});
  const local=path.join(process.env.APPDATA,"FrameStudio");
  try { await fs.copyFile(path.join(local,"agent-config.json"),path.join(isolated,"agent-config.json")); }
  catch(e) {
    if (e.code!=="ENOENT") throw e;
    await fs.copyFile(path.join(profile,"Local State"),path.join(isolated,"Local State"));
    await fs.copyFile(path.join(local,"agent-vault.json"),path.join(isolated,"agent-vault.json"));
  }
  app = await electron.launch({args:[dir],env:{...process.env,STUDIO_TEST_MODE:"1"}});
  const page = await app.firstWindow();
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.waitForFunction(()=>window.theater?.ready);
  const scene=emptyScene();
  Object.assign(scene,{width:640,height:360,fps:24,duration:5,workArea:{start:0,end:5,loop:false}});
  await page.evaluate(async s=>window.theater.loadScene(s),scene);
  const profileInfo=await page.evaluate(async()=>{
    const s=await window.studioAgent.settings();
    if (!s.hasKey || new URL(s.endpoint).origin!=="https://api.deepseek.com") throw Error("需要已配置的官方 DeepSeek API");
    await window.studioAgent.configure({endpoint:s.endpoint,model:s.model,thinking:s.thinking,sharePreview:true,stream:true});
    return {model:s.model,thinking:s.thinking};
  });
  console.log("Configured provider",profileInfo);
  const calls=[];
  await app.evaluate(()=>{
    const fetch=globalThis.fetch;
    globalThis.fetch=async (url,options)=>{
      const response=await fetch(url,options);
      if (String(url).startsWith("https://api.deepseek.com/") && String(url).endsWith("/chat/completions")) {
        const input=JSON.parse(options.body);
        process.stdout.write("FS_AGENT_QA "+JSON.stringify({
          status:response.status,stream:response.headers.get("content-type")?.includes("text/event-stream") ?? false,
          image:input.messages.some(m=>Array.isArray(m.content) && m.content.some(p=>p.type==="image_url")),
        })+"\n");
      }
      return response;
    };
  });
  const stdout=createInterface({input:app.process().stdout});
  stdout.on("line",line=>{
    if (!line.startsWith("FS_AGENT_QA ")) return;
    const summary=JSON.parse(line.slice(12));
    calls.push(summary);console.log(summary);
  });
  if (visionCheck) {
    const result=await page.evaluate(async()=>{
      const settings=await window.studioAgent.settings();
      await window.studioAgent.configure({...settings,sharePreview:false});
      const canvas=document.createElement("canvas");
      canvas.width=canvas.height=200;
      const ctx=canvas.getContext("2d");
      ctx.fillStyle="#ffffff";ctx.fillRect(0,0,200,200);
      ctx.fillStyle="#ff0000";ctx.fillRect(30,30,140,140);
      const reply=await window.studioAgent.complete([{role:"user",content:[
        {type:"text",text:"Synthetic vision test: what color is the large square? Answer only with its English color name."},
        {type:"image_url",image_url:{url:canvas.toDataURL("image/jpeg"),detail:"low"}},
      ]}],crypto.randomUUID());
      return reply.content;
    });
    assert.match(result,/red/i);
    assert.ok(calls.some(c=>c.status===200 && c.image));
    console.log("PASS: real DeepSeek reads an explicit image with canvas sharing disabled");
  } else if (streamCheck) {
    const result=await page.evaluate(async()=>{
      const messages=[{role:"user",content:"Synthetic integration test. First call graph_context to read the sample canvas. Then reply only with the width you receive."}];
      const updates=[];
      const unsubscribe=window.studioAgent.onProgress(e=>updates.push({
        id:e.requestId,thinking:!!e.reasoning,text:!!e.text,tools:e.tools,
      }));
      try {
        const firstId=crypto.randomUUID(), secondId=crypto.randomUUID();
        const first=await window.studioAgent.complete(messages,firstId);
        if (!first.tool_calls?.some(c=>c.function.name==="graph_context")) throw Error("Provider returned no expected graph_context call");
        messages.push(first,...first.tool_calls.map(c=>({role:"tool",tool_call_id:c.id,content:JSON.stringify({width:640,height:360})})));
        const final=await window.studioAgent.complete(messages,secondId);
        messages.push(final,{role:"user",content:"Confirm by replying with ACK only."});
        const followUp=await window.studioAgent.complete(messages,crypto.randomUUID());
        return {
          tools:first.tool_calls.map(c=>c.function.name),
          receivedThinking:updates.some(u=>u.id===firstId && u.thinking),
          receivedText:updates.some(u=>u.id===secondId && u.text),
          progress:updates.length, width:final.content?.includes("640"),followUp:followUp.content?.includes("ACK"),
        };
      } finally {unsubscribe();}
    });
    assert.equal(result.width,true);
    assert.equal(result.followUp,true);
    assert.equal(result.receivedText,true);
    if (profileInfo.thinking) assert.equal(result.receivedThinking,true);
    assert.ok(calls.some(c=>c.status===200 && c.stream));
    console.log("PASS: real DeepSeek SSE, reasoning updates, tool assembly and follow-up",result);
  } else {
  await page.getByRole("button",{name:"Agent",exact:true}).click();
  const agent=page.getByRole("region",{name:"FrameStudio Agent"});
  const input=agent.getByRole("textbox",{name:"给 Agent 的消息"});
  async function turn(prompt) {
    await input.fill(prompt);
    await agent.getByRole("button",{name:"发送给 Agent"}).click();
    await agent.getByRole("button",{name:"停止 Agent"}).waitFor();
    await agent.getByRole("button",{name:"停止 Agent"}).waitFor({state:"hidden",timeout:360000});
    const alerts=await agent.getByRole("alert").allTextContents();
    assert.deepEqual(alerts,[]);
  }
  await turn("这是隔离的合成测试场景。请先读取场景与布局和时间线技能，然后用工具把画布改成 720×480，创建一层名为 QA Title 的白色文字，内容准确写成 FRAMESTUDIO，关闭文字自身入场动画，设置位置 Y=-60，写入 0 秒 0.2、1 秒 1 的不透明度关键帧，再加一盏暖色点光。保持透明底。最后调用 editor_render 预览 1 秒处并说明结果。保留为草稿。");
  const draft=await page.evaluate(()=>window.theater.displayScene);
  assert.equal(draft.width,720);assert.equal(draft.height,480);
  const title=draft.layers.find(l=>l.name==="QA Title");
  assert.equal(title.text.value,"FRAMESTUDIO");
  assert.equal(title.transform.y,-60);
  assert.deepEqual(title.animation.opacity.map(({t,v})=>[t,v]),[[0,.2],[1,1]]);
  assert.ok(draft.layers.some(l=>l.kind==="light"));
  assert.equal(await page.evaluate(()=>window.theater.scene.layers.length),0);
  await turn("延续当前草稿，用工具把 QA Title 的位置 Y 精确改到 -40，其他内容保留。检查后简短回复。");
  assert.equal(await page.evaluate(id=>window.theater.displayScene.layers.find(l=>l.id===id).transform.y,title.id),-40);
  await agent.getByRole("button",{name:"应用草稿"}).click();
  assert.equal(await page.evaluate(id=>window.theater.scene.layers.find(l=>l.id===id).transform.y,title.id),-40);
  assert.ok(await agent.locator(".studio-agent-tool summary").filter({hasText:"编辑草稿"}).count());
  assert.ok(await agent.locator(".studio-agent-tool summary").filter({hasText:"渲染预览"}).count());
  if (profileInfo.model==="deepseek-flash") assert.ok(calls.some(c=>c.image),"DeepSeek must receive the synthetic frame");
  assert.deepEqual(errors,[]);
  console.log("PASS: real DeepSeek design edits, frame review, follow-up, and draft apply");
  }
} finally {
  await app?.close();
  await fs.rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:200});
}
