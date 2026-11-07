import {test} from 'node:test';import assert from 'node:assert/strict';import {produce} from 'immer';
import {emptyScene,layer,addVisual,sceneClip,track,migrateScene} from '../src/theater/schema';
import {readProperty,writeProperty,movePropertyKey,bindingId,parameterDriven} from '../src/theater/properties';
function actors(){const s=emptyScene();for(const name of ['A','B']){const l=layer('model',name);l.model={resourceId:'r',physics:false,parameterMap:{},groupOverrides:{},baseValues:{},keys:[],lipOpen:'open',lipForm:'form'};addVisual(s,l);}return s;}
test('same parameter on two objects has distinct bindings and writes only its explicit owner',()=>{
 const s=actors(),[a,b]=s.layers,A={layerId:a.id,channel:'param:ParamAngleX'},B={layerId:b.id,channel:'param:ParamAngleX'};
 const out=produce(s,d=>writeProperty(d,A,[{t:1,v:20,mode:'linear'}]));assert.notEqual(bindingId(A),bindingId(B));assert.equal(readProperty(out,A,1).value,20);assert.equal(readProperty(out,B,1).keys.length,0);assert.equal(s.layers[0].model!.keys.length,0);
});
test('preset edit uses bound actor and clip and makes an isolated asset copy',()=>{
 const s=actors(),[a,b]=s.layers;s.models=[{id:'r',name:'r',modelId:'demo',file:'m',assets:[{id:'m',name:'motion',kind:'motion',duration:2,fps:30,curves:[{id:'X',target:'Parameter',keys:[{t:0,v:0,mode:'linear'}]}]}]}];
 const one=sceneClip('motion',a.id,'m','one'),two=sceneClip('motion',b.id,'m','two');s.tracks.push({...track('actions'),clips:[one,two]});
 const out=produce(s,d=>writeProperty(d,{layerId:a.id,clipId:one.id,channel:'motion:X'},[{t:0,v:12,mode:'linear'}]));
 assert.notEqual(out.tracks.at(-1)!.clips[0].assetId,'m');assert.equal(out.tracks.at(-1)!.clips[1].assetId,'m');assert.equal(out.models[0].assets[0].curves[0].keys[0].v,0);
 const wrong=produce(out,d=>writeProperty(d,{layerId:b.id,clipId:one.id,channel:'motion:X'},[]));assert.equal(wrong,out);
});
test('key drag changes only the addressed channel and shifts Bezier handles',()=>{
 const s=actors(),a=s.layers[0],b={layerId:a.id,channel:'x'};a.animation.x=[{t:0,v:0,mode:'bezier'},{t:2,v:5,in:[1.5,4],out:[2.4,6],mode:'bezier'},{t:5,v:10,mode:'linear'}];a.animation.y=[{t:2,v:8,mode:'linear'}];
 const out=produce(s,d=>movePropertyKey(d,b,1,3));assert.equal(out.layers[0].animation.x[1].t,3);assert.equal(out.layers[0].animation.x[1].in![0],2.5);assert.equal(out.layers[0].animation.y[0].t,2);
});
test('loading mixed legacy storage separates clip controls while retaining explicit model ownership',()=>{
 const s=actors(),a=s.layers[0];s.tracks.push({...track('自由名称'),muted:true,clips:[sceneClip('motion',a.id,'x','a'),sceneClip('motion',a.id,'y','b')]});
 const loaded=migrateScene(s),actions=loaded.tracks.filter(t=>t.name==='自由名称');assert.equal(actions.length,2);assert.ok(actions.every(t=>t.clips.length===1&&t.muted));assert.ok(actions.every(t=>t.clips[0].layerId===a.id));
});
test('preset-driven edits detect only active unmasked channels belonging to that actor',()=>{
 const s=actors(),[a,b]=s.layers;a.model!.parameterMap={LegacyX:'ParamAngleX'};s.models=[{id:'r',name:'r',modelId:'demo',file:'m',assets:[{id:'m',name:'m',kind:'motion',duration:2,fps:30,curves:[{id:'LegacyX',target:'Parameter',keys:[{t:0,v:15,mode:'linear'}]}]}]}];
 const c=sceneClip('motion',a.id,'m','m',0,2);s.tracks.push({...track('action'),clips:[c]});const binding={layerId:a.id,channel:'param:ParamAngleX'};
 assert.equal(parameterDriven(s,binding,1),true);assert.equal(parameterDriven(s,{...binding,layerId:b.id},1),false);assert.equal(parameterDriven(s,binding,3),false);c.disabledIds=['LegacyX'];assert.equal(parameterDriven({...s},binding,1),false);
});
