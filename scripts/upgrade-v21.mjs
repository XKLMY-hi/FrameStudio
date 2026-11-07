import fs from 'node:fs/promises';
const file='src/theater/SceneTimeline.tsx';let s=await fs.readFile(file,'utf8');
s=s.replace('useRef, useState','useRef, useState, useMemo');
s=s.replace('import { Key }','import { Key, Param }');
s=s.replace('import { Scene, SceneClip } from "./schema";','import { Scene, SceneClip } from "./schema";\nimport {Binding, bindingId, clipsOf, propertiesOf, readProperty, movePropertyKey} from "./properties";');
s=s.replace('  scene: Scene;','  scene: Scene;\n  selectedLayerId:string;\n  selectedBinding:Binding;\n  paramsByLayer:Record<string,Param[]>;\n  onSelectLayer:(id:string)=>void;\n  onBinding:(binding:Binding,index?:number)=>void;\n  onRecord:(binding:Binding)=>void;\n  onValue:(binding:Binding,value:number)=>void;\n  onWriteKeys:(binding:Binding,keys:Key[])=>void;\n  onHeight:(n:number)=>void;\n  height:number;');
s=s.replace('onDrop: (payload: any, track: string, t: number)', 'onDrop: (payload: any, track: string | undefined, t: number, targetLayerId?:string)');
s=s.replace('    label = 190,','    label = 340,');
const shiftStart=s.indexOf('          const shift = Math.round('),shiftEnd=s.indexOf('\n        }\n        for (const t',shiftStart);if(shiftStart<0||shiftEnd<0)throw Error('drag anchor');s=s.slice(0,shiftStart)+s.slice(shiftEnd);
s=s.replace('if (p.scene.tracks[trIndex].locked) return;', 'if (p.scene.tracks[trIndex].locked || p.scene.layers.find(l=>l.id===c.layerId)?.locked) return;');
const helpers=await fs.readFile('scripts/timeline-helpers.txt','utf8');
s=s.replace('  const interval =',helpers+'\n  const interval ='); // callbacks evaluate interval during render after initialization below
// objectRows invokes lane before interval is initialized; put the declaration before the helpers.
const intervalText='  const interval = px >= 90 ? 1 : px >= 45 ? 2 : 5;';s=s.replace(intervalText,'');s=s.replace('  const [expanded',intervalText+'\n  const [expanded');
const start=s.indexOf('          {p.scene.tracks.map((tr, index) => ('),end=s.indexOf('          <div\n            className="scene-playhead"',start);if(start<0||end<0)throw Error('rows anchor');
s=s.slice(0,start)+`          <div className="ae-row ae-object"><div className="scene-track-label"><button aria-label="展开相机" onClick={()=>toggle('@camera')}>{isOpen('@camera')?'▾':'▸'}</button><button className="object-name" onClick={()=>p.onSelectLayer('@camera')}>相机</button></div>{lane(null)}</div>
          {isOpen('@camera')&&propertyRows('@camera','相机',1)}
          {rows}
`+s.slice(end);
s=s.replace('            data-zoom={px}','            data-zoom={px}\n            data-label={label}');
s=s.replace('29 + p.scene.tracks.length * 54 + (p.keys.length ? 40 : 0)','"100%"');
s=s.replace('通用轨道 · {p.scene.fps} FPS','对象 / 属性 · {p.scene.fps} FPS');
s=s.replace('<section className={"scene-timeline " + (dragging ? "dragging" : "")}>','<section className={"scene-timeline ae-timeline " + (dragging ? "dragging" : "")}>\n      <div className="timeline-resize" title="拖动调整时间线高度" onPointerDown={e=>{e.preventDefault();const y=e.clientY,h=p.height;const move=(ev:PointerEvent)=>p.onHeight(clamp(h+y-ev.clientY,200,window.innerHeight*.7));const up=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up)};window.addEventListener("pointermove",move);window.addEventListener("pointerup",up);}}/>');
const addStart=s.indexOf('          <button\n            onClick={() =>\n              p.onChange('),addEnd=s.indexOf('          <button title="分割',addStart);
if(addStart>=0&&addEnd>=0)s=s.slice(0,addStart)+s.slice(addEnd); // no anonymous track creation in the object view
s=s.replace('<div className="scene-timeline-scroll" ref={scroller}>','<div className="ae-toolbar"><input aria-label="搜索时间线对象或属性" placeholder="搜索对象 / 参数" value={filter} onChange={e=>setFilter(e.target.value)}/><label><input type="checkbox" checked={animatedOnly} onChange={e=>setAnimatedOnly(e.target.checked)}/>仅动画属性</label><span>属性独立成行 · 动作拖入指定对象 · 关键帧右键删除</span></div>\n      <div className="scene-timeline-scroll" ref={scroller}>');
await fs.writeFile(file,s);
