import assert from "node:assert/strict";
import { test } from "node:test";
import { graphOrder } from "../src/theater/effect-graph";
import { shapeSvg, validateShape } from "../src/theater/shape";
import { emptyScene } from "../src/theater/schema";
import { editDesignScene } from "../src/theater/agent-edit";
import { inspectDesignScene } from "../src/theater/agent-inspect";
import { prepareAgentHistory, runDesignTurn, type Message, type AssistantMessage } from "../src/theater/agent-turn";
import { contextLimitError } from "../backend/agent-limits.mjs";

test("design edits combine canvas, layout, lighting, timeline, and a GLSL graph in one draft", () => {
  const base=emptyScene();
  const shader={format:"framestudio-glsl",version:1,name:"Warm",passes:[{id:"mainPass",source:"vec4 shade(vec2 uv){return source(uv);}"}]};
  const r=editDesignScene(base,[
    {op:"canvas",values:{width:800,height:450,duration:5,fps:24}},
    {op:"add_layer",kind:"group",name:"Titles",as:"group"},
    {op:"add_layer",kind:"text",name:"Title",as:"title",parentId:"$group"},
    {op:"text",id:"$title",values:{value:"FrameStudio",animation:"none"}},
    {op:"transform",id:"$title",values:{y:-90}},
    {op:"keyframes",layerId:"$title",channel:"opacity",keys:[{t:0,v:0,mode:"linear"},{t:1,v:1,mode:"bezier"}]},
    {op:"add_layer",kind:"light",name:"Fill",as:"fill"},
    {op:"light",id:"$fill",values:{type:"area",color:"#ffca95",targets:["$title"]}},
    {op:"camera",values:{zoom:1.1,dof:true}},
    {op:"graph",id:"output",edits:[{op:"add",id:"warm",type:"glsl",inputs:{shader}},{op:"output",value:"@warm"}]},
  ]);
  const {scene,created}=r;
  assert.equal(base.layers.length,0);
  assert.equal(scene.workArea.end,5);
  const title=scene.layers.find(l=>l.id===created.title)!;
  assert.equal(title.parentId,created.group);
  assert.equal(title.text?.value,"FrameStudio");
  assert.equal(title.transform.y,-90);
  assert.equal(title.animation.opacity.length,2);
  assert.equal(scene.layers.find(l=>l.id===created.fill)!.light?.targets[0],title.id);
  assert.equal(scene.outputGraph?.output,"@warm");
  const rewired=editDesignScene(scene,[{op:"graph",id:"output",edits:[
    {op:"add",id:"dim",type:"exposure",inputs:{image:"@warm",stops:-1}},
    {op:"output",value:"@dim"},
  ]}]).scene;
  assert.equal(rewired.outputGraph?.output,"@dim");
  const details=inspectDesignScene(scene,{section:"assets"},0,"",()=>[]);
  assert.ok(!JSON.stringify(details).includes("models/"));
  assert.throws(()=>editDesignScene(scene,[{op:"transform",id:title.id,values:{x:600}},{op:"parent",id:created.group,parentId:title.id}]),/循环/);
  assert.equal(scene.layers.find(l=>l.id===title.id)!.transform.x,0);
});

test("audio timeline edits bind cues explicitly and keyframes respect ownership", () => {
  const base=emptyScene();
  base.models.push({id:"resource",name:"Actor",file:"test.model3.json",modelId:"test",assets:[]});
  base.assets.push({id:"dialogue",name:"Dialogue",kind:"audio",path:"audio/private.wav",duration:5});
  const r=editDesignScene(base,[
    {op:"add_layer",kind:"model",assetId:"resource",as:"actor"},
    {op:"add_layer",kind:"audio",assetId:"dialogue",createClip:false,as:"audio"},
    {op:"add_clip",kind:"audio",layerId:"$audio",as:"line",values:{start:1,duration:3,lipTarget:"$actor",lipEnabled:true,fadeIn:.2}},
    {op:"keyframes",layerId:"$audio",clipId:"$line",channel:"gain",keys:[{t:0,v:.2,mode:"linear"},{t:3,v:1,mode:"linear"}]},
  ]);
  const clip=r.scene.tracks.flatMap(t=>t.clips).find(c=>c.id===r.created.line)!;
  assert.equal(clip.lipTarget,r.created.actor);
  assert.equal(clip.gainKeys.length,2);
  assert.throws(()=>editDesignScene(r.scene,[{op:"keyframes",layerId:r.created.actor,clipId:clip.id,channel:"gain",keys:[]}]),/对应的音频/);
  assert.ok(!JSON.stringify(inspectDesignScene(r.scene,{section:"assets"},0,"",()=>[])).includes("audio/private.wav"));
});

test("tool runner continues beyond seven rounds and eighty history entries", async () => {
  let requests=0;
  const result=await runDesignTurn({
    messages:[{role:"user",content:"Continue a multi-step design"}],
    complete:async messages=>{
      requests++;
      if (requests===48) {
        assert.ok(messages.length>80);
        return {role:"assistant",content:"finished"};
      }
      return {role:"assistant",content:null,reasoning_content:"r"+requests,tool_calls:[
        {id:"c"+requests,type:"function",function:{name:"editor_edit",arguments:JSON.stringify({step:requests})}},
      ]};
    },
    tool:()=>({status:"ready",revision:requests}),
    signal:new AbortController().signal,share:()=>false,onStep:()=>{},
  });
  assert.equal(result.reply.content,"finished");
  assert.equal(requests,48);
});

