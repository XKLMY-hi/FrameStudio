import fs from 'node:fs/promises';let s=await fs.readFile('src/theater/TheaterApp.tsx','utf8');
const replace=(a,b)=>{if(!s.includes(a))throw Error('Missing '+a.slice(0,70));s=s.replace(a,b);};
replace('  Box,','  Box,\n  Lamp,');
replace('import { AudioEditor }','import {LightPanel} from "./LightPanel";\nimport {ModelPreprocessPanel} from "./ModelPreprocessPanel";\nimport {preprocessingScene} from "./preprocess";\nimport { AudioEditor }');
replace('  SceneEffects,','  SceneEffects,\n  SceneLight,defaultLight,MAX_SCENE_LIGHTS,sceneEffects,');
replace('  audio: <Music2 size={16} />,','  audio: <Music2 size={16} />,\n  light:<Lamp size={16}/>,');
replace('    [dirty, setDirty] = useState(false);','    [dirty, setDirty] = useState(false),\n    [workspaceMode,setWorkspaceMode]=useState<"scene"|"preprocess">("scene"),\n    [preprocessId,setPreprocessId]=useState("");');
replace('    sRef = useRef(scene),','    sRef = useRef(scene),\n    displayRef=useRef(scene),modeRef=useRef<"scene"|"preprocess">("scene"),\n    savedSceneView=useRef({panX:0,panY:0,zoom:1}),lastMode=useRef("scene"),');
replace('  const currentBinding: Binding = {','  const preprocessingResource=scene.models.find(r=>r.id===preprocessId) || resource || scene.models[0];\n  const displayScene=useMemo(()=>workspaceMode==="preprocess"?preprocessingScene(scene,preprocessingResource?.id || ""):scene,[scene,workspaceMode,preprocessingResource?.id]);\n  displayRef.current=displayScene;modeRef.current=workspaceMode;\n  const currentBinding: Binding = {');
replace('    if (next === current) return;','    if (next === current) return;\n    if(next.layers.filter(l=>l.kind==="light").length>MAX_SCENE_LIGHTS){notify("每个场景最多 "+MAX_SCENE_LIGHTS+" 个光源");return;}');
replace('  async function loadScene(s: Scene) {','  async function loadScene(s: Scene) {\n    setWorkspaceMode("scene");');
replace('      ?.ensure(scene)','      ?.ensure(displayScene)');
replace('  }, [scene.layers, scene.models, scene.assets]);','  }, [displayScene.layers, displayScene.models, displayScene.assets]);\n  useEffect(()=>{const r=rRef.current;if(!r)return;if(workspaceMode!==lastMode.current){if(workspaceMode==="preprocess"){savedSceneView.current={...r.view};r.view={panX:0,panY:0,zoom:1};}else r.view={...savedSceneView.current};lastMode.current=workspaceMode;r.invalidate();}},[workspaceMode]);');
replace('      if (playRef.current && !busyRef.current) {','      if (modeRef.current==="scene" && playRef.current && !busyRef.current) {');
replace('        p = sRef.current,\n        t = tRef.current;','        p = displayRef.current,\n        t = modeRef.current==="preprocess"?0:tRef.current;');
replace('        model: "角色",','        model: "角色",\n        light:"点光源",');
replace('  function addLayer(kind: Layer["kind"]) {',`  function openPreprocess(id=resource?.id || scene.models[0]?.id || ''){
    stopMotionPreview();setPlaying(false);playRef.current=false;preview.current?.pause();setPreviewId('');for(const a of audioPlayers.current.values())a.pause();
    setPreprocessId(id);setWorkspaceMode('preprocess');setLibraryTab('model');setCurveOpen(false);setInspectorOpen(true);
  }
  function addLight(type:SceneLight['type']){
    if(scene.layers.filter(l=>l.light).length>=MAX_SCENE_LIGHTS){notify('已达到光源数量上限');return;}
    const names={point:'点光源',area:'面光源',sun:'日光',ambient:'环境光'},l=layer('light',names[type]+' '+(scene.layers.filter(l=>l.light).length+1));l.light=defaultLight(type);
    change(s=>{s.lighting=s.lighting || {enabled:true,ambient:.7,color:'#ffffff',exposure:1};addVisual(s,l,tRef.current,Math.max(.1,s.duration-tRef.current));});selectLayer(l.id);setWorkspaceMode('scene');
  }
  function addLayer(kind: Layer["kind"]) {`);
