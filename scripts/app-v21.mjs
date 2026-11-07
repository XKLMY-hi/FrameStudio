import fs from 'node:fs/promises';
const file='src/theater/TheaterApp.tsx';let s=await fs.readFile(file,'utf8');
function replace(a,b){if(!s.includes(a))throw Error('Missing '+a.slice(0,70));s=s.replace(a,b);}
replace('import { SceneTimeline } from "./SceneTimeline";','import { SceneTimeline } from "./SceneTimeline";\nimport { Binding, readProperty, writeProperty, propertiesOf } from "./properties";\nimport { AudioLibraryPreview } from "./AudioLibraryPreview";');
replace('    [previewId, setPreviewId] = useState(""),','    [previewId, setPreviewId] = useState(""),\n    [motionPreviewId,setMotionPreviewId]=useState(""),\n    [motionTargetId,setMotionTargetId]=useState(""),\n    [timelineHeight,setTimelineHeight]=useState(370),\n    [exportMatte,setExportMatte]=useState("#ffffff"),');
replace('[exportFormat, setExportFormat] = useState("webm")','[exportFormat, setExportFormat] = useState("mp4")');
replace('    clipboard = useRef<SceneClip[]>([]);','    clipboard = useRef<SceneClip[]>([]),\n    motionPreviewRef=useRef<{started:number,duration:number}|undefined>(undefined);');
replace('.find((c) => selection.includes(c.id)),','.find((c) => selection.includes(c.id) && c.layerId===selected),');
replace('  function notify(s: string) {','  const motionLayer=selectedLayer?.model?selectedLayer:scene.layers.find(l=>l.id===motionTargetId&&l.model);\n  const motionResource=scene.models.find(r=>r.id===motionLayer?.model?.resourceId);\n  const paramsByLayer=useMemo(()=>Object.fromEntries(scene.layers.filter(l=>l.model).map(l=>[l.id,rRef.current?.nodes.get(l.id)?.runtime?.params || []])),[scene.layers,modelVersion]);\n  const currentBinding:Binding={layerId:selected,channel,clipId:selectedClip?.id};\n  function notify(s: string) {');
replace('  function change(mut: Scene | ((s: Scene) => void), record = true) {','  function change(mut: Scene | ((s: Scene) => void), record = true) {\n    stopMotionPreview();');
replace('  function seek(t: number) {','  function seek(t: number) {\n    stopMotionPreview();');
replace('  function selectLayer(id: string) {\n    setSelected(id);','  function selectLayer(id: string) {\n    stopMotionPreview();\n    setSelection([]);\n    if(sRef.current.layers.find(l=>l.id===id)?.model)setMotionTargetId(id);\n    setSelected(id);');
replace('    setSelection(ids);\n    const c =','    const c =');
replace('      selectLayer(c.layerId);\n      setInspector(','      selectLayer(c.layerId);\n      setSelection(ids);\n      setInspector(');
replace('      if (c.kind === "audio") setChannel("gain");','      if (c.kind === "audio") setChannel("gain");\n      else if(c.kind==="motion"){const a=sRef.current.models.find(r=>r.id===sRef.current.layers.find(l=>l.id===c.layerId)?.model?.resourceId)?.assets.find(a=>a.id===c.assetId);if(a?.curves[0])setChannel("motion:"+a.curves[0].id);}');
// Playback audition lives in renderer state, never in the serialized scene.
replace('  function previewAudio(a: MediaAsset) {',`  function stopMotionPreview(){
    motionPreviewRef.current=undefined;
    if(rRef.current?.motionPreview){rRef.current.motionPreview=undefined;rRef.current.invalidate();setMotionPreviewId("");}
  }
  function previewMotion(asset:Asset,targetId=motionLayer?.id){
    if(!targetId){notify("先指定预览对象");return;}
    if(motionPreviewId===asset.id&&rRef.current?.motionPreview){stopMotionPreview();return;}
    stopMotionPreview();setPlaying(false);playRef.current=false;preview.current?.pause();setPreviewId("");for(const a of audioPlayers.current.values())a.pause();
    const target=sRef.current.layers.find(l=>l.id===targetId);if(!target?.model)return;
    const project=modelProject(sRef.current,target),duration=Math.max(.1,asset.duration),c=sceneClip('motion',target.id,asset.id,asset.name,0,duration);
    c.fadeIn=c.fadeOut=0;c.blend='override';
    const audition={...project,physics:target.model.physics,duration,assets:[asset],tracks:[{id:'audition',name:'预览',type:'generic' as const,muted:false,solo:false,clips:[c]}]};
    if(!visualClip(sRef.current,target.id,tRef.current)){const vc=sRef.current.tracks.flatMap(t=>t.clips).find(c=>c.kind==='visual'&&c.layerId===target.id);if(vc)seek(vc.start);}
    rRef.current!.motionPreview={layerId:targetId,project:audition,time:0};motionPreviewRef.current={started:performance.now(),duration};setMotionPreviewId(asset.id);rRef.current!.invalidate();
  }
  function previewAudio(a: MediaAsset) {\n    stopMotionPreview();`);
