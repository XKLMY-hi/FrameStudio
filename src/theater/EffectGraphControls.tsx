import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Diamond, Download, Network, Upload } from "lucide-react";
import { download } from "../api";
import {
  emptyGraph, graphPresets, importEffectGraph,
  legacyGraph, validateEffectGraph, type EffectGraph,
} from "./effect-graph";
import type { ShaderRecipe } from "./stylize";

type Props = {
  kind: EffectGraph["kind"];
  graph?: EffectGraph;
  legacy?: ShaderRecipe;
  onChange: (graph?: EffectGraph) => void;
  onPreview?: (graph?: EffectGraph, output?: string) => void;
  value?: (id: string) => number;
  onValue?: (id: string, value: number, key?: boolean) => void;
  keyed?: (id: string) => boolean;
};
const save = (value: unknown, name: string) =>
  download(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}),name);
const failure = (e: unknown) => e instanceof SyntaxError ? "文件不是有效的 JSON" : (e as Error).message;
const GraphEditor = lazy(() => import("./EffectNodeEditor"));

export function EffectGraphControls(p: Props) {
  const [open,setOpen] = useState(false), [error,setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const presets = useMemo(() => graphPresets(p.kind),[p.kind]);
  function show() {
    setError("");
    try {
      if (!p.graph) p.onChange(validateEffectGraph(p.legacy ? legacyGraph(p.legacy) : emptyGraph(p.kind)));
      setOpen(true);
    } catch (err) { setError(failure(err)); }
  }
  return <section className="effect-graph-controls" aria-label={p.kind === "post" ? "后处理节点" : "文字动效节点"}>
    <h3>{p.kind === "post" ? "后处理节点" : "文字动效节点"}</h3>
    <label className="stack-field">
      节点预设
      <select aria-label="节点预设" value="" onChange={e => {
        const preset = presets[Number(e.target.value)];
        if (preset) p.onChange(structuredClone(preset));
      }}>
        <option value="" disabled>{p.graph?.name ?? "选择预设…"}</option>
        {presets.map((preset,i) => <option key={preset.name} value={i}>{preset.name}</option>)}
      </select>
    </label>
    {Object.entries(p.graph?.parameters ?? {}).map(([id,param]) => {
      const value = p.value?.(id) ?? param.value;
      const change = (value:number) => p.onValue ? p.onValue(id,value) :
        p.onChange({...p.graph!,parameters:{...p.graph!.parameters,[id]:{...param,value}}});
      return <div className="shader-amount" key={id}>
        <label><span>{param.label} <small>{Number(value.toFixed(3))}</small></span>
          <input aria-label={param.label} type="range" min={param.min} max={param.max}
            step={(param.max-param.min)/200 || .01} value={value} onChange={e => change(+e.target.value)} />
        </label>
        {p.onValue && <button className={p.keyed?.(id) ? "active" : ""} title={"记录关键帧 "+param.label}
          onClick={() => p.onValue?.(id,value,true)}><Diamond size={14}/></button>}
      </div>;
    })}
    <div className="shader-actions">
      <button onClick={show}><Network size={14}/> 编辑节点</button>
      <button onClick={() => file.current?.click()}><Upload size={14}/> 导入 JSON</button>
      <button disabled={!p.graph} onClick={() => p.graph && save(p.graph,"FrameStudio.fsfx.json")}><Download size={14}/> 导出 JSON</button>
      {p.graph && <button onClick={() => {p.onChange(undefined);setOpen(false);}}>移除</button>}
    </div>
    <input ref={file} type="file" accept=".json" hidden aria-label="效果配方文件" onChange={async e => {
      const chosen = e.currentTarget.files?.[0];
      e.currentTarget.value = "";
      if (!chosen) return;
      try {
        if (chosen.size > 262144) throw Error("效果配方最多 256 KB");
        p.onChange(importEffectGraph(await chosen.text(),p.kind));setError("");
      } catch (err) { setError(failure(err)); }
    }}/>
    {error && <p role="alert" className="shader-error">{error}</p>}
    {open && p.graph && createPortal(<Suspense fallback={null}><GraphEditor graph={p.graph} change={p.onChange} preview={p.onPreview}
      close={() => setOpen(false)}/></Suspense>,document.body)}
  </section>;
}
