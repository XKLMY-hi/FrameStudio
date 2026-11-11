import { ipcMain, safeStorage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { designTools, designInstructions } from "../backend/design-tools.mjs";
import { chatCompletionPayload, isDeepSeekEndpoint, supportsAgentVision } from "../backend/agent-provider.mjs";
import { readAgentJson, readAgentResponse } from "../backend/agent-response.mjs";
import { contextLimitError, maxAgentRequestBytes } from "../backend/agent-limits.mjs";

const defaultEndpoint = "https://api.openai.com/v1";

function endpointFor(value) {
  if (typeof value !== "string" || value.length > 500) throw Error("请输入有效的 API 地址");
  let url;
  try { url = new URL(value.trim()); }
  catch { throw Error("请输入有效的 API 地址"); }
  const local = ["localhost","127.0.0.1","[::1]"].includes(url.hostname);
  if (!(url.protocol === "https:" || (url.protocol === "http:" && local)) || url.username || url.password || url.search || url.hash)
    throw Error("API 地址应使用 HTTPS，本机回环可使用 HTTP");
  url.pathname = url.pathname.replace(/\/+$/,"").replace(/\/chat\/completions$/,"");
  return url.href.replace(/\/$/,"");
}

function checkedMessages(messages, vision, sharePreview) {
  if (!Array.isArray(messages) || !messages.length ||
      Buffer.byteLength(JSON.stringify(messages)) > maxAgentRequestBytes) throw Error("对话请求超过 FrameStudio 的 32 MiB 本机上限");
  for (const message of messages) {
    if (!message || !["user","assistant","tool"].includes(message.role)) throw Error("无效的对话消息");
    if (message.content === null || typeof message.content === "string") continue;
    const tool=message.role==="tool", limit=tool ? 128000 : 400000;
    const parts=message.content;
    if (!vision || (tool ? !sharePreview : message.role!=="user") ||
        !Array.isArray(parts) || parts.length<2 || parts.length>(tool ? 2 : 4) ||
        parts[0]?.type!=="text" || typeof parts[0].text!=="string" ||
        parts.slice(1).some(part=>part?.type!=="image_url" || typeof part.image_url?.url!=="string" ||
          part.image_url.url.length>limit || !/^data:image\/jpeg;base64,[\w+/=]+$/.test(part.image_url.url)))
      throw Error("当前模型或设置不允许发送此图片");
  }
  return messages;
}

function unsupportedStreaming({code,message}) {
  return code==="streaming_not_supported" || typeof message==="string" &&
    /(?:stream[^.]{0,50}(?:unsupported|not supported|disabled)|(?:unsupported|not support)[^.]{0,50}stream)/i.test(message);
}

export function installStudioAgent(win, origin, directory) {
  const file = path.join(directory,"agent-config.json");
  const legacy = path.join(directory,"agent-vault.json");
  let running;
  let configQueue = Promise.resolve();
  function configTask(fn) {
    const task=configQueue.then(fn);
    configQueue=task.catch(()=>{});
    return task;
  }
  async function readFile(filename) {
    try { return JSON.parse(await fs.readFile(filename,"utf8")); }
    catch (e) {
      if (e.code !== "ENOENT") throw Error("无法读取本机 Agent 配置");
      return undefined;
    }
  }
  async function write(data) {
    await fs.mkdir(directory,{recursive:true});
    const temp=file+"."+randomUUID()+".tmp";
    try {
      await fs.writeFile(temp,JSON.stringify(data),{mode:0o600});
      await fs.rename(temp,file);
    } finally {
      await fs.rm(temp,{force:true}).catch(()=>{});
    }
  }
  async function read() {
    const plain=await readFile(file);
    if (plain) return plain;
    const prior=await readFile(legacy);
    if (!prior) return {endpoint:defaultEndpoint,model:"",key:null};
    const {secret,...settings}=prior;
    const data={...settings,key:null};
    if (secret) {
      try {
        const {result}=await safeStorage.decryptStringAsync(Buffer.from(secret,"base64"));
        const old=JSON.parse(result);
        if (old.endpoint===settings.endpoint && typeof old.key==="string") data.key=old.key;
      } catch { return data; }
    }
    if (!secret || data.key) await write(data);
    return data;
  }
  const settings = data => ({
    endpoint:data.endpoint,model:data.model,thinking:data.thinking !== false,sharePreview:data.sharePreview === true,
    hasKey:!!data.key,stream:data.stream !== false,
  });
  function handle(method, fn) {
    ipcMain.handle("studio-agent:" + method, (event, ...args) => {
      if (event.sender !== win.webContents || !event.senderFrame ||
          event.senderFrame !== win.webContents.mainFrame || new URL(event.senderFrame.url).origin !== origin)
        throw Error("无效的 Agent 请求来源");
      return fn(...args);
    });
  }
  handle("settings",() => configTask(async () => settings(await read())));
  handle("configure",input => configTask(async () => {
      const endpoint = endpointFor(input?.endpoint);
      const model = typeof input?.model === "string" ? input.model.trim() : "";
      if (!model || model.length > 150) throw Error("请填写模型 ID");
      const prior = await read();
      const key = typeof input?.key === "string" ? input.key.trim() : "";
      if (key.length > 4096 || /[\x00-\x20\x7f]/.test(key)) throw Error("API 密钥格式无效");
      const savedKey = input?.removeKey ? null : key || (endpoint===prior.endpoint ? prior.key : null);
      const data = {endpoint,model,key:savedKey,thinking:input?.thinking !== false,
        stream:typeof input?.stream==="boolean" ? input.stream : prior.stream !== false,
        sharePreview:input?.sharePreview === true && supportsAgentVision(endpoint,model)};
      await write(data);
      if (input?.removeKey) await fs.rm(legacy,{force:true});
      return settings(data);
  }));
  handle("abort",() => { running?.abort(); });
  handle("complete",async (input,requestId) => {
    if (running) throw Error("Agent 正在等待模型响应");
    const controller = new AbortController();
    running = controller;
    let timer,timedOut=false;
    try {
      const data = await configTask(read);
      if (!data.model) throw Error("请先配置 Agent 的 API 地址和模型");
      const endpoint = endpointFor(data.endpoint);
      const messages = checkedMessages(input,supportsAgentVision(endpoint,data.model),data.sharePreview === true);
      const key=typeof data.key==="string" ? data.key : undefined;
      if (!key && !["localhost","127.0.0.1","[::1]"].includes(new URL(endpoint).hostname)) {
        throw Error("请为这个 API 地址填写密钥");
      }
      const thinking = data.thinking !== false;
      const timeout = isDeepSeekEndpoint(endpoint) && thinking ? 180000 : 65000;
      const activity=()=>{
        clearTimeout(timer);
        if (!controller.signal.aborted) timer=setTimeout(()=>{
          timedOut=true;controller.abort();
        },timeout);
      };
      const history = [{role:"system",content:designInstructions},...messages];
      const tools = designTools.map(t=>({type:"function",function:{name:t.name,description:t.description,parameters:t.inputSchema}}));
      const payload=chatCompletionPayload(endpoint,data.model,thinking,history,tools);
      const signal=controller.signal;
      const call=async stream=>{
        try {
          return await fetch(endpoint+"/chat/completions",{
            method:"POST",redirect:"error",signal,
            headers:{"Content-Type":"application/json",...(key ? {Authorization:"Bearer "+key} : {})},
            body:JSON.stringify({...payload,stream}),
          });
        } catch { throw Error(controller.signal.aborted ? "已停止" : "连接 API 失败或超时"); }
      };
      const stream=data.stream !== false;
      activity();
      let response=await call(stream);
      let failure={};
      if (!response.ok) {
        failure=(await readAgentJson(response,activity,64*1024).catch(()=>null))?.error ?? {};
        if (stream && [400,422,501].includes(response.status) && unsupportedStreaming(failure)) {
          activity();
          response=await call(false);
          if (!response.ok) failure=(await readAgentJson(response,activity,64*1024).catch(()=>null))?.error ?? {};
        }
      }
      if (!response.ok) {
        if (response.status===413 || [400,422].includes(response.status) &&
            (failure.code==="context_length_exceeded" ||
              typeof failure.message==="string" && /(?:maximum context length|context (?:length|window) (?:exceeded|is too long)|input is too long)/i.test(failure.message)))
          throw Error(contextLimitError);
        throw Error("API 请求失败（HTTP "+response.status+"）");
      }
      activity();
      return await readAgentResponse(response,key,event=>{
        if (typeof requestId==="string" && /^[\da-f-]{36}$/i.test(requestId) &&
            !controller.signal.aborted && !win.isDestroyed() && !win.webContents.isDestroyed())
          win.webContents.send("studio-agent:progress",{requestId,...event});
      },activity);
    } catch (error) {
      if (timedOut) throw Error("API 连接长时间没有数据，已停止等待");
      throw error;
    } finally {
      clearTimeout(timer);
      if (running === controller) running = undefined;
    }
  });
  win.webContents.once("destroyed",()=>running?.abort());
}
