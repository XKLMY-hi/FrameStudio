import { useSyncExternalStore } from "react";
import { Crosshair, Plus, Trash2 } from "lucide-react";
import { clamp } from "../engine";
import { uid, type Param } from "../types";
import type { ModelControl } from "./schema";

type Point={x:number;y:number};
type Frame={points:Point[];width:number;height:number};
export type PoseInput={
  values:Record<string,number>;
  begin?:()=>void;
  preview:(values:Record<string,number>)=>void;
  commit:(values:Record<string,number>)=>void;
};
export function modelPoseStore() {
  let frame:Frame|undefined,signature="";
  const listeners=new Set<()=>void>();
  return {
    read:()=>frame,
    subscribe:(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};},
    publish:(next?:Frame)=>{
      const key=next ? JSON.stringify(next) : "";
      if (key===signature) return;
      frame=next;signature=key;
      listeners.forEach(listener=>listener());
    },
  };
}
export function modelControls(value:unknown):ModelControl[] {
  if(!Array.isArray(value))return [];
  const ids=new Set<string>();
  return value.slice(0,32).filter((control):control is ModelControl=>{
    if(!control || typeof control.id!=="string" || ids.has(control.id) || typeof control.name!=="string" ||
      !Number.isFinite(control.x) || control.x<0 || control.x>1 ||
      !Number.isFinite(control.y) || control.y<0 || control.y>1 ||
      typeof control.xParam!=="string" || typeof control.yParam!=="string")return false;
    ids.add(control.id);return true;
  });
}
const anchored=(p:Point[],x:number,y:number)=>({
  x:(p[0].x*(1-x)+p[1].x*x)*(1-y)+(p[3].x*(1-x)+p[2].x*x)*y,
  y:(p[0].y*(1-x)+p[1].y*x)*(1-y)+(p[3].y*(1-x)+p[2].y*x)*y,
});
export function ModelPoseControls({store,controls,params,input,place,selected}:{
  store:ReturnType<typeof modelPoseStore>;controls:ModelControl[];params:Param[];
  input?:()=>PoseInput|undefined;place?:(id:string,x:number,y:number)=>void;selected?:string;
}) {
  const frame=useSyncExternalStore(store.subscribe,store.read);
  if(!frame || frame.points.length!==4 || !frame.width || !frame.height)return null;
  const points=frame.points;
  const positions=new Map(controls.map(c=>[c.id,anchored(points,c.x,c.y)]));
  return <div className="model-pose-overlay" aria-label="模型控制点">
    <svg viewBox={"0 0 "+frame.width+" "+frame.height} preserveAspectRatio="none" aria-hidden="true">
      {controls.map(c=>{
        const a=positions.get(c.id),b=c.parentId && positions.get(c.parentId);
        return a && b && <line key={c.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y}/>;
      })}
    </svg>
    {controls.map(c=>{
      const at=positions.get(c.id)!;
      const px=params.find(p=>p.id===c.xParam),py=params.find(p=>p.id===c.yParam && p.id!==px?.id);
      return <button type="button" key={c.id} className={c.id===selected?"selected":""}
        title={(place?"定位 ":"拖动 ")+c.name} aria-label={(place?"定位控制点 ":"拖动控制点 ")+c.name}
        style={{left:at.x/frame.width*100+"%",top:at.y/frame.height*100+"%"}}
        onPointerDown={e=>{
          if(e.button!==0)return;
          const pose=input?.();
          if(!place && (!pose || (!px && !py)))return;
          e.preventDefault();e.stopPropagation();pose?.begin?.();
          const button=e.currentTarget,startX=e.clientX,startY=e.clientY,pointer=e.pointerId;
          const bounds=button.parentElement!.getBoundingClientRect();
          button.setPointerCapture(pointer);
          let values:Record<string,number>={},delta={x:0,y:0};
          const move=(event:PointerEvent)=>{
            if(event.pointerId!==pointer)return;
            const x=event.clientX-startX,y=event.clientY-startY;
            delta={x,y};
            if(place)return;
            values={};
            if(px)values[px.id]=clamp((pose?.values[px.id]??px.default)+x/160*(px.max-px.min),px.min,px.max);
            if(py)values[py.id]=clamp((pose?.values[py.id]??py.default)-y/160*(py.max-py.min),py.min,py.max);
            pose?.preview(values);
          };
          const end=(event:PointerEvent)=>{
            if(event.pointerId!==pointer)return;
            button.removeEventListener("pointermove",move);
            for(const type of ["pointerup","pointercancel","lostpointercapture"] as const)button.removeEventListener(type,end);
            if(event.type!=="pointerup" || Math.hypot(delta.x,delta.y)<2) {pose?.preview({});return;}
            if(place) {
              const x=delta.x*frame.width/Math.max(1,bounds.width),y=delta.y*frame.height/Math.max(1,bounds.height);
              const ux=points[1].x-points[0].x,uy=points[1].y-points[0].y;
              const vx=points[3].x-points[0].x,vy=points[3].y-points[0].y,det=ux*vy-uy*vx;
              if(Math.abs(det)>1e-6)place(c.id,clamp(c.x+(x*vy-y*vx)/det,0,1),clamp(c.y+(ux*y-uy*x)/det,0,1));
            } else pose?.commit(values);
          };
          button.addEventListener("pointermove",move);
          for(const type of ["pointerup","pointercancel","lostpointercapture"] as const)button.addEventListener(type,end);
        }}
      ><Crosshair size={16}/><span>{c.name}</span></button>;
    })}
  </div>;
}

