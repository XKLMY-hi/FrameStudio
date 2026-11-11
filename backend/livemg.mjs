import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
function safe(root, p) {
  const dest = path.resolve(root, p);
  if (dest !== root && !dest.startsWith(root + path.sep))
    throw Error("工程资源路径越界");
  return dest;
}
async function walk(root, prefix = "") {
  const out = [];
  for (const f of await fs.readdir(root, { withFileTypes: true })) {
    const p = prefix + f.name;
    if (f.isDirectory())
      out.push(...(await walk(path.join(root, f.name), p + "/")));
    else out.push(p);
  }
  return out;
}
const hash = (v) => createHash("sha256").update(v).digest("hex");
function projectScenes(project) {
  const single = p => p?.format === "livemg" && p.version === 2 &&
    ["models","assets","layers","tracks"].every(key=>Array.isArray(p[key]));
  if (single(project)) return [project];
  if (project?.format === "framestudio-montage" && project.version === 1 &&
      Array.isArray(project.canvases) && project.canvases.length>0 && project.canvases.length<=120 &&
      Array.isArray(project.clips) && project.clips.length<=600 && project.canvases.every(c=>single(c?.scene)))
    return project.canvases.map(c=>c.scene);
  throw Error("工程格式或版本不支持");
}
export async function saveLivemg(project,data,thumbnail,options={}) {
  const scenes=projectScenes(project);
  if(project.format==="framestudio-montage" && options.container) {
    const files=Object.create(null), seen=new Set();
    const embedded=options.embedCanvases===true;
    const refs=[];
    for(const [i,canvas] of project.canvases.entries()) {
      if(typeof canvas.id!=="string" || !canvas.id || seen.has(canvas.id)) throw Error("画布 ID 无效或重复");
      seen.add(canvas.id);
      const entry="canvases/"+String(i+1).padStart(3,"0")+".livemg";
      files[entry]=await saveLivemg(canvas.scene,data,undefined,{includeAssets:embedded});
      refs.push({id:canvas.id,file:entry});
    }
    files["project.json"]=strToU8(JSON.stringify({...project,canvases:refs}));
    if(!embedded) await packResources(files,scenes,data);
    return archive(files,4,scenes,{sharedAssets:!embedded});
  }
  const files=Object.assign(Object.create(null),{"project.json":strToU8(JSON.stringify(project))});
  if(options.includeAssets!==false) await packResources(files,scenes,data);
  if(thumbnail && /^data:image\/png;base64,/.test(thumbnail))
    files["thumbnail.png"]=Buffer.from(thumbnail.split(",")[1],"base64");
  return archive(files,project.format==="framestudio-montage" ? 3 : 2,scenes,{externalAssets:options.includeAssets===false});
}
async function packResources(files,scenes,data) {
  const modelIds = [...new Set(scenes.flatMap(s=>s.models.map(m=>m.modelId)))];
  for (const id of modelIds) {
    if (typeof id!=="string" || !id || id==="." || id===".." || /[\\/]/.test(id))
      throw Error("无效的模型资源 ID");
    const dir = safe(path.join(data, "models"), id);
    for (const f of await walk(dir))
      files["models/" + id + "/" + f] = new Uint8Array(
        await fs.readFile(safe(dir, f)),
      );
  }
  const media=scenes.flatMap(s=>[...s.assets,...s.models.flatMap(m=>m.assets).filter(a=>a.motionFile).map(a=>({path:a.motionFile}))]);
  for (const asset of media) {
    if (!asset.path || Object.hasOwn(files,"assets/"+asset.path)) continue;
    files["assets/" + asset.path] = new Uint8Array(
      await fs.readFile(safe(data, asset.path)),
    );
  }
}
function archive(files,schemaVersion,scenes,extra) {
  files["manifest.json"]=strToU8(JSON.stringify({
    format:"livemg",schemaVersion,appVersion:"2.15.2",savedAt:new Date().toISOString(),...extra,
    files:Object.entries(files).map(([file,bytes])=>({file,bytes:bytes.length,sha256:hash(bytes)})),
    embeddedFonts:[...new Set(scenes.flatMap(s=>s.assets).filter(a=>a.kind==="font").map(a=>a.fontFamily))],
  }));
  return zipSync(files,{level:1});
}
function readArchive(bytes) {
  const files=unzipSync(bytes);
  if(!files["manifest.json"] || !files["project.json"]) throw Error("缺少 .livemg 工程清单");
  const manifest=JSON.parse(strFromU8(files["manifest.json"]));
  const p=JSON.parse(strFromU8(files["project.json"]));
  if(manifest.format!=="livemg" || !Array.isArray(manifest.files)) throw Error("工程格式或版本不支持");
  let total=0;
  const listed=new Set(manifest.files.map(v=>v.file));
  if(listed.size!==manifest.files.length || !listed.has("project.json") ||
      Object.keys(files).some(n=>!n.endsWith("/") && n!=="manifest.json" && !listed.has(n)))
    throw Error("工程包含未校验或重复的资源");
  for(const v of manifest.files) {
    const f=Object.hasOwn(files,v.file) && files[v.file];
    if(!f || f.length!==v.bytes || hash(f)!==v.sha256) throw Error("工程资源损坏或缺失："+v.file);
    total+=f.length;
    if(total>1024*1024*1024) throw Error("工程资源超过 1 GB");
  }
  return {p,files,manifest,total};
}
export async function openLivemg(bytes, data) {
  const {p,files,manifest,total}=readArchive(bytes);
  if(manifest.externalAssets) {
    const [scene]=projectScenes(p);
    try {
      await Promise.all([
        ...scene.models.map(m=>fs.access(safe(path.join(data,"models"),m.modelId+"/"+m.file))),
        ...scene.assets.map(a=>fs.access(safe(data,a.path))),
        ...scene.models.flatMap(m=>m.assets).filter(a=>a.motionFile).map(a=>fs.access(safe(data,a.motionFile))),
      ]);
      return p;
    } catch {throw Error("此画布引用本地资产，当前工作区缺少资源。请打开原 .livemgs 或使用含资产的独立 .livemg");}
  }
  if(manifest.schemaVersion===4) {
    if(p.format!=="framestudio-montage" || p.version!==1 || !Array.isArray(p.canvases) || p.canvases.length>120)
      throw Error("总工程格式无效");
    let expanded=total;
    const seen=new Set();
    p.canvases=p.canvases.map(ref=>{
      if(typeof ref?.file!=="string" || !/^canvases\/\d{3}\.livemg$/.test(ref.file) || !Object.hasOwn(files,ref.file) || seen.has(ref.file))
        throw Error("缺少独立画布工程");
      seen.add(ref.file);
      const entry=readArchive(files[ref.file]);
      if(entry.manifest.schemaVersion!==2 || entry.p.format!=="livemg") throw Error("子画布格式无效");
      expanded+=entry.total;
      if(expanded>1024*1024*1024) throw Error("工程展开后超过 1 GB");
      for(const [name,blob] of Object.entries(entry.files)) {
        if(!name.startsWith("assets/") && !name.startsWith("models/")) continue;
        if(Object.hasOwn(files,name) && hash(files[name])!==hash(blob)) throw Error("子画布的同名资产内容冲突");
        files[name]=blob;
      }
      return {id:ref.id,scene:entry.p};
    });
  } else if(manifest.schemaVersion!==(p.format==="framestudio-montage" ? 3 : 2)) throw Error("工程格式或版本不支持");
  const scenes=projectScenes(p);
  const prefix = "livemg-" + randomUUID().slice(0, 8),
    remap = new Map();
  const models=scenes.flatMap(s=>s.models);
  for (const m of models) {
    if (!remap.has(m.modelId))
      remap.set(
        m.modelId,
        prefix + "-" + remap.size + "-" + m.modelId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50),
      );
  }
  for (const [old, id] of remap) {
    const key = "models/" + old + "/";
    for (const [n, v] of Object.entries(files)) {
      if (!n.startsWith(key) || n.endsWith("/")) continue;
      const dest = safe(path.join(data, "models", id), n.slice(key.length));
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, v);
    }
  }
  for (const m of models) m.modelId = remap.get(m.modelId);
  const importedAssets=new Map();
  async function importAsset(original,name) {
    if(importedAssets.has(original)) return importedAssets.get(original);
    const file=files["assets/"+original];
    if(!file) throw Error("缺少媒体资源："+name);
    const ext=original.endsWith(".motion3.json") ? ".motion3.json" : path.extname(original);
    const next="media/"+prefix+"/"+hash(original).slice(0,24)+ext;
    const dest=safe(data,next);
    await fs.mkdir(path.dirname(dest),{recursive:true});
    await fs.writeFile(dest,file);importedAssets.set(original,next);
    return next;
  }
  for(const a of scenes.flatMap(s=>s.assets)) a.path=await importAsset(a.path,a.name);
  for(const a of models.flatMap(m=>m.assets)) if(a.motionFile) a.motionFile=await importAsset(a.motionFile,a.name);
  return p;
}
export async function volumeEnvelope(file, duration, points) {
  const rate = 48000,
    count = Math.ceil(duration * rate),
    header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(36 + count * 2, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(count * 2, 40);
  const handle = await fs.open(file, "w");
  try {
    await handle.write(header);
    let cursor = 0;
    for (let start = 0; start < count; start += 8192) {
      const n = Math.min(8192, count - start),
        b = Buffer.alloc(n * 2);
      for (let i = 0; i < n; i++) {
        const t = (start + i) / rate;
        while (cursor < points.length - 2 && points[cursor + 1].t <= t)
          cursor++;
        const a = points[cursor] || { t: 0, v: 1 },
          z = points[cursor + 1] || a,
          ratio =
            z.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (z.t - a.t))) : 0,
          v = a.v + (z.v - a.v) * ratio;
        b.writeInt16LE(Math.round(Math.max(0, Math.min(1, v)) * 32767), i * 2);
      }
      await handle.write(b);
    }
  } finally {
    await handle.close();
  }
}
