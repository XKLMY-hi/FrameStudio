import assert from "node:assert/strict";
import { test } from "node:test";
import { freeze, produce } from "immer";
import { buildPropertyCatalog } from "../src/theater/property-catalog";
import { curveGeometry, segmentAt } from "../src/theater/curve-geometry";
import { bindingId } from "../src/theater/properties";
import { visualClip } from "../src/theater/scene-engine";
import { addVisual, emptyScene, layer, sceneClip, track } from "../src/theater/schema";
import type { Key } from "../src/types";

test("curve catalog preserves object, clip and property ownership, including unanimated controls",()=>{
  const s=emptyScene(),folder=layer("group","Scene"),a=layer("model","Actor"),audio=layer("audio","Audio");
  s.layers.push(folder,a,audio);a.parentId=folder.id;
  a.model={resourceId:"r",physics:false,parameterMap:{},groupOverrides:{},baseValues:{},keys:[],lipOpen:"",lipForm:""};
  s.models.push({id:"r",modelId:"r",file:"m",name:"model",assets:[{id:"walk",name:"walk",kind:"motion",duration:2,fps:30,curves:[{id:"ParamAngleX",target:"Parameter",keys:[{t:0,v:1,mode:"linear"}]}]}]});
  const one=sceneClip("motion",a.id,"walk","Walk 1"),two=sceneClip("motion",a.id,"walk","Walk 2");
  const sound=sceneClip("audio",audio.id,"media","BGM");
  s.tracks.push({...track("test"),clips:[one,two,sound]});
  const c=buildPropertyCatalog(s,{});
  assert.equal(c.parents.get("object:"+a.id),"object:"+folder.id);
  assert.ok(c.properties.has(bindingId({layerId:a.id,channel:"x"})));
  const ids=[one,two].map(clip=>bindingId({layerId:a.id,clipId:clip.id,channel:"motion:ParamAngleX"}));
  assert.deepEqual(ids.map(id=>c.parents.get(id)),["preset:"+one.id,"preset:"+two.id]);
  assert.equal(c.parents.get(bindingId({layerId:audio.id,clipId:sound.id,channel:"gain"})),"clip:"+sound.id);
  assert.equal(c.roots[0].label,"相机");
});
test("curve geometry batches visible keys and preserves Bezier and stepped segment selection",()=>{
  const keys:Key[]=Array.from({length:1000},(_,i)=>({t:i,v:i%4,mode:i===400?"step":"bezier"}));
  const g=curveGeometry(keys,400.1,404.2,x=>x,y=>y);
  assert.deepEqual(g.points.map(p=>p.i),[401,402,403,404]);
  assert.match(g.segments.get(400)!,/H401V1/);
  assert.ok(g.segments.size<8);
  assert.equal(segmentAt(keys,402.8),402);
  assert.equal(segmentAt(keys,999),998);
});
test("indexed visual clips honor solo and replace cached lookups after edits",()=>{
  const s=emptyScene(),a=layer("model","A"),b=layer("model","B");addVisual(s,a);addVisual(s,b);
  const m=sceneClip("motion",a.id,"walk","Walk",0,2);
  s.tracks.push({...track("motion"),solo:true,clips:[m]});
  const old=freeze(s,true);
  assert.equal(visualClip(old,a.id,1)?.layerId,a.id);
  assert.equal(visualClip(old,b.id,1),undefined);
  const next=produce(old,d=>{d.tracks.at(-1)!.solo=false});
  assert.equal(visualClip(next,b.id,1)?.layerId,b.id);
  assert.equal(visualClip(old,b.id,1),undefined);
});