replace('      const r = rRef.current,\n        p = sRef.current,','      if(motionPreviewRef.current && rRef.current?.motionPreview){\n        const audition=motionPreviewRef.current,elapsed=(now-audition.started)/1000;\n        if(elapsed>=audition.duration)stopMotionPreview();else {rRef.current.motionPreview.time=elapsed;rRef.current.invalidate();}\n      }\n      const r = rRef.current,\n        p = sRef.current,');
replace('190 + t * Number(h.dataset.zoom || 70)', 'Number(h.dataset.label || 340) + t * Number(h.dataset.zoom || 70)');
replace('payload: { kind: string; id: string },','payload: { kind: string; id: string; targetLayerId?:string },');
replace('    start = tRef.current,\n  ) {','    start = tRef.current,\n    targetLayerId?:string,\n  ) {');
replace('      const l =\n        selectedLayer?.kind === "model"\n          ? selectedLayer\n          : scene.layers.find((l) => l.kind === "model");','      const l = sRef.current.layers.find(l=>l.id===(targetLayerId || payload.targetLayerId || motionLayer?.id) && l.model);');
replace('      const res = scene.models.find((r) => r.id === l?.model?.resourceId),','      const res = sRef.current.models.find((r) => r.id === l?.model?.resourceId),');
replace('    if (id && !selectedMedia.cues?.length) await analyze(selectedMedia);','    // Binding is explicit and does not start speech recognition.');
// Replace the coupled curve writer and slider routing with owner-addressed operations.
const a=s.indexOf('  function writeKeys(keys: Key[]) {'),b=s.indexOf('  function record(',a);if(a<0||b<0)throw Error('writer');s=s.slice(0,a)+`  function writeKeys(keys:Key[]){change(s=>writeProperty(s,currentBinding,keys));}
  function selectProperty(binding:Binding,index=-1){
    selectLayer(binding.layerId);setSelection(binding.clipId?[binding.clipId]:[]);setChannel(binding.channel);setKeyIndex(index);
    if(binding.channel.startsWith('param:')||binding.channel.startsWith('motion:'))setInspector('controller');
    if(binding.channel==='gain')setInspector('audio');
  }
  function editProperty(binding:Binding,v:number,force=false){
    if(!Number.isFinite(v))return;
    const data=readProperty(sRef.current,binding,tRef.current),l=sRef.current.layers.find(l=>l.id===binding.layerId);
    const param=paramsByLayer[binding.layerId]?.find(p=>'param:'+p.id===binding.channel),base=param?(l?.model?.baseValues[param.id]??param.default):data.base;
    if(l?.locked)return;
    change(s=>{
      const target=s.layers.find(l=>l.id===binding.layerId),local=Math.max(0,(tRef.current-data.offset)*data.speed);
      if(force||autoKey||data.keys.length||binding.channel.startsWith('motion:')){
        const keys=cloneData(data.keys);if(!keys.length&&local>1/s.fps)keys.push({t:0,v:base,mode:'bezier'});upsertKey(keys,local,v,s.fps);writeProperty(s,binding,keys);
      }else if(binding.layerId==='@camera')(s.camera as any)[binding.channel]=v;
      else if(target){if(binding.channel.startsWith('param:')&&target.model)target.model.baseValues[binding.channel.slice(6)]=v;
        else if(binding.channel.startsWith('effects.'))(target.effects as any)[binding.channel.slice(8)]=v;
        else if(binding.channel==='gain'){const keys=[{t:0,v,mode:'linear' as const}];writeProperty(s,binding,keys);}
        else (target.transform as any)[binding.channel]=v;}
    });
  }
  function recordProperty(binding:Binding){const data=readProperty(sRef.current,binding,tRef.current),p=paramsByLayer[binding.layerId]?.find(p=>'param:'+p.id===binding.channel),l=sRef.current.layers.find(l=>l.id===binding.layerId),value=data.keys.length?data.value:p?(l?.model?.baseValues[p.id]??p.default):data.base;selectProperty(binding);editProperty(binding,value,true);}
`+s.slice(b);
const c=s.indexOf('  function setValue('),d=s.indexOf('  function canvasPointer(',c);if(c<0||d<0)throw Error('slider');s=s.slice(0,c)+`  function setValue(id:string,v:number,force=false){setChannel(id);editProperty({layerId:selected,channel:id,clipId:selectedClip?.id},v,force);}
`+s.slice(d);
replace('motions = (resource?.assets || [])','motions = (motionResource?.assets || [])');
replace('<div className="theater-app">','<div className="theater-app" style={{gridTemplateRows:"64px minmax(180px,1fr) "+timelineHeight+"px 25px"}}>');
replace('onClick={(e) => e.stopPropagation()}\n                    onChange={(e)', 'onClick={(e) => {e.stopPropagation();selectLayer(l.id);}}\n                    onFocus={()=>selectLayer(l.id)}\n                    onChange={(e)');
replace('                {!resource ? (','                <label className="stack-field">预览 / 添加到对象<select aria-label="动作目标对象" value={motionLayer?.id || ""} onChange={e=>selectLayer(e.target.value)}><option value="">选择模型对象</option>{scene.layers.filter(l=>l.model).map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>\n                {motionPreviewId && <button className="wide-button" onClick={stopMotionPreview}>停止动作预览 · 恢复场景</button>}\n                {!motionResource ? (');
replace('                      key={a.id}\n                      draggable','                      key={a.id}\n                      data-motion-id={a.id}\n                      className={"motion-card "+(motionPreviewId===a.id?"audition-active":"")}\n                      onClick={()=>previewMotion(a)}\n                      draggable');
// remove the duplicate className added to motion cards above
replace('className="motion-card"\n                      key={a.id}','key={a.id}');
replace('JSON.stringify({ kind: "motion", id: a.id })','JSON.stringify({ kind: "motion", id: a.id, targetLayerId:motionLayer?.id })');
replace('                      onDoubleClick={() =>\n                        addAsset({ kind: "motion", id: a.id })\n                      }','                      onDoubleClick={() => addAsset({ kind: "motion", id: a.id })}');
replace('                        onClick={() => addAsset({ kind: "motion", id: a.id })}','                        title="将动作加入指定对象"\n                        onClick={(e) => {e.stopPropagation();addAsset({ kind: "motion", id: a.id });}}');
const oldAudio=`                {a.kind === "audio" && (
                  <button title="离线生成口型" onClick={() => analyze(a)}>
                    <Volume2 size={14} />
                  </button>
                )}`;