function suggestedControls(params:Param[]) {
  const get=(name:string)=>params.find(p=>p.id.toLowerCase().replaceAll("_","")===name)?.id??"";
  const head:ModelControl={id:uid(),name:"头部",x:.5,y:.23,xParam:get("paramanglex"),yParam:get("paramangley")};
  const body:ModelControl={id:uid(),name:"身体",x:.5,y:.55,xParam:get("parambodyanglex"),yParam:get("parambodyangley")};
  if(body.xParam || body.yParam)head.parentId=body.id;
  return [body,head].filter(c=>c.xParam || c.yParam);
}
export function ModelControlEditor({controls,params,selected,select,change,readOnly}:{
  controls:ModelControl[];params:Param[];selected:string;select:(id:string)=>void;
  change:(controls:ModelControl[])=>void;readOnly:boolean;
}) {
  const active=controls.find(c=>c.id===selected)??controls[0];
  function canLink(candidate:ModelControl) {
    const seen=new Set([active?.id]);
    let parent:ModelControl|undefined=candidate;
    while(parent) {
      if(seen.has(parent.id)) return false;
      seen.add(parent.id);
      parent=controls.find(c=>c.id===parent?.parentId);
    }
    return true;
  }
  function update(patch:Partial<ModelControl>) {if(active)change(controls.map(c=>c.id===active.id?{...c,...patch}:c));}
  return <section className="model-control-editor" aria-label="控制点设置">
    <p className="property-note">绑定现有的 Live2D 参数。拖动画板上的控制点可调整位置，切换到预设动作后可拖动它来记录姿势。</p>
    <div className="shader-actions">
      <button disabled={readOnly||controls.length>=32} onClick={()=>{
        const control={id:uid(),name:"控制点 "+(controls.length+1),x:.5,y:.5,xParam:params[0]?.id??"",yParam:""};
        change([...controls,control]);select(control.id);
      }}><Plus size={14}/> 添加控制点</button>
      {!controls.length && <button disabled={readOnly || !params.some(p=>/^param(?:body)?angle[xy]$/i.test(p.id.replaceAll("_","")))}
        onClick={()=>{const next=suggestedControls(params);change(next);select(next[0]?.id??"");}}>匹配头部和身体</button>}
    </div>
    {!!controls.length && <label className="stack-field">当前控制点<select value={active?.id??""} onChange={e=>select(e.target.value)}>
      {controls.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
    </select></label>}
    {active && <fieldset disabled={readOnly} className="model-control-fields">
      <label className="stack-field">名称<input key={active.id} defaultValue={active.name} maxLength={50}
        onBlur={e=>{const name=e.currentTarget.value.trim();if(name)update({name});else e.currentTarget.value=active.name;}}
        onKeyDown={e=>{if(e.key==="Enter")e.currentTarget.blur();}}/></label>
      {(["xParam","yParam"] as const).map((axis,i)=><label className="stack-field" key={axis}>{i?"竖向参数":"横向参数"}
        <select value={active[axis]} onChange={e=>update({[axis]:e.target.value})}>
          <option value="">未绑定</option>
          {active[axis] && !params.some(p=>p.id===active[axis]) && <option value={active[axis]}>{active[axis]} · 不可用</option>}
          {params.filter(p=>p.id!==active[i?"xParam":"yParam"]).map(p=><option key={p.id} value={p.id}>{p.name} · {p.id}</option>)}
        </select>
      </label>)}
      <label className="stack-field">连线对象<select value={active.parentId??""} onChange={e=>update({parentId:e.target.value||undefined})}>
        <option value="">无</option>{controls.filter(canLink).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>
      <button onClick={()=>change(controls.filter(c=>c.id!==active.id).map(c=>c.parentId===active.id?{...c,parentId:undefined}:c))}>
        <Trash2 size={14}/> 移除控制点
      </button>
    </fieldset>}
  </section>;
}
