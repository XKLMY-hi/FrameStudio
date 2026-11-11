import assert from "node:assert/strict";
import { test } from "node:test";
import { readAgentResponse } from "../backend/agent-response.mjs";

const event=(delta:unknown,finish_reason:string|null=null)=>"data: "+JSON.stringify({
  choices:[{index:0,delta,finish_reason}],
})+"\r\n\r\n";
function stream(body:string,chunkSize=7) {
  const bytes=new TextEncoder().encode(body);
  let cursor=0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (cursor>=bytes.length) controller.close();
      else { controller.enqueue(bytes.slice(cursor,cursor+chunkSize));cursor+=chunkSize; }
    },
  }),{headers:{"content-type":"text/event-stream; charset=utf-8"}});
}

test("SSE joins UTF-8 reasoning, answer chunks, and tool fragments by index", async()=>{
  const chunks: string[]=[];
  const result=await readAgentResponse(stream([
    ": keepalive\r\n\r\n",
    event({role:"assistant",reasoning_content:"先看画布。"}),
    event({reasoning_content:"再处理图层。"}),
    event({content:"开始",tool_calls:[{index:1,id:"b",type:"function",function:{name:"editor_ren",arguments:"{\"time\":"}}]}),
    event({content:"编辑",tool_calls:[
      {index:0,id:"a",type:"function",function:{name:"editor_inspect",arguments:"{}"}},
      {index:1,function:{name:"der",arguments:"1}"}},
    ]}),
    event({},"tool_calls"),"data: [DONE]\r\n\r\n",
  ].join("")),undefined,update=>chunks.push(update.reasoning));
  assert.equal(result.content,"开始编辑");
  assert.equal(result.reasoning_content,"先看画布。再处理图层。");
  assert.deepEqual(result.tool_calls?.map(t=>[t.id,t.function.name,JSON.parse(t.function.arguments)]),[
    ["a","editor_inspect",{}],["b","editor_render",{time:1}],
  ]);
  assert.ok(chunks.length>=2);
});

test("JSON fallback renders exposed reasoning and redacts the credential",async()=>{
  const value={choices:[{message:{content:"Result",reasoning:"Use the sk-test-value token",tool_calls:[]}}]};
  const snapshots:string[]=[];
  const result=await readAgentResponse(Response.json(value),"sk-test-value",event=>snapshots.push(event.reasoning));
  assert.equal(result.reasoning,"Use the [redacted] token");
  assert.equal(result.tool_calls,undefined);
  assert.deepEqual(snapshots,["Use the [redacted] token"]);
});

test("an interrupted response and truncated tool arguments do not return a callable message",async()=>{
  const partial=event({tool_calls:[{index:0,function:{arguments:"{"}}]});
  await assert.rejects(readAgentResponse(stream(partial)),/提前结束/);
  await assert.rejects(readAgentResponse(stream(partial+event({},"length"))),/长度上限/);
  await assert.rejects(readAgentResponse(stream(partial+"data: [DONE]\r\n\r\n")),/不完整/);
});

test("long DeepSeek streams exclude event wrappers and keepalives from the content budget", async()=>{
  const delta="思考这一帧的光线。";
  const frame="data: "+JSON.stringify({
    id:"chatcmpl-long",object:"chat.completion.chunk",model:"deepseek-flash",
    obfuscation:"x".repeat(140),choices:[{index:0,delta:{reasoning_content:delta},finish_reason:null}],
  })+"\n\n";
  const wire=(": keep-alive\n\n"+frame).repeat(12000)+event({content:"完成。"},"stop")+"data: [DONE]\n\n";
  assert.ok(Buffer.byteLength(wire)>3*1024*1024);
  let chunks=0;
  const result=await readAgentResponse(stream(wire,16384),undefined,undefined,()=>chunks++);
  assert.equal(result.reasoning_content,delta.repeat(12000));
  assert.equal(result.content,"完成。");
  assert.ok(chunks>1);
});
