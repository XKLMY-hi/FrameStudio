import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Layers, Pause, Play, Plus, SkipBack, SlidersHorizontal, AudioLines, Maximize2 } from "lucide-react";
import { ProjectCanvases } from "./ProjectCanvases";
import { previewFrameTime } from "./scene-engine";
import { MontageAudio, MontageRenderer } from "./montage-renderer";
import { montageEnd, montageJunctions, snapMontageStart, transitionKinds, type Montage, type MontageClip, type Transition } from "./montage";

const names:Record<Transition["kind"],string>={cut:"硬切",fade:"淡入淡出",wipe:"擦除",slide:"滑动"};
const rowHeight=42;
const seconds=(t:number)=>t.toFixed(2)+" s";
function timecode(seconds: number, fps: number) {
  const frame = Math.round(seconds * fps);
  return [Math.floor(frame / fps / 3600), Math.floor(frame / fps / 60) % 60, Math.floor(frame / fps) % 60, frame % fps]
    .map(value => String(value).padStart(2, "0")).join(":");
}
type Props={
  project:Montage; renderer:MontageRenderer; busy:boolean; draft:boolean; time:number; selected:string;
  select:(id:string)=>void; seek:(time:number)=>void; onTime:(time:number)=>void; playing:boolean; play:(playing:boolean)=>void;
  edit:(edits:unknown)=>void; openGraph:()=>void; open:(id:string)=>void; importCanvas:()=>void; previewError:(error:unknown)=>void;
};

function NumberField({label,value,min,max,step=.01,update}:{
  label:string;value:number;min:number;max:number;step?:number;update:(n:number)=>void;
}) {
  return <label>{label}<input key={value} type="number" aria-label={label} min={min} max={max} step={step}
    defaultValue={Number(value.toFixed(4))} onBlur={e=>{
      const input=e.currentTarget,n=input.valueAsNumber;
      if(Number.isFinite(n) && n!==value) update(Math.max(min,Math.min(max,n)));
      input.value=String(Number(value.toFixed(4)));
    }} onKeyDown={e=>{if(e.key==="Enter") e.currentTarget.blur();}}/></label>;
}