replace('    if (e.button !== 0) return;','    if(modeRef.current==="preprocess")return;\n    if (e.button !== 0) return;');
replace('    const corner = hit?.points.find(','    const corner = l.kind==="light"?undefined:hit?.points.find(');
replace('      if (editing || modal) return;','      if(modeRef.current==="preprocess"){if(e.ctrlKey&&e.key.toLowerCase()==="s"){e.preventDefault();saveProject();}return;}\n      if (editing || modal) return;');
replace('      loadScene,','      loadScene,\n      addLight,openPreprocess,\n      get displayScene(){return displayRef.current;},\n      setWorkspaceMode,');
replace('          "64px minmax(180px,1fr) " + timelineHeight + "px 25px",','          "64px minmax(180px,1fr) " + (workspaceMode==="preprocess"?0:timelineHeight) + "px 25px",');
replace('        <aside className="theater-library">','        {workspaceMode==="preprocess"&&<aside className="theater-library preprocess-library"><h3>模型素材</h3><p className="property-note">选择要准备基础质感的模型</p><div className="scene-asset-list">{scene.models.map(r=><button className={"preprocess-resource "+(preprocessingResource?.id===r.id?"active":"")} key={r.id} onClick={()=>setPreprocessId(r.id)}>{r.name}<small>{r.preprocess?.enabled===false?"预处理关闭":r.preprocess?"已设置基础质感":"原始质感"}</small></button>)}</div><button className="wide-button" onClick={()=>modelInput.current?.click()}>导入模型 ZIP</button><button className="wide-button" onClick={()=>setWorkspaceMode("scene")}>返回场景</button></aside>}\n        <aside className="theater-library" hidden={workspaceMode==="preprocess"}>');
replace('                    <Layers size={23} />','                    <Layers size={23} />');
replace('                    <button\n                      title="创建独立模型容器"','                    <button title={"预处理 "+m.name} onClick={()=>openPreprocess(m.id)}><SlidersHorizontal size={15}/></button>\n                    <button\n                      title="创建独立模型容器"');
replace('                </div>\n              </details>\n            </div>\n            <div className="layer-list">','                  <div className="menu-divider"/>{(["point","area","sun","ambient"] as const).map(type=><button key={type} onClick={()=>addLight(type)}><Lamp size={14}/>{{point:"点光源",area:"面光源",sun:"日光 / 平行光",ambient:"环境光"}[type]}</button>)}\n                </div>\n              </details>\n            </div>\n            <div className="layer-list">');
replace('            <div>\n              <button\n                className={\n                  inspectorOpen && inspector === "layer"','            <div>\n              <button className={workspaceMode==="preprocess"?"active":""} onClick={()=>workspaceMode==="preprocess"?setWorkspaceMode("scene"):openPreprocess()}>模型预处理</button>\n              {workspaceMode==="preprocess"&&<button onClick={()=>setWorkspaceMode("scene")}>返回场景</button>}\n              <button\n                className={\n                  inspectorOpen && inspector === "layer"');
replace('                  setInspector("layer");\n                  setInspectorOpen','                  setWorkspaceMode("scene");setInspector("layer");\n                  setInspectorOpen');
replace('                  setInspector("controller");\n                  setInspectorOpen','                  setWorkspaceMode("scene");setInspector("controller");\n                  setInspectorOpen');
replace('                  setSelected("@camera");','                  setWorkspaceMode("scene");setSelected("@camera");');
replace('          {curveOpen && (','          {curveOpen && workspaceMode==="scene" && (');
replace('{inspector === "controller"\n                ? "独立模型控制器"','{workspaceMode==="preprocess"?"模型预处理 · 素材级":inspector === "controller"\n                ? "独立模型控制器"');
replace('            {inspector === "camera" ? (','            {workspaceMode==="preprocess"?<ModelPreprocessPanel resource={preprocessingResource} onChange={value=>change(s=>{const r=s.models.find(r=>r.id===preprocessingResource?.id);if(r)r.preprocess=value;})}/>:inspector === "camera" ? (');
replace('                    效果\n                  </button>','                    场景后处理\n                  </button>');
replace('                {inspector === "layer" && (\n                  <>','                {inspector === "layer" && (\n                  <>\n                    {selectedLayer.light&&<LightPanel scene={scene} layer={animated!} onChange={patch=>updateLayer(l=>Object.assign(l.light!,patch))} onScene={value=>change(s=>{s.lighting=value})} onValue={setValue} onKey={id=>setValue(id,(animated!.light as any)[id.slice(6)],true)}/>}');
replace('                    {effectFields.map(([id, name, min, max]) => (','                    {effectFields.map(([id, name, min, max]) => (');
replace('                    <p className="property-note">\n                      {selectedLayer.kind === "adjustment"','                    <p className="property-note">此处是当前场景实例的后处理，独立于模型素材预处理。</p>\n                    {selectedLayer.model&&<button className="wide-button" onClick={()=>openPreprocess(selectedLayer.model!.resourceId)}>打开模型素材预处理</button>}\n                    <p className="property-note">\n                      {selectedLayer.kind === "adjustment"');
replace('                      模拟灯光','                      旧版局部补光（兼容旧工程）');
replace('            <div className="inspector-bottom">','            <div className="inspector-bottom" style={{display:workspaceMode==="preprocess"?"none":undefined}}>');
replace('      <SceneTimeline','      <div className="timeline-slot" style={{visibility:workspaceMode==="preprocess"?"hidden":"visible"}}>\n      <SceneTimeline');
replace('      <footer className="theater-status">','      </div>\n      <footer className="theater-status">');
replace('        else if (binding.channel === "gain") {','        else if(binding.channel.startsWith("light.")&&target.light)(target.light as any)[binding.channel.slice(6)]=v;\n        else if(binding.channel.startsWith("surface.")){target.surface=target.surface || {roughness:.55,specular:.25,rim:.25,bump:0};(target.surface as any)[binding.channel.slice(8)]=v;}\n        else if (binding.channel === "gain") {');
replace('      : channel === "reveal"','      : channel.startsWith("light.")?(animated!.light as any)?.[channel.slice(6)]:channel.startsWith("surface.")?(animated!.surface as any)?.[channel.slice(8)]:channel === "reveal"');
replace('      label: channels.find((c) => c[0] === channel)?.[1] || channel,','      label: channels.find((c) => c[0] === channel)?.[1] || propertiesOf(scene,selected,params).find(p=>p.channel===channel)?.name || channel,');
replace('            ...(selectedClip?.kind === "audio" ? [["gain", "音频音量"]] : []),','            ...(selectedClip?.kind === "audio" ? [["gain", "音频音量"]] : []),\n            ...propertiesOf(scene,selected,params).filter(p=>p.channel.startsWith("light.")||p.channel.startsWith("surface.")).map(p=>[p.channel,p.name]),');
await fs.writeFile('src/theater/TheaterApp.tsx',s);
