import type { Layer, Scene } from "./schema";
import { cameraChannels, channels } from "./schema";
import { propertiesOf, readProperty } from "./properties";
import { objectArgument, type ParameterCatalog } from "./agent-edit";
import { currentPostGraph } from "./agent-graph";
import type { EffectGraph } from "./effect-graph";
import { worldLights, receivesLight } from "./lighting";
import { animatedCamera, worldMatrix } from "./scene-engine";
import { textAnimationFile } from "./appearance-preset";

export type DesignDraft = { name:string; base:Scene; scene:Scene; revision:number; target?:string };

const graphInfo = (g?:EffectGraph) => g && {name:g.name,output:g.output,nodes:g.nodes.length};
const layerInfo = (l:Layer) => ({
  id:l.id,name:l.name,kind:l.shape ? "shape" : l.kind,parentId:l.parentId,visible:l.visible,locked:l.locked,is3D:l.is3D,
  width:l.width,height:l.height,assetId:l.assetId,resourceId:l.model?.resourceId,transform:l.transform,
});
export function inspectDesignScene(s:Scene, args:unknown, playhead:number, selected:string, params:ParameterCatalog) {
  const e=objectArgument(args);
  const layer=s.layers.find(l=>l.id===e.id);
  const offset=typeof e.offset==="number" && Number.isFinite(e.offset) ? Math.max(0,Math.floor(e.offset)) : 0;
  const limit=typeof e.limit==="number" && Number.isFinite(e.limit) ? Math.max(1,Math.min(32,Math.floor(e.limit))) : 12;
  const query=typeof e.query==="string" ? e.query.trim().toLowerCase() : "";
  const page=<T extends {id:string;name?:string}>(items:T[])=>{
    const found=query ? items.filter(item=>(item.id+" "+(item.name ?? "")).toLowerCase().includes(query)) : items;
    return {total:found.length,offset,items:found.slice(offset,offset+limit)};
  };
  const requireLayer=()=>{if (!layer) throw Error("找不到指定图层");return layer;};
  switch(e.section) {
    case "overview": {
      const {width,height,fps,duration,name,workArea,depthOcclusion,lighting}=s;
      const {animation,...camera}=s.camera;
      return {name,width,height,fps,duration,workArea,depthOcclusion,lighting,camera,playhead,selected,
        layerCount:s.layers.length,assetCount:s.assets.length,modelCount:s.models.length,trackCount:s.tracks.length,
        output:graphInfo(s.outputGraph),layers:page(s.layers.map(layerInfo))};
    }
    case "layers": return page(s.layers.map(layerInfo));
    case "layer": {
      const l=requireLayer();
      const {graph,graphValues,codeShader,stylize,...effects}=l.effects;
      const text=l.text && {...l.text,graph:graphInfo(l.text.graph)};
      const model=l.model && {resourceId:l.model.resourceId,physics:l.model.physics,lipOpen:l.model.lipOpen,lipForm:l.model.lipForm};
      const properties=propertiesOf(s,l.id,Array.from(params(l.id)));
      return {...layerInfo(l),blend:l.blend,depthMode:l.depthMode,color:l.color,receiveLight:l.receiveLight,
        effects,text,model,light:l.light,surface:l.surface,shape:l.shape,graph:graphInfo(graph),
        channels:properties.slice(0,64).map(p=>({id:p.channel,name:p.name,clipId:p.clipId,min:p.min,max:p.max}))};
    }
    case "text_animation": return textAnimationFile(requireLayer());
    case "spatial": {
      const {animation,...camera}=animatedCamera(s,playhead);
      const lights=worldLights(s,playhead);
      return {playhead,camera,lighting:s.lighting,lightingEnabled:s.lighting?.enabled!==false,
        lights:page(s.layers.filter(l=>l.light).map(l=>{
          const light=lights.find(x=>x.id===l.id);
          return {id:l.id,name:l.name,type:l.light!.type,active:!!light && s.lighting?.enabled!==false,power:light?.power??0,
            world:worldMatrix(s,l,playhead).slice(12,15),direction:light?.direction,range:light?.range,targets:l.light!.targets};
        })),
        objects:page(s.layers.filter(l=>l.kind!=="audio" && l.kind!=="light").map(l=>({
          ...layerInfo(l),world:worldMatrix(s,l,playhead).slice(12,15),receivesLight:receivesLight(s,l),
        })))};
    }
    case "assets": return page([
      ...s.assets.map(a=>({id:a.id,name:a.name,kind:a.kind,duration:a.duration,width:a.width,height:a.height,fontFamily:a.fontFamily,lipCues:a.cues?.length ?? 0})),
      ...s.models.flatMap(m=>[{id:m.id,name:m.name,kind:"model"},...m.assets.map(a=>({
        id:a.id,name:a.name,kind:a.kind,duration:a.duration,resourceId:m.id,
      }))]),
    ]);
    case "timeline": return {...page(s.tracks.filter(t=>!e.id || t.clips.some(c=>c.layerId===e.id || c.id===e.id)).map(t=>({
      id:t.id,name:t.name,locked:t.locked,muted:t.muted,solo:t.solo,
      clips:t.clips.slice(0,16).map(({gainKeys,disabledIds,...clip})=>({...clip,gainKeys:gainKeys.length,disabledIds:disabledIds.length})),
    }))),workArea:s.workArea,markers:s.markers.slice(0,32)};
    case "property": {
      const layerId=e.id==="@camera" ? e.id : requireLayer().id;
      if (typeof e.channel!=="string") return {channels:layerId==="@camera" ? cameraChannels : channels};
      const p=readProperty(s,{layerId,channel:e.channel,clipId:typeof e.clipId==="string" ? e.clipId : undefined},playhead);
      return {...p,totalKeys:p.keys.length,keys:p.keys.slice(offset,offset+limit)};
    }
    case "model_params": return page(Array.from(params(requireLayer().id)).map(p=>({...p,base:layer?.model?.baseValues[p.id] ?? p.default})));
    case "graph": {
      const scope=e.scope ?? "post";
      if (scope==="preprocess") {
        const m=s.models.find(m=>m.id===e.id);
        if (!m) throw Error("找不到模型资源");
        return {scope,graph:m.preprocess?.effects.graph,enabled:m.preprocess?.enabled,look:m.preprocess?.look};
      }
      if (scope==="text") return {scope,graph:requireLayer().text?.graph};
      if (scope!=="post") throw Error("未知节点作用范围");
      const target=e.id==="output" ? "output" : requireLayer().id;
      return {target,scope,graph:currentPostGraph(s,target)};
    }
    default: throw Error("未知检查范围");
  }
}
