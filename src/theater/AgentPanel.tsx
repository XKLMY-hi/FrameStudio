import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bot, ChevronDown, Download, Paperclip, Send, Settings2, Square, X } from "lucide-react";
import { deepseekPreset, isDeepSeekEndpoint, supportsAgentVision } from "../../backend/agent-provider.mjs";
import { download } from "../api";
import { AgentReferenceEditor, loadReference, maxReferenceImages, type ReferenceImage } from "./AgentReference";
import { runDesignTurn, type AgentArtifact, type Message, type AssistantMessage, type AgentProgress, type ToolProgress } from "./agent-turn";

export type AgentSettings = { endpoint: string; model: string; thinking: boolean; sharePreview: boolean; hasKey: boolean; stream:boolean };
export type DesktopAgent = {
  settings: () => Promise<AgentSettings>;
  configure: (config:{endpoint:string;model:string;thinking:boolean;sharePreview:boolean;stream?:boolean;key?:string;removeKey?:boolean}) => Promise<AgentSettings>;
  complete: (messages: Message[], requestId?:string) => Promise<AssistantMessage>;
  onProgress: (listener:(event:AgentProgress)=>void) => ()=>void;
  abort: () => Promise<void>;
};
declare global { interface Window { studioAgent?: DesktopAgent } }

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
  .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
type Visible =
  | {id:string;role:"user";text:string;references?:ReferenceImage[]}
  | {id:string;role:"artifact";artifact:AgentArtifact}
  | {id:string;role:"assistant";text:string;reasoning:string;tools:string[]}
  | {id:string;role:"tool";name:string;args:string;state:ToolProgress["state"]|"stopped";result?:string};
function toolLabel(name:string) {
  return ({
    editor_skill:"加载设计技能",editor_inspect:"读取工程",editor_edit:"编辑草稿",
    editor_view:"调整工作区",editor_render:"渲染预览",editor_analyze_audio:"分析口型",
    model_inspect:"读取模型工作台",model_edit:"编辑模型素材",
    montage_inspect:"读取总时间线",montage_edit:"编排总时间线",montage_view:"调整总预览",montage_render:"渲染总成片",
    editor_shader:"写入 GLSL 节点",editor_light:"添加场景灯光",editor_deliver:"交付文件",
    graph_context:"读取后处理目标",graph_read:"读取节点图",graph_edit:"编辑节点图",
  } as Record<string,string>)[name] ?? name;
}
const snippet = (text:string) => text.length>4000 ? text.slice(0,4000)+"\n…" : text;
type DraftAction = { draft?: {name:string;target?:string}; openGraph: (target:string)=>void; apply:()=>void; discard:()=>void };

