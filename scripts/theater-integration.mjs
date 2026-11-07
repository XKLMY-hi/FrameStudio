import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {_electron as electron} from 'playwright';
import {unzipSync,strFromU8} from 'fflate';
import {emptyScene,layer,addVisual,sceneClip,track} from '../src/theater/schema.ts';
const root=process.cwd(),report=JSON.parse(await fs.readFile('qa/theater-smoke-report.json','utf8')),dir=report.appRoot;
for(const d of ['dist','backend','electron'])await fs.cp(path.join(root,d),path.join(dir,d),{recursive:true});
const svg=path.join(root,'qa/theater-background.svg');
await fs.writeFile(svg,`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#b9d3df"/><stop offset="1" stop-color="#f5e8d8"/></linearGradient></defs><path fill="url(#sky)" d="M0 0h1280v720H0z"/><path fill="#718c9b" opacity=".4" d="M0 280h180V90h115v240h170V150h140v220h170V110h140v220h145V180h220v540H0z"/><path fill="#e7ddd4" d="M0 490h1280v230H0z"/><path stroke="#fff" stroke-width="8" opacity=".6" d="M0 490h1280M150 490 0 720M1130 490l150 230"/></svg>`);
const app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[dir],env:{...process.env,STUDIO_TEST_MODE:''}});
const p=await app.firstWindow(),errors=[];p.on('pageerror',e=>{errors.push(e.message);console.log('PAGE_ERROR',e.message)});p.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('CONSOLE',m.text().slice(0,250));}});
const out={};
const api=async(name,body)=>p.evaluate(async({name,body})=>{const r=await fetch('/api/'+name,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+new URL(location.href).searchParams.get('token'),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error);return data;},{name,body});
try{
 await p.waitForFunction(()=>window.theater?.ready,null,{timeout:90000});
 const initial=await p.evaluate(()=>structuredClone(theater.scene)),fresh=emptyScene();
 fresh.models=[initial.models[0]];const actor=initial.layers.find(l=>l.model);actor.parentId=null;actor.transform={...layer('model','').transform};actor.animation={};actor.model.keys=[];addVisual(fresh,actor,0,12);
 await p.evaluate(async s=>await theater.loadScene(s),fresh);
 await p.locator('input[type=file][accept*=".png"]').setInputFiles([svg,'C:/Windows/Fonts/arial.ttf']);
 await p.waitForFunction(()=>theater.scene.assets.some(a=>a.kind==='font')&&theater.scene.assets.some(a=>a.kind==='image'));
 await p.locator('input[type=file][accept^="audio"]').setInputFiles(path.join(root,'qa/test-voice.wav'));
 await p.waitForFunction(()=>theater.scene.assets.some(a=>a.kind==='audio'),null,{timeout:30000});
 console.log('IMPORTED',await p.evaluate(()=>theater.scene.assets.map(a=>({kind:a.kind,duration:a.duration,waveform:a.waveform?.length}))));
 const voice=await p.evaluate(()=>theater.scene.assets.find(a=>a.kind==='audio'));
 assert.ok(Math.abs(voice.duration-3.8583125)<.01);assert.ok(voice.waveform.length>10);
 const analyzed=await api('audio-analyze',{path:voice.path});assert.ok(analyzed.cues.length>5);out.lipCues=analyzed.cues.length;
 await p.evaluate(({id,data})=>theater.change(s=>{const a=s.assets.find(a=>a.id===id);Object.assign(a,data);}),{id:voice.id,data:analyzed});
 // Exercise proxy-safe actor duplication through the actual application command.
 await p.evaluate(()=>theater.selectLayer(theater.scene.layers.find(l=>l.kind==='model').id));
 await p.waitForTimeout(100);await p.evaluate(()=>theater.duplicateLayer());
 await p.waitForFunction(()=>[...theater.renderer.nodes.values()].filter(n=>n.runtime?.model).length>=2,null,{timeout:60000});
 let scene=await p.evaluate(()=>structuredClone(theater.scene));scene.name='街角对白 · 小剧场示例';scene.duration=6;scene.workArea={start:0,end:6,loop:true};
 scene.layers=scene.layers.filter(l=>l.kind==='model').slice(0,2);const [a,b]=scene.layers;
 a.name='主角 · 独立控制器';b.name='远景角色 · 独立控制器';
 for(const [l,x,z,angle] of [[a,-215,0,16],[b,310,310,-18]]){l.is3D=true;l.transform.x=x;l.transform.z=z;l.transform.scaleX=l.transform.scaleY=.82;l.model.physics=false;l.model.keys=[{id:'ParamAngleX',target:'Parameter',keys:[{t:0,v:angle,mode:'linear'},{t:6,v:angle,mode:'linear'}]}];}
 scene.tracks=[];for(const [i,l] of scene.layers.entries()){const tr=track(i?'远景角色':'角色与镜头');tr.clips.push(sceneClip('visual',l.id,l.id,l.name,0,6));scene.tracks.push(tr);}
 const image=scene.assets.find(a=>a.kind==='image'),bg=layer('image','街角背景');bg.assetId=image.id;bg.width=1280;bg.height=720;bg.is3D=true;bg.transform.z=600;bg.transform.scaleX=bg.transform.scaleY=1.6;addVisual(scene,bg,0,6);scene.layers=scene.layers.filter(l=>l.id!==bg.id);scene.layers.unshift(bg);
 const group=layer('group','角色组');scene.layers.push(group);a.parentId=b.parentId=group.id;
 const fx=layer('adjustment','角色柔光 · 后处理层');fx.parentId=group.id;fx.effects.bloom=.18;fx.effects.gloss=.12;addVisual(scene,fx,0,6);
 const text=layer('text','对白 · 打字机');text.width=1100;text.height=120;text.transform.y=266;text.text.value='你好，这是我们的小剧场。';text.text.fontSize=36;text.text.strokeWidth=3;text.text.charsPerSecond=7;addVisual(scene,text,.4,5.6);
 const title=layer('text','场景标题');title.width=1100;title.height=90;title.transform.y=-294;title.text.value='SCENE 01   /   街角相逢';title.text.fontSize=30;title.text.fill='#334456';title.text.animation='none';addVisual(scene,title,0,6);
 const audio=layer('audio','对白音轨');audio.assetId=voice.id;scene.layers.push(audio);const audioTrack=track('对白与口型'),ac=sceneClip('audio',audio.id,voice.id,'你好 · 配音',.6,voice.duration);Object.assign(ac,{fadeIn:.4,fadeOut:.6,fadeCurve:'equalPower',weight:.7,lipTarget:a.id,lipEnabled:true,lipWeight:1,gainKeys:[{t:0,v:1,mode:'linear'},{t:voice.duration,v:.8,mode:'linear'}]});audioTrack.clips.push(ac);scene.tracks.push(audioTrack);
 scene.camera.dof=true;scene.camera.aperture=.13;scene.camera.focusZ=0;scene.camera.animation.zoom=[{t:0,v:1,mode:'linear'},{t:6,v:1.08,mode:'linear'}];scene.markers=[{id:'line',t:.6,name:'配音入点'}];
 await p.evaluate(async s=>{await theater.loadScene(s);theater.seek(1.8)},scene);await p.waitForTimeout(800);
 out.controllers=await p.evaluate(()=>{const s=theater.scene,r=theater.renderer,ls=s.layers.filter(l=>l.kind==='model'),ns=ls.map(l=>r.nodes.get(l.id));return {head:ns.map(n=>n.runtime.model.internalModel.coreModel.getParameterValueById('ParamAngleX')),independent:ns[0].runtime.model.internalModel.coreModel!==ns[1].runtime.model.internalModel.coreModel,contexts:new Set(ns.map(n=>n.runtime.app)).size,blur:!!ns[1].blur,fonts:document.fonts.check('16px '+s.assets.find(a=>a.kind==='font').fontFamily)};});
 assert.deepEqual(out.controllers.head,[16,-18]);assert.ok(out.controllers.independent&&out.controllers.blur&&out.controllers.fonts);assert.equal(out.controllers.contexts,1);
 out.mouth=await p.evaluate(()=>{const s=theater.scene,r=theater.renderer,ls=s.layers.filter(l=>l.kind==='model'),values=[];for(let t=.8;t<3;t+=.1){r.renderAt(s,t,true);values.push(ls.map(l=>r.nodes.get(l.id).runtime.model.internalModel.coreModel.getParameterValueById(l.model.lipOpen)));}r.invalidate();return values;});assert.ok(out.mouth.some(v=>v[0]>.1));assert.ok(out.mouth.every(v=>Math.abs(v[1])<.01));
 // Library audio preview and stop are tested through the UI.
 await p.evaluate(id=>theater.selectClips([id]),ac.id);await p.getByRole('button',{name:'试听原音频'}).click();await p.waitForTimeout(300);await p.getByRole('button',{name:'试听原音频'}).click();
 await p.evaluate(id=>theater.selectLayer(id),a.id);await p.waitForTimeout(200);await p.screenshot({path:'qa/theater-main.png'});
 const saved=path.join(root,'qa/theater-roundtrip.livemg');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},saved);
 await p.evaluate(()=>theater.saveProject());const archive=unzipSync(new Uint8Array(await fs.readFile(saved)));const manifest=JSON.parse(strFromU8(archive['manifest.json']));assert.ok(archive['thumbnail.png']);assert.equal(manifest.embeddedFonts.length,1);out.projectBytes=(await fs.stat(saved)).size;out.projectFiles=manifest.files.length;
 const oldModel=scene.models[0].modelId;await p.locator('input[type=file][accept=".livemg,.l2dstudio"]').setInputFiles(saved);
 await p.waitForFunction(old=>theater.ready&&theater.scene.models[0].modelId!==old,oldModel,{timeout:60000});await p.waitForTimeout(300);
 out.roundtrip=await p.evaluate(()=>({actors:theater.scene.layers.filter(l=>l.model).length,assets:theater.scene.assets.length,tracks:theater.scene.tracks.length,modelId:theater.scene.models[0].modelId}));assert.equal(out.roundtrip.actors,2);assert.equal(out.roundtrip.assets,3);
 // Create a redistributable local example without embedding a Windows font.
 await p.evaluate(()=>{theater.change(s=>{s.assets=s.assets.filter(a=>a.kind!=='font');});theater.seek(1.8);});await p.waitForTimeout(200);
 const demo=path.join(root,'qa/小剧场示例.livemg');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},demo);await p.evaluate(()=>theater.saveProject());
 // Export only a short work area at a lower frame size for real encoder/audio/alpha validation.
 await p.evaluate(()=>{theater.change(s=>{s.width=640;s.height=360;s.fps=12;s.workArea={start:.8,end:1.8,loop:false};const bg=s.layers.find(l=>l.name==='街角背景');bg.visible=false;for(const l of s.layers){if(l.kind!=='audio'&&l.kind!=='group'&&l.kind!=='adjustment'){l.transform.x*=.5;l.transform.y*=.5;l.transform.scaleX*=.5;l.transform.scaleY*=.5;}}});});
 await p.getByRole('button',{name:'导出',exact:true}).click();await p.getByText('仅导出工作区',{exact:false}).locator('input').check().catch(async()=>{await p.locator('.modal label').filter({hasText:'仅导出工作区'}).locator('input').check()});
 let exportResult;const response=p.waitForResponse(r=>r.url().includes('/api/export-finish'),{timeout:120000});await p.getByRole('button',{name:'开始导出',exact:true}).click();exportResult=await (await response).json();assert.ok(exportResult.path,JSON.stringify(exportResult));console.log('WEBM',exportResult);
 const webm=path.join(root,'qa/theater-alpha.webm');await fs.copyFile(exportResult.path,webm);
 const probe=spawnSync(path.join(root,'tools/ffprobe.exe'),['-v','error','-show_streams','-show_format','-of','json',webm],{encoding:'utf8',windowsHide:true});assert.equal(probe.status,0,probe.stderr);out.webm=JSON.parse(probe.stdout);assert.ok(out.webm.streams.some(s=>s.codec_type==='audio'));assert.equal(out.webm.streams.find(s=>s.codec_type==='video').tags.alpha_mode,'1');
 const raw=spawnSync(path.join(root,'tools/ffmpeg.exe'),['-v','error','-c:v','libvpx-vp9','-i',webm,'-frames:v','1','-vf','alphaextract','-f','rawvideo','-pix_fmt','gray','pipe:1'],{maxBuffer:4e6,windowsHide:true});assert.equal(raw.status,0,raw.stderr.toString());out.alpha={min:raw.stdout.reduce((a,v)=>Math.min(a,v),255),max:raw.stdout.reduce((a,v)=>Math.max(a,v),0)};assert.equal(out.alpha.min,0);assert.ok(out.alpha.max>200);
 const copied=path.join(root,'qa/theater-native-save.webm');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},copied);await p.getByRole('button',{name:'保存视频文件'}).click();await p.waitForTimeout(250);assert.equal((await fs.stat(copied)).size,(await fs.stat(webm)).size);
 await p.getByRole('button',{name:'ProRes 4444',exact:false}).click();const movResponse=p.waitForResponse(r=>r.url().includes('/api/export-finish'),{timeout:120000});await p.getByRole('button',{name:'开始导出',exact:true}).click();const movResult=await(await movResponse).json();assert.ok(movResult.path,JSON.stringify(movResult));await fs.copyFile(movResult.path,path.join(root,'qa/theater-alpha.mov'));out.prores=JSON.parse(spawnSync(path.join(root,'tools/ffprobe.exe'),['-v','error','-show_streams','-of','json',movResult.path],{encoding:'utf8',windowsHide:true}).stdout).streams.map(s=>({codec:s.codec_name,pix_fmt:s.pix_fmt,channels:s.channels}));assert.ok(out.prores.some(s=>s.pix_fmt?.startsWith('yuva')));
 await p.getByRole('button',{name:'关闭对话框'}).click();const c0=await p.evaluate(()=>theater.renderer.frameCount);await p.waitForTimeout(800);out.pausedRenders=(await p.evaluate(()=>theater.renderer.frameCount))-c0;assert.equal(out.pausedRenders,0);
 assert.deepEqual(errors,[]);out.errors=errors;out.appRoot=dir;await fs.writeFile('qa/theater-integration-report.json',JSON.stringify(out,null,2));console.log('PASS',JSON.stringify({controllers:out.controllers,roundtrip:out.roundtrip,lipCues:out.lipCues,alpha:out.alpha,pausedRenders:out.pausedRenders}));
}finally{await app.close();}