export function MontageWorkspace({project:p,renderer,busy,draft,time,selected,select,seek,onTime,playing,play,edit,openGraph,open,importCanvas,previewError}:Props) {
  const canvas=useRef<HTMLCanvasElement>(null);
  const clock=useRef(time);
  const [position,setPosition]=useState(time);
  const shown=playing ? position : time;
  const audio=useMemo(()=>new MontageAudio(),[]);
  const latest=useRef({p,seek,onTime,play,previewError});
  latest.current={p,seek,onTime,play,previewError};
  const [zoom,setZoom]=useState(86);
  const timelineScroll=useRef<HTMLDivElement>(null);
  const laneLabels=useRef<HTMLDivElement>(null);
  const [snap,setSnap]=useState(true);
  const [junction,setJunction]=useState<{from:string;to:string}>();
  const seam=montageJunctions(p).find(j=>j.a.id===junction?.from && j.b.id===junction.to);
  const [ghost,setGhost]=useState<{id:string;start:number;lane:number}>();
  const selectedClip=p.clips.find(c=>c.id===selected);
  const source=selectedClip && p.canvases.find(c=>c.id===selectedClip.canvasId);
  const end=montageEnd(p), span=Math.max(5,end+2,...p.clips.map(c=>
    c.start-c.trimIn+(p.canvases.find(a=>a.id===c.canvasId)?.scene.duration??c.duration)));
  const pps=Math.min(zoom,40000/span);
  const lanes=Math.min(32,Math.max(3,2+Math.max(0,...p.clips.map(c=>c.lane))));
  const tickStep=Math.max(1,Math.ceil(55/pps));
  function fitTimeline() {
    const scroll=timelineScroll.current,labels=laneLabels.current;
    if (!scroll || !labels) return;
    setZoom(Math.max(12,Math.min(240,(scroll.clientWidth-labels.offsetWidth-1)/span)));
    scroll.scrollLeft=0;
  }
  useEffect(()=>{clock.current=time;setPosition(time);},[time]);
  useEffect(()=>{
    if(!canvas.current || busy) {audio.stop();return;}
    const cv=canvas.current;
    let live=true,raf=0,inFlight=false,last=0,lastPaint=-1;
    const start=performance.now(),base=clock.current;
    function tick(now:number) {
      if(!live) return;
      const {p,play,seek,onTime,previewError}=latest.current, end=montageEnd(p);
      const next=playing ? Math.min(end,base+(now-start)/1000) : clock.current;
      const visibleTime=previewFrameTime(end,p.fps,next);
      if(playing && now-last>42) {
        last=now;clock.current=next;onTime(next);setPosition(next);audio.sync(p,visibleTime);
        if(next>=end) {play(false);seek(next);}
      }
      const frame=Math.floor(visibleTime*Math.min(24,p.fps));
      if(!inFlight && (lastPaint<0 || (playing && frame!==lastPaint))) {
        inFlight=true;lastPaint=frame;
        renderer.render(p,visibleTime,{maxEdge:768,preview:cv,isCurrent:()=>live})
          .catch(error=>{if(live){play(false);previewError(error);}})
          .finally(()=>{inFlight=false;});
      }
      if(playing) raf=requestAnimationFrame(tick);
    }
    tick(start);
    return ()=>{live=false;cancelAnimationFrame(raf);audio.stop();};
  },[p,playing,playing ? undefined : time,renderer,audio,busy]);
  const patch=(values:Partial<MontageClip>)=>{if(selectedClip) edit([{op:"clip",id:selectedClip.id,values}]);};
  const canEdit=!busy && !draft;
  function changeTransition(edge:"enter"|"exit",value:Transition){patch({[edge]:value});}

  return <section className="montage-workspace" aria-label="总时间线工作区">
    <aside className="montage-assets">
      <div className="deck-heading">
        <div><span className="studio-kicker">PROJECT / SOURCE</span><h2>项目画布</h2></div>
        <span className="deck-count">{p.canvases.length}</span>
      </div>
      <ProjectCanvases project={p} current={selectedClip?.canvasId ?? p.activeCanvasId} disabled={!canEdit}
        open={open} importCanvas={importCanvas} edit={edit}/>
    </aside>
    <main className="montage-monitor">
      <header className="deck-monitor-header">
        <span className="deck-monitor-dot" aria-hidden="true"/>
        <strong>总成片</strong><small>{p.width} × {p.height} <span>·</span> {p.fps} FPS</small>
        <button disabled={busy} onClick={openGraph}><SlidersHorizontal size={14}/> 总成片效果</button>
      </header>
      <div className="montage-stage">
        <canvas ref={canvas} aria-label="总成片画布"
          style={{aspectRatio:p.width+"/"+p.height,"--deck-aspect":p.width/p.height} as CSSProperties}/>
      </div>
      <div className="montage-transport">
        <button aria-label="总时间线回到开头" onClick={()=>{play(false);seek(0);}}><SkipBack size={16}/></button>
        <button aria-label={playing?"暂停总时间线":"播放总时间线"} disabled={busy || !end}
          onClick={()=>{if(!playing && shown>=end) seek(0);play(!playing);}}>{playing?<Pause size={16}/>:<Play size={16}/>}</button>
        <output className="deck-timecode" aria-label="总时间线当前时间">{timecode(shown,p.fps)}</output>
        <input aria-label="总时间线播放头" type="range" value={shown} min={0} max={Math.max(1/p.fps,end)} step={1/p.fps}
          onChange={e=>{play(false);seek(+e.target.value);}}/>
        <span className="deck-runtime" title="总时长">{timecode(end,p.fps)}</span>
      </div>
    </main>
    <aside className="montage-properties">
      <div className="deck-heading">
        <div><span className="studio-kicker">EDIT / INSPECTOR</span><h2>{seam ? "接缝转场" : selectedClip ? "片段属性" : "总画布设置"}</h2></div>
        <SlidersHorizontal size={17} aria-hidden="true"/>
      </div>
      <div className={"montage-fields"+(draft?" agent-outline":"")} title={draft?"确认草稿后即可编辑":undefined} inert={!canEdit}>
        {seam ? <div className="montage-seam-picker" role="group" aria-label="接缝转场">
          <p>{p.canvases.find(c=>c.id===seam.a.canvasId)?.scene.name} → {p.canvases.find(c=>c.id===seam.b.canvasId)?.scene.name}</p>
          <strong>接缝位置 · {seconds(seam.at)}</strong>
          <div className="montage-seam-options">
        {transitionKinds.map(kind=><button key={kind} disabled={!canEdit} aria-pressed={(seam.transition?.kind??"cut")===kind}
          onClick={()=>edit([{op:"join",from:seam.a.id,to:seam.b.id,transition:{kind,duration:seam.transition?.duration||.5}}])}>{names[kind]}</button>)}
          </div>
        {seam.transition && <NumberField label="接缝转场时长" value={seam.transition.duration} min={.001} max={60}
          update={duration=>edit([{op:"join",from:seam.a.id,to:seam.b.id,transition:{kind:seam.transition!.kind,duration}}])}/>}
        <button onClick={()=>setJunction(undefined)}>完成</button>
        </div> : selectedClip && source ? <>
          <strong className="deck-selected-source"><Layers size={17}/>{source.scene.name}</strong>
          <div className="deck-field-grid">
          <NumberField label="开始时间" value={selectedClip.start} min={0} max={3600-selectedClip.duration} update={start=>patch({start})}/>
          <NumberField label="源入点" value={selectedClip.trimIn} min={0} max={source.scene.duration-.001}
            update={trimIn=>patch({trimIn,duration:Math.min(selectedClip.duration,source.scene.duration-trimIn)})}/>
          <NumberField label="片段时长" value={selectedClip.duration} min={.001} max={Math.min(source.scene.duration-selectedClip.trimIn,3600-selectedClip.start)} update={duration=>patch({duration})}/>
          <NumberField label="轨道层级" value={selectedClip.lane+1} min={1} max={32} step={1} update={lane=>patch({lane:Math.round(lane)-1})}/>
          <NumberField label="片段不透明度" value={selectedClip.opacity} min={0} max={1} update={opacity=>patch({opacity})}/>
          <NumberField label="片段音量" value={selectedClip.volume} min={0} max={1} update={volume=>patch({volume})}/>
          </div>
          {(["enter","exit"] as const).map(edge=><div key={edge} className="montage-transition">
            <label>{edge==="enter"?"入场":"出场"}<select aria-label={edge==="enter"?"入场转场":"出场转场"} value={selectedClip[edge].kind}
              onChange={e=>changeTransition(edge,{kind:e.target.value as Transition["kind"],duration:selectedClip[edge].duration||.4})}>
              {transitionKinds.map(kind=><option key={kind} value={kind}>{names[kind]}</option>)}
            </select></label>
            {selectedClip[edge].kind!=="cut" && <NumberField label={edge==="enter"?"入场时长":"出场时长"} value={selectedClip[edge].duration}
              min={.001} max={60} update={duration=>changeTransition(edge,{...selectedClip[edge],duration})}/>}
          </div>)}
          <button onClick={()=>open(source.id)}>打开源画布</button>
          <button onClick={()=>{edit([{op:"remove_clip",id:selectedClip.id}]);select("");}}>移除片段</button>
          <button onClick={()=>select("")}>总画布设置</button>
        </> : <>
          <NumberField label="总画布宽度" value={p.width} min={64} max={3840} step={1} update={width=>edit([{op:"settings",values:{width:Math.round(width)}}])}/>
          <NumberField label="总画布高度" value={p.height} min={64} max={3840} step={1} update={height=>edit([{op:"settings",values:{height:Math.round(height)}}])}/>
          <NumberField label="总时间线帧率" value={p.fps} min={1} max={60} step={1} update={fps=>edit([{op:"settings",values:{fps:Math.round(fps)}}])}/>
          <small>高轨道显示在前。双击片段可打开独立画布。</small>
        </>}
      </div>
    </aside>
    <div className="montage-timeline">
      <header className="deck-timeline-header">
        <div className="deck-timeline-title"><AudioLines size={17}/><strong>总时间线</strong><small>{p.clips.length} 个片段</small></div>
        <label title="拖动片段时吸附到相邻边界"><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)}/> 吸附</label>
        <label>缩放 <input aria-label="总时间线缩放" type="range" min={12} max={240} value={zoom} onChange={e=>setZoom(+e.target.value)}/></label>
        <button className="deck-fit-timeline" aria-label="适合总时间线宽度" title="适合总时间线宽度" onClick={fitTimeline}><Maximize2 size={14}/></button>
      </header>
      <div ref={timelineScroll} className="montage-scroll" onWheel={e=>{if(e.altKey)setZoom(v=>Math.max(12,Math.min(240,v-e.deltaY*.12)));}}>
        <div ref={laneLabels} className="montage-lane-labels"><div>轨道</div>{Array.from({length:lanes},(_,i)=><div key={i}>{String(lanes-i).padStart(2,"0")}</div>)}</div>
        <div className="montage-grid" style={{width:Math.ceil(span*pps),height:24+lanes*rowHeight}}>
          <div className="montage-ruler" onPointerDown={e=>{
            play(false);select("");setJunction(undefined);seek((e.clientX-e.currentTarget.getBoundingClientRect().left)/pps);
          }}>
            {Array.from({length:Math.floor(span/tickStep)+1},(_,i)=><span key={i} style={{left:i*tickStep*pps}}>{i*tickStep}s</span>)}
          </div>
          {Array.from({length:lanes},(_,i)=><div key={i} className="montage-lane" style={{top:24+i*rowHeight}}/>)}
          <i className="montage-playhead" style={{left:shown*pps}}/>
          {p.clips.map(c=>{
            const sc=p.canvases.find(x=>x.id===c.canvasId)?.scene;
            const clip=ghost?.id===c.id ? {...c,...ghost} : c;
            const fullStart=Math.max(0,clip.start-clip.trimIn);
            const fullEnd=clip.start-clip.trimIn+(sc?.duration??clip.duration);
            return <div key={c.id} className="montage-clip-group">
              {fullEnd-fullStart>clip.duration+1e-5 && <i className="montage-trimmed-span" style={{left:fullStart*pps,
                width:(fullEnd-fullStart)*pps,top:27+(lanes-1-clip.lane)*rowHeight}}/>}
              <button data-montage-clip={c.id} className={"montage-clip"+(selected===c.id?" selected":"")+
                (shown>=clip.start && shown<clip.start+clip.duration?" at-head":"")+(draft?" agent-outline":"")}
              title={(sc?.name??"")+" · "+seconds(c.start)+" – "+seconds(c.start+c.duration)}
              style={{left:clip.start*pps,top:27+(lanes-1-clip.lane)*rowHeight,width:Math.max(10,clip.duration*pps)}}
              onDoubleClick={()=>{if(canEdit) open(c.canvasId);}}
              onPointerDown={e=>{
                if(e.button!==0) return;
                select(c.id);setJunction(undefined);
                if(!canEdit) return;
                const button=e.currentTarget,x=e.clientX,y=e.clientY;
                button.setPointerCapture(e.pointerId);
                const draft=(event:PointerEvent)=>{
                  const n=Math.round((c.start+(event.clientX-x)/pps)*p.fps)/p.fps;
                  const start=Math.max(0,Math.min(3600-c.duration,n));
                  return {id:c.id,start:snap && !event.altKey ? snapMontageStart(p,c,start,shown,pps) : start,
                    lane:Math.min(lanes-1,Math.max(0,c.lane-Math.round((event.clientY-y)/rowHeight)))};
                };
                const move=(event:PointerEvent)=>{if(event.pointerId===e.pointerId) setGhost(draft(event));};
                const stop=(event:PointerEvent)=>{
                  if(event.pointerId!==e.pointerId) return;
                  button.removeEventListener("pointermove",move);button.removeEventListener("lostpointercapture",stop);
                  button.removeEventListener("pointerup",stop);button.removeEventListener("pointercancel",stop);setGhost(undefined);
                  if(event.type!=="pointerup" || Math.hypot(event.clientX-x,event.clientY-y)<4) return;
                  const {start,lane}=draft(event);edit([{op:"clip",id:c.id,values:{start,lane}}]);
                };
                button.addEventListener("pointermove",move);
                for(const type of ["pointerup","pointercancel","lostpointercapture"] as const) button.addEventListener(type,stop);
              }} onClick={()=>{select(c.id);setJunction(undefined);}}>
              {c.enter.kind!=="cut" && <small>◢ </small>}{sc?.name}{c.exit.kind!=="cut" && <small> ◣</small>}
            </button></div>;
          })}
          {!ghost && montageJunctions(p).map(j=><button key={j.a.id+":"+j.b.id} type="button" className="montage-seam"
            style={{left:j.at*pps,top:44+(lanes-1-j.a.lane)*rowHeight}} aria-label={j.transition?"编辑接缝转场":"添加接缝转场"}
            onClick={()=>setJunction({from:j.a.id,to:j.b.id})} title={j.transition ? names[j.transition.kind] : "添加转场"}>
            {j.transition ? "◈" : <Plus size={12}/>}</button>)}
        </div>
      </div>
    </div>
  </section>;
}
