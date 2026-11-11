import { maxAgentEventBytes, maxAgentMessageBytes, maxAgentRequestBytes } from "./agent-limits.mjs";

function redactor(key, pending = false) {
  return value => {
    if (!key || typeof value !== "string") return value;
    const safe = value.replaceAll(key, "[redacted]");
    if (pending) {
      for (let count = Math.min(key.length - 1, safe.length); count > 0; count--)
        if (safe.endsWith(key.slice(0,count))) return safe.slice(0,-count);
    }
    return safe;
  };
}

function reasoningText(m) {
  return m.reasoning_content ?? m.reasoning ?? m.reasoning_details?.map?.(detail=>detail?.text ?? detail?.summary ?? "").join("");
}

function completedMessage(m, key) {
  if (!m || typeof m !== "object") throw Error("提供商未返回有效的对话消息");
  const redact = redactor(key);
  const message = {role:"assistant",content:typeof m.content==="string" ? redact(m.content) : null};
  for (const field of ["reasoning_content","reasoning"])
    if (typeof m[field]==="string") message[field]=redact(m[field]);
  if (Array.isArray(m.reasoning_details))
    message.reasoning_details = JSON.parse(JSON.stringify(m.reasoning_details,(_key,value)=>redact(value)));
  if (Array.isArray(m.tool_calls) && m.tool_calls.length) message.tool_calls = m.tool_calls.map(c => {
    if (c?.type!=="function" || typeof c.id!=="string" || !c.id || typeof c.function?.name!=="string" ||
        !c.function.name || typeof c.function?.arguments!=="string")
      throw Error("提供商返回了不完整的工具调用");
    return {id:redact(c.id),type:"function",function:{name:redact(c.function.name),arguments:redact(c.function.arguments)}};
  });
  return message;
}

function snapshot(message,key,pending) {
  const redact = redactor(key,pending);
  return {
    text: typeof message.content==="string" ? redact(message.content) : "",
    reasoning: redact(reasoningText(message) ?? ""),
    tools: message.tool_calls?.map(c=>redact(c.function?.name ?? "")).filter(Boolean) ?? [],
  };
}

export async function readAgentJson(response, onActivity = ()=>{}, limit = maxAgentRequestBytes) {
  let size=0;
  const chunks=[];
  for await (const chunk of response.body) {
    onActivity();
    size+=chunk.byteLength;
    if (size>limit) throw Error("普通响应超过 FrameStudio 的本机接收上限");
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Error("API 返回的内容不是有效的 JSON"); }
}

function checkFinish(choice) {
  if (choice?.finish_reason==="length") throw Error("模型输出达到了本次响应的长度上限");
  if (choice?.finish_reason==="content_filter") throw Error("提供商过滤了本次响应");
}

async function readStream(response,key,publish,onActivity) {
  const utf8=new TextDecoder();
  const tools=new Map();
  const details=new Map();
  const m={content:null,tool_calls:[]};
  let buffer="", data=[], eventBytes=0, messageBytes=0, done=false, finished=false, received=false, lastPublish=0;
  const account = value => {
    messageBytes+=Buffer.byteLength(value);
    if (messageBytes>maxAgentMessageBytes) throw Error("单次模型输出超过 FrameStudio 的 24 MiB 内容上限");
    return value;
  };
  function accept() {
    if (!data.length) return;
    const payload=data.join("\n");
    data=[];
    eventBytes=0;
    if (payload.trim()==="[DONE]") { done=true;return; }
    let event;
    try { event=JSON.parse(payload); }
    catch { throw Error("流式响应包含无效的 JSON"); }
    if (event?.error) throw Error("提供商中断了流式响应");
    const choice=event?.choices?.find(c=>c.index===0 || c.index===undefined);
    if (!choice) return;
    checkFinish(choice);
    if (choice.finish_reason) finished=true;
    const delta=choice.delta;
    if (!delta) return;
    received=true;
    for (const field of ["content","reasoning_content","reasoning"]) {
      if (typeof delta[field]==="string") m[field]=(m[field] ?? "")+account(delta[field]);
    }
    if (Array.isArray(delta.reasoning_details)) {
      for (const [position,detail] of delta.reasoning_details.entries()) {
        if (!detail || typeof detail!=="object") continue;
        account(JSON.stringify(detail));
        const i=detail.index ?? position;
        const prior=details.get(i) ?? {};
        const merged={...prior,...detail};
        for (const field of ["text","summary","data"])
          if (typeof prior[field]==="string" && typeof detail[field]==="string")
            merged[field]=prior[field]+detail[field];
        details.set(i,merged);
      }
      m.reasoning_details=[...details.values()];
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const [position,call] of delta.tool_calls.entries()) {
        const i=call.index ?? position;
        if (!Number.isInteger(i) || i<0) throw Error("工具调用的流式索引无效");
        const tool=tools.get(i) ?? {id:"",type:"function",function:{name:"",arguments:""}};
        if (typeof call.id==="string") tool.id+=account(call.id);
        if (typeof call.type==="string") tool.type=call.type;
        for (const field of ["name","arguments"])
          if (typeof call.function?.[field]==="string") tool.function[field]+=account(call.function[field]);
        tools.set(i,tool);
      }
      m.tool_calls=[...tools].sort(([a],[b])=>a-b).map(([,tool])=>tool);
    }
    if (Date.now()-lastPublish>=(messageBytes>1024*1024 ? 500 : 35)) {
      publish(snapshot(m,key,true));
      lastPublish=Date.now();
    }
  }
  function line(value) {
    if (!value) { accept();return; }
    if (value.startsWith("data:")) {
      const payload=value.slice(5).replace(/^ /,"");
      eventBytes+=Buffer.byteLength(payload)+1;
      if (eventBytes>maxAgentEventBytes) throw Error("单条流式事件超过 FrameStudio 的 8 MiB 接收上限");
      data.push(payload);
    }
  }
  for await (const chunk of response.body) {
    onActivity();
    buffer+=utf8.decode(chunk,{stream:true});
    let end;
    while (!done && (end=buffer.search(/[\r\n]/))>=0) {
      if (buffer[end]==="\r" && end===buffer.length-1) break;
      const skip=buffer[end]==="\r" && buffer[end+1]==="\n" ? 2 : 1;
      line(buffer.slice(0,end));
      buffer=buffer.slice(end+skip);
    }
    if (done) break;
    if (buffer.length>maxAgentEventBytes) throw Error("流式事件缺少换行或内容过长");
  }
  if (!done) {
    buffer+=utf8.decode();
    if (buffer) line(buffer.replace(/\r$/,""));
    accept();
  }
  if ((!done && !finished) || !received) throw Error("流式响应提前结束，请重试");
  return m;
}

export async function readAgentResponse(response,key,publish=()=>{},onActivity=()=>{}) {
  if (!response.body) throw Error("提供商返回了空响应");
  let message;
  if (response.headers.get("content-type")?.toLowerCase().includes("text/event-stream"))
    message=await readStream(response,key,publish,onActivity);
  else {
    const choice=(await readAgentJson(response,onActivity))?.choices?.[0];
    checkFinish(choice);
    message=choice?.message;
  }
  const result=completedMessage(message,key);
  publish(snapshot(result,undefined,false));
  return result;
}