export function AgentPanel({ documentId, activeDocument, runTool, onTurnActive, settingsHost, onSettings, closeSettings, mcp, draft, draftScope, context, openGraph, apply, discard }: DraftAction & {
  context: {label:string;instructions:string};
  draftScope?: string;
  onTurnActive: (active: boolean) => void;
  settingsHost:HTMLElement|null;onSettings:()=>void;closeSettings:()=>void;mcp:ReactNode;
  documentId: () => string;
  activeDocument: string;
  runTool: (name:string,args:unknown,share:boolean,signal:AbortSignal) => unknown;
}) {
  const desktop = window.studioAgent;
  const [open,setOpen] = useState(false);
  const [settings,setSettings] = useState<AgentSettings>();
  const [connections,setConnections] = useState(false);
  const [endpoint,setEndpoint] = useState("");
  const [model,setModel] = useState("");
  const [thinking,setThinking] = useState(true);
  const [sharePreview,setSharePreview] = useState(false);
  const [stream,setStream] = useState(true);
  const [key,setKey] = useState("");
  const [prompt,setPrompt] = useState("");
  const [references,setReferences] = useState<ReferenceImage[]>([]);
  const [annotating,setAnnotating] = useState<number>();
  const [loadingImages,setLoadingImages] = useState(false);
  const referenceInput=useRef<HTMLInputElement>(null);
  const vision=!!settings && supportsAgentVision(settings.endpoint,settings.model);
  const [visible,setVisible] = useState<Visible[]>([]);
  const [busy,setBusy] = useState(false);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState("");
  const [phase,setPhase] = useState("");
  const transcript = useRef<Message[]>([]);
  const generation = useRef(0);
  const activeTurn = useRef<AbortController | undefined>(undefined);
  const tail = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const latest = useRef({ documentId,runTool,onTurnActive });
  latest.current = { documentId,runTool,onTurnActive };
  function updateVisible(row:Visible) {
    setVisible(previous=>previous.some(item=>item.id===row.id)
      ? previous.map(item=>item.id===row.id ? row : item) : [...previous,row]);
  }
  useEffect(() => { if (open && follow.current) tail.current?.scrollIntoView({block:"nearest"}); },[visible,busy,open]);
  useEffect(() => {
    generation.current++;
    activeTurn.current?.abort();
    latest.current.onTurnActive(false);
    void desktop?.abort().catch(()=>{});
    transcript.current=[];
    setVisible([]);setReferences([]);setAnnotating(undefined);setBusy(false);setPhase("");setError("");
  },[activeDocument]);

  function loadSettings(show: boolean) {
    if (!desktop) return;
    void desktop.settings().then(s=>{
      setSettings(s);setEndpoint(s.endpoint);setModel(s.model);setThinking(s.thinking);setSharePreview(s.sharePreview);
      setStream(s.stream !== false);
      if (show) onSettings();
    }).catch(e=>setError(errorMessage(e)));
  }
  useEffect(()=>{if(settingsHost) loadSettings(false);else setKey("");},[settingsHost]);

  async function store(removeKey = false) {
    if (!desktop) return;
    setSaving(true);setError("");
    try {
      const s=await desktop.configure({endpoint,model,thinking,sharePreview,stream,key:removeKey ? "" : key,removeKey});
      if (settings?.endpoint !== s.endpoint || settings?.model !== s.model ||
          (isDeepSeekEndpoint(s.endpoint) && settings?.thinking !== s.thinking) ||
          settings?.sharePreview !== s.sharePreview || key.trim() || removeKey) {
        transcript.current=[];
        setVisible([]);setReferences([]);
      }
      setSettings(s);setEndpoint(s.endpoint);setModel(s.model);setThinking(s.thinking);setSharePreview(s.sharePreview);
      setStream(s.stream !== false);setKey("");closeSettings();
    } catch (e) { setError(errorMessage(e)); }
    finally { setSaving(false); }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const text=prompt.trim();
    if ((!text && !references.length) || busy || !desktop || loadingImages) return;
    let configured=settings;
    if(!configured?.model) {
      try {
        configured=await desktop.settings();
        if(!configured.model){onSettings();return;}
        setSettings(configured);
      } catch(error) {setError(errorMessage(error));return;}
    }
    const turn=++generation.current, document=latest.current.documentId();
    const current = () => turn===generation.current && document===latest.current.documentId();
    const controller = new AbortController();
    activeTurn.current=controller;
    follow.current=true;
    // Keep complete prior turns. A failed or stopped turn never leaves unmatched tool calls in history.
    if(references.length && !supportsAgentVision(configured.endpoint,configured.model)) {setError("当前模型不支持参考图");return;}
    const description=text || "请查看我附上的参考图。";
    const scopedDescription="[FrameStudio 发送时的编辑上下文] "+context.instructions+"\n\n"+description;
    const messages: Message[] = [...transcript.current,{role:"user",content:references.length ? [
      {type:"text",text:scopedDescription},
      ...references.map(image=>({type:"image_url" as const,image_url:{url:image.url,detail:"low" as const}})),
    ] : scopedDescription}];
    updateVisible({id:crypto.randomUUID(),role:"user",text:description,references});
    latest.current.onTurnActive(true);
    setReferences([]);setPrompt("");setBusy(true);setError("");setPhase("等待模型响应");
    try {
      const result=await runDesignTurn({messages,complete:async history=>{
        const requestId=crypto.randomUUID();
        let shown=false;
        const show=(progress:AgentProgress)=>{
          if (current() && (shown || progress.text || progress.reasoning || progress.tools.length)) {
            shown=true;
            updateVisible({id:requestId,role:"assistant",text:progress.text,reasoning:progress.reasoning,tools:progress.tools});
          }
        };
        const unsubscribe=desktop.onProgress(progress=>{
          if (progress.requestId===requestId) show(progress);
        });
        try {
          const reply=await desktop.complete(history,requestId);
          show({requestId,text:reply.content ?? "",reasoning:reply.reasoning_content ?? reply.reasoning ??
            reply.reasoning_details?.map(detail=>detail.text ?? detail.summary ?? "").join("") ?? "",
            tools:[]});
          return reply;
        } finally { unsubscribe(); }
      },
        tool:(name,args,share,signal)=>{
          if (!current()) throw Error("工程已变更");
          return latest.current.runTool(name,args,share,signal);
        },
        signal:controller.signal,share:()=>configured.sharePreview,
        onArtifact:artifact=>{if(current()) updateVisible({id:crypto.randomUUID(),role:"artifact",artifact});},
        onCheckpoint:history=>{ if (current()) transcript.current=history; },
        onTool:({call,index,state,result})=>{
          if (current()) updateVisible({id:turn+":"+index,role:"tool",name:call.function.name,
            args:snippet(call.function.arguments),state,result:result===undefined ? undefined : snippet(result)});
        },
        onStep:name=>setPhase(name ? ({
          editor_edit:"正在试渲染场景编辑",graph_edit:"正在检查节点连线",editor_render:"正在渲染画布",
          editor_analyze_audio:"正在分析口型",
        } as Record<string,string>)[name] ?? "正在读取工程" : "等待模型响应")});
      if (!current()) return;
      if (!result.reply.content?.trim())
        updateVisible({id:crypto.randomUUID(),role:"assistant",text:"模型结束了本轮操作。请查看当前画布与草稿。",reasoning:"",tools:[]});
      transcript.current=result.messages;
    } catch(e) {
      if (current()) {
        setError(errorMessage(e));
        setVisible(rows=>rows.map(row=>row.role==="assistant" && row.tools.length ? {...row,tools:[]} : row));
      }
    } finally {
      if (activeTurn.current===controller) activeTurn.current=undefined;
      if (turn===generation.current) { latest.current.onTurnActive(false);setBusy(false);setPhase(""); }
    }
  }

  const settingsForm=desktop ? (<form className="studio-agent-config" onSubmit={e=>{e.preventDefault();void store();}}>
      <div className="shader-actions">
        <button type="button" onClick={()=>{
          if (endpoint !== deepseekPreset.endpoint) setKey("");
          setEndpoint(deepseekPreset.endpoint);setModel(deepseekPreset.model);setThinking(true);
        }}>使用 DeepSeek 预设</button>
      </div>
      <label>API 地址<input aria-label="Agent API 地址" value={endpoint} onChange={e=>setEndpoint(e.target.value)} required/></label>
      <label>模型 ID<input aria-label="Agent 模型 ID" value={model} list={isDeepSeekEndpoint(endpoint) ? "studio-deepseek-models" : undefined}
        placeholder="服务商提供的模型名称" onChange={e=>setModel(e.target.value)} required/></label>
      {isDeepSeekEndpoint(endpoint) && <>
        <datalist id="studio-deepseek-models">{deepseekPreset.models.map(name=><option key={name} value={name}/>)}</datalist>
        <label className="studio-agent-option">
          <input type="checkbox" checked={thinking} onChange={e=>setThinking(e.target.checked)}/> 深度思考
        </label>
      </>}
      {supportsAgentVision(endpoint,model) && <label className="studio-agent-option">
        <input type="checkbox" checked={sharePreview} onChange={e=>setSharePreview(e.target.checked)}/>
        允许将成片预览发送给模型
      </label>}
      <label className="studio-agent-option">
        <input type="checkbox" checked={stream} onChange={e=>setStream(e.target.checked)}/> 流式输出
      </label>
      <label>API 密钥<input aria-label="Agent API 密钥" type="password" autoComplete="new-password" value={key}
        placeholder={settings?.hasKey && settings.endpoint === endpoint ? "已保存，留空保留" : "输入服务商密钥"} onChange={e=>setKey(e.target.value)}/></label>
      <small>密钥以明文保存在本机 Agent 配置中。更换 API 地址后请填写对应的密钥。</small>
      <div className="shader-actions">
        <button type="submit" disabled={saving}>保存设置</button>
        {settings?.hasKey && <button type="button" disabled={saving} onClick={()=>void store(true)}>清除密钥</button>}
        <button type="button" onClick={()=>{closeSettings();setKey("");}}><X size={14}/> 取消</button>
      </div>

    </form>) : <p>桌面版提供 API 与 MCP 设置。</p>;
  return <>{settingsHost && createPortal(<>{settingsForm}{error && <p role="alert">{error}</p>}</>,settingsHost)}
    {createPortal(open ? <section className="studio-agent" aria-label="FrameStudio Agent">
    <header>
      <strong><Bot size={18}/> Agent</strong>
      <button type="button" aria-label="新建 Agent 对话" disabled={busy} onClick={()=>{
        transcript.current=[];setVisible([]);setError("");
      }}>新对话</button>
      <button type="button" aria-pressed={connections} onClick={()=>setConnections(v=>!v)}>MCP</button>
      <button type="button" aria-label="Agent 设置" disabled={busy} onClick={onSettings}><Settings2 size={16}/></button>
      <button type="button" aria-label="收起 Agent" onClick={()=>{setOpen(false);setKey("");}}><ChevronDown size={18}/></button>
    </header>
    <small className="agent-scope" title={context.label}>当前范围 · {context.label}</small>
    {connections && mcp}
    {!desktop ? <p className="studio-agent-note">内置 Agent 需要 FrameStudio 桌面版。</p> :
    <>

      <div className="studio-agent-messages" onScroll={e=>{
        const el=e.currentTarget;
        follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<48;
      }}>
        {!visible.length && <p className="studio-agent-note">描述想要的画面或动画，Agent 会调整场景和时间线，并把结果预览为草稿。</p>}
        {visible.map(m=>m.role==="user" ? <div className="studio-agent-message user" key={m.id}>{m.text}
            {!!m.references?.length && <div className="studio-agent-images">{m.references.map((img,i)=><img key={i} src={img.url} alt={img.name}/>)}</div>}
          </div> : m.role==="artifact" ? <div className="studio-agent-artifact" key={m.id}>
            {m.artifact.preview && <img src={m.artifact.preview} alt={m.artifact.name}/>}
            <button onClick={async ()=>{
              const file=m.artifact.blob ?? (m.artifact.preview ? await (await fetch(m.artifact.preview)).blob() : undefined);
              if(file) download(file,m.artifact.name);
            }}><Download size={14}/> {m.artifact.name}</button>
          </div> :
          m.role==="assistant" ? <div className="studio-agent-answer" key={m.id}>
            {m.reasoning && <details className="studio-agent-trace" open>
              <summary>模型思考</summary><div className="studio-agent-reasoning">{m.reasoning}</div>
            </details>}
            {m.text && <p className="studio-agent-message assistant">{m.text}</p>}
            {!!m.tools.length && <small>正在生成工具调用 · {m.tools.map(toolLabel).join("、")}</small>}
          </div> : <details className="studio-agent-trace studio-agent-tool" key={m.id}>
            <summary>{toolLabel(m.name)} <small>{{running:"执行中",done:"已完成",error:"失败",stopped:"已停止"}[m.state]}</small></summary>
            <div><code>{m.name}</code><pre>{m.args}</pre>{m.result!==undefined && <pre>{m.result}</pre>}</div>
          </details>)}
        {busy && <small role="status">{phase}…</small>}
        <div ref={tail}/>
      </div>
      {draft && <div className="studio-agent-draft">
        <span title={draft.name}>草稿待确认{draftScope && <small className="agent-draft-scope">{draftScope}</small>}</span>
        <div className="shader-actions">
          {draft.target && <button type="button" onClick={()=>{
            setOpen(false);
            openGraph(draft.target!);
          }}>查看节点</button>}
          <button type="button" disabled={busy} onClick={()=>{try { apply(); } catch(e) { setError(errorMessage(e)); }}}>应用草稿</button>
          <button type="button" disabled={busy} onClick={discard}>丢弃</button>
        </div>
      </div>}
      {!!references.length && <div className="studio-agent-images studio-agent-attachments">
        {references.map((image,i)=><div key={i}>
          <button aria-label={"标注 "+image.name} onClick={()=>setAnnotating(i)}><img src={image.url} alt={image.name}/></button>
          <button aria-label={"移除 "+image.name} onClick={()=>setReferences(list=>list.filter((_,index)=>index!==i))}><X size={12}/></button>
        </div>)}
        {annotating!==undefined && references[annotating] && <AgentReferenceEditor image={references[annotating]}
          close={()=>setAnnotating(undefined)} apply={image=>{
            setReferences(list=>list.map((item,i)=>i===annotating ? image : item));setAnnotating(undefined);
          }}/>}
      </div>}
      <form className="studio-agent-compose" onSubmit={send}>
        <input type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp" ref={referenceInput}
          onChange={async e=>{
            const input=e.currentTarget,files=Array.from(input.files??[]).slice(0,maxReferenceImages-references.length);
            input.value="";
            if(!files.length) return;
            const conversation=generation.current;
            setLoadingImages(true);setError("");
            try {
              const images=await Promise.all(files.map(loadReference));
              if(conversation===generation.current) setReferences(list=>[...list,...images].slice(0,maxReferenceImages));
            }
            catch(err){if(conversation===generation.current) setError(errorMessage(err));}
            finally {setLoadingImages(false);}
          }}/>
        <button type="button" aria-label="添加参考图" title={vision ? "添加参考图并发送给视觉模型" : "当前模型不支持图片输入"}
          disabled={busy || !vision || loadingImages || references.length>=maxReferenceImages} onClick={()=>referenceInput.current?.click()}><Paperclip size={16}/></button>
        <textarea aria-label="给 Agent 的消息" value={prompt} rows={2} maxLength={6000} placeholder="例如：给选中模型加柔和的暖色泛光"
          onChange={e=>setPrompt(e.target.value)}
          onKeyDown={e=>{
            if (e.key==="Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}/>
        {busy ? <button type="button" aria-label="停止 Agent" onClick={()=>{
          generation.current++;activeTurn.current?.abort();latest.current.onTurnActive(false);void desktop?.abort().catch(()=>{});setBusy(false);setPhase("");
          setVisible(rows=>rows.map(row=>row.role==="tool" && row.state==="running" ? {...row,state:"stopped"} :
            row.role==="assistant" && row.tools.length ? {...row,tools:[]} : row));
        }}><Square size={15}/></button> : <button type="submit" aria-label="发送给 Agent" disabled={loadingImages || (!prompt.trim() && !references.length)}><Send size={16}/></button>}
      </form>
    </>}
    {error && <p className="studio-agent-error" role="alert">{error}</p>}
  </section> : <button className="studio-agent-launch" type="button" onClick={()=>{setOpen(true);if (!settings) loadSettings(false);}}>
    <Bot size={17}/> Agent {busy ? "…" : ""}
  </button>,document.body)}</>;
}
