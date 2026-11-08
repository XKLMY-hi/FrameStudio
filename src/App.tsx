import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import {produce} from 'immer';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  AudioLines,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Diamond,
  Download,
  Expand,
  Eye,
  FilePlus2,
  Film,
  FolderOpen,
  Info,
  Layers,
  Lightbulb,
  Loader2,
  Maximize2,
  Minus,
  MousePointer2,
  Move,
  Music2,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  Volume2,
  X,
} from "lucide-react";
import {
  Asset,
  Clip,
  Curve,
  Effects,
  Group,
  ModelEntry,
  Param,
  Project,
  defaultEffects,
  emptyProject,
  normalizeTracks,
  groupNames,
  uid,
} from "./types";
import {
  clamp,
  classify,
  clipTime,
  cuesToCurves,
  evaluate,
  exportMotion,
  parseAsset,
  parseCatalogAsset,
  parseLegacy,
  sampleCurve,
} from "./engine";
import { api, download, media, token } from "./api";
import { StudioRenderer } from "./renderer";
import { Timeline } from "./Timeline";
import { CurveEditor } from "./CurveEditor";
import { AssetItems } from './AssetItems';
function useEvent<T extends (...args:any[])=>any>(fn:T):T{const ref=useRef(fn);ref.current=fn;return useCallback(((...a:any[])=>ref.current(...a)) as T,[]);}
const fmt = (n: number) => Number(n.toFixed(4));
function NumberField({
  label,
  value,
  onChange,
  min = -1e6,
  max = 1e6,
  step = 0.01,
  suffix = "",
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <div>
        <input
          type="number"
          value={fmt(value)}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const n = +e.target.value;
            if (Number.isFinite(n)) onChange(clamp(n, min, max));
          }}
        />
        {suffix && <small>{suffix}</small>}
      </div>
    </label>
  );
}
function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="slider-field">
      <span>
        {label}
        <b>{value.toFixed(step >= 1 ? 0 : 2)}</b>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(+e.target.value)}
      />
    </label>
  );
}
const kindLabels = {
  motion: "动作",
  expression: "表情",
  keyframe: "关键帧",
  audio: "音频",
};
export default function App() {
  const [project, setProject] = useState<Project>(emptyProject),
    [models, setModels] = useState<ModelEntry[]>([]),
    [params, setParams] = useState<Param[]>([]),
    [ready, setReady] = useState(false),
    [status, setStatus] = useState("正在连接本地工作室…"),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [selected, setSelected] = useState(""),
    [assetFilter, setAssetFilter] = useState("all"),
    [search, setSearch] = useState(""),
    [paramSearch, setParamSearch] = useState(""),
    [selectedParam, setSelectedParam] = useState("ParamAngleX"),
    [paramGroup, setParamGroup] = useState<Group | "all">("all"),
    [sideTab, setSideTab] = useState<"clip" | "params" | "effects">("clip"),
    [inspectorOpen,setInspectorOpen]=useState(false),
    [previewQuality,setPreviewQuality]=useState(720),
    [zoom, setZoom] = useState(75),
    [snap, setSnap] = useState(true),
    [curveOpen, setCurveOpen] = useState(false),
    [keyIndex, setKeyIndex] = useState(-1),
    [modal, setModal] = useState<"" | "canvas" | "export" | "help">(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [exportProgress, setExportProgress] = useState(0),
    [exportStatus, setExportStatus] = useState(""),
    [exportResult, setExportResult] = useState<any>(null),
    [exportFormat, setExportFormat] = useState("webm"),
    [checker, setChecker] = useState(true),
    [hasRhubarb, setHasRhubarb] = useState(false),
    [dirty, setDirty] = useState(false),
    [autoKey, setAutoKey] = useState(true),
    [undoVersion, setUndoVersion] = useState(0);
  const [previewValues, setPreviewValues] = useState<Record<string, number>>(
    {},
  );
  const stageHost = useRef<HTMLDivElement>(null),
    renderer = useRef<StudioRenderer | undefined>(undefined),
    pRef = useRef(project),
    timeRef = useRef(time),
    playingRef = useRef(playing),
    raf = useRef(0),
    history = useRef<Project[]>([]),
    future = useRef<Project[]>([]),
    lastEdit = useRef(0),
    cancelExport = useRef(false),
    audioPlayers = useRef(new Map<string, HTMLAudioElement>()),
    modelInput = useRef<HTMLInputElement>(null),
    folderInput = useRef<HTMLInputElement>(null),
    motionInput = useRef<HTMLInputElement>(null),
    audioInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const livePanels=useRef(false),syncAudioRef=useRef<()=>void>(()=>{});
  livePanels.current=(inspectorOpen&&sideTab==='params')||curveOpen;
  pRef.current = project;
  playingRef.current = playing;
  const selectedTrack = project.tracks.find((t) =>
      t.clips.some((c) => c.id === selected),
    ),
    clip = selectedTrack?.clips.find((c) => c.id === selected),
    asset = project.assets.find((a) => a.id === clip?.assetId),
    curve = asset?.curves.find((c) => c.id === selectedParam),
    param = params.find((p) => p.id === selectedParam),
    localTime = clip && asset ? clipTime(clip, asset, time) : time;
  function notify(s: string) {
    setToast(s);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4400);
  }
  function change(mut: Project | ((p: Project) => void), record = true) {
    const current = pRef.current,
      next = typeof mut === "function" ? produce(current,draft=>{mut(draft);}) : mut;
    if(next===current)return;
    if (record) {
      if (Date.now() - lastEdit.current > 450) {
        history.current.push(current);
        if (history.current.length > 22) history.current.shift();
      }
      lastEdit.current = Date.now();
      future.current = [];
      setUndoVersion((v) => v + 1);
    }
    pRef.current = next;
    setProject(next);
    setDirty(true);
    const timelineChanged=next.assets!==current.assets||next.physics!==current.physics||next.groupOverrides!==current.groupOverrides||next.parameterMap!==current.parameterMap||next.tracks.length!==current.tracks.length||next.tracks.some((t,i)=>t.clips!==current.tracks[i]?.clips||t.muted!==current.tracks[i]?.muted||t.solo!==current.tracks[i]?.solo);
    if(timelineChanged)renderer.current?.resetPhysics();else renderer.current?.invalidate();
  }
  function changeClip(mut: (c: Clip) => void) {
    if (!clip) return;
    change((p) => {
      const c = p.tracks.flatMap((t) => t.clips).find((c) => c.id === selected);
      if (c) mut(c);
    });
  }
  function seek(t: number) {
    setPreviewValues({});
    if (renderer.current) renderer.current.previewOverrides = {};
    const n = clamp(t, 0, pRef.current.duration);
    timeRef.current = n;
    setTime(n);
  }
  function undo() {
    if (!history.current.length) return;
    future.current.push(pRef.current);
    const p = history.current.pop()!;
    pRef.current = p;
    setProject(p);
    renderer.current?.resetPhysics();
    setUndoVersion((v) => v + 1);
  }
  function redo() {
    if (!future.current.length) return;
    history.current.push(pRef.current);
    const p = future.current.pop()!;
    pRef.current = p;
    setProject(p);
    renderer.current?.resetPhysics();
    setUndoVersion((v) => v + 1);
  }
  async function loadModel(p: Project, loadLibrary = true) {
    normalizeTracks(p);
    setReady(false);
    setStatus("正在载入模型与参数…");
    try {
      const ps = await renderer.current!.load(
        new URL(media(`models/${p.modelId}/${p.modelFile}`), location.href)
          .href,
      );
      setParams(ps);
      if (loadLibrary) {
        const catalog = await api(
          "model-catalog?id=" +
            encodeURIComponent(p.modelId) +
            "&file=" +
            encodeURIComponent(p.modelFile),
        );
        const assets: Asset[] = catalog.assets.map(parseCatalogAsset);
        p.assets = assets;
      }
      pRef.current = p;
      setProject({ ...p });
      setReady(true);
      setStatus(`${ps.length} 个参数 · 本地离线运行`);
      renderer.current!.renderAt(p, timeRef.current);
    } catch (e: any) {
      setStatus("模型载入失败");
      notify(e.message);
    }
  }
  useEffect(() => {
    const r = new StudioRenderer(stageHost.current!);
    renderer.current = r;
    let alive = true;
    (async () => {
      try {
        const info = await api("info");
        if (!alive) return;
        setModels(info.models);
        setHasRhubarb(info.rhubarb);
        const saved = await api<Project | null>("autosave");
        const p = saved || emptyProject();
        await loadModel(p, !saved);
        if (!saved && p.assets.length) {
          const idle =
            p.assets.find(
              (a) => /idle01_C|idle01$/i.test(a.name) && a.kind === "motion",
            ) || p.assets.find((a) => a.kind === "motion");
          if (idle) {
            const c = makeClip(idle, 0);
            c.duration = Math.min(idle.duration, p.duration);
            p.tracks[0].clips = [c];
            p.name = "银灰大衣 · 动作实验";
            pRef.current = p;
            setProject({ ...p });
          }
        }
      } catch (e: any) {
        setStatus("启动未完成");
        notify(e.message);
      }
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf.current);
      r.destroy();
      for (const a of audioPlayers.current.values()) a.pause();
    };
  }, []);
  useEffect(() => {
    let last = performance.now(),lastFrame=0,lastUI=0,lastAudio=0,lastClock=-1;
    function tick(now: number) {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (playingRef.current && !busy) {
        let t = timeRef.current + dt;
        if (t >= pRef.current.duration) {
          t = pRef.current.duration;
          setPlaying(false);
          playingRef.current = false;
          setTime(t);
        }
        timeRef.current = t;
        if(livePanels.current&&now-lastUI>=100){setTime(t);lastUI=now;}
      }
      if(ready&&!busy){
        const r=renderer.current,p=pRef.current,t=timeRef.current;
        if(r&&r.needsRender(p,t)&&now-lastFrame>=1000/Math.min(p.fps,30)-1){r.renderAt(p,t);lastFrame=now;}
        if(playingRef.current&&now-lastAudio>=80){syncAudioRef.current();lastAudio=now;}
        if(t!==lastClock){
        const playhead=document.querySelector<HTMLElement>('[data-playhead]');
        if(playhead)playhead.style.left=`${174+t*Number(playhead.dataset.zoom||75)}px`;
        const label=document.querySelector<HTMLElement>('[data-clock]');
        if(label)label.textContent=`${Math.floor(t/60).toString().padStart(2,'0')}:${(t%60).toFixed(3).padStart(6,'0')}`;
        const frame=document.querySelector<HTMLElement>('[data-frame]');if(frame)frame.textContent=`帧 ${Math.round(t*p.fps)}`;
        lastClock=t;}
      }
      raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [ready, busy]);
  useEffect(()=>{if(renderer.current){renderer.current.previewLimit=previewQuality;renderer.current.invalidate();}},[previewQuality]);
  useEffect(() => {
    if (!ready || busy) return;
    const timer = setTimeout(() => {
      api("autosave", project).catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, [project, ready, busy]);
  useEffect(() => {
    if (playing) {
      setPreviewValues({});
      if (renderer.current) renderer.current.previewOverrides = {};
    }else setTime(timeRef.current);
  }, [playing]);
  useEffect(()=>{if(livePanels.current)setTime(timeRef.current);},[sideTab,inspectorOpen,curveOpen]);
  syncAudioRef.current = () => {
    const project=pRef.current,time=timeRef.current,playing=playingRef.current;
    const players = audioPlayers.current;
    const active = new Set<string>();
    const solo = project.tracks.some((t) => t.solo && !t.muted);
    for (const tr of project.tracks) {
      if (tr.muted || (solo && !tr.solo)) continue;
      for (const c of tr.clips) {
        const a = project.assets.find((a) => a.id === c.assetId);
        if (
          !a?.audioPath ||
          !c.enabled ||
          time < c.start ||
          time >= c.start + c.duration
        )
          continue;
        active.add(c.id);
        let player = players.get(c.id);
        if (!player) {
          player = new Audio(media(a.audioPath));
          player.preload = "auto";
          players.set(c.id, player);
        }
        const target = clipTime(c, a, time);
        if (Math.abs(player.currentTime - target) > 0.12)
          player.currentTime = target;
        player.playbackRate = c.speed;
        const fade = Math.min(
          c.fadeIn > 0 ? (time - c.start) / c.fadeIn : 1,
          c.fadeOut > 0 ? (c.start + c.duration - time) / c.fadeOut : 1,
        );
        player.volume = clamp(c.weight * fade, 0, 1);
        if (playing && !busy) {if(player.paused)player.play().catch(() => {});}
        else player.pause();
      }
    }
    for (const [id, a] of players)
      if (!active.has(id) || !playing || busy) a.pause();
  };
  useEffect(()=>{syncAudioRef.current();},[time,playing,project,busy]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if(e.key==='Escape'){setCurveOpen(false);setInspectorOpen(false);if(!busy)setModal('');return;}
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || modal) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((v) => !v);
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteClip();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveProject();
      }
      if (e.key === "ArrowLeft") seek(timeRef.current - 1 / pRef.current.fps);
      if (e.key === "ArrowRight") seek(timeRef.current + 1 / pRef.current.fps);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selected, modal, project]);
  useEffect(() => {
    window.studio = {
      get project() {
        return pRef.current;
      },
      get renderer() {
        return renderer.current;
      },
      get ready() {
        return ready;
      },
      seek,
      change,
      exportVideo,
      select: setSelected,
      get playing(){return playingRef.current;},
      get time(){return timeRef.current;},
      renderStats:()=>({canvas:[renderer.current?.app.screen.width,renderer.current?.app.screen.height],warming:renderer.current?.warming}),
    };
  }, [ready, project, exportFormat]);
  function makeClip(a: Asset, start: number): Clip {
    return {
      id: uid(),
      assetId: a.id,
      start,
      trimIn: 0,
      duration: a.duration,
      speed: 1,
      weight: 1,
      fadeIn: Math.min(Math.max(0, a.fadeIn ?? 0.2), a.duration / 3),
      fadeOut: Math.min(Math.max(0, a.fadeOut ?? 0.2), a.duration / 3),
      blend: a.kind === "expression" || a.kind === "audio" ? "override" : "mix",
      disabledGroups: [],
      disabledIds: [],
      loop: false,
      enabled: true,
    };
  }
  function addAsset(id: string, trackId?: string, t = timeRef.current) {
    const a = pRef.current.assets.find((a) => a.id === id);
    if (!a) return;
    const c = makeClip(a, t);
    change((p) => {
      let tr =
        p.tracks.find((tr) => tr.id === trackId) ||
        p.tracks.find(
          (tr) =>
            !tr.clips.some(
              (old) =>
                old.start < c.start + c.duration &&
                old.start + old.duration > c.start,
            ),
        );
      if (!tr) {
        tr = {
          id: uid(),
          name: "轨道 " + (p.tracks.length+1),
          type: 'generic',
          muted: false,
          solo: false,
          clips: [],
        };
        p.tracks.push(tr);
      }
      tr.clips.push(c);
      p.duration = Math.max(p.duration, c.start + c.duration);
    });
    setSelected(c.id);
    setSideTab("clip");
    setInspectorOpen(true);
    if (a.curves.length) setSelectedParam(a.curves[0].id);
  }
  function deleteClip() {
    if (!selected) return;
    change((p) => {
      for (const t of p.tracks)
        t.clips = t.clips.filter((c) => c.id !== selected);
    });
    setSelected("");
  }
  function duplicateClip() {
    if (!clip) return;
    const c = structuredClone(clip);
    c.id = uid();
    c.start += 0.3;
    change((p) => {
      p.tracks.find((t) => t.id === selectedTrack!.id)!.clips.push(c);
      p.duration = Math.max(p.duration, c.start + c.duration);
    });
    setSelected(c.id);
  }
  function splitClip() {
    const time=timeRef.current;
    if (!clip || time <= clip.start || time >= clip.start + clip.duration) {
      notify("请把播放头放在片段内部");
      return;
    }
    const b = structuredClone(clip);
    b.id = uid();
    b.start = time;
    b.duration = clip.start + clip.duration - time;
    b.trimIn += (time - clip.start) * clip.speed;
    b.fadeIn = 0;
    change((p) => {
      const tr = p.tracks.find((t) => t.id === selectedTrack!.id)!;
      const a = tr.clips.find((c) => c.id === clip.id)!;
      a.duration = time - a.start;
      a.fadeOut = 0;
      tr.clips.push(b);
    });
    setSelected(b.id);
  }
  async function importModel(file: File) {
    setBusy(true);
    try {
      const m = await api<ModelEntry>("model-import", file, {
        "X-File-Name": encodeURIComponent(file.name),
      });
      setModels((s) => [...s, m]);
      const p = emptyProject();
      p.modelId = m.id;
      p.modelFile = m.files[0].path;
      p.name = file.name.replace(/\.zip$/i, "");
      await loadModel(p);
      history.current = [];
      notify("模型已导入，动作与表情已进入素材库");
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function importFolder(files: FileList) {
    setBusy(true);
    try {
      const { zipSync } = await import("fflate");
      const entries: Record<string, Uint8Array> = {};
      for (const f of Array.from(files)) {
        const rel = (f as any).webkitRelativePath || f.name;
        entries[rel] = new Uint8Array(await f.arrayBuffer());
      }
      await importModel(
        new File([zipSync(entries, { level: 0 }) as any], "导入模型.zip"),
      );
    } finally {
      setBusy(false);
    }
  }
  async function importMotions(files: FileList) {
    try {
      const imported: Asset[] = [];
      for (const f of Array.from(files)) {
        const text = await f.text();
        imported.push(
          /\.mtn$/i.test(f.name)
            ? parseLegacy(text, f.name)
            : parseAsset(JSON.parse(text), f.name),
        );
      }
      change((p) => p.assets.push(...imported));
      notify(`已导入 ${imported.length} 个预设，时长来自原始动作数据`);
    } catch (e: any) {
      notify(e.message);
    }
  }
  async function importAudio(file: File) {
    setBusy(true);
    setStatus("正在离线识别口型，请稍候…");
    try {
      const info = await api("audio-import", file, {
        "X-File-Name": encodeURIComponent(file.name),
      });
      const open =
          params.find((p) => /mouth.*open|ParamMouthOpenY/i.test(p.id))?.id ||
          "ParamMouthOpenY",
        form =
          params.find((p) => /mouth.*form/i.test(p.id))?.id || "ParamMouthForm";
      const a: Asset = {
        ...info,
        kind: "audio",
        fps: project.fps,
        curves: cuesToCurves(info.cues, info.duration, open, form),
      };
      change((p) => p.assets.push(a));
      addAsset(a.id);
      notify(info.analysis + " · 已创建配音口型片段");
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
      setStatus(`${params.length} 个参数 · 本地离线运行`);
    }
  }
  async function saveProject() {
    try {
      const res = await fetch("/api/project-save", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(pRef.current),
      });
      if (!res.ok) throw Error((await res.json()).error);
      download(await res.blob(), pRef.current.name + ".l2dstudio");
      setDirty(false);
      notify("工程已打包，包含模型、动作和音频，可移动到其他电脑");
    } catch (e: any) {
      notify(e.message);
    }
  }
  async function openProject(file: File) {
    setBusy(true);
    setPlaying(false);
    try {
      const p = await api<Project>("project-open", file);
      seek(0);
      await loadModel(p, false);
      history.current = [];
      setDirty(false);
      setSelected("");
      notify("工程已打开");
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  function editableCopy() {
    if (!asset || !clip) return;
    const copy = structuredClone(asset);
    copy.id = uid();
    copy.kind = "keyframe";
    copy.name = asset.name + " · 编辑副本";
    delete copy.audioPath;
    delete copy.waveform;
    change((p) => {
      p.assets.push(copy);
      p.tracks.flatMap((t) => t.clips).find((c) => c.id === clip.id)!.assetId =
        copy.id;
    });
    setSideTab("params");
    setInspectorOpen(true);
    setCurveOpen(true);
    if (copy.curves[0]) setSelectedParam(copy.curves[0].id);
    notify("已创建独立曲线副本，原预设不受影响");
  }
  function setParameter(id: string, value: number, force = false) {
    if (!autoKey && !force) {
      const next = { ...previewValues, [id]: value };
      setPreviewValues(next);
      if (renderer.current) {
        renderer.current.previewOverrides = next;
        renderer.current.invalidate();
      }
      setSelectedParam(id);
      return;
    }
    setPreviewValues((v) => {
      const n = { ...v };
      delete n[id];
      if (renderer.current) renderer.current.previewOverrides = n;
      return n;
    });
    const current = pRef.current;
    let track = current.tracks.find((t) => t.clips.some(c=>current.assets.some(a=>a.id===c.assetId&&a.kind==='keyframe')&&timeRef.current>=c.start&&timeRef.current<=c.start+c.duration));
    let c = track?.clips.find(
      (c) =>
        current.assets.some(a=>a.id===c.assetId&&a.kind==='keyframe')&&timeRef.current >= c.start && timeRef.current <= c.start + c.duration,
    );
    if (asset?.kind === "keyframe" && clip) c = clip;
    let a = current.assets.find(
      (a) => a.id === c?.assetId && a.kind === "keyframe",
    );
    const par = params.find((p) => p.id === id);
    if (!par) return;
    let newC = "";
    change((p) => {
      if (!a) {
        const created: Asset = {
          id: uid(),
          name: "手动参数动画",
          kind: "keyframe",
          duration: p.duration,
          fps: p.fps,
          curves: [],
        };
        p.assets.push(created);
        const cl = makeClip(created, 0);
        cl.fadeIn = 0;
        cl.fadeOut = 0;
        cl.blend = "override";
        let tr = p.tracks.find((t) => t.id === track?.id)||p.tracks.find(t=>!t.clips.length);
        if (!tr) {
          tr = {
            id: uid(),
            name: "轨道 "+(p.tracks.length+1),
            type: "generic",
            muted: false,
            solo: false,
            clips: [],
          };
          p.tracks.push(tr);
        }
        tr.clips.push(cl);
        newC = cl.id;
        a = created;
        c = cl;
      }
      const target = p.assets.find((x) => x.id === a!.id)!;
      let cv = target.curves.find((cv) => cv.id === id);
      if (!cv) {
        cv = { id, target: "Parameter", keys: [] };
        target.curves.push(cv);
      }
      const t = clipTime(c!, target, timeRef.current);
      if (!cv.keys.length && t > 1 / p.fps)
        cv.keys.push({ t: 0, v: par.default, mode: "bezier" });
      let k = cv.keys.find((k) => Math.abs(k.t - t) < 0.5 / p.fps);
      if (k) k.v = value;
      else {
        cv.keys.push({ t: fmt(t), v: value, mode: "bezier" });
        cv.keys.sort((a, b) => a.t - b.t);
      }
      target.duration = Math.max(target.duration, t);
    });
    if (newC) setSelected(newC);
    setSelectedParam(id);
  }
  function updateCurve(c: Curve) {
    if (!asset) return;
    change((p) => {
      const a = p.assets.find((a) => a.id === asset.id)!;
      const i = a.curves.findIndex((cv) => cv.id === c.id);
      if (i >= 0) a.curves[i] = c;
    });
  }
  function updateKey(mut: (k: any) => void) {
    if (!curve || keyIndex < 0 || !curve.keys[keyIndex]) return;
    const cv = structuredClone(curve);
    mut(cv.keys[keyIndex]);
    cv.keys.sort((a, b) => a.t - b.t);
    updateCurve(cv);
  }
  async function exportVideo() {
    if (!ready) return;
    const p = structuredClone(pRef.current);
    setPlaying(false);
    setBusy(true);
    setExportProgress(0);
    setExportResult(null);
    cancelExport.current = false;
    setExportStatus("准备透明帧…");
    let job: any;
    try {
      const solo = p.tracks.some((t) => t.solo && !t.muted);
      const audio = p.tracks
        .filter((t) => !t.muted && (!solo || t.solo))
        .flatMap((t) => t.clips)
        .filter((c) => c.enabled)
        .flatMap((c) => {
          const a = p.assets.find((a) => a.id === c.assetId);
          return a?.audioPath ? [{ ...c, path: a.audioPath }] : [];
        });
      job = await api("export-start", {
        width: p.width,
        height: p.height,
        fps: p.fps,
        duration: p.duration,
        format: exportFormat,
        audio,
      });
      renderer.current!.previewOverrides = {};
      renderer.current!.resetPhysics();
      for (let i = 0; i < job.total; i++) {
        if (cancelExport.current) throw Error("已取消导出");
        renderer.current!.renderAt(p, i / p.fps, true);
        const png = await renderer.current!.png();
        await api(`export-frame/${job.id}/${i}`, png);
        setExportProgress(((i + 1) / job.total) * 0.85);
        setExportStatus(`渲染透明帧 ${i + 1} / ${job.total}`);
        await new Promise<void>((r) => setTimeout(r, 0));
      }
      setExportStatus("正在编码视频与混合音频…");
      const result = await api("export-finish", { id: job.id });
      setExportProgress(1);
      setExportResult(result);
      setExportStatus("导出完成 · Alpha 透明通道已保留");
      notify("透明动画已导出");
    } catch (e: any) {
      setExportStatus(e.message);
      if (job) await api("export-cancel", { id: job.id }).catch(() => {});
    } finally {
      setBusy(false);
      renderer.current?.invalidate();
    }
  }
  const evaluated=useMemo(()=>{const v=evaluate(project,params,time);Object.assign(v.parameters,previewValues);return v;},[project,params,time,previewValues]);
  const addFromLibrary=useEvent(addAsset);
  const visibleParams = params.filter(
    (p) =>
      (paramGroup === "all" ||
        (project.groupOverrides[p.id] || p.group) === paramGroup) &&
      (p.name.toLowerCase().includes(paramSearch.toLowerCase()) ||
        p.id.toLowerCase().includes(paramSearch.toLowerCase())),
  );
  const selectClip = (id: string) => {
    setSelected(id);
    setSideTab('clip');setInspectorOpen(true);
    setKeyIndex(-1);
    const a = project.assets.find(
      (a) =>
        a.id ===
        project.tracks.flatMap((t) => t.clips).find((c) => c.id === id)
          ?.assetId,
    );
    if (a?.curves.length && !a.curves.some((c) => c.id === selectedParam))
      setSelectedParam(a.curves[0].id);
  };
  const effect = (id: keyof Effects, v: any) =>
    change((p) => {
      (p.effects as any)[id] = v;
    });
  return (
    <div className="studio-app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <Layers size={22} />
          </span>
          <div>
            <strong>帧间</strong>
            <span>LIVE2D POCKET STUDIO</span>
          </div>
          <span className="version-badge">LOCAL / 01</span>
        </div>
        <div className="project-title">
          <span className={dirty ? "dirty-dot" : ""} />
          <input
            aria-label="作品名称"
            value={project.name}
            onChange={(e) =>
              change((p) => {
                p.name = e.target.value;
              })
            }
          />
          <span className="small-muted">
            {project.width} × {project.height}
          </span>
        </div>
        <div className="header-actions">
          <button title="新建画布" onClick={() => setModal("canvas")}>
            <FilePlus2 size={15} />
          </button>
          <button
            title="打开工程"
            onClick={() => projectInput.current?.click()}
          >
            <FolderOpen size={15} />
          </button>
          <button title="保存便携工程（Ctrl+S）" onClick={saveProject}>
            <Save size={15} />
          </button>
          <span className="divider" />
          <button
            title="撤销（Ctrl+Z）"
            disabled={!history.current.length}
            onClick={undo}
          >
            <Undo2 size={15} />
          </button>
          <button title="重做" disabled={!future.current.length} onClick={redo}>
            <Redo2 size={15} />
          </button>
          <button
            className="export-button"
            onClick={() => setModal("export")}
            disabled={!ready}
          >
            <ArrowUpFromLine size={15} />
            导出动画
          </button>
        </div>
      </header>
      <div className={"workspace "+(!inspectorOpen?"inspector-closed":"")}>
        <aside className="asset-panel">
          <div className="panel-title">
            <span>素材库</span>
            <span className="count">{project.assets.length}</span>
            <button
              title="导入动作"
              onClick={() => motionInput.current?.click()}
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="model-card">
            <div className="model-icon">
              <Layers size={22} />
            </div>
            <div>
              <strong>
                {project.modelFile.includes("coat")
                  ? "银灰大衣"
                  : project.modelFile
                      .split("/")
                      .pop()
                      ?.replace(/\.model3?\.json$/i, "")}
              </strong>
              <span>
                <i className={ready ? "ready-dot" : "waiting-dot"} />
                {ready ? "模型已连接" : "加载模型中"}
              </span>
            </div>
            <button
              title="导入模型 ZIP"
              onClick={() => modelInput.current?.click()}
            >
              <FolderOpen size={16} />
            </button>
          </div>
          <div className="import-row">
            <button onClick={() => modelInput.current?.click()}>
              <Plus size={12} />
              模型 ZIP
            </button>
            <button onClick={() => folderInput.current?.click()}>
              模型文件夹
            </button>
          </div>
          <details className="model-switch">
            <summary>切换已导入模型</summary>
            {models.map((m) => (
              <div key={m.id}>
                {m.files.map((f) => (
                  <button
                    key={f.path}
                    onClick={() => {
                      const p = emptyProject();
                      p.modelId = m.id;
                      p.modelFile = f.path;
                      p.name = m.name;
                      setTime(0);
                      loadModel(p);
                      setSelected("");
                    }}
                  >
                    {m.name} / {f.name}
                  </button>
                ))}
              </div>
            ))}
          </details>
          <div className="search-field">
            <Search size={14} />
            <input
              aria-label="搜索素材"
              placeholder="搜索动作、表情…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="asset-tabs">
            {[
              ["all", "全部"],
              ["motion", "动作"],
              ["expression", "表情"],
              ["keyframe", "关键帧"],
              ["audio", "音频"],
            ].map(([id, label]) => (
              <button
                key={id}
                className={id === assetFilter ? "active" : ""}
                onClick={() => setAssetFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <AssetItems assets={project.assets} filter={assetFilter} search={search} onAdd={addFromLibrary}/>
          <div className="asset-bottom">
            <button onClick={() => motionInput.current?.click()}>
              <ArrowDownToLine size={14} />
              导入预设动作
            </button>
            <button onClick={() => audioInput.current?.click()}>
              <AudioLines size={15} />
              导入音频 / 自动口型
            </button>
            <span>
              {hasRhubarb ? "Rhubarb 离线嘴型引擎已就绪" : "音量口型后备模式"}
            </span>
          </div>
        </aside>
        <main className="center-column">
          <div className="viewer-toolbar">
            <div>
              <span className="live-badge">
                <i />
                画布预览
              </span>
              <span className="small-muted">
                {project.width} × {project.height} / {project.fps} FPS
              </span>
            </div>
            <div>
              <select aria-label="预览清晰度" value={previewQuality} onChange={e=>setPreviewQuality(+e.target.value)}><option value="720">流畅预览</option><option value="1080">高清预览</option><option value="8192">原画预览</option></select>
              {([['clip','片段'],['params','参数'],['effects','质感']] as const).map(([id,label])=><button key={id} className={inspectorOpen&&sideTab===id?'active':''} aria-pressed={inspectorOpen&&sideTab===id} onClick={()=>{if(inspectorOpen&&sideTab===id)setInspectorOpen(false);else{setSideTab(id);setInspectorOpen(true);}}}>{label}</button>)}
              <button
                className={project.view === "full" ? "active" : ""}
                onClick={() =>
                  change((p) => {
                    p.view = "full";
                  })
                }
              >
                全身
              </button>
              <button
                className={project.view === "bust" ? "active" : ""}
                onClick={() =>
                  change((p) => {
                    p.view = "bust";
                  })
                }
              >
                半身
              </button>
              <button
                title="透明棋盘格"
                className={checker ? "active" : ""}
                onClick={() => setChecker((v) => !v)}
              >
                <Layers size={14} />
              </button>
              <button
                title="重置构图"
                onClick={() =>
                  change((p) => {
                    p.transform = { x: 0, y: 0, scale: 1, rotation: 0 };
                  })
                }
              >
                <Maximize2 size={14} />
              </button>
            </div>
          </div>
          <div className="viewer-area">
            <div className="viewer-guides">
              <span>{ready ? "LIVE2D / REALTIME" : "LOADING MODEL"}</span>
              <span>ALPHA CHANNEL</span>
            </div>
            <div
              className={"stage-frame " + (checker ? "checker" : "dark-stage")}
              style={{ aspectRatio: `${project.width}/${project.height}`, '--aspect':project.width/project.height } as React.CSSProperties}
            >
              <div ref={stageHost} className="stage-host" />
              {!ready && (
                <div className="model-loading">
                  <Loader2 className="spin" size={25} />
                  <span>{status}</span>
                </div>
              )}
            </div>
            <div className="viewer-bottom">
              <span>
                <MousePointer2 size={12} />
                参数由时间线驱动
              </span>
              <span>
                {project.physics ? "物理模拟 开启" : "物理模拟 关闭"}
                <button
                  title="透明截图"
                  onClick={async () => {
                    if (ready){renderer.current!.renderAt(pRef.current,timeRef.current,true);
                      download(
                        await renderer.current!.png(),
                        project.name + ".png",
                      );renderer.current!.invalidate();}
                  }}
                >
                  <Download size={14} />
                </button>
              </span>
            </div>
          </div>
          {curveOpen && (
            <div className="curve-section">
              <button className="curve-close" aria-label="关闭曲线编辑器" title="关闭曲线编辑器（Esc）" onClick={()=>setCurveOpen(false)}><X size={17}/></button>
              <div className="curve-tools">
                <select
                  aria-label="选择曲线"
                  value={curve?.id || ""}
                  onChange={(e) => {
                    setSelectedParam(e.target.value);
                    setKeyIndex(-1);
                  }}
                >
                  <option value="">选择片段中的参数曲线</option>
                  {asset?.curves.map((c) => (
                    <option key={c.id} value={c.id}>
                      {params.find((p) => p.id === c.id)?.name || c.id}
                    </option>
                  ))}
                </select>
                {asset && asset.kind !== "keyframe" && (
                  <button onClick={editableCopy}>
                    <Copy size={12} />
                    独立编辑副本
                  </button>
                )}
                <button
                  disabled={!asset?.curves.length}
                  title="导出当前片段曲线为 motion3.json"
                  onClick={() =>
                    asset &&
                    download(
                      new Blob([JSON.stringify(exportMotion(asset), null, 2)], {
                        type: "application/json",
                      }),
                      asset.name + ".motion3.json",
                    )
                  }
                >
                  <Download size={13} />
                </button>
                {curve && keyIndex >= 0 && curve.keys[keyIndex] && (
                  <>
                    <select
                      aria-label="关键帧插值"
                      value={curve.keys[keyIndex].mode}
                      onChange={(e) =>
                        updateKey((k) => {
                          k.mode = e.target.value;
                        })
                      }
                    >
                      <option value="linear">线性</option>
                      <option value="bezier">贝塞尔</option>
                      <option value="step">阶跃</option>
                      <option value="inverse">反向阶跃</option>
                    </select>
                    <input
                      className="key-value"
                      title="关键帧数值"
                      type="number"
                      step=".01"
                      value={fmt(curve.keys[keyIndex].v)}
                      onChange={(e) =>
                        updateKey((k) => {
                          k.v = +e.target.value;
                        })
                      }
                    />
                    <button
                      title="删除关键帧"
                      onClick={() => {
                        const c = structuredClone(curve);
                        c.keys.splice(keyIndex, 1);
                        if (!c.keys.length)
                          c.keys.push({
                            t: 0,
                            v: param?.default ?? 0,
                            mode: "linear",
                          });
                        updateCurve(c);
                        setKeyIndex(-1);
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
              <CurveEditor
                curve={curve}
                duration={asset?.duration || project.duration}
                param={param}
                time={localTime}
                selected={keyIndex}
                onSelect={setKeyIndex}
                onChange={updateCurve}
                onSeek={(t) =>
                  seek(clip ? clip.start + (t - clip.trimIn) / clip.speed : t)
                }
              />
            </div>
          )}
        </main>
        <aside className="inspector" hidden={!inspectorOpen}>
          <div className="inspector-header"><strong>{sideTab==='params'?'参数编辑器':sideTab==='effects'?'质感效果':'片段设置'}</strong><button aria-label="关闭属性面板" title="关闭（Esc）" onClick={()=>setInspectorOpen(false)}><X size={18}/></button></div>
          <div className="inspector-content">
            {sideTab === "clip" && (
              <>
                {clip && asset ? (
                  <>
                    <div className="section-eyebrow">
                      {kindLabels[asset.kind]}片段 / CLIP
                    </div>
                    <h2>{asset.name}</h2>
                    <p className="small-muted">
                      原始时长 {asset.duration.toFixed(6)} 秒 · {asset.fps} FPS
                    </p>
                    <div className="field-grid">
                      <NumberField
                        label="起始时间"
                        value={clip.start}
                        min={0}
                        max={3600}
                        suffix="s"
                        onChange={(v) =>
                          changeClip((c) => {
                            c.start = v;
                          })
                        }
                      />
                      <NumberField
                        label="片段时长"
                        value={clip.duration}
                        min={1 / project.fps}
                        max={
                          clip.loop
                            ? 3600
                            : (asset.duration - clip.trimIn) / clip.speed
                        }
                        suffix="s"
                        onChange={(v) =>
                          changeClip((c) => {
                            c.duration = v;
                          })
                        }
                      />
                      <NumberField
                        label="源入点"
                        value={clip.trimIn}
                        min={0}
                        max={Math.max(0, asset.duration - 1 / project.fps)}
                        suffix="s"
                        onChange={(v) =>
                          changeClip((c) => {
                            c.trimIn = v;
                            c.duration = Math.min(
                              c.duration,
                              (asset.duration - v) / c.speed,
                            );
                          })
                        }
                      />
                      <NumberField
                        label="播放速度"
                        value={clip.speed}
                        min={0.25}
                        max={4}
                        suffix="×"
                        onChange={(v) =>
                          changeClip((c) => {
                            const ratio = c.speed / v;
                            c.duration *= ratio;
                            c.speed = v;
                          })
                        }
                      />
                      <NumberField
                        label="淡入"
                        value={clip.fadeIn}
                        min={0}
                        max={clip.duration}
                        suffix="s"
                        onChange={(v) =>
                          changeClip((c) => {
                            c.fadeIn = v;
                          })
                        }
                      />
                      <NumberField
                        label="淡出"
                        value={clip.fadeOut}
                        min={0}
                        max={clip.duration}
                        suffix="s"
                        onChange={(v) =>
                          changeClip((c) => {
                            c.fadeOut = v;
                          })
                        }
                      />
                    </div>
                    <Slider
                      label="混合权重"
                      value={clip.weight}
                      onChange={(v) =>
                        changeClip((c) => {
                          c.weight = v;
                        })
                      }
                    />
                    <label className="stack-field">
                      叠加方式
                      <select
                        value={clip.blend}
                        onChange={(e) =>
                          changeClip((c) => {
                            c.blend = e.target.value as any;
                          })
                        }
                      >
                        <option value="mix">归一化混合 · 重叠平滑</option>
                        <option value="add">增量叠加 · 相对默认姿态</option>
                        <option value="override">覆盖 · 按轨道顺序</option>
                      </select>
                    </label>
                    <div className="toggle-row">
                      <label>
                        <input
                          type="checkbox"
                          checked={clip.enabled}
                          onChange={(e) =>
                            changeClip((c) => {
                              c.enabled = e.target.checked;
                            })
                          }
                        />
                        片段启用
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={clip.loop}
                          onChange={(e) =>
                            changeClip((c) => {
                              c.loop = e.target.checked;
                            })
                          }
                        />
                        循环源动作
                      </label>
                    </div>
                    <div className="section-heading">
                      <span>参数遮罩</span>
                      <small>仅作用于此片段</small>
                    </div>
                    <p className="hint">
                      取消勾选某组，该片段将不再影响这些参数，其他动作仍然生效。
                    </p>
                    <div className="group-mask">
                      {(Object.keys(groupNames) as Group[]).map((g) => (
                        <label key={g}>
                          <input
                            type="checkbox"
                            checked={!clip.disabledGroups.includes(g)}
                            onChange={(e) =>
                              changeClip((c) => {
                                c.disabledGroups = e.target.checked
                                  ? c.disabledGroups.filter((x) => x !== g)
                                  : [...c.disabledGroups, g];
                              })
                            }
                          />
                          <span>{groupNames[g]}</span>
                          <small>
                            {asset.curves.filter(
                              (cv) =>
                                (project.groupOverrides[cv.id] ||
                                  classify(cv.id)) === g,
                            ).length +
                              (asset.expression?.filter(
                                (v) =>
                                  (project.groupOverrides[v.id] ||
                                    classify(v.id)) === g,
                              ).length || 0)}
                          </small>
                        </label>
                      ))}
                    </div>
                    <details className="parameter-mask">
                      <summary>
                        逐个参数开关与映射{" "}
                        <span>
                          {asset.curves.length +
                            (asset.expression?.length || 0)}
                        </span>
                      </summary>
                      {[
                        ...new Set([
                          ...asset.curves.map((c) => c.id),
                          ...(asset.expression?.map((c) => c.id) || []),
                        ]),
                      ].map((id) => {
                        const mapped = project.parameterMap[id] || id,
                          matched = params.some((p) => p.id === mapped);
                        return (
                          <div className="parameter-mask-row" key={id}>
                            <label>
                              <input
                                type="checkbox"
                                checked={!clip.disabledIds.includes(id)}
                                onChange={(e) =>
                                  changeClip((c) => {
                                    c.disabledIds = e.target.checked
                                      ? c.disabledIds.filter((x) => x !== id)
                                      : [...c.disabledIds, id];
                                  })
                                }
                              />
                              <span
                                title={id}
                                className={matched ? "" : "unmatched"}
                              >
                                {id}
                              </span>
                            </label>
                            {!matched && (
                              <select
                                aria-label={"映射 " + id}
                                value={project.parameterMap[id] || ""}
                                onChange={(e) =>
                                  change((p) => {
                                    p.parameterMap[id] = e.target.value;
                                  })
                                }
                              >
                                <option value="">未匹配 · 选择目标</option>
                                {params.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        );
                      })}
                    </details>
                    {asset.kind === "audio" && (
                      <div className="audio-note">
                        <AudioLines size={16} />
                        <span>
                          {asset.analysis}
                          <br />
                          嘴型映射可在曲线中手动修正。禁用嘴部组后仍播放音频。
                        </span>
                      </div>
                    )}
                    <button className="wide-button" onClick={editableCopy}>
                      <Diamond size={14} />
                      将参数曲线制作为独立编辑副本
                    </button>
                  </>
                ) : (
                  <>
                    <div className="inspector-empty">
                      <Layers size={30} />
                      <h3>选择一个时间线片段</h3>
                      <p>
                        调整叠加权重、淡入淡出，
                        <br />
                        或屏蔽不需要的参数。
                      </p>
                    </div>
                    <div className="section-heading">画布与构图</div>
                    <div className="field-grid">
                      <NumberField
                        label="横向位置"
                        value={project.transform.x}
                        min={-1}
                        max={1}
                        onChange={(v) =>
                          change((p) => {
                            p.transform.x = v;
                          })
                        }
                      />
                      <NumberField
                        label="纵向位置"
                        value={project.transform.y}
                        min={-1}
                        max={1}
                        onChange={(v) =>
                          change((p) => {
                            p.transform.y = v;
                          })
                        }
                      />
                      <NumberField
                        label="缩放"
                        value={project.transform.scale}
                        min={0.1}
                        max={8}
                        onChange={(v) =>
                          change((p) => {
                            p.transform.scale = v;
                          })
                        }
                      />
                      <NumberField
                        label="旋转"
                        value={project.transform.rotation}
                        min={-180}
                        max={180}
                        onChange={(v) =>
                          change((p) => {
                            p.transform.rotation = v;
                          })
                        }
                      />
                    </div>
                    <label className="toggle-line">
                      <input
                        type="checkbox"
                        checked={project.physics}
                        onChange={(e) =>
                          change((p) => {
                            p.physics = e.target.checked;
                          })
                        }
                      />
                      启用模型物理
                    </label>
                    <button
                      className="wide-button"
                      onClick={() => setModal("canvas")}
                    >
                      <Settings2 size={14} />
                      画布与帧率设置
                    </button>
                  </>
                )}
              </>
            )}
            {sideTab === "params" && (
              <>
                <div className="section-eyebrow">PARAMETER ANIMATION</div>
                <h2>模型参数</h2>
                <div className="param-top">
                  <label className="toggle-line">
                    <input
                      type="checkbox"
                      checked={autoKey}
                      onChange={(e) => setAutoKey(e.target.checked)}
                    />
                    自动记录关键帧
                  </label>
                  <button
                    title="在播放头处记录当前参数值"
                    onClick={() =>
                      param &&
                      setParameter(
                        param.id,
                        evaluated.parameters[param.id] ?? param.default,
                        true,
                      )
                    }
                  >
                    <Diamond size={14} />
                  </button>
                </div>
                <p className="hint">
                  滑动参数会在当前时间记录关键帧。编辑预设时先创建独立副本；参数分组可以手动修正。
                </p>
                <div className="search-field">
                  <Search size={13} />
                  <input
                    placeholder="搜索参数名称或 ID"
                    aria-label="搜索参数"
                    value={paramSearch}
                    onChange={(e) => setParamSearch(e.target.value)}
                  />
                </div>
                <select
                  className="full-select"
                  value={paramGroup}
                  onChange={(e) => setParamGroup(e.target.value as any)}
                >
                  <option value="all">全部参数 ({params.length})</option>
                  {Object.entries(groupNames).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
                <div className="parameter-list">
                  {visibleParams.map((p) => (
                    <div
                      className={`parameter-row ${selectedParam === p.id ? "selected" : ""}`}
                      key={p.id}
                      onClick={() => setSelectedParam(p.id)}
                    >
                      <div>
                        <span title={p.id}>{p.name}</span>
                        <button
                          title="记录关键帧"
                          onClick={() =>
                            setParameter(
                              p.id,
                              evaluated.parameters[p.id] ?? p.default,
                              true,
                            )
                          }
                        >
                          <Diamond size={11} />
                        </button>
                        <b>
                          {(evaluated.parameters[p.id] ?? p.default).toFixed(2)}
                        </b>
                      </div>
                      <input
                        aria-label={p.name}
                        type="range"
                        min={p.min}
                        max={p.max}
                        step={Math.max(0.001, (p.max - p.min) / 200)}
                        value={evaluated.parameters[p.id] ?? p.default}
                        onChange={(e) => setParameter(p.id, +e.target.value)}
                      />
                      <div className="param-id">
                        <small>{p.id}</small>
                        <select
                          aria-label={"分组 " + p.id}
                          value={project.groupOverrides[p.id] || p.group}
                          onChange={(e) =>
                            change((pr) => {
                              pr.groupOverrides[p.id] = e.target.value as Group;
                            })
                          }
                        >
                          {Object.entries(groupNames).map(([id, name]) => (
                            <option key={id} value={id}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {sideTab === "effects" && (
              <>
                <div className="section-eyebrow">LOOK DEVELOPMENT</div>
                <h2>效果</h2>
                <div className="look-presets">
                  <button
                    onClick={() =>
                      change((p) => {
                        p.effects = { ...defaultEffects };
                      })
                    }
                  >
                    原始
                  </button>
                  <button
                    onClick={() =>
                      change((p) => {
                        p.effects = {
                          ...defaultEffects,
                          outline: 3,
                          glow: 0.15,
                          lightType: "area",
                          lightIntensity: 0.4,
                          rim: 0.5,
                        };
                      })
                    }
                  >
                    柔和描边
                  </button>
                  <button
                    onClick={() =>
                      change((p) => {
                        p.effects = {
                          ...defaultEffects,
                          bloom: 0.35,
                          glow: 0.2,
                          lightType: "point",
                          lightIntensity: 0.5,
                          rim: 0.7,
                          gloss: 0.6,
                          lightColor: "#ffe6cd",
                        };
                      })
                    }
                  >
                    暖光电影
                  </button>
                </div>
                <div className="section-heading">
                  <span>轮廓与泛光</span>
                  <Sparkles size={13} />
                </div>
                <Slider
                  label="描边宽度 / px"
                  value={project.effects.outline}
                  min={0}
                  max={12}
                  step={0.5}
                  onChange={(v) => effect("outline", v)}
                />
                <label className="color-field">
                  描边颜色
                  <input
                    type="color"
                    value={project.effects.outlineColor}
                    onChange={(e) => effect("outlineColor", e.target.value)}
                  />
                </label>
                <Slider
                  label="边缘发光"
                  value={project.effects.glow}
                  max={2}
                  onChange={(v) => effect("glow", v)}
                />
                <label className="color-field">
                  发光颜色
                  <input
                    type="color"
                    value={project.effects.glowColor}
                    onChange={(e) => effect("glowColor", e.target.value)}
                  />
                </label>
                <Slider
                  label="高光泛光 / Bloom"
                  value={project.effects.bloom}
                  max={2}
                  onChange={(v) => effect("bloom", v)}
                />
                <div className="section-heading">
                  <span>模拟灯光</span>
                  <Lightbulb size={14} />
                </div>
                <label className="stack-field">
                  灯光类型
                  <select
                    value={project.effects.lightType}
                    onChange={(e) => effect("lightType", e.target.value)}
                  >
                    <option value="off">关闭</option>
                    <option value="point">点光</option>
                    <option value="area">面光</option>
                    <option value="sun">日光</option>
                  </select>
                </label>
                <div
                  className="light-pad"
                  onPointerDown={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const move = (ev: { clientX: number; clientY: number }) =>
                      change((p) => {
                        p.effects.lightX = clamp(
                          (ev.clientX - rect.left) / rect.width,
                          0,
                          1,
                        );
                        p.effects.lightY = clamp(
                          (ev.clientY - rect.top) / rect.height,
                          0,
                          1,
                        );
                      });
                    move(e);
                    const m = (ev: PointerEvent) => move(ev),
                      up = () => {
                        window.removeEventListener("pointermove", m);
                        window.removeEventListener("pointerup", up);
                      };
                    window.addEventListener("pointermove", m);
                    window.addEventListener("pointerup", up);
                  }}
                >
                  <div className="light-grid" />
                  <div
                    style={{
                      left: project.effects.lightX * 100 + "%",
                      top: project.effects.lightY * 100 + "%",
                    }}
                  >
                    <Lightbulb size={17} />
                  </div>
                  <span>拖动定位光源</span>
                </div>
                <label className="color-field">
                  光源颜色
                  <input
                    type="color"
                    value={project.effects.lightColor}
                    onChange={(e) => effect("lightColor", e.target.value)}
                  />
                </label>
                <Slider
                  label="灯光强度"
                  value={project.effects.lightIntensity}
                  max={2}
                  onChange={(v) => effect("lightIntensity", v)}
                />
                <Slider
                  label="边缘轮廓光"
                  value={project.effects.rim}
                  max={2}
                  onChange={(v) => effect("rim", v)}
                />
                <Slider
                  label="表面光泽"
                  value={project.effects.gloss}
                  max={2}
                  onChange={(v) => effect("gloss", v)}
                />
                <p className="hint">
                  灯光为基于画面与轮廓的 2.5D
                  模拟；无模型法线贴图时，不计算真实立体阴影。
                </p>
                <div className="section-heading">色彩</div>
                <Slider
                  label="曝光 / 亮度"
                  value={project.effects.brightness}
                  min={0.2}
                  max={2}
                  onChange={(v) => effect("brightness", v)}
                />
                <Slider
                  label="对比度"
                  value={project.effects.contrast}
                  min={0.2}
                  max={2}
                  onChange={(v) => effect("contrast", v)}
                />
                <Slider
                  label="饱和度"
                  value={project.effects.saturation}
                  min={0}
                  max={2}
                  onChange={(v) => effect("saturation", v)}
                />
              </>
            )}
          </div>
          <div className="inspector-footer">
            <button onClick={() => setModal("help")}>
              <Info size={13} />
              使用指南
            </button>
            <span>本地文件 · 无需联网</span>
          </div>
        </aside>
      </div>
      <Timeline
        project={project}
        time={time}
        playing={playing}
        selected={selected}
        zoom={zoom}
        snap={snap}
        onSeek={seek}
        onPlay={() => {
          if (timeRef.current >= project.duration) seek(0);
          setPlaying((v) => !v);
        }}
        onChange={change}
        onSelect={selectClip}
        onZoom={setZoom}
        onSnap={() => setSnap((v) => !v)}
        onSplit={splitClip}
        onDuplicate={duplicateClip}
        onDelete={deleteClip}
        onDropAsset={addAsset}
        onAddTrack={() =>
          change((p) =>
            p.tracks.push({
              id: uid(),
              name: "轨道 " + (p.tracks.length + 1),
              type: "generic",
              muted: false,
              solo: false,
              clips: [],
            }),
          )
        }
        curveOpen={curveOpen}
        onCurve={() => setCurveOpen((v) => !v)}
      />
      <footer className="status-bar">
        <span>
          <i className={ready ? "ready-dot" : "waiting-dot"} />
          {status}
        </span>
        <span>
          <span data-frame>帧 {Math.round(time * project.fps)}</span> <i>·</i>{" "}
          {project.physics ? "固定步长物理" : "参数直接驱动"} <i>·</i>{" "}
          {dirty ? "已自动保存草稿" : "工程已就绪"}
        </span>
      </footer>
      <input
        ref={modelInput}
        type="file"
        accept=".zip"
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) importModel(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={folderInput}
        type="file"
        hidden
        {...({ webkitdirectory: "", directory: "" } as any)}
        onChange={(e) => {
          if (e.target.files?.length) importFolder(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={motionInput}
        type="file"
        accept=".json,.mtn"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) importMotions(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={audioInput}
        type="file"
        accept="audio/*,.wav,.mp3,.ogg,.m4a,.flac"
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) importAudio(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={projectInput}
        type="file"
        accept=".l2dstudio"
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) openProject(e.target.files[0]);
          e.target.value = "";
        }}
      />
      {toast && (
        <div className="toast">
          <Info size={15} />
          {toast}
        </div>
      )}
      {busy && modal !== "export" && (
        <div className="busy-strip">
          <Loader2 className="spin" size={14} />
          {status}
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget && !busy) setModal("");
          }}
        >
          <div
            className={"modal " + (modal === "help" ? "help-modal" : "")}
            role="dialog"
            aria-modal="true"
          >
            <button
              className="modal-close"
              title="关闭"
              disabled={busy}
              onClick={() => setModal("")}
            >
              <X size={17} />
            </button>
            {modal === "canvas" && (
              <>
                <div className="section-eyebrow">COMPOSITION SETTINGS</div>
                <h1>画布设置</h1>
                <p>设置输出画幅与帧率，时间线按秒精确计算。</p>
                <div className="canvas-presets">
                  {[
                    [1080, 1080, "方形"],
                    [1920, 1080, "横屏"],
                    [1080, 1920, "竖屏"],
                    [1280, 720, "轻量"],
                  ].map(([w, h, l]) => (
                    <button
                      key={l}
                      className={
                        project.width === w && project.height === h
                          ? "active"
                          : ""
                      }
                      onClick={() =>
                        change((p) => {
                          p.width = +w;
                          p.height = +h;
                        })
                      }
                    >
                      {l}
                      <small>
                        {w} × {h}
                      </small>
                    </button>
                  ))}
                </div>
                <div className="field-grid">
                  <NumberField
                    label="宽度"
                    value={project.width}
                    min={64}
                    max={3840}
                    step={2}
                    onChange={(v) =>
                      change((p) => {
                        p.width = Math.round(v / 2) * 2;
                      })
                    }
                  />
                  <NumberField
                    label="高度"
                    value={project.height}
                    min={64}
                    max={3840}
                    step={2}
                    onChange={(v) =>
                      change((p) => {
                        p.height = Math.round(v / 2) * 2;
                      })
                    }
                  />
                  <NumberField
                    label="帧率"
                    value={project.fps}
                    min={1}
                    max={60}
                    step={1}
                    onChange={(v) =>
                      change((p) => {
                        p.fps = Math.round(v);
                      })
                    }
                  />
                  <NumberField
                    label="总时长（秒）"
                    value={project.duration}
                    min={0.1}
                    max={3600}
                    onChange={(v) =>
                      change((p) => {
                        p.duration = v;
                      })
                    }
                  />
                </div>
                <button
                  className="primary wide-button"
                  onClick={() => {
                    setModal("");
                    notify("画布设置已应用");
                  }}
                >
                  应用画布设置
                </button>
                <button
                  className="wide-button"
                  onClick={() => {
                    if (
                      !confirm(
                        "清空当前时间线并创建新作品？草稿将更新；已下载工程不受影响。",
                      )
                    )
                      return;
                    const p = emptyProject();
                    p.modelId = project.modelId;
                    p.modelFile = project.modelFile;
                    p.assets = project.assets.filter(
                      (a) => a.kind === "motion" || a.kind === "expression",
                    );
                    change(p);
                    seek(0);
                    setSelected("");
                    setModal("");
                  }}
                >
                  新建空白时间线
                </button>
              </>
            )}
            {modal === "export" && (
              <>
                <div className="section-eyebrow">RENDER & EXPORT</div>
                <h1>导出动画</h1>
                <p>透明背景输出，保留时间线叠加、口型、音频与后期效果。</p>
                <div className="export-options">
                  {[
                    ["webm", "WebM / VP9", "透明通道 · 体积较小"],
                    [
                      "prores",
                      "MOV / ProRes 4444",
                      "透明通道 · 适合 AE / 剪辑",
                    ],
                    ["png", "PNG 序列", "逐帧透明图像 · ZIP 打包"],
                  ].map(([id, title, desc]) => (
                    <button
                      key={id}
                      disabled={busy}
                      className={exportFormat === id ? "selected" : ""}
                      onClick={() => {
                        setExportFormat(id);
                        setExportResult(null);
                        setExportProgress(0);
                        setExportStatus("");
                      }}
                    >
                      <Film size={20} />
                      <span>
                        <strong>{title}</strong>
                        <small>{desc}</small>
                      </span>
                      <i>{exportFormat === id && <Check size={15} />}</i>
                    </button>
                  ))}
                </div>
                <div className="export-summary">
                  <span>
                    {project.width} × {project.height}
                  </span>
                  <span>{project.fps} FPS</span>
                  <span>{project.duration.toFixed(3)} 秒</span>
                  <span>{Math.ceil(project.duration * project.fps)} 帧</span>
                </div>
                {(exportProgress > 0 || exportStatus) && (
                  <div className="export-progress">
                    <div>
                      <i style={{ width: exportProgress * 100 + "%" }} />
                    </div>
                    <span>{exportStatus}</span>
                  </div>
                )}
                {exportResult ? (
                  <>
                    <button className="wide-button" onClick={exportVideo}>
                      重新导出当前时间线
                    </button>
                    <button
                      className="primary wide-button"
                      onClick={() => {
                        const a = document.createElement("a");
                        a.href = exportResult.url;
                        a.download =
                          project.name +
                          (exportFormat === "prores"
                            ? ".mov"
                            : exportFormat === "png"
                              ? ".zip"
                              : ".webm");
                        a.click();
                      }}
                    >
                      <Download size={15} />
                      保存导出文件
                    </button>
                    {window.studioDesktop && (
                      <button
                        className="wide-button"
                        onClick={() =>
                          window.studioDesktop!.reveal(exportResult.path)
                        }
                      >
                        打开所在文件夹
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    className="primary wide-button"
                    disabled={busy || !ready}
                    onClick={exportVideo}
                  >
                    {busy ? (
                      <Loader2 className="spin" size={16} />
                    ) : (
                      <ArrowUpFromLine size={16} />
                    )}{" "}
                    {busy ? "正在导出…" : "开始导出"}
                  </button>
                )}
                {busy && exportProgress < 0.85 && (
                  <button
                    className="wide-button"
                    onClick={() => {
                      cancelExport.current = true;
                    }}
                  >
                    取消导出
                  </button>
                )}
                <p className="hint">
                  透明棋盘格只在预览中显示。普通播放器可能把透明区域显示为黑色；请在支持
                  Alpha 的剪辑软件中叠加查看。
                </p>
              </>
            )}
            {modal === "help" && (
              <>
                <div className="section-eyebrow">QUICK START</div>
                <h1>使用指南</h1>
                <ol>
                  <li>
                    <b>导入模型</b>：支持 Cubism 2.1 的 model.json 和 Cubism 3/4/5 的 model3.json
                    ZIP 或完整文件夹。CMO3
                    是编辑器源文件，需要先导出运行时文件。
                  </li>
                  <li>
                    <b>搭建时间线</b>
                    ：双击素材或拖入轨道；在不同轨道的同一时间放入动作即可叠加，拖动片段边缘裁切。
                  </li>
                  <li>
                    <b>控制叠加</b>
                    ：选择片段，在参数遮罩中关闭嘴部、表情或身体组；逐个开关可细分到每个参数。分组依据名称推断，可在参数页修正。
                  </li>
                  <li>
                    <b>编辑曲线</b>
                    ：选择预设中的参数，创建独立编辑副本；曲线上拖动菱形，选择贝塞尔后拖动圆点手柄，双击添加关键帧。参数滑块会自动记录到关键帧轨道。
                  </li>
                  <li>
                    <b>配音口型</b>
                    ：导入音频后自动离线分析嘴型；可单独屏蔽嘴部参数而保留声音。Rhubarb
                    通用模式并非中文逐字强制对齐，嘴型可继续微调。
                  </li>
                  <li>
                    <b>光与导出</b>：质感页提供描边、发光、泛光和模拟灯光。WebM
                    VP9 与 ProRes 4444 保存透明通道；PNG 序列不包含音频。
                  </li>
                  <li>
                    <b>带走工程</b>：保存 .l2dstudio
                    文件，模型、音频、动作与设置一起打包。未导出的草稿自动保存在便携工具的
                    data 文件夹。
                  </li>
                </ol>
                <div className="shortcut-grid">
                  <span>
                    空格 <b>播放 / 暂停</b>
                  </span>
                  <span>
                    ← → <b>逐帧移动</b>
                  </span>
                  <span>
                    Ctrl + Z <b>撤销</b>
                  </span>
                  <span>
                    Ctrl + S <b>保存工程</b>
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