replace(oldAudio,'                {a.kind === "audio" && previewId===a.id && <AudioLibraryPreview audio={preview.current!} asset={a}/>}');
replace('title={previewId === a.id ? "停止试听" : "试听音频"}','title={previewId === a.id ? "停止库内预览" : "库内预览播放"}');
replace('                      <button\n                        className="wide-button"\n                        onClick={() => previewAudio(selectedMedia)}','                      <button\n                        className="wide-button"\n                        onClick={() => {setLibraryTab("audio");previewAudio(selectedMedia);}}');
replace('                        试听原音频','                        在音频库预览');
replace('                      <label className="stack-field">\n                        口型绑定模型','                      <button className="wide-button" disabled={!!busy} onClick={()=>analyze(selectedMedia)}>识别口型（仅此音频）</button>\n                      <p className="property-note">背景音乐无需识别口型。识别后，手动选择要驱动的角色。</p>\n                      <label className="stack-field">\n                        口型绑定模型');
replace('        scene={scene}\n        time={time}','        scene={scene}\n        selectedLayerId={selected}\n        selectedBinding={currentBinding}\n        paramsByLayer={paramsByLayer}\n        onSelectLayer={selectLayer}\n        onBinding={selectProperty}\n        onRecord={recordProperty}\n        onValue={editProperty}\n        onWriteKeys={(b,keys)=>change(s=>writeProperty(s,b,keys))}\n        height={timelineHeight}\n        onHeight={setTimelineHeight}\n        time={time}');
// Expose owner-addressed editing for regression checks as well as the UI.
replace('      loadScene,\n    };','      loadScene,\n      editProperty,selectProperty,previewMotion,stopMotionPreview,\n    };');
await fs.writeFile(file,s);
