import {readFile,writeFile} from 'node:fs/promises';
let s=await readFile('src/App.tsx','utf8');
function replace(a,b){if(!s.includes(a))throw Error('Missing source marker: '+a);s=s.replace(a,b);}
replace(" const stageHost=", " const [previewValues,setPreviewValues]=useState<Record<string,number>>({});\n const stageHost=");
replace('function seek(t:number){const n=', 'function seek(t:number){setPreviewValues({});if(renderer.current)renderer.current.previewOverrides={};const n=');
replace("useEffect(()=>{const timer=setTimeout(()=>{api('autosave',project).catch(()=>{});},1200);return()=>clearTimeout(timer);},[project]);", "useEffect(()=>{if(!ready||busy)return;const timer=setTimeout(()=>{api('autosave',project).catch(()=>{});},1200);return()=>clearTimeout(timer);},[project,ready,busy]);\n useEffect(()=>{if(playing){setPreviewValues({});if(renderer.current)renderer.current.previewOverrides={};}},[playing]);");
replace("p.tracks.find(tr=>tr.type===(a.kind==='motion'?'motion':a.kind))", "p.tracks.find(tr=>tr.type===a.kind&&!tr.clips.some(old=>old.start<c.start+c.duration&&old.start+old.duration>c.start))");
replace("function setParameter(id:string,value:number){if(!autoKey)return;", "function setParameter(id:string,value:number,force=false){if(!autoKey&&!force){const next={...previewValues,[id]:value};setPreviewValues(next);if(renderer.current){renderer.current.previewOverrides=next;renderer.current.resetPhysics();}setSelectedParam(id);return;}setPreviewValues(v=>{const n={...v};delete n[id];if(renderer.current)renderer.current.previewOverrides=n;return n;});");
replace('const evaluated=evaluate(project,params,time),visibleAssets=', 'const evaluated=evaluate(project,params,time);Object.assign(evaluated.parameters,previewValues);const visibleAssets=');
replace('setParameter(param.id,evaluated.parameters[param.id]??param.default)', 'setParameter(param.id,evaluated.parameters[param.id]??param.default,true)');
replace('setParameter(p.id,evaluated.parameters[p.id]??p.default)', 'setParameter(p.id,evaluated.parameters[p.id]??p.default,true)');
replace('renderer.current!.resetPhysics();for(let i=0;', 'renderer.current!.previewOverrides={};renderer.current!.resetPhysics();for(let i=0;');
replace('fadeIn:Math.min(a.fadeIn??.2,a.duration/3),fadeOut:Math.min(a.fadeOut??.2,a.duration/3)', 'fadeIn:Math.min(Math.max(0,a.fadeIn??.2),a.duration/3),fadeOut:Math.min(Math.max(0,a.fadeOut??.2),a.duration/3)');
await writeFile('src/App.tsx',s);
