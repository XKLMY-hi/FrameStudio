import assert from "node:assert/strict";
import { test } from "node:test";
import { chatCompletionPayload, deepseekPreset, isDeepSeekEndpoint } from "../backend/agent-provider.mjs";

const messages = [
  {role:"user",content:"预览泛光"},
  {role:"assistant",content:null,reasoning_content:"plan-a",tool_calls:[{id:"call-a"}]},
  {role:"tool",content:"{}",tool_call_id:"call-a"},
  {role:"assistant",content:"已预览",reasoning_content:"plan-b"},
  {role:"user",content:"减弱泛光"},
];
const tools = [{type:"function",function:{name:"graph_edit"}}];

test("DeepSeek thinking preserves reasoning, assistant text, and tool IDs across user turns", () => {
  const payload = chatCompletionPayload(deepseekPreset.endpoint + "/v1",deepseekPreset.model,true,messages,tools);
  assert.deepEqual(payload.thinking,{type:"enabled"});
  assert.ok(!Object.hasOwn(payload,"tool_choice"));
  assert.deepEqual(payload.messages,[messages[0],{...messages[1],content:""},...messages.slice(2)]);
  assert.equal(messages[1].content,null);
});

test("DeepSeek non-thinking omits reasoning and generic OpenAI-compatible endpoints retain their request format", () => {
  const payload = chatCompletionPayload(deepseekPreset.endpoint,deepseekPreset.model,false,messages,tools);
  assert.deepEqual(payload.thinking,{type:"disabled"});
  assert.ok(payload.messages.every(message=>!Object.hasOwn(message,"reasoning_content")));
  assert.equal(payload.messages[1].content,"");
  assert.equal(payload.messages[2].tool_call_id,"call-a");
  assert.equal(isDeepSeekEndpoint("https://api.deepseek.com.example.org/v1"),false);
  const generic = chatCompletionPayload("https://example.org/v1",deepseekPreset.model,true,messages,tools);
  assert.equal(generic.tool_choice,"auto");
  assert.equal(generic.messages,messages);
  assert.ok(!Object.hasOwn(generic,"thinking"));
});
