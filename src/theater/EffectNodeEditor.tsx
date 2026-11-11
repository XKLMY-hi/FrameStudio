import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Network, X } from "lucide-react";
import { download } from "../api";
import type { Key } from "../types";
import { curveFile, importCurveFile } from "./curve-file";
import { graphNode, graphOps, graphReferenceType, importEffectGraph, opsFor, validateEffectGraph, type EffectGraph, type GraphNode, type GraphOp } from "./effect-graph";
import { shaderBytes,validateCodeShader,type CodeShader } from "../../backend/shader-format.mjs";
import { appendShader } from "./agent-graph";
import stageBloom from "../../examples/stage-bloom.fsglsl.json";

const save = (value: unknown, name: string) =>
  download(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}),name);
const failure = (e: unknown) => e instanceof SyntaxError ? "文件不是有效的 JSON" : (e as Error).message;
const shown = (node: GraphNode) => node.op === "glsl" ? (node.inputs.shader as CodeShader).name : graphOps[node.op].label;
const nodeWidth = 162, rowHeight = 25, headerHeight = 32;
const names: Record<string,string> = {
  image:"图像", top:"上层", bottom:"下层", a:"输入 A", b:"输入 B", amount:"混合", radius:"半径",
  threshold:"阈值", softness:"过渡", color:"颜色", opacity:"透明度", duration:"时长", delay:"间隔",
  progress:"进度", curve:"曲线", x:"横向位移", y:"纵向位移", scale:"起始缩放", angle:"旋转",
  min:"最小",max:"最大",rate:"速度",pass:"效果",stops:"曝光 / EV",amplitude:"幅度",period:"周期",
  value:"控制值",maxShift:"位移上限",program:"像素表达式",shader:"GLSL 程序",
};

