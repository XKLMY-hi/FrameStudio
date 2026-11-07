import {test} from 'node:test';import assert from 'node:assert/strict';import {cubismMemoryGuard} from '../src/cubism-memory';
function fixture(){
 let heap=new ArrayBuffer(4096),next=64;const freed=new Set<number>();
 const grow=()=>{const fresh=new ArrayBuffer(heap.byteLength*2);new Uint8Array(fresh).set(new Uint8Array(heap));heap=fresh;};
 class Parameters {values:Float32Array;minimumValues:Float32Array;maximumValues:Float32Array;constructor(ptr:number){if(freed.has(ptr))throw Error('freed pointer');this.values=new Float32Array(heap,ptr,2);this.minimumValues=new Float32Array(heap,ptr+8,2);this.maximumValues=new Float32Array(heap,ptr+16,2);}}
 class Parts {opacities:Float32Array;constructor(ptr:number){this.opacities=new Float32Array(heap,ptr+24,2)}}
 class Drawables {vertexPositions:Float32Array[];constructor(ptr:number){this.vertexPositions=[new Float32Array(heap,ptr+32,4)]}}
 class Model {_ptr:number;parameters:Parameters;parts:Parts;drawables:Drawables;constructor(growLate=false){this._ptr=next;next+=128;this.parameters=new Parameters(this._ptr);this.parts=new Parts(this._ptr);this.drawables=new Drawables(this._ptr);if(growLate)grow();}static fromMoc(moc:any){return new Model(moc.growLate)}release(){freed.add(this._ptr);this._ptr=0;}}
 const Core={Parameters,Parts,Drawables,Model,Moc:{fromArrayBuffer(bytes:any){if(bytes.grow)grow();return bytes;}}};
 const owner=(raw:any)=>({_model:raw,_parameterValues:raw.parameters.values,_parameterMinimumValues:raw.parameters.minimumValues,_parameterMaximumValues:raw.parameters.maximumValues,_partOpacities:raw.parts.opacities});
 return {Core,grow,owner,buffer:()=>heap};
}
test('native heap growth rebinds all earlier parameter, limit, part and drawable views',()=>{
 const f=fixture(),g=cubismMemoryGuard(f.Core),raw=f.Core.Model.fromMoc({}),core=f.owner(raw);let dirty=0;g.track(core,()=>dirty++);const old=core._parameterValues;old[0]=12;
 f.Core.Moc.fromArrayBuffer({grow:true});assert.notEqual(raw.parameters.values.buffer,old.buffer);assert.equal(raw.parameters.values.buffer,f.buffer());assert.equal(raw.parameters.values[0],12);assert.equal(dirty,1);
 core._parameterValues[0]=-20;assert.equal(new Float32Array(f.buffer(),raw._ptr,2)[0],-20);assert.equal(core._parameterMinimumValues.buffer,f.buffer());assert.equal(core._parameterMaximumValues.buffer,f.buffer());assert.equal(core._partOpacities.buffer,f.buffer());assert.equal(raw.drawables.vertexPositions[0].buffer,f.buffer());
});
test('growth during newest model construction repairs it and older models through subsequent growths',()=>{
 const f=fixture(),g=cubismMemoryGuard(f.Core),one=f.Core.Model.fromMoc({}),core=f.owner(one);g.track(core,()=>{});const two=f.Core.Model.fromMoc({growLate:true});assert.equal(two.parameters.values.buffer,f.buffer());assert.equal(one.parameters.values.buffer,f.buffer());
 f.Core.Moc.fromArrayBuffer({grow:true});assert.equal(two.drawables.vertexPositions[0].buffer,f.buffer());assert.equal(core._parameterValues.buffer,f.buffer());assert.equal(g.growths,2);assert.equal(cubismMemoryGuard(f.Core),g);
});
test('released models and detached owners are not refreshed on later allocations',()=>{
 const f=fixture(),g=cubismMemoryGuard(f.Core),one=f.Core.Model.fromMoc({}),two=f.Core.Model.fromMoc({});let notified=0;const detach=g.track(f.owner(one),()=>notified++);detach();one.release();assert.doesNotThrow(()=>f.Core.Moc.fromArrayBuffer({grow:true}));assert.equal(notified,0);assert.equal(two.parameters.values.buffer,f.buffer());
});
