import { produce } from "immer";
import { clamp } from "../engine";
import { uid } from "../types";
import { emptyScene, migrateScene, type Scene } from "./schema";
import { collectAudio,previewFrameTime } from "./scene-engine";
import { validateEffectGraph, type EffectGraph } from "./effect-graph";

export const transitionKinds = ["cut", "fade", "wipe", "slide"] as const;
export type Transition = {kind:typeof transitionKinds[number]; duration:number};
export type MontageClip = {
  id:string;canvasId:string;start:number;trimIn:number;duration:number;lane:number;
  opacity:number;volume:number;enter:Transition;exit:Transition;
};
export type MontageJoin = Transition & {from:string;to:string};
export type Montage = {
  format:"framestudio-montage";version:1;id:string;name:string;
  width:number;height:number;fps:number;activeCanvasId:string;
  canvases:{id:string;scene:Scene}[];clips:MontageClip[];joins?:MontageJoin[];outputGraph?:EffectGraph;
};
export const isMontage = (value:unknown):value is Montage =>
  !!value && typeof value==="object" && (value as Montage).format==="framestudio-montage" && (value as Montage).version===1;
export const montageEnd = (p:Montage) => Math.max(0,...p.clips.map(c=>c.start+c.duration));
const cut = ():Transition => ({kind:"cut",duration:0});
export function emptyMontage(scene:Scene):Montage {
  const id=uid();
  return {format:"framestudio-montage",version:1,id:uid(),name:scene.name,width:scene.width,height:scene.height,
    fps:scene.fps,activeCanvasId:id,canvases:[{id,scene}],clips:[montageClip(id,scene.duration,0)]};
}
export function montageClip(canvasId:string,duration:number,start:number,lane=0):MontageClip {
  return {id:uid(),canvasId,start,trimIn:0,duration,lane,opacity:1,volume:1,enter:cut(),exit:cut()};
}
function number(value:unknown,min:number,max:number,name:string,whole=false):number {
  if(typeof value!=="number" || !Number.isFinite(value) || value<min || value>max || (whole && !Number.isInteger(value)))
    throw Error(name+"超出范围");
  return value;
}
const record=(value:unknown)=>{
  if(!value || typeof value!=="object" || Array.isArray(value)) throw Error("需要 JSON 对象");
  return value as Record<string,unknown>;
};
function transition(value:unknown):Transition {
  const v=record(value), kind=v.kind as Transition["kind"];
  if(!transitionKinds.includes(kind)) throw Error("未知转场类型");
  return {kind,duration:kind==="cut" ? 0 : number(v.duration,.001,60,"转场时长")};
}
export function boundMontageClip(clip:MontageClip,scene:Scene) {
  clip.trimIn=clamp(clip.trimIn,0,Math.max(0,scene.duration-.001));
  clip.duration=clamp(clip.duration,.001,Math.max(.001,scene.duration-clip.trimIn));
}
function checkClip(c:MontageClip,p:Montage) {
  const source=p.canvases.find(v=>v.id===c.canvasId);
  if(!source) throw Error("片段关联的画布不存在");
  number(c.start,0,3599.999,"片段起点");
  number(c.trimIn,0,source.scene.duration,"源入点");
  number(c.duration,.001,Math.min(source.scene.duration-c.trimIn,3600-c.start)+1e-7,"片段时长");
  number(c.lane,0,31,"轨道",true);
  number(c.opacity,0,1,"不透明度");
  number(c.volume,0,1,"音量");
  c.enter=transition(c.enter);c.exit=transition(c.exit);
}
export function loadMontage(input:Montage) {
  if(!Array.isArray(input.canvases) || !input.canvases.length || input.canvases.length>120 ||
     !Array.isArray(input.clips) || input.clips.length>600) throw Error("总时间线工程结构无效");
  const p={...input,canvases:input.canvases.map(c=>({...c,scene:migrateScene(c.scene)})),clips:input.clips.map(c=>({...c}))};
  if(new Set(p.canvases.map(c=>c.id)).size!==p.canvases.length || new Set(p.clips.map(c=>c.id)).size!==p.clips.length)
    throw Error("画布或片段 ID 重复");
  number(p.width,64,3840,"总画布宽度",true);number(p.height,64,3840,"总画布高度",true);number(p.fps,1,60,"总时间线帧率",true);
  for(const clip of p.clips) checkClip(clip,p);
  p.joins=Array.isArray(p.joins) ? p.joins.filter(j=>joined(p,j.from,j.to)).map(j=>({...transition(j),from:j.from,to:j.to})) : [];
  if(p.outputGraph) {
    p.outputGraph=validateEffectGraph(p.outputGraph);
    if(p.outputGraph.kind!=="post") throw Error("总画布需要图像后处理图");
  }
  if(!p.canvases.some(c=>c.id===p.activeCanvasId)) p.activeCanvasId=p.canvases[0].id;
  return p;
}
export function withMontageCanvas(p:Montage,id:string,scene:Scene) {
  const source=p.canvases.find(c=>c.id===id);
  if(!source || source.scene===scene) return p;
  return produce(p,d=>{
    d.canvases.find(c=>c.id===id)!.scene=scene;
    if(scene.duration!==source.scene.duration)
      for(const clip of d.clips) if(clip.canvasId===id) boundMontageClip(clip,scene);
    if(d.joins?.length) d.joins=d.joins.filter(j=>joined(d,j.from,j.to));
  });
}
export function editMontage(base:Montage, edits:unknown) {
  if(!Array.isArray(edits) || !edits.length || edits.length>40) throw Error("每批需要 1–40 项总时间线操作");
  const created:Record<string,string>=Object.create(null);
  const resolve=(value:unknown)=>typeof value==="string" && value.startsWith("$") ? created[value.slice(1)] : value;
  function alias(name:unknown,id:string) {
    if(name===undefined) return;
    if(typeof name!=="string" || !/^[a-zA-Z][\w-]{0,30}$/.test(name) || Object.hasOwn(created,name)) throw Error("别名无效或重复");
    created[name]=id;
  }
  const name=(v:unknown)=>{if(typeof v!=="string" || !v.trim() || v.length>150) throw Error("名称无效");return v;};
  const montage=produce(base,p=>{
    for(const input of edits) {
      const e=record(input),id=resolve(e.id);
      if(e.op==="settings") {
        const v=record(e.values);
        if(v.name!==undefined) p.name=name(v.name);
        if(v.width!==undefined) p.width=number(v.width,64,3840,"总画布宽度",true);
        if(v.height!==undefined) p.height=number(v.height,64,3840,"总画布高度",true);
        if(v.fps!==undefined) p.fps=number(v.fps,1,60,"总时间线帧率",true);
      } else if(e.op==="add_canvas") {
        if(p.canvases.length>=120) throw Error("画布已达上限");
        const scene=emptyScene();
        scene.width=p.width;scene.height=p.height;scene.fps=p.fps;
        scene.name=e.name===undefined ? "画布 "+(p.canvases.length+1) : name(e.name);
        if(e.duration!==undefined) scene.workArea.end=scene.duration=number(e.duration,.001,3600,"画布时长");
        const id=uid();p.canvases.push({id,scene});alias(e.as,id);
      } else if(e.op==="remove_canvas") {
        if(p.canvases.length===1) throw Error("总工程至少保留一张画布");
        if(!p.canvases.some(c=>c.id===id)) throw Error("找不到画布");
        p.canvases=p.canvases.filter(c=>c.id!==id);
        p.clips=p.clips.filter(c=>c.canvasId!==id);
        if(p.activeCanvasId===id) p.activeCanvasId=p.canvases[0].id;
      } else if(e.op==="add_clip" || e.op==="clip") {
        const canvasId=resolve(e.canvasId);
        const source=p.canvases.find(c=>c.id===canvasId);
        const v=e.values===undefined ? {} : record(e.values);
        let c=p.clips.find(c=>c.id===id);
        if(e.op==="add_clip") {
          if(!source || p.clips.length>=600) throw Error("找不到画布或片段已达上限");
          c=montageClip(source.id,source.scene.duration,montageEnd(p));
        }
        if(!c) throw Error("找不到时间线片段");
        if(v.start!==undefined) c.start=number(v.start,0,3599.999,"片段起点");
        if(v.trimIn!==undefined) c.trimIn=number(v.trimIn,0,3600,"源入点");
        if(v.duration!==undefined) c.duration=number(v.duration,.001,3600,"片段时长");
        if(v.lane!==undefined) c.lane=number(v.lane,0,31,"轨道",true);
        if(v.opacity!==undefined) c.opacity=number(v.opacity,0,1,"不透明度");
        if(v.volume!==undefined) c.volume=number(v.volume,0,1,"音量");
        if(v.enter!==undefined) c.enter=transition(v.enter);
        if(v.exit!==undefined) c.exit=transition(v.exit);
        if(e.op==="add_clip" && v.duration===undefined && source)
          c.duration=Math.min(source.scene.duration-c.trimIn,3600-c.start);
        checkClip(c,p);
        if(e.op==="add_clip") {p.clips.push(c);alias(e.as,c.id);}
      } else if(e.op==="remove_clip") {
        if(!p.clips.some(c=>c.id===id)) throw Error("找不到时间线片段");
        p.clips=p.clips.filter(c=>c.id!==id);
      } else if(e.op==="join") {
        const from=resolve(e.from),to=resolve(e.to),v=transition(e.transition);
        if(typeof from!=="string" || typeof to!=="string" || !joined(p,from,to)) throw Error("请选择同一轨道上相接的两个片段");
        p.joins=(p.joins??[]).filter(j=>j.from!==from || j.to!==to);
        if(v.kind!=="cut") p.joins.push({...v,from,to});
      } else if(e.op==="graph") {
        if(e.graph===null) delete p.outputGraph;
        else {
          const graph=validateEffectGraph(e.graph);
          if(graph.kind!=="post") throw Error("总画布需要图像后处理图");
          p.outputGraph=graph;
        }
      } else throw Error("未知总时间线操作 "+String(e.op));
    }
    if(p.joins?.length) p.joins=p.joins.filter(j=>joined(p,j.from,j.to));
  });
  return {montage,created};
}

