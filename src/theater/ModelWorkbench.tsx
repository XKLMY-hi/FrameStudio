import { useEffect,useRef,useState,type PointerEvent,type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Asset,Param } from "../types";
import { drawTextureStroke,loadTextureCanvas,saveTexture,textureCatalog,textureUrl,
  type TextureSlot,type TextureStroke } from "./model-edit";
import type { MediaAsset,ModelControl,ModelResource } from "./schema";
import { ModelMotionWorkspace } from "./ModelMotionWorkspace";
import { ModelControlEditor, type PoseInput } from "./ModelPoseControls";

export type ModelWorkbenchTab="look"|"texture"|"motion"|"rig";
type Props={
  resource:ModelResource;assets:MediaAsset[];params:Param[];preprocess:ReactNode;readOnly:boolean;
  tab:ModelWorkbenchTab;selectTab:(tab:ModelWorkbenchTab)=>void;
  board:HTMLElement|null;dock:HTMLElement|null;
  rename:(name:string)=>void;texture:(index:number,asset:MediaAsset)=>void;motion:(asset:Asset)=>void;
  pose:(values:Record<string,number>)=>void;attachPose:(input?:PoseInput)=>void;dockHeight:(height:number)=>void;
  textureDirty:(dirty:boolean)=>void;motionDirty:(dirty:boolean)=>void;
  controls:ModelControl[];selectedControl:string;selectControl:(id:string)=>void;saveControls:(controls:ModelControl[])=>void;
};
export function ModelWorkbench(p:Props) {
  const [opened,setOpened]=useState({texture:false,motion:false});
  const [error,setError]=useState("");
  const fail=(e:unknown)=>setError(e instanceof Error ? e.message : String(e));
  return <section className="model-workbench">
    <label className="stack-field">模型名称<input aria-label="模型名称" key={p.resource.name} defaultValue={p.resource.name} disabled={p.readOnly}
      onBlur={e=>{if(e.currentTarget.value.trim()!==p.resource.name) try{p.rename(e.currentTarget.value);}catch(err){fail(err);}}}
      onKeyDown={e=>{if(e.key==="Enter")e.currentTarget.blur();}}/></label>
    <div className="shader-actions" aria-label="模型工作台">
      {([["look","预处理"],["texture","贴图"],["motion","预设动作"],["rig","模型控制点"]] as const).map(([id,name])=><button key={id}
        aria-pressed={p.tab===id} onClick={()=>{setError("");if(id==="motion"||id==="texture")setOpened(v=>({...v,[id]:true}));p.selectTab(id);}}>{name}</button>)}
    </div>
    {error && <p role="alert">{error}</p>}
    {p.tab==="look" && p.preprocess}
    {p.tab==="rig" && <ModelControlEditor controls={p.controls} params={p.params} selected={p.selectedControl}
      select={p.selectControl} change={p.saveControls} readOnly={p.readOnly}/>}
    {(opened.texture || p.tab==="texture") && <TextureEditor resource={p.resource} assets={p.assets} readOnly={p.readOnly}
      texture={p.texture} board={p.board} active={p.tab==="texture"} fail={fail} dirty={p.textureDirty}/>}
    {(opened.motion || p.tab==="motion") && <ModelMotionWorkspace resource={p.resource} params={p.params}
      readOnly={p.readOnly} active={p.tab==="motion"} dock={p.dock} pose={p.pose} save={p.motion}
      report={fail} attachPose={p.attachPose} height={p.dockHeight} dirty={p.motionDirty}/>}
  </section>;
}
function TextureEditor({resource,assets,readOnly,texture,board,active:shown,fail,dirty}:
  Pick<Props,"resource"|"assets"|"readOnly"|"texture"|"board">&{active:boolean;fail:(e:unknown)=>void;dirty:(value:boolean)=>void}) {
  const [slots,setSlots]=useState<TextureSlot[]>([]);
  const [slot,setSlot]=useState(0),[mode,setMode]=useState<TextureStroke["mode"]|"hand">("brush"),[color,setColor]=useState("#ff8844");
  const [size,setSize]=useState(25),[count,setCount]=useState(0),[ready,setReady]=useState(false),[saving,setSaving]=useState(false);
  useEffect(()=>{dirty(count>0);return ()=>dirty(false);},[count,dirty]);
  const surface=useRef<HTMLCanvasElement>(null),base=useRef<HTMLCanvasElement>(null);
  const stage=useRef<HTMLDivElement>(null);
  const [extent,setExtent]=useState({width:1,height:1});
  const [canvasSize,setCanvasSize]=useState({width:1,height:1});
  const [view,setView]=useState({zoom:1,x:0,y:0});
  const strokes=useRef<TextureStroke[]>([]),redo=useRef<TextureStroke[]>([]),active=useRef<number>(undefined);
  const pan=useRef<{id:number;x:number;y:number;originX:number;originY:number}|undefined>(undefined);
  useEffect(()=>{
    const element=stage.current;
    if(!element||!shown)return;
    const observer=new ResizeObserver(([entry])=>setExtent({width:entry.contentRect.width,height:entry.contentRect.height}));
    observer.observe(element);
    const wheel=(e:WheelEvent)=>{
      e.preventDefault();
      const rect=element.getBoundingClientRect(),x=e.clientX-rect.left-rect.width/2,y=e.clientY-rect.top-rect.height/2;
      setView(v=>{
        const zoom=Math.min(32,Math.max(.12,v.zoom*Math.exp(-e.deltaY*.0015))),ratio=zoom/v.zoom;
        return {zoom,x:x-(x-v.x)*ratio,y:y-(y-v.y)*ratio};
      });
    };
    element.addEventListener("wheel",wheel,{passive:false});
    return ()=>{observer.disconnect();element.removeEventListener("wheel",wheel);};
  },[board,shown]);
  const item=slots.find(s=>s.index===slot),url=item && textureUrl(resource,assets,item);
  useEffect(()=>{
    let live=true;textureCatalog(resource).then(value=>{if(live)setSlots(value);}).catch(e=>{if(live)fail(e);});
    return ()=>{live=false;};
  },[resource.modelId,resource.file]);
  useEffect(()=>{
    if(!url || !board)return;
    let live=true;setReady(false);setCount(0);strokes.current=[];redo.current=[];
    setView({zoom:1,x:0,y:0});
    const original=document.createElement("canvas");
    loadTextureCanvas(url,original).then(()=>{
      const cv=surface.current;
      if(!live||!cv)return;
      base.current=original;cv.width=original.width;cv.height=original.height;
      setCanvasSize({width:cv.width,height:cv.height});
      cv.getContext("2d")!.drawImage(original,0,0);setReady(true);
    }).catch(e=>{if(live)fail(e);});
    return ()=>{live=false;active.current=undefined;};
  },[url,board]);
  function redraw() {
    const cv=surface.current,img=base.current;
    if(!cv||!img)return;
    const ctx=cv.getContext("2d")!;
    ctx.clearRect(0,0,cv.width,cv.height);ctx.drawImage(img,0,0);
    for(const stroke of strokes.current)drawTextureStroke(ctx,stroke);
  }
  function point(e:PointerEvent<HTMLCanvasElement>):[number,number]{
    const r=e.currentTarget.getBoundingClientRect();
    return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];
  }
  const scale=Math.max(.001,Math.min((extent.width-50)/canvasSize.width,(extent.height-50)/canvasSize.height,1))*view.zoom;
  return <div className="model-texture-tools" hidden={!shown}>
    <label className="stack-field">贴图<select aria-label="模型贴图" value={slot} disabled={saving} onChange={e=>{
      if(!count||confirm("当前贴图有未保存笔划。切换贴图会丢弃这些笔划，继续吗？"))setSlot(+e.target.value);
    }}>
      {slots.map(s=><option key={s.index} value={s.index}>{s.index+1} · {s.name}</option>)}
    </select></label>
    <div className="shader-actions">
      <button aria-pressed={mode==="hand"} onClick={()=>setMode("hand")}>抓手</button>
      <button disabled={readOnly} aria-pressed={mode==="brush"} onClick={()=>setMode("brush")}>画笔</button>
      <button disabled={readOnly} aria-pressed={mode==="erase"} onClick={()=>setMode("erase")}>橡皮擦</button>
      <input aria-label="画笔颜色" type="color" value={color} disabled={readOnly} onChange={e=>setColor(e.target.value)}/>
      <input aria-label="画笔大小" type="number" min={1} max={512} value={size} onChange={e=>setSize(Math.max(1,Math.min(512,+e.target.value)))}/>
    </div>
    {board && createPortal(<div className="model-texture-board" hidden={!shown}>
      <header><strong>贴图画板</strong><small>{ready ? canvasSize.width+" × "+canvasSize.height : "读取模型贴图"}</small>
        <button onClick={()=>setView({zoom:1,x:0,y:0})}>适合画板</button>
        <button onClick={()=>setView({zoom:1/Math.max(.001,scale/view.zoom),x:0,y:0})}>100%</button>
        <output aria-label="贴图缩放">{Math.round(scale*100)}%</output>
      </header>
      <div className="texture-board-stage" ref={stage} data-tool={mode}
        onPointerDown={e=>{
          if(e.button!==1 && (e.button!==0 || mode!=="hand"))return;
          e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
          pan.current={id:e.pointerId,x:e.clientX,y:e.clientY,originX:view.x,originY:view.y};
        }}
        onPointerMove={e=>{
          const drag=pan.current;
          if(drag?.id===e.pointerId)setView(v=>({...v,x:drag.originX+e.clientX-drag.x,y:drag.originY+e.clientY-drag.y}));
        }} onLostPointerCapture={()=>{pan.current=undefined;}}>
        <canvas ref={surface} aria-label="贴图画布" hidden={!ready}
          style={{width:canvasSize.width*scale,height:canvasSize.height*scale,
            transform:"translate(-50%,-50%) translate("+view.x+"px,"+view.y+"px)"}}
          onPointerDown={e=>{
            if(!ready||readOnly||saving||mode==="hand"||e.button!==0||active.current!==undefined)return;
            e.currentTarget.setPointerCapture(e.pointerId);active.current=e.pointerId;
            const stroke={mode,color,size,points:[point(e)]};
            strokes.current.push(stroke);redo.current=[];setCount(strokes.current.length);
            drawTextureStroke(e.currentTarget.getContext("2d")!,stroke);
          }} onPointerMove={e=>{
            if(e.pointerId!==active.current)return;
            const stroke=strokes.current.at(-1)!;
            const old=stroke.points.at(-1)!,next=point(e);stroke.points.push(next);
            drawTextureStroke(e.currentTarget.getContext("2d")!,{...stroke,points:[old,next]});
          }} onLostPointerCapture={()=>{active.current=undefined;}}/>
      </div>
      <footer>滚轮缩放 · 中键或抓手平移</footer>
    </div>,board)}
    <div className="shader-actions">
      <button disabled={!count||saving||readOnly} onClick={()=>{redo.current.push(strokes.current.pop()!);setCount(strokes.current.length);redraw();}}>撤销笔划</button>
      <button disabled={!redo.current.length||saving||readOnly} onClick={()=>{strokes.current.push(redo.current.pop()!);setCount(strokes.current.length);redraw();}}>重做笔划</button>
      <button disabled={!count||saving||readOnly} onClick={async()=>{
        setSaving(true);
        try{texture(slot,await saveTexture(surface.current!));}catch(e){fail(e);}finally{setSaving(false);}
      }}>保存贴图副本</button>
    </div>
  </div>;
}
