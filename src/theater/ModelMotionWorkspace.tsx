import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clamp, sampleCurve } from "../engine";
import { download } from "../api";
import type { Asset, Key, Param } from "../types";
import { CurveWorkspace } from "./CurveWorkspace";
import { SceneTimeline } from "./SceneTimeline";
import { editMotion, motionDocument, newMotion, saveMotion } from "./model-edit";
import { emptyScene, layer, type ModelResource, type Scene } from "./schema";
import { readProperty, type Binding } from "./properties";
import { upsertKey } from "./scene-engine";
import type { PoseInput } from "./ModelPoseControls";

const actor="@motion-parameters";
const nothing=()=>{};
export function ModelMotionWorkspace({resource,params,readOnly,active,dock,pose,save,report,attachPose,height,dirty}:{
  resource:ModelResource;params:Param[];readOnly:boolean;active:boolean;dock:HTMLElement|null;
  pose:(values:Record<string,number>)=>void;save:(asset:Asset)=>void;report:(error:unknown)=>void;
  attachPose:(input?:PoseInput)=>void;height:(value:number)=>void;dirty:(value:boolean)=>void;
}) {
  const saved=resource.assets.filter(a=>a.kind==="motion");
  const [draft,setDraft]=useState<Asset>(()=>structuredClone(saved[0]??newMotion()));
  const savedDraft=useRef(draft);
  const undo=useRef<Asset[]>([]),redo=useRef<Asset[]>([]);
  useEffect(()=>{dirty(draft!==savedDraft.current);return ()=>dirty(false);},[draft,dirty]);
  const [time,setTime]=useState(0),[playing,setPlaying]=useState(false),[saving,setSaving]=useState(false);
  const [channel,setChannel]=useState(""),[curve,setCurve]=useState(false),[zoom,setZoom]=useState(150);
  const [snap,setSnap]=useState(true),[autoKey,setAutoKey]=useState(false);
  const [preview,setPreview]=useState<Record<string,number>>({});
  const [work,setWork]=useState<Scene["workArea"]>({start:0,end:Infinity,loop:false});
  const catalog=useMemo(()=>{
    const result=new Map(params.map(param=>[param.id,param]));
    for (const c of draft.curves) if (c.target==="Parameter" && !result.has(c.id)) {
      result.set(c.id,{id:c.id,name:c.id,min:-10000,max:10000,default:c.keys[0]?.v??0,group:"other"});
    }
    return [...result.values()];
  },[params,draft.curves]);
  const bindings=useMemo(()=>({[actor]:catalog}),[catalog]);
  const scene=useMemo(()=>{
    const next=emptyScene(),model=layer("model",resource.name);
    model.id=actor;
    model.model={resourceId:resource.id,physics:false,parameterMap:{},groupOverrides:{},
      baseValues:Object.fromEntries(catalog.map(p=>[p.id,p.default])),keys:draft.curves.filter(c=>c.target==="Parameter"),
      lipOpen:"",lipForm:""};
    next.id=draft.id;next.duration=draft.duration;next.fps=draft.fps;
    const end=Math.min(work.end,draft.duration);
    next.workArea={...work,start:Math.min(work.start,Math.max(0,end-1/draft.fps)),end};
    next.layers=[model];next.tracks=[];
    return next;
  },[resource.id,resource.name,catalog,draft,work]);
  const id=channel || catalog[0]?.id || "";
  const binding={layerId:actor,channel:"param:"+id};
  const values=useMemo(()=>Object.fromEntries(draft.curves.filter(c=>c.target==="Parameter" && c.keys.length)
    .map(c=>[c.id,sampleCurve(c,time)])),[draft.curves,time]);
  useEffect(()=>{
    if(active) pose({...values,...preview});
  },[active,values,preview,pose]);
  useEffect(()=>{
    if(!active) {setPlaying(false);setPreview({});return;}
    return ()=>pose({});
  },[active,pose]);
  useEffect(()=>{
    if(!active || !playing)return;
    let frame=0,last=-Infinity;
    const {start,end,loop}=scene.workArea,from=time,begin=performance.now();
    function tick(now:number) {
      const next=from+(now-begin)/1000;
      if(next>=end && !loop){setTime(end);setPlaying(false);return;}
      if(now-last>=1000/Math.min(30,draft.fps)-1) {
        setTime(next>=end ? start+(next-start)%Math.max(1/draft.fps,end-start) : next);
        last=now;
      }
      frame=requestAnimationFrame(tick);
    }
    frame=requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(frame);
  },[active,playing,scene.workArea.start,scene.workArea.end,scene.workArea.loop,draft.fps]);
  function seek(t:number){setPlaying(false);setPreview({});setTime(clamp(t,0,draft.duration));}
  function choose(a:Asset){
    if(draft!==savedDraft.current && !confirm("当前动作尚未保存。切换动作会丢弃这些改动，继续吗？"))return;
    const next=structuredClone(a);
    seek(0);savedDraft.current=next;setDraft(next);undo.current=[];redo.current=[];
    setWork({start:0,end:Infinity,loop:false});setChannel("");
  }
  function change(next:Asset) {
    undo.current.push(draft);
    if(undo.current.length>60)undo.current.shift();
    redo.current=[];
    setDraft(next);
  }
  function stepHistory(forward:boolean) {
    const from=forward?redo.current:undo.current,to=forward?undo.current:redo.current;
    const next=from.pop();
    if(!next)return;
    to.push(draft);setDraft(next);seek(Math.min(time,next.duration));
  }
  useEffect(()=>{
    if(!active||readOnly)return;
    const onKey=(event:KeyboardEvent)=>{
      if(!(event.ctrlKey||event.metaKey)||event.key.toLowerCase()!=="z"||
        document.querySelector('[aria-modal="true"]')||
        (event.target instanceof HTMLElement && (event.target.closest(".studio-agent") || event.target.isContentEditable ||
          ["INPUT","TEXTAREA","SELECT"].includes(event.target.tagName))))return;
      event.preventDefault();event.stopImmediatePropagation();stepHistory(event.shiftKey);
    };
    window.addEventListener("keydown",onKey,true);
    return ()=>window.removeEventListener("keydown",onKey,true);
  },[active,readOnly,draft,time]);
  function update(patch:unknown) {
    try {change(editMotion(patch,draft,params));} catch(error) {report(error);}
  }
  function write(b:Binding,keys:Key[]) {
    if (readOnly || !b.channel.startsWith("param:")) return;
    update({curves:[{id:b.channel.slice(6),target:"Parameter",keys}]});
    setPreview({});
  }
  function record(next:Record<string,number>) {
    if (readOnly) return;
    const frameTime=clamp(snap ? Math.round(time*draft.fps)/draft.fps : time,0,draft.duration);
    update({curves:Object.entries(next).map(([id,v])=>{
      const data=readProperty(scene,{layerId:actor,channel:"param:"+id},time);
      const keys=structuredClone(data.keys);
      if(!keys.length && frameTime>1/draft.fps) keys.push({t:0,v:data.base,mode:"linear"});
      upsertKey(keys,frameTime,v,draft.fps);
      if (keys.length && keys.at(-1)!.t>draft.duration) keys.at(-1)!.t=draft.duration;
      return {id,target:"Parameter",keys};
    })});
    setPreview({});
  }
  function recordOne(b:Binding) {
    const id=b.channel.slice(6);
    if(id) record({[id]:preview[id]??readProperty(scene,b,time).value});
  }
  function value(b:Binding,v:number) {
    const id=b.channel.slice(6),param=catalog.find(p=>p.id===id);
    if(!param || readOnly || !Number.isFinite(v)) return;
    const bounded=clamp(v,param.min,param.max);
    if(autoKey) record({[id]:bounded});
    else setPreview(current=>({...current,[id]:bounded}));
  }
  useEffect(()=>{
    if(!active || readOnly) return;
    attachPose({values:{...values,...preview},begin:()=>setPlaying(false),preview:setPreview,commit:next=>{
      const first=Object.keys(next)[0];
      if(first)setChannel(first);
      record(next);
    }});
    return ()=>attachPose(undefined);
  },[active,readOnly,values,preview,time,draft,attachPose,snap]);
  function play() {
    if(!playing && time>=scene.workArea.end) setTime(scene.workArea.start);
    setPreview({});setPlaying(!playing);
  }
  const locked=readOnly || saving;
  return <div className="model-motion-editor" hidden={!active}>
    <label className="stack-field">预设<select aria-label="模型预设动作" value={saved.some(a=>a.id===draft.id)?draft.id:""}
      onChange={e=>{const a=saved.find(v=>v.id===e.target.value);if(a)choose(a);}}>
      <option value="" disabled>新动作</option>{saved.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
    </select></label>
    <div className="shader-actions">
      <button disabled={locked} onClick={()=>choose(newMotion())}>新建动作</button>
      <button disabled={locked} onClick={async()=>{
        setPlaying(false);setSaving(true);
        try{const a=await saveMotion(editMotion({name:draft.name},draft,params));save(a);savedDraft.current=a;setDraft(a);}
        catch(error){report(error);}finally{setSaving(false);}
      }}>保存动作</button>
    </div>
    <label className="stack-field">动作名称<input aria-label="动作名称" value={draft.name} disabled={locked}
      onChange={e=>setDraft(a=>({...a,name:e.target.value}))}/></label>
    <label className="stack-field">动作时长（秒）<input aria-label="动作时长" type="number" min={.001} max={3600} step=".1"
      key={draft.id+draft.duration} defaultValue={draft.duration} disabled={locked} onBlur={e=>{
        const duration=e.currentTarget.valueAsNumber;
        try{change(editMotion({duration},draft,params));if(time>duration)seek(duration);}
        catch(error){e.currentTarget.value=String(draft.duration);report(error);}
      }}/></label>
    <label className="stack-field">动作帧率<input type="number" min={1} max={60} key={draft.id+":"+draft.fps}
      defaultValue={draft.fps} disabled={locked} onBlur={e=>{
        try{change(editMotion({fps:e.currentTarget.valueAsNumber},draft,params));}
        catch(error){e.currentTarget.value=String(draft.fps);report(error);}
      }}/></label>
    <label className="stack-field">当前参数<select aria-label="动作参数" value={id} onChange={e=>setChannel(e.target.value)}>
      {catalog.map(p=><option key={p.id} value={p.id}>{p.name} · {p.id}</option>)}
    </select></label>
    <label className="stack-field">关键帧数值<input aria-label="关键帧数值" type="number" step="any" disabled={locked || !id}
      value={Number((preview[id]??readProperty(scene,binding,time).value).toFixed(4))} onChange={e=>value(binding,+e.target.value)}/></label>
    <div className="shader-actions">
      <button disabled={locked||!id} onClick={()=>recordOne(binding)}>记录关键帧</button>
      <button onClick={()=>{try{
        const a=editMotion({name:draft.name},draft,params);
        download(new Blob([JSON.stringify(motionDocument(a),null,2)],{type:"application/json"}),a.name+".motion3.json");
      }catch(error){report(error);}}}>导出 .motion3.json</button>
    </div>
    {dock && active && createPortal(<section className="model-animation-dock" aria-label="Live2D 动作时间线"
      onKeyDown={e=>{if(e.code==="Space" && (e.target as HTMLElement).tagName==="DIV"){e.preventDefault();play();}}} tabIndex={0}>
      <div className="motion-dock-heading"><strong>{draft.name || "未命名动作"}</strong>
        <small>{draft.fps} FPS · {draft.duration.toFixed(2)} s</small>
        <button disabled={locked||!undo.current.length} onClick={()=>stepHistory(false)}>撤销动作编辑</button>
        <button disabled={locked||!redo.current.length} onClick={()=>stepHistory(true)}>重做</button>
        <button onClick={play}>{playing?"暂停动作":"预览动作"}</button>
        <label className="motion-jump">时间
          <input aria-label="动作播放头" type="number" min={0} max={draft.duration} step={1/draft.fps}
            value={Number(time.toFixed(4))} onChange={e=>{if(Number.isFinite(e.target.valueAsNumber))seek(e.target.valueAsNumber);}}/> s
        </label>
      </div>
      <div className="model-motion-dopesheet" hidden={curve} inert={locked}>
        <SceneTimeline parameterOnly visible={!curve} scene={scene} selectedLayerId={actor}
          selectedBinding={binding} paramsByLayer={bindings}
          onSelectLayer={nothing} onBinding={b=>setChannel(b.channel.slice(6))}
          onRecord={recordOne} onValue={value} onWriteKeys={write}
          onHeight={height} time={time} playing={playing} selection={[]} zoom={zoom} snap={snap}
          onSeek={seek} onPlay={play} onChange={s=>setWork(s.workArea)} onSelect={nothing} onDrop={nothing}
          onZoom={setZoom} onSnap={()=>setSnap(v=>!v)} onSplit={nothing} onDuplicate={nothing}
          onDelete={nothing} onMarker={nothing} onCurve={b=>{if(b)setChannel(b.channel.slice(6));setCurve(true);}}
          autoKey={autoKey} onToggleAutoKey={()=>setAutoKey(v=>!v)}/>
      </div>
      {curve && <div className="model-motion-curves" inert={locked}>
        <CurveWorkspace parameterOnly scene={scene} binding={binding} seed={id ? binding : undefined}
          paramsByLayer={bindings} value={value} time={time} snap={snap} autoKey={autoKey}
          toggleAutoKey={()=>setAutoKey(v=>!v)} seek={seek} write={write} record={recordOne} editClip={nothing}
          close={()=>setCurve(false)}/>
      </div>}
    </section>,dock)}
  </div>;
}