export function montageSamples(p:Montage,time:number) {
  return p.clips.filter(c=>time>=c.start && time<c.start+c.duration)
    .sort((a,b)=>a.lane-b.lane || a.start-b.start)
    .flatMap(clip=>{
      const scene=p.canvases.find(c=>c.id===clip.canvasId)?.scene;
      if(!scene) return [];
      const elapsed=time-clip.start;
      return [{clip,scene,time:clip.trimIn+elapsed,elapsed}];
    });
}
export function joined(p:Montage,from:string,to:string) {
  const a=p.clips.find(c=>c.id===from),b=p.clips.find(c=>c.id===to);
  if(a && b && a!==b && a.lane===b.lane && Math.abs(a.start+a.duration-b.start)<1e-5) return [a,b] as const;
}
export function montageJunctions(p:Montage) {
  const sorted=[...p.clips].sort((a,b)=>a.lane-b.lane || a.start-b.start);
  return sorted.flatMap((a,i)=>{
    const b=sorted[i+1];
    return b && joined(p,a.id,b.id) ? [{a,b,at:b.start,transition:p.joins?.find(j=>j.from===a.id && j.to===b.id)}] : [];
  });
}
export function snapMontageStart(p:Montage,clip:MontageClip,start:number,time:number,pxPerSecond:number) {
  let best=start, distance=9/pxPerSecond;
  for(const at of [0,time,...p.clips.filter(c=>c.id!==clip.id).flatMap(c=>[c.start,c.start+c.duration])])
    for(const candidate of [at,at-clip.duration]) {
      if(candidate<0 || candidate+clip.duration>3600) continue;
      const delta=Math.abs(candidate-start);
      if(delta<distance) {best=candidate;distance=delta;}
    }
  return best;
}
type Shot=ReturnType<typeof montageSamples>[number];
export function montageVisuals(p:Montage,t:number):{shots:Shot[];transition?:{kind:Transition["kind"];progress:number}}[] {
  const shots=montageSamples(p,t);
  const used=new Set<string>();
  const pairs:{shots:Shot[];transition:{kind:Transition["kind"];progress:number}}[]=[];
  for(const join of p.joins??[]) {
    const pair=joined(p,join.from,join.to);
    if(!pair || pair.some(c=>used.has(c.id))) continue;
    const [a,b]=pair,half=Math.min(a.duration/2,b.duration/2,join.duration/2);
    if(!half || t<b.start-half || t>=b.start+half) continue;
    const members=pair.flatMap(clip=>{
      const scene=p.canvases.find(s=>s.id===clip.canvasId)?.scene;
      if(!scene) return [];
      const elapsed=clamp(t-clip.start,0,clip.duration-1e-7);
      return [{clip,scene,elapsed,time:previewFrameTime(scene.duration,scene.fps,clip.trimIn+t-clip.start)}];
    });
    if(members.length!==2) continue;
    pair.forEach(c=>used.add(c.id));
    pairs.push({shots:members,transition:{kind:join.kind,progress:(t-b.start+half)/(half*2)}});
  }
  return [...shots.filter(s=>!used.has(s.clip.id)).map(shot=>({shots:[shot]})),...pairs]
    .sort((a,b)=>a.shots[0].clip.lane-b.shots[0].clip.lane || a.shots[0].clip.start-b.shots[0].clip.start);
}

export function transitionAmount(c:MontageClip,elapsed:number,kind:Transition["kind"]) {
  const at=(v:Transition,t:number)=>v.kind===kind ? clamp(t/Math.min(v.duration,c.duration),0,1) : 1;
  return [at(c.enter,elapsed),at(c.exit,c.duration-elapsed)] as const;
}
export function montageAudio(p:Montage) {
  return p.clips.flatMap(clip=>{
    const scene=p.canvases.find(c=>c.id===clip.canvasId)?.scene;
    if(!scene || !clip.volume) return [];
    return collectAudio(scene,clip.trimIn,clip.trimIn+clip.duration).map(a=>({
      ...a,start:a.start+clip.start,volumeSamples:a.volumeSamples.map(key=>{
        const [enter,exit]=transitionAmount(clip,a.start+key.t,"fade");
        return {...key,v:key.v*clip.volume*enter*exit};
      }),
    }));
  });
}
