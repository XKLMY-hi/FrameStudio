import { api,media } from "../api";
import { type Asset,type Curve,type Param,uid } from "../types";
import { validateCurveKeys } from "./effect-graph";
import type { MediaAsset,ModelResource,Scene } from "./schema";

export type TextureSlot={index:number;file:string;name:string};
export type TextureStroke={mode:"brush"|"erase";color:string;size:number;points:[number,number][]};
export function textureUrl(resource:ModelResource,assets:MediaAsset[],slot:TextureSlot) {
  const override=assets.find(a=>a.id===resource.textureOverrides?.[slot.index]);
  return media(override?.path??("models/"+resource.modelId+"/"+slot.file));
}
export function textureCatalog(resource:ModelResource) {
  const query=new URLSearchParams({id:resource.modelId,file:resource.file});
  return api<{textures:TextureSlot[]}>("model-catalog?"+query).then(r=>r.textures);
}
export function drawTextureStroke(ctx:CanvasRenderingContext2D,stroke:TextureStroke) {
  const {width,height}=ctx.canvas;
  ctx.save();ctx.globalCompositeOperation=stroke.mode==="erase"?"destination-out":"source-over";
  ctx.strokeStyle=ctx.fillStyle=stroke.color;ctx.lineWidth=stroke.size;ctx.lineCap=ctx.lineJoin="round";
  const [first,...rest]=stroke.points;
  if(first) {
    ctx.beginPath();
    if(rest.length) {ctx.moveTo(first[0]*width,first[1]*height);for(const [x,y] of rest)ctx.lineTo(x*width,y*height);ctx.stroke();}
    else {ctx.arc(first[0]*width,first[1]*height,stroke.size/2,0,Math.PI*2);ctx.fill();}
  }
  ctx.restore();
}
export async function loadTextureCanvas(url:string,canvas:HTMLCanvasElement) {
  const image=new Image();image.src=url;await image.decode();
  if(!image.naturalWidth || Math.max(image.naturalWidth,image.naturalHeight)>8192) throw Error("贴图最大边长为 8192 像素");
  canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  canvas.getContext("2d")!.drawImage(image,0,0);
}
export function saveTexture(canvas:HTMLCanvasElement) {
  return new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error("贴图编码失败")),"image/png"))
    .then(blob=>api<MediaAsset>("model-texture",blob));
}
export function applyTextureCopy(scene:Scene,id:string,index:number,asset:MediaAsset) {
  const resource=scene.models.find(m=>m.id===id);
  if(!resource) throw Error("找不到模型素材");
  const prior=resource.textureOverrides?.[index];
  scene.assets.push(asset);
  resource.textureOverrides={...resource.textureOverrides,[index]:asset.id};
  if(prior && !scene.models.some(m=>Object.values(m.textureOverrides??{}).includes(prior)) &&
     !scene.layers.some(l=>l.assetId===prior)) scene.assets=scene.assets.filter(a=>a.id!==prior);
}
export function checkedStrokes(value:unknown):TextureStroke[] {
  if(!Array.isArray(value) || !value.length || value.length>128) throw Error("每批需要 1–128 个笔划");
  return value.map(s=>{
    if(!s || !["brush","erase"].includes(s.mode) || !/^#[0-9a-f]{6}$/i.test(s.color) ||
       !Number.isFinite(s.size) || s.size<1 || s.size>512 || !Array.isArray(s.points) || !s.points.length || s.points.length>4096 ||
       s.points.some((p:unknown)=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||v<0||v>1)))
      throw Error("笔划坐标需在 0–1 内，笔刷宽度为 1–512 像素");
    return s;
  });
}
export function motionDocument(asset:Asset) {
  if(asset.kind!=="motion" || !Number.isFinite(asset.duration) || asset.duration<=0) throw Error("动作时长无效");
  let segments=0,points=0;
  const Curves=asset.curves.filter(c=>c.keys.length).map(c=>{
    const first=c.keys[0],data=[first.t,first.v];points++;
    for(let i=1;i<c.keys.length;i++){
      const a=c.keys[i-1],b=c.keys[i];
      if(a.mode==="bezier") {
        const dt=(b.t-a.t)/3;
        data.push(1,...(a.out??[a.t+dt,a.v]),...(b.in??[b.t-dt,b.v]),b.t,b.v);points+=3;
      } else {data.push(a.mode==="step"?2:a.mode==="inverse"?3:0,b.t,b.v);points++;}
      segments++;
    }
    return {Id:c.id,Target:c.target,Segments:data,FadeInTime:c.fadeIn,FadeOutTime:c.fadeOut};
  });
  return {Version:3,Meta:{Duration:asset.duration,Fps:asset.fps,Loop:false,AreBeziersRestricted:false,
    CurveCount:Curves.length,TotalSegmentCount:segments,TotalPointCount:points,UserDataCount:0,TotalUserDataSize:0,
    FadeInTime:asset.fadeIn,FadeOutTime:asset.fadeOut},Curves,UserData:[]};
}
export function newMotion(name="新动作"):Asset {return {id:uid(),name,kind:"motion",duration:2,fps:30,curves:[]};}
export function editMotion(input:unknown,base:Asset,params:readonly Param[]) {
  if(!input || typeof input!=="object" || Array.isArray(input)) throw Error("需要动作编辑对象");
  const v=input as {name?:unknown;duration?:unknown;fps?:unknown;curves?:unknown};
  const a=structuredClone(base);
  if(v.name!==undefined){
    if(typeof v.name!=="string" || !v.name.trim() || v.name.length>150) throw Error("动作名称无效");
    a.name=v.name.trim();
  }
  if(v.duration!==undefined){
    if(typeof v.duration!=="number" || !Number.isFinite(v.duration) || v.duration<.001 || v.duration>3600) throw Error("动作时长无效");
    a.duration=v.duration;
  }
  if(v.fps!==undefined){
    if(typeof v.fps!=="number" || !Number.isInteger(v.fps) || v.fps<1 || v.fps>60) throw Error("动作帧率无效");
    a.fps=v.fps;
  }
  if(v.curves!==undefined){
    if(!Array.isArray(v.curves) || v.curves.length>512) throw Error("动作曲线无效");
    for(const c of v.curves){
      if(!c || typeof c.id!=="string" || !c.id || c.id.length>100 ||
         !["Parameter","PartOpacity","Model"].includes(c.target??"Parameter")) throw Error("曲线绑定无效");
      const target=c.target??"Parameter",existing=a.curves.find(x=>x.id===c.id && x.target===target);
      const param=params.find(p=>p.id===c.id);
      if(!existing && target==="Parameter" && params.length && !param) throw Error("模型参数不存在："+c.id);
      const keys=Array.isArray(c.keys) && !c.keys.length ? [] : validateCurveKeys(c.keys);
      if(param && keys.some(k=>k.v<param.min || k.v>param.max)) throw Error("模型参数值越界："+c.id);
      const next:Curve={...existing,id:c.id,target,keys};
      a.curves=a.curves.filter(x=>x!==existing);
      if(keys.length) a.curves.push(next);
    }
  }
  if(a.curves.some(c=>(c.keys.at(-1)?.t??0)>a.duration+1e-7)) throw Error("动作末尾仍有关键帧");
  return a;
}
export async function saveMotion(asset:Asset) {
  const data=motionDocument(asset);
  const r=await api<{path:string}>("model-motion",data);
  return {...asset,motionFile:r.path};
}