export default function GraphEditor({graph,change,preview,close,readOnly=false,readOnlyReason,scopeLabel,targets,target,selectTarget}: {
  graph:EffectGraph; change:(graph:EffectGraph)=>void;
  preview?: (graph?: EffectGraph, output?: string) => void; close:()=>void;
  readOnly?:boolean;readOnlyReason?:string;scopeLabel?:string;targets?:{id:string;name:string;available:boolean}[];target?:string;selectTarget?:(id:string)=>void;
}) {
  const [selection,setSelection] = useState(graph.output.startsWith("@") ? graph.output.slice(1) : graph.nodes[0]?.id);
  const [link,setLink] = useState<string>();
  const [op,setOp] = useState<GraphOp>(opsFor(graph.kind)[0]);
  const [error,setError] = useState("");
  const [json,setJson] = useState<string>();
  const [inspect,setInspect] = useState<string>();
  const [moving,setMoving] = useState<{id:string;x:number;y:number}>();
  const drag = useRef<{id:string; sx:number; sy:number; x:number; y:number}>(undefined);
  const group = useRef<HTMLInputElement>(null);
  const glsl=useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    if (selection) canvas.current?.querySelector('[data-effect-node="'+CSS.escape(selection)+'"]')
      ?.scrollIntoView({block:"nearest",inline:"nearest"});
  },[selection]);
  const onPreview = useRef(preview);
  onPreview.current = preview;
  useEffect(() => {
    const valid = inspect && graphReferenceType(inspect,graph) === (graph.kind==="post" ? "image" : "pose");
    onPreview.current?.(valid ? graph : undefined,valid ? inspect : undefined);
    return () => onPreview.current?.();
  },[graph,inspect]);
  useEffect(() => {
    const handler = (e:KeyboardEvent) => {
      if (e.key === "Escape") {e.preventDefault();e.stopImmediatePropagation();close();}
    };
    window.addEventListener("keydown",handler,true);
    return () => window.removeEventListener("keydown",handler,true);
  },[close]);
  const selected = graph.nodes.find(n => n.id === selection);
  const outputType = graph.kind === "post" ? "image" : "pose";
  const inputSource = graph.kind === "post" ? "$source" : "$identity";
  const references = [inputSource,...graph.nodes.map(n=>"@"+n.id),...Object.keys(graph.parameters).map(id=>"$params."+id)];
  function commit(value: EffectGraph) {
    try {if(readOnly) throw Error("确认草稿后即可编辑节点");change(validateEffectGraph(value));setError("");return true;}
    catch (err) {setError(failure(err));return false;}
  }
  function updateNode(node: GraphNode) {
    return commit({...graph,nodes:graph.nodes.map(n => n.id === node.id ? node : n)});
  }
  function connect(node: GraphNode, key: string, ref: string) {
    if (!ref) return;
    if (updateNode({...node,inputs:{...node.inputs,[key]:ref}})) setLink(undefined);
  }
  function remove(node: GraphNode) {
    const ref = "@"+node.id;
    if (inspect === ref) setInspect(undefined);
    if (link === ref) setLink(undefined);
    commit({...graph,output:graph.output === ref ? inputSource : graph.output,nodes:graph.nodes
      .filter(n=>n.id!==node.id).map(n=>({...n,inputs:Object.fromEntries(Object.entries(n.inputs)
        .map(([key,value])=>[key,value === ref ? graphOps[n.op].inputs[key].value : value]))}))});
  }
  function add() {
    let index = graph.nodes.length+1;
    while (graph.nodes.some(n=>n.id === "node"+index)) index++;
    const node = graphNode("node"+index,op,180+(graph.nodes.length%4)*188,64+Math.floor(graph.nodes.length/4)*176);
    if (commit({...graph,nodes:[...graph.nodes,node]})) setSelection(node.id);
  }
  const position = (node:GraphNode) => moving?.id === node.id ? moving : node;
  function endpoints(ref: string) {
    if (ref === inputSource) return [146,42];
    const owner = graph.nodes.find(n => "@"+n.id === ref);
    if (!owner) return null;
    const {x,y} = position(owner);
    return [x+nodeWidth,y+17];
  }
  function insert(other: EffectGraph) {
    const used = new Set([...graph.nodes.map(n=>n.id),...Object.keys(graph.parameters)]);
    let index = 1;
    while ([...used].some(id => id.startsWith("g"+index+"_"))) index++;
    const prefix = "g"+index+"_";
    const rename = (id:string) => (prefix+id).slice(0,32);
    const map = (ref:unknown) => typeof ref !== "string" ? ref :
      ref === inputSource && graph.kind === "post" ? graph.output :
      ref.startsWith("@") ? "@"+rename(ref.slice(1)) :
      ref.startsWith("$params.") ? "$params."+rename(ref.slice(8)) : ref;
    const y = Math.max(0,...graph.nodes.map(n=>n.y+140))+30;
    const nodes = other.nodes.map(n=>({...n,id:rename(n.id),y:Math.min(4800,n.y+y),
      inputs:Object.fromEntries(Object.entries(n.inputs).map(([key,v])=>[key,map(v)]))})) as GraphNode[];
    let output = map(other.output) as string;
    if (graph.kind === "text" && graph.output !== "$identity") {
      const blend = graphNode(prefix+"combined","combine",630,Math.min(4800,y),{a:graph.output,b:output});
      nodes.push(blend);output="@"+blend.id;
    }
    commit({...graph,nodes:[...graph.nodes,...nodes],output,
      parameters:{...graph.parameters,...Object.fromEntries(Object.entries(other.parameters).map(([id,p])=>[rename(id),p]))}});
  }
  return <section className={"effect-node-editor"+(readOnly?" agent-outline":"")} aria-label="效果节点编辑器">
    <header>
      <strong><Network size={15}/> 节点编辑器</strong>
      {targets && <select aria-label="节点处理范围" value={target} onChange={e=>selectTarget?.(e.target.value)}>
        {targets.map(t=><option key={t.id} value={t.id} disabled={!t.available}>{t.name}</option>)}
      </select>}
      {scopeLabel && <small className="effect-scope" title={scopeLabel}>{scopeLabel}</small>}
      {readOnly && <small>{readOnlyReason ?? "确认草稿后即可编辑"}</small>}
      {graph.kind==="post" && <>
        <button disabled={readOnly} onClick={()=>glsl.current?.click()}>导入 GLSL</button>
        <button disabled={readOnly} onClick={()=>{try{commit(appendShader(graph,validateCodeShader(stageBloom)));}catch(e){setError(failure(e));}}}>暖光泛光</button>
        <input type="file" hidden ref={glsl} accept=".json" aria-label="GLSL 着色器文件" onChange={async e=>{
          const file=e.currentTarget.files?.[0];e.currentTarget.value="";if(!file)return;
          try{if(file.size>shaderBytes)throw Error("着色器超过 64 KiB");
            commit(appendShader(graph,validateCodeShader(JSON.parse(await file.text()))));
          }catch(err){setError(failure(err));}
        }}/>
      </>}
      <input readOnly={readOnly} aria-label="配方名称" key={graph.name} defaultValue={graph.name} maxLength={80} onBlur={e => {
        if (e.target.value !== graph.name) commit({...graph,name:e.target.value});
      }}/>
      <select aria-label="新增节点类型" value={op} onChange={e=>setOp(e.target.value as GraphOp)}>
        {opsFor(graph.kind).map(op=><option key={op} value={op}>{graphOps[op].label}</option>)}
      </select>
      <button disabled={readOnly} onClick={add}>添加节点</button>
      <button disabled={readOnly} onClick={()=>group.current?.click()}>插入节点组</button>
      <input ref={group} hidden type="file" accept=".json" aria-label="节点组文件" onChange={async e=>{
        const file=e.currentTarget.files?.[0];e.currentTarget.value="";
        if (file) try {
          if (file.size > 262144) throw Error("效果配方最多 256 KB");
          insert(importEffectGraph(await file.text(),graph.kind));
        } catch (err) {setError(failure(err));}
      }}/>
      <button aria-pressed={json!==undefined} onClick={()=>setJson(json===undefined ? JSON.stringify(graph,null,2) : undefined)}>JSON</button>
      <button onClick={()=>save(graph,"FrameStudio.fsfx.json")}>保存节点组</button>
      <button aria-label="关闭节点编辑器" onClick={close}><X size={16}/></button>
    </header>
    {error && <div role="alert" className="shader-error">{error}</div>}
    {json !== undefined ? <div className="effect-node-json">
      <textarea aria-label="效果 JSON" value={json} onChange={e=>setJson(e.target.value)} spellCheck={false}/>
      <button onClick={()=>{
        try {if (commit(importEffectGraph(json,graph.kind))) setJson(undefined);}
        catch(err) {setError(failure(err));}
      }}>应用 JSON</button>
    </div> : <div className="effect-node-body">
      <div className="effect-node-scroll">
        <div ref={canvas} className="effect-node-canvas" style={{width:Math.max(840,...graph.nodes.map(n=>position(n).x+210)),
          height:Math.max(310,...graph.nodes.map(n=>position(n).y+headerHeight+Object.keys(n.inputs).length*rowHeight+40))}}>
          <svg aria-hidden="true">
            {graph.nodes.flatMap(node=>Object.keys(graphOps[node.op].inputs).map((key,i)=>{
              const origin=endpoints(String(node.inputs[key]));
              if (!origin) return null;
              const [a,b]=origin,{x,y}=position(node), target=y+headerHeight+(i+.5)*rowHeight;
              const curve=Math.max(36,Math.abs(x-a)*.45);
              return <path key={node.id+key} d={`M ${a} ${b} C ${a+curve} ${b} ${x-curve} ${target} ${x} ${target}`}/>;
            }))}
          </svg>
          <button className="effect-node-source" aria-pressed={link===inputSource} draggable
            onDragStart={e=>e.dataTransfer.setData("text/plain",inputSource)} onClick={()=>setLink(inputSource)}>
            {graph.kind === "post" ? "原始画面" : "原始文字姿态"} ●
          </button>
          {graph.nodes.map(node=><div key={node.id} data-effect-node={node.id} className={"effect-node"+(selected?.id===node.id ? " selected" : "")}
            style={{left:position(node).x,top:position(node).y,width:nodeWidth}} onClick={()=>setSelection(node.id)}>
            <div className="effect-node-title" onPointerDown={e=>{
              if (readOnly || e.button!==0 || (e.target as HTMLElement).closest("button")) return;
              e.currentTarget.setPointerCapture(e.pointerId);setSelection(node.id);
              drag.current={id:node.id,sx:e.clientX,sy:e.clientY,x:node.x,y:node.y};
            }} onPointerMove={e=>{
              const d=drag.current;
              if (d?.id===node.id) setMoving({id:node.id,x:Math.max(0,Math.min(4800,d.x+e.clientX-d.sx)),
                y:Math.max(0,Math.min(4800,d.y+e.clientY-d.sy))});
            }} onPointerUp={()=>{
              if (moving?.id===node.id) updateNode({...node,x:moving.x,y:moving.y});
              drag.current=undefined;setMoving(undefined);
            }} onPointerCancel={()=>{drag.current=undefined;setMoving(undefined);}}>
              <span>{shown(node)}{graph.output==="@"+node.id && " · 输出"}</span>
              <button draggable title={shown(node)+" 输出"} aria-pressed={link==="@"+node.id}
                onDragStart={e=>e.dataTransfer.setData("text/plain","@"+node.id)}
                onClick={()=>setLink("@"+node.id)}>●</button>
            </div>
            {Object.entries(graphOps[node.op].inputs).map(([key,socket])=><button className="effect-node-port"
              key={key} title={"连接 "+(names[key]??key)} disabled={["curve","pass","color","pixel","shader"].includes(socket.type)}
              onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();connect(node,key,e.dataTransfer.getData("text/plain"));}}
              onClick={()=>link && connect(node,key,link)}>
              <span>{typeof node.inputs[key]==="string" && /^[\$@]/.test(String(node.inputs[key])) ? "●" : "○"}</span>
              {names[key]??key}
            </button>)}
          </div>)}
        </div>
      </div>
      <aside className="effect-node-inspector">
        {graph.kind==="text" && <label>作用范围<select value={graph.scope} onChange={e=>commit({...graph,scope:e.target.value as "glyph"|"block"})}>
          <option value="glyph">逐字</option><option value="block">整段</option>
        </select></label>}
        {inspect && <button onClick={()=>setInspect(undefined)}>恢复最终预览</button>}
        {selected ? <>
          <strong>{shown(selected)}</strong>
          <div className="shader-actions">
            {graphOps[selected.op].output===outputType && <>
              <button onClick={()=>commit({...graph,output:"@"+selected.id})}>设为输出</button>
              {preview && <button onClick={()=>setInspect("@"+selected.id)}>中间预览</button>}
            </>}
            <button onClick={()=>remove(selected)}>删除</button>
          </div>
          {Object.entries(graphOps[selected.op].inputs).map(([key,socket])=>{
            const value=selected.inputs[key], ref=typeof value==="string" && /^[\$@]/.test(value);
            const set = (value:GraphNode["inputs"][string])=>updateNode({...selected,inputs:{...selected.inputs,[key]:value}});
            return <div className="effect-node-setting" key={selected.id+key}>
              <label>{names[key]??key}
                {socket.type==="number" && !ref && <input type="number" aria-label={names[key]??key} min={socket.min} max={socket.max}
                  step="any" key={String(value)} defaultValue={Number(value)} onBlur={e=>{if (e.target.value!=="") set(+e.target.value);}}/>}
                {socket.type==="color" && <input type="color" aria-label={names[key]??key} value={String(value)} onChange={e=>set(e.target.value)}/>}
                {socket.type==="pass" && <small>{(value as {op:string}).op} · 在 JSON 中调整</small>}
                {socket.type==="pixel" && <small>在 JSON 中调整位移和 RGBA</small>}
              </label>
              {(["number","image","pose"].includes(socket.type)) && <select aria-label={(names[key]??key)+" 的连线"}
                value={ref ? String(value) : ""} onChange={e=>set(e.target.value||socket.value)}>
                <option value="">使用默认值</option>
                {references.filter(r=>r!=="@"+selected.id && graphReferenceType(r,graph)===socket.type)
                  .map(r=><option key={r} value={r}>{r}</option>)}
              </select>}
              {socket.type==="number" && !ref && <button onClick={()=>{
                const base=(selected.id+"_"+key).slice(0,29);
                let id=base, i=1;
                while (Object.hasOwn(graph.parameters,id)) id=base+ ++i;
                commit({...graph,parameters:{...graph.parameters,[id]:{label:names[key]??key,value:Number(value),min:socket.min!,max:socket.max!}},
                  nodes:graph.nodes.map(n=>n.id===selected.id ? {...n,inputs:{...n.inputs,[key]:"$params."+id}} : n)});
              }}>公开参数</button>}
              {socket.type==="shader" && (() => {
                const shader = value as CodeShader;
                return <div className="stack-field">
                  <label><input type="checkbox" checked={shader.enabled}
                    onChange={e=>set({...shader,enabled:e.target.checked})}/> 启用着色器</label>
                  <small>{shader.passes.length} 道通道 · 在 JSON 中编辑 GLSL</small>
                  {Object.entries(shader.parameters).map(([id,p])=><label key={id}>
                    {p.label}<input type="number" aria-label={p.label} min={p.min} max={p.max} step="any"
                      key={p.value} defaultValue={p.value} onBlur={e=>{
                        const value=e.target.valueAsNumber;
                        if (Number.isFinite(value) && value!==p.value)
                          set({...shader,parameters:{...shader.parameters,[id]:{...p,value}}});
                      }}/>
                  </label>)}
                  <button onClick={()=>save(shader,"FrameStudio.fsglsl.json")}>导出 GLSL</button>
                </div>;
              })()}
              {socket.type==="curve" && <div className="shader-actions">
                <label className="effect-curve-import">导入缓动<input type="file" accept=".json" onChange={async e=>{
                  const file=e.currentTarget.files?.[0];e.currentTarget.value="";
                  if (file) try {
                    if (file.size>524288) throw Error("曲线文件最多 512 KB");
                    const data=importCurveFile(await file.text());
                    if (data.kind!=="ease") throw Error("请导入归一化的缓动预设");
                    set(data.keys);
                  } catch (err) {setError(failure(err));}
                }}/></label>
                <button onClick={()=>save(curveFile("ease",shown(selected),value as Key[]),"FrameStudio.fscurve.json")}>导出缓动</button>
              </div>}
            </div>;
          })}
        </> : <p>添加或选择节点。拖动输出到输入端口连接。</p>}
        {link && <button onClick={()=>setLink(undefined)}>取消连线 {link}</button>}
      </aside>
    </div>}
  </section>;
}