test("the tool runner stops identical failed batches and sends frames only when enabled", async () => {
  let tries=0;
  const toolReply=(id:string,name:string):AssistantMessage=>({role:"assistant",content:null,tool_calls:[{
    id,type:"function",function:{name,arguments:"{}"},
  }]});
  await assert.rejects(runDesignTurn({
    messages:[{role:"user",content:"Edit"}],
    complete:async()=>toolReply("c"+ ++tries,"editor_edit"),
    tool:()=>{throw Error("locked");},
    signal:new AbortController().signal,share:()=>false,onStep:()=>{},
  }),/重复相同操作/);
  assert.equal(tries,3);
  for (const share of [false,true]) {
    let received:Message|undefined;
    await runDesignTurn({
      messages:[{role:"user",content:"Render"}],
      complete:async messages=>{
        if (messages.length===1) return toolReply("render","editor_render");
        received=messages.at(-1);
        return {role:"assistant",content:"done"};
      },
      tool:()=>({status:"ready",previewImage:"data:image/jpeg;base64,AAAA"}),
      signal:new AbortController().signal,share:()=>share,onStep:()=>{},
    });
    assert.equal(Array.isArray(received?.content),share);
    if (!share) assert.ok(!JSON.stringify(received).includes("AAAA"));
  }
});

test("context pressure preserves the current reasoning and complete tool exchange", async()=>{
  const older={role:"tool" as const,tool_call_id:"old",content:"x".repeat(30000)};
  const latest={role:"tool" as const,tool_call_id:"latest",content:"{\"revision\":4}"};
  const assistant=(id:string):AssistantMessage=>({role:"assistant",content:null,reasoning_content:"reasoning:"+id,
    tool_calls:[{id,type:"function",function:{name:"editor_inspect",arguments:"{}"}}]});
  const messages:Message[]=[{role:"user",content:"Keep the model on the left"},assistant("old"),older,assistant("latest"),latest];
  const pruned=prepareAgentHistory(messages,20000);
  assert.notEqual(pruned[2],older);
  assert.deepEqual(pruned.slice(-2),messages.slice(-2));
  assert.equal(older.content.length,30000);
  let requests=0;
  const turn=await runDesignTurn({
    messages,complete:async history=>{
      if (++requests===1) throw Error(contextLimitError);
      assert.deepEqual(history.slice(-2),messages.slice(-2));
      assert.ok(JSON.stringify(history).length<JSON.stringify(messages).length);
      return {role:"assistant",content:"ok"};
    },
    tool:()=>({}),signal:new AbortController().signal,share:()=>false,onStep:()=>{},
  });
  assert.equal(turn.reply.content,"ok");
  assert.equal(requests,2);
});

test("a later network failure preserves completed tool results as a turn checkpoint",async()=>{
  let checkpoint:Message[]|undefined;
  let count=0;
  await assert.rejects(runDesignTurn({
    messages:[{role:"user",content:"Change the canvas"}],
    complete:async()=>{
      if (count++) throw Error("network down");
      return {role:"assistant",content:null,reasoning_content:"make a draft",tool_calls:[
        {id:"t",type:"function",function:{name:"editor_edit",arguments:"{}"}},
      ]};
    },
    tool:()=>({status:"ready",revision:1}),signal:new AbortController().signal,share:()=>false,onStep:()=>{},
    onCheckpoint:messages=>{checkpoint=messages;},
  }),/network down/);
  assert.equal(checkpoint?.at(-1)?.role,"tool");
  assert.equal(checkpoint?.length,3);
});

test("detached agent GLSL becomes output without discarding the prior chain", () => {
  const shader={format:"framestudio-glsl",version:1,name:"Tint",passes:[{id:"tint",source:"vec4 shade(vec2 uv){return source(uv);}"}]};
  const first=editDesignScene(emptyScene(),[{op:"shader",id:"output",shader}]).scene;
  const next=editDesignScene(first,[{op:"graph",id:"output",edits:[{op:"add",id:"newTint",type:"glsl",inputs:{shader}}]}]).scene;
  assert.equal(next.outputGraph!.output,"@newTint");
  assert.equal(next.outputGraph!.nodes.find(n=>n.id==="newTint")?.inputs.image,first.outputGraph!.output);
  assert.equal(graphOrder(next.outputGraph!).length,2);
});

test("expression geometry generates a bounded SVG and selected key edits preserve neighbors", () => {
  const shape=validateShape({kind:"expression",fill:"none",stroke:"#aabbcc",strokeWidth:2,closed:false,samples:8,
    x:["add",50,["mul",40,["cos","t"]]],y:["add",50,["mul",40,["sin","t"]]]});
  assert.match(shapeSvg(shape),/M90.000,50.000/);
  assert.throws(()=>validateShape({...shape,y:["div",1,0]}),/无效坐标/);
  const created=editDesignScene(emptyScene(),[{op:"add_layer",kind:"shape",shape,as:"shape"},
    {op:"keyframes",layerId:"$shape",channel:"x",keys:[{t:0,v:1,mode:"linear"},{t:1,v:12,mode:"linear"}]}]);
  const result=editDesignScene(created.scene,[{op:"curve_key",layerId:created.created.shape,channel:"x",index:1,value:20,localTime:1.5}]).scene;
  assert.deepEqual(result.layers[0].animation.x.map(k=>[k.t,k.v]),[[0,1],[1.5,20]]);
});
