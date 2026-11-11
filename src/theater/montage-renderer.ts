import { media } from "../api";
import type { Param } from "../types";
import { emptyScene, type Scene } from "./schema";
import { active, audioGain, enabledTracks, previewFrameTime, sourceTime } from "./scene-engine";
import { SceneRenderer } from "./scene-renderer";
import { montageSamples, montageVisuals, transitionAmount, type Montage, type MontageClip } from "./montage";

function namespaced(scene:Scene,owner:string):Scene {
  const key=(id:string)=>owner+":"+id;
  return {...scene,id:key(scene.id),
    assets:scene.assets.map(a=>({...a,id:key(a.id)})),
    models:scene.models.map(m=>({...m,id:key(m.id),textureOverrides:m.textureOverrides && Object.fromEntries(Object.entries(m.textureOverrides).map(([slot,id])=>[slot,key(id)]))})),
    layers:scene.layers.map(l=>({...l,id:key(l.id),parentId:l.parentId ? key(l.parentId) : null,
      assetId:l.assetId ? key(l.assetId) : undefined,
      model:l.model && {...l.model,resourceId:key(l.model.resourceId)},
      light:l.light && {...l.light,targets:l.light.targets.map(key)}})),
    tracks:scene.tracks.map(t=>({...t,clips:t.clips.map(c=>({...c,layerId:key(c.layerId),
      assetId:c.kind==="motion" ? c.assetId : key(c.assetId),lipTarget:c.lipTarget ? key(c.lipTarget) : ""}))})),
  };
}
const canvas=()=>document.createElement("canvas");
function paintClip(ctx:CanvasRenderingContext2D,image:HTMLCanvasElement,c:MontageClip,elapsed:number,w:number,h:number) {
  const [enter,exit]=transitionAmount(c,elapsed,"fade");
  const [wipeIn,wipeOut]=transitionAmount(c,elapsed,"wipe");
  const [slideIn,slideOut]=transitionAmount(c,elapsed,"slide");
  const scale=Math.min(w/image.width,h/image.height);
  const width=image.width*scale,height=image.height*scale;
  ctx.save();
  ctx.globalAlpha=c.opacity*enter*exit;
  if(wipeIn<1 || wipeOut<1) {
    ctx.beginPath();
    ctx.rect(w*(1-wipeOut),0,Math.max(0,w*(wipeIn+wipeOut-1)),h);
    ctx.clip();
  }
  ctx.drawImage(image,(w-width)/2+w*(slideOut-slideIn),(h-height)/2,width,height);
  ctx.restore();
}
export class MontageRenderer {
  constructor(private renderer:SceneRenderer,private keepEditor:()=>Scene) {}
  private tasks=Promise.resolve();
  private disposed=false;
  private sources=new Map<string,{original:Scene;scene:Scene}>();
  private loaded=new Map<string,Scene>();
  private stage=emptyScene();
  private composition=canvas();
  private result=canvas();
  private pair=canvas();
  private context=this.composition.getContext("2d")!;
  private output=this.result.getContext("2d")!;
  private source(owner:string,scene:Scene) {
    let source=this.sources.get(owner);
    if(source?.original!==scene) {
      source={original:scene,scene:namespaced(scene,owner)};
      this.sources.set(owner,source);
    }
    return source.scene;
  }
  private run<T>(task:(r:SceneRenderer)=>Promise<T>) {
    const next=this.tasks.then(()=>{
      if(this.disposed) throw Error("合成预览已关闭");
      return task(this.renderer);
    });
    this.tasks=next.then(()=>{},()=>{});
    return next;
  }
  async render(p:Montage,t:number,options:{maxEdge?:number;matte?:string;preview?:HTMLCanvasElement;png?:boolean;isCurrent?:()=>boolean}={}) {
    return this.run(async r=>{
      if(this.disposed || (options.isCurrent && !options.isCurrent())) return;
      const scale=Math.min(1,(options.maxEdge??Infinity)/Math.max(p.width,p.height));
      const w=Math.max(1,Math.round(p.width*scale)),h=Math.max(1,Math.round(p.height*scale));
      const items=montageVisuals(p,t);
      const samples=items.flatMap(i=>i.shots).filter(a=>a.clip.opacity>0);
      const loaded=new Map(samples.map(a=>[a.clip.id,this.source(a.clip.id,a.scene)]));
      // Warm one upcoming source for cuts. Other scenes have no model runtime in the preview.
      if(options.maxEdge && loaded.size<2) {
        const next=p.clips.filter(c=>c.start>t && c.start-t<.65 && c.opacity>0).sort((a,b)=>a.start-b.start)[0];
        const source=next && p.canvases.find(c=>c.id===next.canvasId)?.scene;
        if(next && source) loaded.set(next.id,this.source(next.id,source));
      }
      if(loaded.size!==this.loaded.size || [...loaded].some(([id,s])=>this.loaded.get(id)!==s)) {
        const all=[...loaded.values()];
        await r.ensure({...this.stage,layers:all.flatMap(s=>s.layers),models:all.flatMap(s=>s.models),assets:all.flatMap(s=>s.assets)},this.keepEditor());
        this.loaded=loaded;
      }
      if(this.disposed || (options.isCurrent && !options.isCurrent())) return;
      for(const id of this.sources.keys()) if(!loaded.has(id)) this.sources.delete(id);
      if(this.composition.width!==w || this.composition.height!==h) {
        this.composition.width=w;this.composition.height=h;
      }
      this.context.clearRect(0,0,w,h);
      for(const {shots,transition} of items) {
        if(transition && (this.pair.width!==w || this.pair.height!==h)) {this.pair.width=w;this.pair.height=h;}
        const ctx=transition ? this.pair.getContext("2d")! : this.context;
        if(transition) ctx.clearRect(0,0,w,h);
        for(const [i,item] of shots.entries()) {
          const source=loaded.get(item.clip.id);
          if(!source) continue;
          const fit=Math.min(w/source.width,h/source.height);
          r.renderAt(source,item.time,!options.maxEdge,false,true,{maxEdge:Math.max(1,Math.ceil(Math.max(source.width,source.height)*fit))});
          const progress=transition?.progress??0;
          let clip=item.clip;
          ctx.save();
          if(transition?.kind==="fade") {
            ctx.globalCompositeOperation=i ? "lighter" : "source-over";
            clip={...clip,opacity:clip.opacity*(i ? progress : 1-progress)};
          } else if(transition?.kind==="wipe") {
            ctx.beginPath();ctx.rect(i ? 0 : w*progress,0,w*(i ? progress : 1-progress),h);ctx.clip();
          } else if(transition?.kind==="slide") ctx.translate(w*(i ? 1-progress : -progress),0);
          paintClip(ctx,r.app.view,clip,item.elapsed,w,h);
          ctx.restore();
        }
        if(transition) this.context.drawImage(this.pair,0,0);
      }
      let final=this.composition;
      if(p.outputGraph && p.outputGraph.output!=="$source") {
        const stage={...this.stage,width:p.width,height:p.height,fps:p.fps,outputGraph:p.outputGraph};
        r.renderAt(stage,t,!options.maxEdge,false,true,{maxEdge:options.maxEdge,composite:this.composition});
        final=r.app.view;
      }
      if(options.matte) {
        if(this.result.width!==w || this.result.height!==h) {this.result.width=w;this.result.height=h;}
        this.output.fillStyle=options.matte;this.output.fillRect(0,0,w,h);
        this.output.drawImage(final,0,0,w,h);
        final=this.result;
      }
      if(options.preview) {
        const cv=options.preview;
        if(cv.width!==w || cv.height!==h) {cv.width=w;cv.height=h;}
        const ctx=cv.getContext("2d")!;
        ctx.clearRect(0,0,w,h);ctx.drawImage(final,0,0,w,h);
      }
      r.invalidate();
      if(options.png) return new Promise<Blob>((resolve,reject)=>final.toBlob(b=>b ? resolve(b) : reject(Error("合成读取失败")),"image/png"));
    });
  }
  renderCanvas(scene:Scene,time:number,full:boolean) {
    return this.run(async r=>{
      this.loaded.clear();
      await r.ensure(scene,this.keepEditor());
      if(this.disposed) throw Error("合成预览已关闭");
      r.renderAt(scene,previewFrameTime(scene.duration,scene.fps,time),full,false,true,{maxEdge:full ? undefined : 360});
      r.invalidate();
      return full ? r.png() : r.app.view.toDataURL("image/jpeg",.78) as string;
    });
  }
  parameters(scene:Scene) {
    return this.run(async r=>{
      this.loaded.clear();
      await r.ensure(scene,this.keepEditor());
      if(this.disposed) throw Error("合成预览已关闭");
      return new Map<string,Param[]>(scene.layers.filter(l=>l.model)
        .map(l=>[l.id,Array.from(r.nodes.get(l.id)?.runtime?.params??[])]));
    });
  }
  resetPhysics() {
    return this.run(async r=>{for(const node of r.nodes.values()) node.runtime?.resetPhysics();});
  }
  close() {
    this.disposed=true;
    this.sources.clear();this.loaded.clear();
  }
}
export class MontageAudio {
  private players=new Map<string,HTMLAudioElement>();
  sync(p:Montage,t:number) {
    const live=new Set<string>();
    for(const {clip,scene,time,elapsed} of montageSamples(p,t)) {
      const [enter,exit]=transitionAmount(clip,elapsed,"fade");
      if(!clip.volume) continue;
      for(const track of enabledTracks(scene)) for(const c of track.clips) {
        if(c.kind!=="audio" || !active(c,time)) continue;
        const a=scene.assets.find(a=>a.id===c.assetId);
        const l=scene.layers.find(l=>l.id===c.layerId);
        if(!a || !l?.visible) continue;
        const id=clip.id+":"+c.id;
        live.add(id);
        let player=this.players.get(id);
        if(!player) {player=new Audio(media(a.path));this.players.set(id,player);}
        const source=sourceTime(c,time,a.duration);
        if(Math.abs(player.currentTime-source)>.15) player.currentTime=Math.min(source,Math.max(0,a.duration-.001));
        player.playbackRate=c.speed;
        player.volume=audioGain(scene,c,time)*clip.volume*enter*exit;
        if(player.paused) void player.play().catch(()=>{});
      }
    }
    for(const [id,player] of this.players) if(!live.has(id)) {player.pause();this.players.delete(id);}
  }
  stop() {
    for(const player of this.players.values()) player.pause();
    this.players.clear();
  }
}
