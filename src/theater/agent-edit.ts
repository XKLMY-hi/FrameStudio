import { produce } from "immer";
import { type Param, type Key, uid, groupNames } from "../types";
import { cameraChannels, channels, layer, sceneClip, sceneEffects, track, MAX_SCENE_LIGHTS, type Layer, type Scene, type SceneClip } from "./schema";
import { cloneData, duplicateTree, reparentSafe, splitSceneClip, upsertKey } from "./scene-engine";
import { editable } from "./viewport-selection";
import { effectParameter, readProperty, writeProperty, type Binding } from "./properties";
import { emptyGraph, validateCurveKeys, validateEffectGraph } from "./effect-graph";
import { appendShader, currentPostGraph, editEffectGraph, editAgentGraph, writePostGraph } from "./agent-graph";
import { validateCodeShader } from "../../backend/shader-format.mjs";
import { validateShape, defaultShape } from "./shape";
import { applyTextAnimation } from "./appearance-preset";
import { applyCurvePreset, curvePresets, type PresetId } from "./curve-presets";
import { neutralLook } from "./model-look";
import { titleMotions } from "./text-motion";

type Dict = Record<string, unknown>;
type Rule = readonly [number,number] | readonly string[] | ((value:unknown)=>unknown);
export type ParameterCatalog = (layerId:string)=>readonly Param[];
export function objectArgument(value:unknown): Dict {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw Error("需要 JSON 对象");
  return value as Dict;
}
const n = (min:number,max:number) => [min,max] as const;
const positive = n(0,1), position = n(-100000,100000), degrees = n(-36000,36000);
const bool = (v:unknown) => { if (typeof v!=="boolean") throw Error("需要布尔值"); return v; };
const text = (max:number) => (v:unknown) => {
  if (typeof v!=="string" || v.length>max) throw Error("文本长度无效");
  return v;
};
const hex = (v:unknown) => { if (typeof v!=="string" || !/^#[\da-f]{6}$/i.test(v)) throw Error("需要 #RRGGBB 颜色");return v; };
const list = (v:unknown) => {
  if (!Array.isArray(v) || v.length>256 || v.some(x=>typeof x!=="string" || x.length>160)) throw Error("列表内容无效");
  return Array.from(new Set(v as string[]));
};
const mapping = (group=false) => (v:unknown) => {
  const entries=Object.entries(objectArgument(v));
  if (entries.length>256 || entries.some(([id,value])=>
    !id || id.length>160 || Object.hasOwn(Object.prototype,id) ||
    typeof value!=="string" || value.length>160 || (group && !Object.hasOwn(groupNames,value))))
    throw Error("参数映射无效");
  return Object.fromEntries(entries);
};
export function numberArgument(v:unknown,min:number,max:number,key:string) {
  if (typeof v!=="number" || !Number.isFinite(v) || v<min || v>max) throw Error(key+" 超出 "+min+"–"+max+" 范围");
  return v;
}
const integer = (min:number,max:number) => (v:unknown) => Math.round(numberArgument(v,min,max,"数值"));
function validated(rule:Rule,value:unknown,key:string) {
  if (typeof rule==="function") return rule(value);
  if (typeof rule[0]==="number") return numberArgument(value,rule[0],rule[1] as number,key);
  if (typeof value!=="string" || !(rule as readonly string[]).includes(value)) throw Error(key+" 的选项无效");
  return value;
}
function patch(target:object,value:unknown,rules:Record<string,Rule>) {
  for (const [key,v] of Object.entries(objectArgument(value))) {
    if (!Object.hasOwn(rules,key)) throw Error("不能编辑字段 "+key);
    Object.assign(target,{[key]:validated(rules[key],v,key)});
  }
}

const canvas = {name:text(150),width:integer(64,3840),height:integer(64,3840),fps:integer(1,60),duration:n(.1,3600),depthOcclusion:bool};
const transform = {x:position,y:position,z:position,rotation:degrees,rotationX:degrees,rotationY:degrees,opacity:positive,scaleX:n(.01,40),scaleY:n(.01,40)};
const camera = {x:position,y:position,z:position,focusZ:position,zoom:n(.05,20),focalLength:n(1,12000),aperture:n(0,10),dof:bool,blurMode:["gaussian","lens"]};
const layerFields = {name:text(150),visible:bool,locked:bool,is3D:bool,width:n(1,12000),height:n(1,12000),depthMode:["scene","stack"],blend:["normal","add","multiply","screen"],receiveLight:bool,color:hex};
const kinds = ["model","image","text","color","adjustment","group","audio","light"] as const;
const appearance = {brightness:n(0,8),contrast:n(0,8),saturation:n(0,8),glow:n(0,8),bloom:n(0,8),blur:n(0,128),outline:n(0,64),bokeh:n(0,4),outlineColor:hex,glowColor:hex,lightColor:hex,lightType:["off","point","area","sun"],lightX:n(-8,8),lightY:n(-8,8),lightIntensity:n(0,16),rim:n(0,8),gloss:n(0,8),blurMode:["gaussian","lens"],stylizeMix:positive};
const lighting = {enabled:bool,ambient:n(0,4),color:hex,exposure:n(-4,4)};
const light = {type:["point","area","sun","ambient"],color:hex,intensity:n(0,16),range:n(1,20000),decay:n(0,8),width:n(1,12000),height:n(1,12000),specular:n(0,4),rim:n(0,4),targets:list};
const surface = {roughness:n(.01,1),specular:n(0,4),rim:n(0,4),bump:n(0,1)};
const look = {exposure:n(-2,2),detail:positive,rolloff:positive,edgeCleanup:positive,diffusion:positive};
const caption = {value:text(6000),fontFamily:text(160),fontSize:n(1,512),fill:hex,align:["left","center","right"],stroke:hex,strokeWidth:n(0,30),animation:["none","typewriter","fade","typewriter-fade",...Object.keys(titleMotions)],charsPerSecond:n(.1,240),entranceDuration:n(0,30),exit:Object.keys(titleMotions),exitDuration:n(0,30),motionAmount:n(0,3)};
const time = n(0,3600);
const trackFields = {name:text(150),muted:bool,solo:bool,locked:bool};
const clipFields = {name:text(150),start:time,duration:n(.001,3600),trimIn:time,speed:n(.05,16),weight:n(0,4),fadeIn:time,fadeOut:time,blend:["mix","add","override"],loop:bool,enabled:bool,lipEnabled:bool,lipWeight:positive,lipTarget:text(160),fadeCurve:["linear","equalPower"],disabledIds:list,disabledGroups:(v:unknown)=>{
  const groups=list(v);
  if (groups.some(g=>!Object.hasOwn(groupNames,g))) throw Error("动作屏蔽分组无效");
  return groups;
}};

function findLayer(s:Scene,id:unknown) {
  const l=s.layers.find(l=>l.id===id);
  if (!l) throw Error("找不到指定图层");
  return l;
}
function writable(s:Scene,id:unknown) {
  const l=findLayer(s,id);
  if (!editable(s,l)) throw Error("图层或父级已锁定");
  return l;
}
function namedTrack(s:Scene,id:unknown) {
  const t=s.tracks.find(t=>t.id===id);
  if (!t) throw Error("找不到指定轨道");
  return t;
}
function clipOwner(s:Scene,id:unknown) {
  const t=s.tracks.find(t=>t.clips.some(c=>c.id===id));
  if (!t || t.locked) throw Error("片段所在轨道不存在或已锁定");
  const c=t.clips.find(c=>c.id===id)!;
  writable(s,c.layerId);
  return {t,c};
}
function putClip(s:Scene,c:SceneClip,trackId:unknown) {
  const t=trackId===undefined ? s.tracks.find(t=>!t.locked && !t.clips.length) : namedTrack(s,trackId);
  if (t?.locked) throw Error("轨道已锁定");
  if (t && !t.clips.length) t.clips.push(c);
  else {
    const next=track(t?.name ?? "轨道 "+(s.tracks.length+1));
    next.clips.push(c);
    s.tracks.push(next);
  }
}
function modelResource(s:Scene,id:unknown) {
  const m=s.models.find(m=>m.id===id);
  if (!m) throw Error("请指定已导入的模型资源 ID");
  return m;
}
function assignParent(s:Scene,l:Layer,id:unknown) {
  if (id!==null) writable(s,id);
  if (id!==null && typeof id!=="string") throw Error("父级 ID 无效");
  if (!reparentSafe(s,l.id,id)) throw Error("父级关系会形成循环");
}
function checkedClip(s:Scene,c:SceneClip) {
  if (c.start>=s.duration) throw Error("片段起点在场景范围之外");
  if (c.lipTarget && findLayer(s,c.lipTarget).kind!=="model") throw Error("口型目标必须是模型图层");
  if (c.kind!=="audio" && (c.lipTarget || c.lipEnabled)) throw Error("口型绑定需要音频片段");
}
function keyRange(s:Scene,b:Binding,params:ParameterCatalog) {
  if (b.layerId==="@camera") {
    if (!cameraChannels.some(([id])=>id===b.channel) && b.channel!=="focalLength") throw Error("未知相机通道");
    return camera[b.channel as keyof typeof camera];
  }
  const l=writable(s,b.layerId);
  if (b.channel==="gain") {
    const {c}=clipOwner(s,b.clipId);
    if (c.kind!=="audio" || c.layerId!==l.id) throw Error("增益关键帧需要对应的音频片段");
    return n(0,4);
  }
  if (b.channel.startsWith("param:")) {
    const id=b.channel.slice(6);
    const p=params(l.id).find(p=>p.id===id);
    if (l.model && p) return n(p.min,p.max);
    if (l.model?.keys.some(k=>k.id===id) || Object.hasOwn(l.model?.baseValues ?? {},id)) return n(-1000,1000);
    throw Error("先读取已加载模型的参数 ID");
  }
  if (b.channel.startsWith("motion:")) {
    const {c}=clipOwner(s,b.clipId);
    const a=s.models.find(m=>m.id===l.model?.resourceId)?.assets.find(a=>a.id===c.assetId);
    if (c.kind!=="motion" || c.layerId!==l.id || !a?.curves.some(v=>v.id===b.channel.slice(7))) throw Error("找不到片段上的动作曲线");
    return n(-10000,10000);
  }
  const effect=effectParameter(l,b.channel);
  if (effect) return n(effect.min,effect.max);
  if (b.channel==="reveal" && l.text) return positive;
  if (Object.hasOwn(transform,b.channel)) return transform[b.channel as keyof typeof transform];
  const [prefix,key,extra]=b.channel.split(".");
  if (extra!==undefined) throw Error("未知关键帧通道");
  const rules=prefix==="effects" ? appearance : prefix==="light" && l.light ? light : prefix==="surface" && ["model","color","image","text"].includes(l.kind) ? surface : undefined;
  const rule=rules && Object.hasOwn(rules,key) ? rules[key as keyof typeof rules] : undefined;
  if (!Array.isArray(rule) || typeof rule[0]!=="number") throw Error("未知关键帧通道");
  return rule;
}

export function editDesignScene(base:Scene,edits:unknown,params:ParameterCatalog=()=>[]) {
  if (!Array.isArray(edits) || !edits.length || edits.length>40) throw Error("每批需要 1–40 项操作，可继续提交下一批");
  const created: Record<string,string>=Object.create(null);
  const changes:string[]=[];
  const scene=produce(base,s=>{
    const ref=(v:unknown)=>typeof v==="string" && v.startsWith("$") ? created[v.slice(1)] ?? v : v;
    const add=(e:Dict,id:string)=>{
      if (e.as===undefined) return;
      if (typeof e.as!=="string" || !/^[A-Za-z][\w-]{0,31}$/.test(e.as) || Object.hasOwn(created,e.as)) throw Error("重复或无效的批内别名");
      created[e.as]=id;
    };
    for (const operation of edits) {
      const e=objectArgument(operation), id=ref(e.id);
      switch(e.op) {
        case "canvas": {
          const duration=s.duration;
          patch(s,e.values,canvas);
          if (s.workArea.end===duration) s.workArea.end=s.duration;
          s.workArea.end=Math.min(s.workArea.end,s.duration);
          if (s.workArea.start>=s.workArea.end) s.workArea={start:0,end:s.duration,loop:s.workArea.loop};
          break;
        }
        case "work_area":
          patch(s.workArea,e.values,{start:time,end:time,loop:bool});
          if (s.workArea.start>=s.workArea.end || s.workArea.end>s.duration) throw Error("工作区范围无效");
          break;
        case "camera": patch(s.camera,e.values,camera); break;
        case "lighting":
          s.lighting ??= {enabled:true,ambient:.58,color:"#ffffff",exposure:0};
          patch(s.lighting,e.values,lighting); break;
        case "marker": {
          if (e.remove===true) {
            if (!s.markers.some(m=>m.id===id)) throw Error("找不到标记");
            s.markers=s.markers.filter(m=>m.id!==id);
          } else {
            const marker=id===undefined ? {id:uid(),t:0,name:"标记"} : s.markers.find(m=>m.id===id);
            if (!marker) throw Error("找不到标记");
            patch(marker,e.values,{t:n(0,s.duration),name:text(150)});
            if (id===undefined) {s.markers.push(marker);add(e,marker.id);}
          }
          break;
        }
        case "add_layer": {
          const kind=validated(kinds,e.kind==="shape" ? "color" : e.kind,"图层类型") as Layer["kind"];
          const l=layer(kind,typeof e.name==="string" ? text(150)(e.name) : kind);
          if (kind==="model") {
            const m=modelResource(s,e.assetId);
            l.model={resourceId:m.id,physics:true,parameterMap:{},groupOverrides:{},baseValues:{},keys:[],lipOpen:"ParamMouthOpenY",lipForm:"ParamMouthForm"};
            l.width=s.width*.6;l.height=s.height*.92;
          } else if (kind==="image" || kind==="audio") {
            const a=s.assets.find(a=>a.id===e.assetId && a.kind===kind);
            if (!a) throw Error("请指定匹配图层类型的素材 ID");
            l.assetId=a.id;
            if (kind==="image") {
              l.width=a.width || 640;l.height=a.height || 360;
              l.transform.scaleX=l.transform.scaleY=Math.min(1,s.width/l.width,s.height/l.height);
            }
          } else if (e.kind==="shape") {
            l.shape=validateShape(e.shape??defaultShape);l.width=320;l.height=240;
          } else if (kind==="color") {l.width=s.width;l.height=s.height;}
          else if (kind==="text") {l.width=s.width*.75;l.height=170;l.transform.y=s.height*.3;}
          if (kind==="color" && !l.shape && e.placement!=="front") s.layers.unshift(l);
          else s.layers.push(l);
          add(e,l.id);
          if (e.parentId!==undefined) assignParent(s,l,ref(e.parentId));
          if (kind!=="group" && e.createClip!==false) {
            const start=e.start===undefined ? 0 : numberArgument(e.start,0,s.duration-.001,"片段起点");
            const natural=kind==="audio" ? s.assets.find(a=>a.id===l.assetId)!.duration : s.duration-start;
            const duration=e.duration===undefined ? Math.max(.001,Math.min(natural,s.duration-start)) : numberArgument(e.duration,.001,3600,"片段时长");
            const c=sceneClip(kind==="audio" ? "audio" : "visual",l.id,l.assetId ?? l.id,l.name,start,duration);
            putClip(s,c,ref(e.trackId));
          }
          break;
        }
        case "shape": {
          const l=writable(s,id);
          if(l.kind!=="color") throw Error("目标不是图形图层");
          l.shape=validateShape(e.values);break;
        }
        case "text_animation": applyTextAnimation(writable(s,id),e.json);break;
        case "layer": {
          const l=findLayer(s,id);
          const values=objectArgument(e.values);
          if (!editable(s,l) && !(Object.keys(values).length===1 && values.locked===false && (!l.parentId || editable(s,findLayer(s,l.parentId)))))
            throw Error("图层或父级已锁定");
          patch(l,values,layerFields);
          break;
        }
        case "transform": patch(writable(s,id).transform,e.values,transform); break;
        case "effects": patch(writable(s,id).effects,e.values,appearance); break;
        case "text": {
          const l=writable(s,id);
          if (!l.text) throw Error("目标不是文本");
          patch(l.text,e.values,caption);break;
        }
        case "light": {
          const l=writable(s,id);
          if (!l.light) throw Error("目标不是光源");
          const values={...objectArgument(e.values)};
          if (Array.isArray(values.targets)) values.targets=values.targets.map(ref);
          patch(l.light,values,light);
          for (const target of l.light.targets) findLayer(s,target);
          break;
        }
        case "surface": {
          const l=writable(s,id);
          if (!l.model) throw Error("目标不是模型");
          l.surface ??= {roughness:.55,specular:.25,rim:.25,bump:0};
          patch(l.surface,e.values,surface);break;
        }
        case "model": {
          const l=writable(s,id);
          if (!l.model) throw Error("目标不是模型");
          patch(l.model,e.values,{physics:bool,lipOpen:text(160),lipForm:text(160),parameterMap:mapping(),groupOverrides:mapping(true)});
          break;
        }
        case "model_param": {
          const l=writable(s,id);
          const p=params(l.id).find(p=>p.id===e.param);
          if (!l.model || !p) throw Error("先读取已加载模型的参数");
          l.model.baseValues[p.id]=numberArgument(e.value,p.min,p.max,p.id);
          break;
        }
        case "preprocess": {
          const m=modelResource(s,e.resourceId);
          m.preprocess ??= {enabled:true,effects:sceneEffects()};
          if (e.enabled!==undefined) m.preprocess.enabled=bool(e.enabled);
          if (e.effects!==undefined) patch(m.preprocess.effects,e.effects,appearance);
          if (e.look!==undefined) {
            m.preprocess.look ??= {...neutralLook};
            patch(m.preprocess.look,e.look,look);
          }
          break;
        }
        case "parent": assignParent(s,writable(s,id),ref(e.parentId)); break;
        case "order": {
          const l=writable(s,id), index=integer(0,s.layers.length-1)(e.index);
          s.layers.splice(s.layers.indexOf(l),1);s.layers.splice(index,0,l);
          break;
        }
        case "duplicate_layer":
          add(e,duplicateTree(s,writable(s,id).id));break;
        case "remove_layer": {
          const root=writable(s,id), ids=new Set([root.id]);
          while (s.layers.some(l=>l.parentId && ids.has(l.parentId) && !ids.has(l.id))) {
            for (const l of s.layers) if (l.parentId && ids.has(l.parentId)) ids.add(l.id);
          }
          if (s.layers.some(l=>ids.has(l.id) && !editable(s,l)) ||
              s.tracks.some(t=>t.locked && t.clips.some(c=>ids.has(c.layerId) || ids.has(c.lipTarget))))
            throw Error("不能移除包含锁定对象的图层");
          s.layers=s.layers.filter(l=>!ids.has(l.id));
          for (const l of s.layers) if (l.light) l.light.targets=l.light.targets.filter(i=>!ids.has(i));
          for (const t of s.tracks) {
            t.clips=t.clips.filter(c=>!ids.has(c.layerId));
            for (const c of t.clips) if (ids.has(c.lipTarget)) {c.lipTarget="";c.lipEnabled=false;}
          }
          break;
        }
        case "add_track": {
          const t=track("轨道 "+(s.tracks.length+1));
          if (e.values!==undefined) patch(t,e.values,trackFields);
          s.tracks.push(t);add(e,t.id);break;
        }
        case "track": {
          const t=namedTrack(s,id), values=objectArgument(e.values);
          if (t.locked && !(Object.keys(values).length===1 && values.locked===false)) throw Error("轨道已锁定");
          patch(t,values,trackFields);break;
        }
        case "remove_track": {
          const t=namedTrack(s,id);
          if (t.locked || t.clips.some(c=>!editable(s,findLayer(s,c.layerId)))) throw Error("轨道或所含图层已锁定");
          s.tracks=s.tracks.filter(item=>item!==t);break;
        }
        case "add_clip": {
          const l=writable(s,ref(e.layerId));
          const kind=validated(["visual","motion","audio"],e.kind,"片段类型") as SceneClip["kind"];
          if (kind==="visual" && ["audio","group"].includes(l.kind)) throw Error("该图层不能添加视觉片段");
          let assetId=l.assetId ?? l.id, name=l.name, duration=s.duration;
          if (kind==="audio") {
            const a=s.assets.find(a=>a.id===l.assetId && a.kind==="audio");
            if (l.kind!=="audio" || !a) throw Error("音频片段需要音频图层");
            duration=a.duration;
          }
          let expression=false;
          if (kind==="motion") {
            const m=modelResource(s,l.model?.resourceId);
            const a=m.assets.find(a=>a.id===e.assetId) ?? s.models.flatMap(m=>m.assets).find(a=>a.id===e.assetId);
            if (!a || a.kind==="audio") throw Error("找不到动作或表情素材");
            if (!m.assets.some(item=>item.id===a.id)) m.assets.push(cloneData(a));
            assetId=a.id;name=a.name;duration=a.duration;expression=a.kind==="expression";
          }
          const c=sceneClip(kind,l.id,assetId,name,0,Math.max(.001,Math.min(duration,s.duration)));
          if (expression) c.blend="override";
          if (e.values!==undefined) {
            const values={...objectArgument(e.values)};
            if (values.lipTarget!==undefined) values.lipTarget=ref(values.lipTarget);
            patch(c,values,clipFields);
          }
          checkedClip(s,c);putClip(s,c,ref(e.trackId));add(e,c.id);break;
        }
        case "clip": {
          const {t,c}=clipOwner(s,id), values={...objectArgument(e.values)};
          if (values.lipTarget!==undefined) values.lipTarget=ref(values.lipTarget);
          patch(c,values,clipFields);checkedClip(s,c);
          if (e.trackId!==undefined && ref(e.trackId)!==t.id) {
            t.clips=t.clips.filter(item=>item!==c);putClip(s,c,ref(e.trackId));
          }
          break;
        }
        case "remove_clip": {
          const {t,c}=clipOwner(s,id);
          t.clips=t.clips.filter(item=>item!==c);
          if (e.ripple===true) for (const later of t.clips) {
            if (later.start<c.start+c.duration) continue;
            writable(s,later.layerId);later.start-=c.duration;
          }
          break;
        }
        case "split_clip": {
          const {t,c}=clipOwner(s,id);
          const right=splitSceneClip(c,numberArgument(e.time,0,s.duration,"分割时间"));
          if (!right) throw Error("分割时间必须在片段内部");
          t.clips.push(right);add(e,right.id);break;
        }
        case "duplicate_clip": {
          const {c}=clipOwner(s,id);
          const copy={...cloneData(c),id:uid(),start:numberArgument(e.start,0,s.duration,"新片段起点")};
          checkedClip(s,copy);putClip(s,copy,ref(e.trackId));add(e,copy.id);break;
        }
        case "keyframes": {
          const target=ref(e.layerId);
          if (typeof target!=="string" || typeof e.channel!=="string") throw Error("缺少关键帧绑定");
          const clipId=ref(e.clipId);
          const b={layerId:target,channel:e.channel,clipId:typeof clipId==="string" ? clipId : undefined};
          const rule=keyRange(s,b,params);
          const input=Array.isArray(e.keys) && e.keys.length===0 ? [] : validateCurveKeys(e.keys);
          const current=readProperty(s,b,0);
          const replace=e.mode!=="merge";
          const keys=new Map<number,Key>(replace ? [] : current.keys.map(k=>[k.t,k]));
          for (const key of input) {
            validated(rule,key.v,b.channel);
            if (key.t>current.duration+.001) throw Error("关键帧超出局部时长");
            keys.set(key.t,key);
          }
          writeProperty(s,b,[...keys.values()].sort((a,b)=>a.t-b.t));
          break;
        }
        case "property":
        case "curve_key":
        case "curve_preset": {
          const layerId=ref(e.layerId),clipId=ref(e.clipId);
          if(typeof layerId!=="string" || typeof e.channel!=="string") throw Error("缺少属性绑定");
          const b={layerId,channel:e.channel,clipId:typeof clipId==="string" ? clipId : undefined};
          const rule=keyRange(s,b,params);
          const at=typeof e.time==="number" ? numberArgument(e.time,0,s.duration,"属性时间") : 0;
          const property=readProperty(s,b,at);
          if(e.op==="curve_preset") {
            const index=integer(0,Math.max(0,property.keys.length-2))(e.segment);
            if(property.keys.length<2 || !curvePresets.some(p=>p.id===e.preset)) throw Error("曲线段或预设无效");
            writeProperty(s,b,applyCurvePreset(property.keys,[index],e.preset as PresetId));
            break;
          }
          if(e.op==="curve_key") {
            if(!property.keys.length) throw Error("曲线还没有关键帧");
            const index=integer(0,property.keys.length-1)(e.index);
            const keys=cloneData(property.keys);
            if(e.remove===true) keys.splice(index,1);
            else {
              const key=keys[index];
              if(e.value!==undefined) key.v=validated(rule,e.value,b.channel) as number;
              if(e.localTime!==undefined) key.t=numberArgument(e.localTime,0,property.duration,"关键帧时间");
              keys.sort((a,b)=>a.t-b.t);
              if(keys.some((k,i)=>i>0 && k.t===keys[i-1].t)) throw Error("该时间已存在关键帧");
            }
            writeProperty(s,b,keys);
            break;
          }
          const value=validated(rule,e.value,b.channel) as number;
          const keys=cloneData(property.keys);
          upsertKey(keys,Math.min(property.duration,Math.max(0,(at-property.offset)*property.speed)),value,s.fps);
          writeProperty(s,b,keys);
          break;
        }
        case "shader": {
          const target=id==="output" ? "output" : writable(s,id).id;
          if(target!=="output" && ["audio","light"].includes(findLayer(s,target).kind)) throw Error("该图层不支持 GLSL");
          writePostGraph(s,target,appendShader(currentPostGraph(s,target),validateCodeShader(e.shader)));
          break;
        }
        case "graph": {
          const scope=e.scope ?? "post";
          if (scope==="text") {
            const l=writable(s,id);
            if (!l.text) throw Error("目标不是文本图层");
            l.text.graph=editEffectGraph(l.text.graph ?? emptyGraph("text","文字动效"),e.edits);
          } else if (scope==="preprocess") {
            const m=modelResource(s,e.resourceId);
            m.preprocess ??= {enabled:true,effects:sceneEffects()};
            m.preprocess.effects.graph=editAgentGraph(m.preprocess.effects.graph ?? emptyGraph("post","模型预处理"),e.edits);
          } else if (scope==="post") {
            const target=id==="output" ? "output" : writable(s,id).id;
            if (target!=="output" && ["audio","light"].includes(findLayer(s,target).kind)) throw Error("该图层不支持图像后处理");
            writePostGraph(s,target,editAgentGraph(currentPostGraph(s,target),e.edits));
          } else throw Error("未知节点作用范围");
          break;
        }
        case "replace_graph": {
          const graph=validateEffectGraph(e.graph);
          if (graph.kind!=="post") throw Error("需要后处理图");
          if (e.scope==="preprocess") {
            const m=modelResource(s,e.resourceId);
            m.preprocess ??= {enabled:true,effects:sceneEffects()};
            m.preprocess.effects.graph=graph;
            break;
          }
          const target=id==="output" ? "output" : writable(s,id).id;
          writePostGraph(s,target,graph);break;
        }
        default: throw Error("未知编辑操作 "+String(e.op).slice(0,48));
      }
      changes.push(String(e.op));
    }
    if (s.tracks.some(t=>t.clips.length>1))
      s.tracks=s.tracks.flatMap(t=>t.clips.length<=1 ? [t] : t.clips.map((clip,index)=>
        ({...t,id:index===0 ? t.id : uid(),clips:[clip]})));
    if (s.layers.filter(l=>l.kind==="light").length>MAX_SCENE_LIGHTS) throw Error("场景光源超过限制");
  });
  return {scene,created,changes};
}
