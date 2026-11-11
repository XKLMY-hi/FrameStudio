import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { download } from "../api";
import { defaultShape } from "./shape";

const expression={kind:"expression",fill:"none",stroke:"#8f8cff",strokeWidth:2,
  x:["add",50,["mul",40,["cos","t"]]],y:["add",50,["mul",40,["sin",["mul",2,"t"]]]],samples:144,closed:true};
const svg={kind:"svg",svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 5 95 50 50 95 5 50Z" fill="#8f8cff"/></svg>'};
const stringify=(value:unknown)=>JSON.stringify(value,null,2);

export function SceneJsonEditor({kind,value,close,apply}:{
  kind:"shape"|"text";value:unknown;close:()=>void;apply:(value:unknown)=>void;
}) {
  const [json,setJson]=useState(()=>stringify(value));
  const [error,setError]=useState("");
  const file=useRef<HTMLInputElement>(null);
  const title=kind==="shape"?"图形 JSON":"文本动画 JSON";
  return createPortal(<div className="studio-json-backdrop">
    <form role="dialog" aria-modal="true" aria-label={title} className="studio-json-dialog" onSubmit={event=>{
      event.preventDefault();
      try {apply(JSON.parse(json));close();}
      catch(e){setError(e instanceof Error ? e.message : String(e));}
    }} onKeyDown={e=>{if(e.key==="Escape"){e.stopPropagation();close();}}}>
      <h2>{title}</h2>
      {kind==="shape" && <div className="shader-actions">
        <button type="button" onClick={()=>setJson(stringify(defaultShape))}>矩形示例</button>
        <button type="button" onClick={()=>setJson(stringify(expression))}>表达式示例</button>
        <button type="button" onClick={()=>setJson(stringify(svg))}>SVG 示例</button>
      </div>}
      <textarea aria-label={title} spellCheck={false} value={json} onChange={e=>setJson(e.target.value)}/>
      {error && <p role="alert">{error}</p>}
      <div className="shader-actions">
        <input type="file" accept=".json,.svg" hidden ref={file} onChange={async e=>{
          const input=e.currentTarget, source=input.files?.[0];
          input.value="";
          if (!source) return;
          try {
            if(source.size>500000) throw Error("文件超过 500 KB");
            const text=await source.text();
            setJson(kind==="shape" && /\.svg$/i.test(source.name) ? stringify({kind:"svg",svg:text}) : text);
            setError("");
          } catch(err){setError(err instanceof Error ? err.message : String(err));}
        }}/>
        <button type="button" onClick={()=>file.current?.click()}>导入文件</button>
        <button type="button" onClick={()=>download(new Blob([json],{type:"application/json"}),kind==="shape"?"shape.json":"text-animation.fslook.json")}>下载 JSON</button>
        <button type="button" onClick={close}>取消</button>
        <button type="submit">应用</button>
      </div>
    </form>
  </div>,document.body);
}
