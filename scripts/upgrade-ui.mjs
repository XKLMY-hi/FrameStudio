import {readFile,writeFile} from 'node:fs/promises';
let s=await readFile('src/App.tsx','utf8');
function replace(a,b){if(!s.includes(a))throw Error('Missing: '+a.slice(0,70));s=s.replace(a,b);}
const start=s.indexOf('          <div className="assets-list">'),end=s.indexOf('          <div className="asset-bottom">',start);if(start<0||end<0)throw Error('Asset list not found');s=s.slice(0,start)+'          <AssetItems assets={project.assets} filter={assetFilter} search={search} onAdd={addFromLibrary}/>\n'+s.slice(end);
replace('<div className="workspace">','<div className={"workspace "+(!inspectorOpen?"inspector-closed":"")}>');
replace('<aside className="inspector">','<aside className="inspector" hidden={!inspectorOpen}>');
const ti=s.indexOf('          <div className="inspector-tabs">'),te=s.indexOf('          <div className="inspector-content">',ti);if(ti<0||te<0)throw Error('Inspector tabs not found');s=s.slice(0,ti)+'          <div className="inspector-header"><strong>{sideTab===\'params\'?\'参数编辑器\':sideTab===\'effects\'?\'质感效果\':\'片段设置\'}</strong><button aria-label="关闭属性面板" title="关闭（Esc）" onClick={()=>setInspectorOpen(false)}><X size={18}/></button></div>\n'+s.slice(te);
replace('            <div className="curve-section">','            <div className="curve-section">\n              <button className="curve-close" aria-label="关闭曲线编辑器" title="关闭曲线编辑器（Esc）" onClick={()=>setCurveOpen(false)}><X size={17}/></button>');
replace('          <div className="viewer-toolbar">','          <div className="viewer-toolbar">');
const toolbarMarker='              <button\n                className={project.view === "full" ? "active" : ""}';
replace(toolbarMarker,`              <select aria-label="预览清晰度" value={previewQuality} onChange={e=>setPreviewQuality(+e.target.value)}><option value="720">流畅预览</option><option value="1080">高清预览</option><option value="8192">原画预览</option></select>
              {([['clip','片段'],['params','参数'],['effects','质感']] as const).map(([id,label])=><button key={id} className={inspectorOpen&&sideTab===id?'active':''} aria-pressed={inspectorOpen&&sideTab===id} onClick={()=>{if(inspectorOpen&&sideTab===id)setInspectorOpen(false);else{setSideTab(id);setInspectorOpen(true);}}}>{label}</button>)}
`+toolbarMarker);
replace('                    if (ready)\n                      download(', '                    if (ready){renderer.current!.renderAt(pRef.current,timeRef.current,true);\n                      download(');
replace('                        project.name + ".png",\n                      );','                        project.name + ".png",\n                      );renderer.current!.invalidate();}');
replace('          if (time >= project.duration) seek(0);','          if (timeRef.current >= project.duration) seek(0);');
replace('name: "叠加动作 " + (p.tracks.length + 1),','name: "轨道 " + (p.tracks.length + 1),');replace('type: "motion",\n              muted:', 'type: "generic",\n              muted:');
replace('          帧 {Math.round(time * project.fps)} <i>·</i>{" "}','          <span data-frame>帧 {Math.round(time * project.fps)}</span> <i>·</i>{" "}');
for(const[a,b]of [['让每一帧都有表达','模型参数'],['给故事一块画布','画布设置'],['把每一帧带走','导出动画'],['光与质感','效果'],['从一个动作开始','使用指南']])s=s.replaceAll(a,b);
await writeFile('src/App.tsx',s);
