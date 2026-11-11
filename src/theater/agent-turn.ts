import { agentHistoryBytes, contextLimitError } from "../../backend/agent-limits.mjs";

export type ToolCall = {id:string;type:"function";function:{name:string;arguments:string}};
export type ToolPart = {type:"text";text:string} | {type:"image_url";image_url:{url:string;detail:"low"}};
export type AssistantMessage = {role:"assistant";content:string|null;tool_calls?:ToolCall[];reasoning_content?:string;
  reasoning?:string;reasoning_details?:{text?:string;summary?:string}[]};
export type Message = {role:"user";content:string|ToolPart[]} | AssistantMessage | {role:"tool";content:string|ToolPart[];tool_call_id:string};
export type AgentArtifact = {name:string;mime:string;blob?:Blob;preview?:string};
export type AgentProgress = {requestId:string;text:string;reasoning:string;tools:string[]};
export type ToolProgress = {call:ToolCall;index:number;state:"running"|"done"|"error";result?:string};

const encoder = new TextEncoder();
const userText=(content:string|ToolPart[])=>typeof content==="string" ? content : content.find(p=>p.type==="text")?.text??"";
const historySize = (messages:Message[])=>encoder.encode(JSON.stringify(messages)).length;

function oldToolSummary(message:Extract<Message,{role:"tool"}>) {
  const body=typeof message.content==="string" ? message.content : message.content.find(part=>part.type==="text")?.text ?? "";
  if (body.length<=16000 && typeof message.content==="string") return message;
  return {...message,content:JSON.stringify({
    compacted:true, note:"Older tool result condensed. Inspect the active FrameStudio draft for current values.",
    preview:body.length<=16000 ? body : body.slice(0,8000)+"\n…\n"+body.slice(-8000),
  })};
}

export function prepareAgentHistory(messages:Message[],budget=agentHistoryBytes) {
  if (historySize(messages)<=budget) return messages;
  const latestBatch = messages.reduce((index,m,i)=>m.role==="assistant" && m.tool_calls?.length ? i : index,messages.length);
  let history=messages.map((m,i)=>m.role==="tool" && i<latestBatch ? oldToolSummary(m) : m);
  const removed: string[]=[];
  while (historySize(history)>budget) {
    const next=history.findIndex((m,i)=>i>0 && m.role==="user");
    if (next<0) break;
    const first=history[0];
    if (first?.role==="user") removed.push(userText(first.content).slice(0,600));
    history=history.slice(next);
  }
  let compactedBatch=false;
  while (history.length>2 && historySize(history)>budget) {
    let end=2;
    while (history[end]?.role==="tool") end++;
    if (end>=history.length) break;
    history=[history[0],...history.slice(end)];
    compactedBatch=true;
  }
  const first=history[0];
  if (first?.role==="user" && (removed.length || compactedBatch)) {
    const checkpoint=removed.slice(-5).join("\n");
    const note="[FrameStudio context checkpoint. Some earlier messages were condensed. Re-read the draft if needed.]\n"+
      (checkpoint ? "Earlier user requests:\n"+checkpoint+"\n\n" : "");
    history[0]={...first,content:typeof first.content==="string" ? note+first.content :
      [{type:"text",text:note+userText(first.content)},...first.content.filter(part=>part.type==="image_url")]};
  }
  return historySize(history)<historySize(messages) ? history : messages;
}

function toolOutput(value: unknown, share: boolean): {content:string|ToolPart[];key:string} {
  if (value && typeof value==="object" && "previewImage" in value) {
    const {previewImage,...rest}=value;
    const key=JSON.stringify(rest);
    if (share && typeof previewImage==="string" && previewImage.length<=128000 &&
        /^data:image\/jpeg;base64,[\w+/=]+$/.test(previewImage)) {
      return {key,content:[{type:"text",text:key},{type:"image_url",image_url:{url:previewImage,detail:"low"}}]};
    }
    return {key,content:key};
  }
  const key=JSON.stringify(value ?? null);
  return {key,content:key};
}

export async function runDesignTurn(options:{
  messages:Message[];
  complete:(messages:Message[])=>Promise<AssistantMessage>;
  tool:(name:string,args:unknown,share:boolean,signal:AbortSignal)=>unknown;
  signal:AbortSignal;
  share:()=>boolean;
  onStep:(name?:string)=>void;
  onTool?:(event:ToolProgress)=>void;
  onArtifact?:(artifact:AgentArtifact)=>void;
  onCheckpoint?:(messages:Message[])=>void;
}) {
  const {complete,tool,signal,share,onStep,onTool,onCheckpoint,onArtifact}=options;
  let messages=structuredClone(options.messages);
  const seen=new Map<string,number>();
  let revision=0;
  let toolIndex=0;
  while (!signal.aborted) {
    messages=prepareAgentHistory(messages);
    let reply;
    try { reply=await complete(messages); }
    catch(error) {
      signal.throwIfAborted();
      if (!(error instanceof Error) || !error.message.includes(contextLimitError)) throw error;
      const compacted=prepareAgentHistory(messages,Math.floor(historySize(messages)*.6));
      if (compacted===messages) throw error;
      messages=compacted;
      reply=await complete(messages);
    }
    signal.throwIfAborted();
    messages.push(reply);
    if (!reply.tool_calls?.length) return {reply,messages};
    const signatures:string[]=[];
    for (const call of reply.tool_calls) {
      signal.throwIfAborted();
      const {name,arguments:args}=call.function;
      const index=toolIndex++;
      onStep(name);
      onTool?.({call,index,state:"running"});
      let value;
      try { value=await tool(name,JSON.parse(args),share(),signal); }
      catch(e) { value={error:e instanceof Error ? e.message : String(e)}; }
      signal.throwIfAborted();
      if ((["editor_edit","graph_edit","editor_analyze_audio","editor_shader","editor_light","montage_edit","model_edit"].includes(name)) &&
          value && typeof value==="object" && "revision" in value && typeof value.revision==="number" &&
          value.revision>revision && "status" in value && value.status==="ready") {
        revision=value.revision;
        seen.clear();
      }
      if(value && typeof value==="object" && "artifact" in value){
        const {artifact,...result}=value;
        onArtifact?.(artifact as AgentArtifact);
        value=result;
      }
      const {content,key}=toolOutput(value,share());
      onTool?.({call,index,state:value && typeof value==="object" && "error" in value ? "error" : "done",result:key});
      messages.push({role:"tool",tool_call_id:call.id,content});
      signatures.push(JSON.stringify([name,args,key]));
    }
    onCheckpoint?.(messages.slice());
    const signature=signatures.sort().join("\n");
    const repeat=(seen.get(signature) ?? 0)+1;
    if (repeat>=3) throw Error("Agent 多次重复相同操作，当前草稿已保留。");
    seen.set(signature,repeat);
    onStep();
  }
  signal.throwIfAborted();
  throw Error("已停止");
}
