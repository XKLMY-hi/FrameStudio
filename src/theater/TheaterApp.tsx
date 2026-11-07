import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { freeze, produce } from "immer";
import {
  Plus,
  Layers,
  Type,
  Image as ImageIcon,
  Music2,
  SlidersHorizontal,
  FolderOpen,
  Save,
  Undo2,
  Redo2,
  Download,
  Upload,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ChevronDown,
  Copy,
  Trash2,
  X,
  Play,
  Pause,
  Search,
  Camera,
  Move,
  Focus,
  Diamond,
  Settings2,
  Loader2,
  Volume2,
  Flag,
  Maximize2,
  Hand,
  Box,
  Lamp,
  Grid2X2,
  Minimize2,
} from "lucide-react";
import { api, download, media, token } from "../api";
import {
  Asset,
  Group,
  Key,
  ModelEntry,
  Param,
  groupNames,
  uid,
} from "../types";
import { clamp, classify, parseAsset, parseLegacy } from "../engine";
import { CurveWorkspace } from "./CurveWorkspace";
import { LightPanel } from "./LightPanel";
import { ModelPreprocessPanel } from "./ModelPreprocessPanel";
import { preprocessingScene } from "./preprocess";
import { receivesLight } from "./lighting";
import { SceneTimeline } from "./SceneTimeline";
import {
  Binding,
  readProperty,
  writeProperty,
  propertiesOf,
  parameterDriven,
} from "./properties";
import { AudioLibraryPreview } from "./AudioLibraryPreview";
import { SceneRenderer, type MirrorView } from "./scene-renderer";
import {
  boxHits,
  dragBox,
  editable,
  groupTransform,
  pivotOf,
  selectionRoots,
  type Box as SelectionBox,
} from "./viewport-selection";
import {
  ViewportOverlay,
  viewportStore,
  type Axis,
  type GizmoTool,
  type Handle,
  type OverlayFrame,
} from "./ViewportOverlay";
import { AuditionControls } from "./AuditionControls";
import {
  advanceAudition,
  auditionProject,
  auditionSample,
  type AuditionState,
} from "./motion-audition";
import {
  cameraPoint,
  fitOrbit,
  orbitPan,
  orbitRotate,
  orbitZoom,
  projectView,
  viewportFocal,
  type ViewPreset,
  type Vec3,
  outputProjection,
} from "./viewport";
import {
  Camera as SceneCamera,
  Layer,
  MediaAsset,
  ModelResource,
  Scene,
  SceneClip,
  SceneEffects,
  SceneLight,
  defaultLight,
  MAX_SCENE_LIGHTS,
  sceneEffects,
  addVisual,
  cameraChannels,
  channels,
  emptyScene,
  layer,
  migrateScene,
  sceneClip,
  track,
} from "./schema";
import {
  active,
  animatedCamera,
  animatedLayer,
  audioGain,
  collectAudio,
  cloneData,
  duplicateTree,
  enabledTracks,
  layerAlpha,
  modelValues,
  modelProject,
  projectPoint,
  reparentSafe,
  sampleKeys,
  spatialLayer,
  sourceTime,
  upsertKey,
  visualClip,
  worldMatrix,
} from "./scene-engine";
declare global {
  interface Window {
    theater: any;
  }
}
const format = (n: number) => Number((Number.isFinite(n) ? n : 0).toFixed(4));
function Num({
  label,
  value,
  onChange,
  min = -1e6,
  max = 1e6,
  step = 0.01,
  keyed = false,
  onKey,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  keyed?: boolean;
  onKey?: () => void;
}) {
  return (
    <label className="scene-number">
      <span>
        {label}
        {onKey && (
          <button
            type="button"
            title={"记录 " + label + " 关键帧"}
            className={keyed ? "keyed" : ""}
            onClick={onKey}
          >
            <Diamond size={11} />
          </button>
        )}
      </span>
      <input
        type="number"
        aria-label={label}
        value={format(value)}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          if (Number.isFinite(+e.target.value))
            onChange(clamp(+e.target.value, min, max));
        }}
      />
    </label>
  );
}
function Range({
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
    <label className="scene-range">
      <span>
        {label}
        <b>{format(value)}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
      />
    </label>
  );
}
const icons: Record<Layer["kind"], React.ReactNode> = {
  model: <Layers size={16} />,
  image: <ImageIcon size={16} />,
  text: <Type size={16} />,
  color: <Box size={16} />,
  adjustment: <SlidersHorizontal size={16} />,
  group: <FolderOpen size={16} />,
  audio: <Music2 size={16} />,
  light: <Lamp size={16} />,
};
export default function TheaterApp() {
  const [scene, setScene] = useState<Scene>(emptyScene),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(""),
    [toast, setToast] = useState(""),
    [selected, setSelected] = useState(""),
    [selectedIds, setSelectedIds] = useState<string[]>([]),
    [splitLayout, setSplitLayout] = useState<"single" | "side" | "stack">(
      "single",
    ),
    [splitRatio, setSplitRatio] = useState(0.5),
    [mirrorSpatial, setMirrorSpatial] = useState(true),
    [boxTool, setBoxTool] = useState(false),
    [viewBox, setViewBox] = useState<{
      pane: "main" | "mirror";
      box: SelectionBox;
    }>(),
    [contextMenu, setContextMenu] = useState<{
      x: number;
      y: number;
      ids: string[];
    }>(),
    [selection, setSelection] = useState<string[]>([]),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [libraryTab, setLibraryTab] = useState("model"),
    [managerTab, setManagerTab] = useState<"layers" | "assets">("layers"),
    [foldedGroups, setFoldedGroups] = useState<Record<string, boolean>>({}),
    [gizmoTool, setGizmoTool] = useState<GizmoTool>("move"),
    [appearance, setAppearance] = useState(() => {
      const value = localStorage.getItem("framestudio.appearance");
      return value === "light" || value === "dark" ? value : "system";
    }),
    [search, setSearch] = useState(""),
    [modelEntries, setModelEntries] = useState<ModelEntry[]>([]),
    [inspector, setInspector] = useState<
      "layer" | "controller" | "audio" | "effects" | "camera"
    >("layer"),
    [inspectorOpen, setInspectorOpen] = useState(true),
    [curveOpen, setCurveOpen] = useState(false),
    [curveSeed, setCurveSeed] = useState<Binding>(),
    [channel, setChannel] = useState("x"),
    [autoKey, setAutoKey] = useState(false),
    [zoom, setZoom] = useState(70),
    [snap, setSnap] = useState(true),
    [viewZoom, setViewZoom] = useState(1),
    [spatialView, setSpatialView] = useState(false),
    [expandedView, setExpandedView] = useState(false),
    [viewGrid, setViewGrid] = useState(true),
    [viewCamera, setViewCamera] = useState(true),
    [quality, setQuality] = useState(960),
    [paramSearch, setParamSearch] = useState(""),
    [paramPage, setParamPage] = useState(0),
    [modal, setModal] = useState<"" | "canvas" | "export" | "help">(""),
    [exportFormat, setExportFormat] = useState("mp4"),
    [exportStatus, setExportStatus] = useState(""),
    [progress, setProgress] = useState(0),
    [exportResult, setExportResult] = useState<any>(null),
    [onlyWork, setOnlyWork] = useState(false),
    [previewId, setPreviewId] = useState(""),
    [motionPreviewId, setMotionPreviewId] = useState(""),
    [motionTargetId, setMotionTargetId] = useState(""),
    [timelineHeight, setTimelineHeight] = useState(370),
    [exportMatte, setExportMatte] = useState("#ffffff"),
    [historyVersion, setHistoryVersion] = useState(0),
    [modelVersion, setModelVersion] = useState(0),
    [dirty, setDirty] = useState(false),
    [workspaceMode, setWorkspaceMode] = useState<"scene" | "preprocess">(
      "scene",
    ),
    [preprocessId, setPreprocessId] = useState("");
  const overlay = useMemo(viewportStore, []),
    mirrorOverlay = useMemo(viewportStore, []);
  const host = useRef<HTMLDivElement>(null),
    menuRef = useRef<HTMLDivElement>(null),
    mirrorHost = useRef<HTMLDivElement>(null),
    mirrorCanvas = useRef<HTMLCanvasElement>(null),
    mirror = useRef<Omit<MirrorView, "host" | "canvas" | "onOverlay">>({
      view: { panX: 0, panY: 0, zoom: 1 },
      spatial: true,
    }),
    rRef = useRef<SceneRenderer | undefined>(undefined),
    sRef = useRef(scene),
    displayRef = useRef(scene),
    modeRef = useRef<"scene" | "preprocess">("scene"),
    savedSceneView = useRef({ panX: 0, panY: 0, zoom: 1 }),
    lastMode = useRef("scene"),
    tRef = useRef(0),
    playRef = useRef(false),
    busyRef = useRef(""),
    raf = useRef(0),
    history = useRef<Scene[]>([]),
    future = useRef<Scene[]>([]),
    lastEdit = useRef(0),
    space = useRef(false),
    cancel = useRef(false),
    preview = useRef<HTMLAudioElement | undefined>(undefined),
    audioPlayers = useRef(new Map<string, HTMLAudioElement>()),
    syncRef = useRef<() => void>(() => {}),
    liveRef = useRef(false),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    modelInput = useRef<HTMLInputElement>(null),
    folderInput = useRef<HTMLInputElement>(null),
    mediaInput = useRef<HTMLInputElement>(null),
    audioInput = useRef<HTMLInputElement>(null),
    motionInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    clipboard = useRef<SceneClip[]>([]),
    motionPreviewRef = useRef<AuditionState | undefined>(undefined),
    auditionLast = useRef(0);
  sRef.current = scene;
  playRef.current = playing;
  busyRef.current = busy;
  liveRef.current = curveOpen || inspectorOpen || expandedView;
  const selectedLayer = scene.layers.find((l) => l.id === selected),
    selectedClip = scene.tracks
      .flatMap((t) => t.clips)
      .find((c) => selection.includes(c.id) && c.layerId === selected),
    selectedMedia = scene.assets.find((a) => a.id === selectedClip?.assetId),
    resource = selectedLayer?.model
      ? scene.models.find((m) => m.id === selectedLayer.model!.resourceId)
      : undefined,
    runtime = selectedLayer
      ? rRef.current?.nodes.get(selectedLayer.id)?.runtime
      : undefined,
    params = runtime?.params || [],
    values =
      selectedLayer?.model && workspaceMode === "scene"
        ? modelValues(scene, selectedLayer, params, time)
        : {},
    animated = selectedLayer
      ? animatedLayer(scene, selectedLayer, time)
      : undefined,
    camera = animatedCamera(scene, time);
  const motionLayer = selectedLayer?.model
    ? selectedLayer
    : scene.layers.find((l) => l.id === motionTargetId && l.model);
  const motionResource = scene.models.find(
    (r) => r.id === motionLayer?.model?.resourceId,
  );
  const paramsByLayer = useMemo(
    () =>
      Object.fromEntries(
        scene.layers
          .filter((l) => l.model)
          .map((l) => [
            l.id,
            rRef.current?.nodes.get(l.id)?.runtime?.params || [],
          ]),
      ),
    [scene.layers, modelVersion],
  );
  const preprocessingResource =
    scene.models.find((r) => r.id === preprocessId) ||
    resource ||
    scene.models[0];
  const displayScene = useMemo(
    () =>
      workspaceMode === "preprocess"
        ? freeze(
            preprocessingScene(scene, preprocessingResource?.id || ""),
            true,
          )
        : scene,
    [scene, workspaceMode, preprocessingResource?.id],
  );
  displayRef.current = displayScene;
  modeRef.current = workspaceMode;
  const currentBinding: Binding = {
    layerId: selected,
    channel,
    clipId: selectedClip?.id,
  };
  function notify(s: string) {
    setToast(s);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4200);
  }
  function change(mut: Scene | ((s: Scene) => void), record = true) {
    stopMotionPreview();
    const current = sRef.current,
      next =
        typeof mut === "function"
          ? produce(current, (d) => {
              mut(d);
              if (d.tracks.some((t) => t.clips.length > 1))
                d.tracks = d.tracks.flatMap((t) =>
                  t.clips.length > 1
                    ? t.clips.map((c) => ({
                        ...t,
                        id: t.id + ":" + c.id,
                        clips: [c],
                      }))
                    : [t],
                );
              if (
                d.duration !== current.duration &&
                d.workArea.end === current.duration
              )
                d.workArea.end = d.duration;
            })
          : mut;
    if (next === current) return;
    if (
      next.layers.filter((l) => l.kind === "light").length > MAX_SCENE_LIGHTS
    ) {
      notify("每个场景最多 " + MAX_SCENE_LIGHTS + " 个光源");
      return;
    }
    if (record) {
      if (Date.now() - lastEdit.current > 400) {
        history.current.push(current);
        if (history.current.length > 35) history.current.shift();
      }
      lastEdit.current = Date.now();
      future.current = [];
      setHistoryVersion((v) => v + 1);
    }
    sRef.current = freeze(next, true);
    setScene(sRef.current);
    setDirty(true);
    rRef.current?.invalidate();
  }
  function seek(t: number) {
    stopMotionPreview();
    tRef.current = clamp(t, 0, sRef.current.duration);
    setTime(tRef.current);
    rRef.current?.invalidate();
    syncRef.current();
  }
  function selectLayer(id: string) {
    stopMotionPreview();
    setSelection([]);
    if (channel === "gain" || channel.startsWith("motion:") || id === "@camera")
      setChannel("x");
    if (sRef.current.layers.find((l) => l.id === id)?.model)
      setMotionTargetId(id);
    setSelected(id);
    setSelectedIds(id && id !== "@camera" ? [id] : []);
    if (rRef.current) {
      rRef.current.selected = id;
      rRef.current.selectedIds = id && id !== "@camera" ? [id] : [];
      rRef.current.invalidate();
    }
    setInspectorOpen(true);
    setInspector(
      id === "@camera"
        ? "camera"
        : sRef.current.layers.find((l) => l.id === id)?.kind === "audio"
          ? "audio"
          : "layer",
    );
  }
  function selectObjects(ids: string[]) {
    const next = [...new Set(ids)].filter((id) =>
      sRef.current.layers.some((l) => l.id === id),
    );
    selectLayer(next.at(-1) || "");
    setSelectedIds(next);
    if (rRef.current) rRef.current.selectedIds = next;
  }
  function selectClips(ids: string[]) {
    const c = sRef.current.tracks
      .flatMap((t) => t.clips)
      .find((c) => ids.includes(c.id));
    if (c) {
      selectLayer(c.layerId);
      setSelection(ids);
      setInspector(
        c.kind === "motion"
          ? "controller"
          : c.kind === "audio"
            ? "audio"
            : "layer",
      );
      if (c.kind === "audio") setChannel("gain");
      else if (c.kind === "motion") {
        const a = sRef.current.models
          .find(
            (r) =>
              r.id ===
              sRef.current.layers.find((l) => l.id === c.layerId)?.model
                ?.resourceId,
          )
          ?.assets.find((a) => a.id === c.assetId);
        if (a?.curves[0]) setChannel("motion:" + a.curves[0].id);
      }
    }
  }
  function undo() {
    if (!history.current.length) return;
    future.current.push(sRef.current);
    const p = history.current.pop()!;
    sRef.current = p;
    setScene(p);
    rRef.current?.invalidate();
    setHistoryVersion((v) => v + 1);
  }
  function redo() {
    if (!future.current.length) return;
    history.current.push(sRef.current);
    const p = future.current.pop()!;
    sRef.current = p;
    setScene(p);
    rRef.current?.invalidate();
    setHistoryVersion((v) => v + 1);
  }
  async function loadScene(s: Scene) {
    setWorkspaceMode("scene");
    toggleSpatial(false);
    if (rRef.current) rRef.current.orbit = undefined;
    stopMotionPreview();
    setBusy("载入场景与独立模型控制器…");
    setReady(false);
    try {
      const p = freeze(migrateScene(s), true);
      setCurveSeed(undefined);
      sRef.current = p;
      setScene(p);
      tRef.current = 0;
      setTime(0);
      setPlaying(false);
      preview.current?.pause();
      setPreviewId("");
      for (const audio of audioPlayers.current.values()) audio.pause();
      audioPlayers.current.clear();
      await rRef.current!.ensure(p);
      rRef.current!.exportBackground = undefined;
      rRef.current!.invalidate();
      rRef.current!.renderAt(p, 0);
      setReady(true);
      const firstModel = p.layers.find((l) => l.kind === "model")?.id || "";
      setSelected(firstModel);
      setSelectedIds(firstModel ? [firstModel] : []);
      rRef.current!.selected = firstModel;
      rRef.current!.selectedIds = firstModel ? [firstModel] : [];
      rRef.current!.invalidate();
      setMotionTargetId(firstModel);
      setChannel("x");
      setSelection([]);
      setModelVersion((v) => v + 1);
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy("");
    }
  }
  async function addModel(
    modelId: string,
    file: string,
    name: string,
    existing?: Scene,
  ) {
    const catalog = await api(
      "model-catalog?id=" +
        encodeURIComponent(modelId) +
        "&file=" +
        encodeURIComponent(file),
    );
    const assets: Asset[] = catalog.assets.map((a: any) => {
      const v = parseAsset(a.json, a.name);
      v.source = a.source;
      if (a.fadeIn >= 0) v.fadeIn = a.fadeIn;
      if (a.fadeOut >= 0) v.fadeOut = a.fadeOut;
      return v;
    });
    const resource: ModelResource = { id: uid(), name, modelId, file, assets },
      l = layer("model", name);
    l.width = scene.width * 0.38;
    l.height = scene.height * 0.9;
    l.model = {
      resourceId: resource.id,
      physics: true,
      parameterMap: {},
      groupOverrides: {},
      baseValues: {},
      keys: [],
      lipOpen: "ParamMouthOpenY",
      lipForm: "ParamMouthForm",
    };
    const assign = (p: Scene) => {
      p.models.push(resource);
      addVisual(p, l);
      const idle =
        assets.find((a) => /idle01_C|idle01$/i.test(a.name)) ||
        assets.find((a) => a.kind === "motion");
      if (idle) {
        const c = sceneClip("motion", l.id, idle.id, idle.name, 0, p.duration);
        c.loop = true;
        const tr =
          p.tracks.find((t) => !t.clips.length) ||
          track("轨道 " + (p.tracks.length + 1));
        if (!p.tracks.includes(tr)) p.tracks.push(tr);
        tr.clips.push(c);
      }
    };
    if (existing) {
      assign(existing);
      return l;
    }
    change(assign);
    await rRef.current!.ensure(sRef.current);
    selectLayer(l.id);
    if (modeRef.current === "preprocess") setPreprocessId(resource.id);
    setModelVersion((v) => v + 1);
    return l;
  }
  useEffect(() => {
    const r = new SceneRenderer(host.current!);
    r.onOverlay = overlay.publish;
    rRef.current = r;
    r.onLoad = () => {
      setModelVersion((v) => v + 1);
    };
    let live = true;
    const observer = new ResizeObserver(() => r.invalidate());
    observer.observe(host.current!);
    (async () => {
      try {
        const info = await api("info");
        if (!live) return;
        api("preferences")
          .then(({ appearance }) => {
            if (live && ["system", "light", "dark"].includes(appearance))
              setAppearance(appearance);
          })
          .catch(() => {});
        setModelEntries(info.models);
        const saved = await api<Scene | null>("scene-autosave");
        if (saved) {
          await loadScene(saved);
        } else {
          const old = await api("autosave");
          if (old) {
            await loadScene(migrateScene(old));
          } else {
            const p = emptyScene();
            const m =
              info.models.find((m: ModelEntry) => m.id === "demo") ||
              info.models[0];
            if (m) {
              const file =
                m.files.find((f: any) => f.path.includes("/coat.model3")) ||
                m.files[0];
              await addModel(m.id, file.path, "角色 1", p);
            }
            await loadScene(p);
          }
        }
      } catch (e: any) {
        notify(e.message);
      }
    })();
    return () => {
      live = false;
      observer.disconnect();
      cancelAnimationFrame(raf.current);
      r.destroy();
      preview.current?.pause();
      for (const a of audioPlayers.current.values()) a.pause();
    };
  }, []);
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark =
        appearance === "dark" || (appearance === "system" && query.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      rRef.current?.setDark(dark);
    };
    localStorage.setItem("framestudio.appearance", appearance);
    window.studioDesktop?.setAppearance?.(appearance);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [appearance]);
  useEffect(() => {
    rRef.current
      ?.ensure(displayScene)
      .then(() => rRef.current?.invalidate())
      .catch((e) => notify(e.message));
  }, [displayScene.layers, displayScene.models, displayScene.assets]);
  useEffect(() => {
    const r = rRef.current;
    if (!r) return;
    if (workspaceMode !== lastMode.current) {
      if (workspaceMode === "preprocess") {
        savedSceneView.current = { ...r.view };
        r.view = { panX: 0, panY: 0, zoom: 1 };
      } else r.view = { ...savedSceneView.current };
      lastMode.current = workspaceMode;
      setViewZoom(r.view.zoom);
      r.invalidate();
    }
  }, [workspaceMode]);
  useEffect(() => {
    if (!ready || busy) return;
    const timer = setTimeout(
      () => api("scene-autosave", scene).catch(() => {}),
      1300,
    );
    return () => clearTimeout(timer);
  }, [scene, ready, busy]);
  useEffect(() => {
    if (rRef.current) {
      rRef.current.previewLimit = quality;
      rRef.current.invalidate();
    }
  }, [quality]);
  useEffect(() => {
    if (!playing) setTime(tRef.current);
    syncRef.current();
  }, [playing]);
  useEffect(() => {
    setTime(tRef.current);
  }, [inspector, inspectorOpen, curveOpen, selected]);
  useEffect(() => {
    let last = performance.now(),
      paint = 0,
      ui = 0,
      audio = 0,
      clock = -1;
    function tick(now: number) {
      const dt = Math.min(0.15, (now - last) / 1000);
      last = now;
      if (modeRef.current === "scene" && playRef.current && !busyRef.current) {
        let t = tRef.current + dt;
        const p = sRef.current;
        if (t >= p.workArea.end) {
          if (p.workArea.loop) t = p.workArea.start;
          else {
            t = p.workArea.end;
            playRef.current = false;
            setPlaying(false);
            setTime(t);
          }
        }
        tRef.current = t;
        if (liveRef.current && now - ui > 100) {
          setTime(t);
          ui = now;
        }
      }
      const r = rRef.current,
        p = displayRef.current,
        t = modeRef.current === "preprocess" ? 0 : tRef.current;
      const audition = motionPreviewRef.current;
      if (
        audition?.playing &&
        r?.motionPreview &&
        !busyRef.current &&
        !r.loading.has(r.motionPreview.layerId) &&
        r.nodes.get(r.motionPreview.layerId)?.runtime?.model
      ) {
        const next = advanceAudition(
          audition,
          auditionLast.current
            ? Math.min(0.15, (now - auditionLast.current) / 1000)
            : 0,
        );
        auditionLast.current = now;
        if (next !== audition) {
          motionPreviewRef.current = next;
          r.motionPreview.time = auditionSample(next.time, next.duration);
          r.invalidate();
        }
      } else auditionLast.current = 0;
      if (
        ready &&
        !busyRef.current &&
        r &&
        r.needsRender(p, t) &&
        now - paint >=
          1000 / Math.min(30, Math.max(p.fps, audition?.fps || 0)) - 1
      ) {
        try {
          const alternate =
            modeRef.current === "scene" &&
            mirrorHost.current &&
            mirrorCanvas.current
              ? (Object.assign(mirror.current, {
                  host: mirrorHost.current,
                  canvas: mirrorCanvas.current,
                  onOverlay: mirrorOverlay.publish,
                }) as MirrorView)
              : undefined;
          if (alternate?.spatial && !alternate.orbit)
            alternate.orbit = fitOrbit(p, t);
          r.renderViews(p, t, alternate);
        } catch (e: any) {
          console.error(e);
          playRef.current = false;
          setPlaying(false);
        }
        paint = now;
      }
      if (t !== clock) {
        const c = document.querySelector<HTMLElement>(".scene-nowclock");
        if (c) c.textContent = t.toFixed(3) + "s";
        const h = document.querySelector<HTMLElement>(".scene-playhead");
        if (h)
          h.style.left =
            Number(h.dataset.label || 340) +
            t * Number(h.dataset.zoom || 70) +
            "px";
        clock = t;
      }
      if (playRef.current && now - audio > 70) {
        syncRef.current();
        audio = now;
      }
      raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [ready]);
  syncRef.current = () => {
    const p = sRef.current,
      t = tRef.current,
      playing = playRef.current && !busyRef.current,
      activeIds = new Set<string>();
    for (const tr of enabledTracks(p))
      for (const c of tr.clips) {
        if (c.kind !== "audio" || !active(c, t)) continue;
        const asset = p.assets.find((a) => a.id === c.assetId);
        if (!asset) continue;
        activeIds.add(c.id);
        let a = audioPlayers.current.get(c.id);
        if (!a) {
          a = new Audio(media(asset.path));
          a.preload = "auto";
          audioPlayers.current.set(c.id, a);
        }
        const source = sourceTime(c, t, asset.duration);
        if (Math.abs(a.currentTime - source) > 0.12)
          a.currentTime = Math.min(asset.duration - 0.001, source);
        a.playbackRate = c.speed;
        a.volume = clamp(audioGain(p, c, t), 0, 1);
        if (playing) {
          if (a.paused) a.play().catch(() => {});
        } else if (!a.paused) a.pause();
      }
    for (const [id, a] of audioPlayers.current)
      if (!activeIds.has(id) || !playing) if (!a.paused) a.pause();
  };
  useEffect(() => {
    syncRef.current();
  }, [scene, time, busy]);
  function stopMotionPreview() {
    motionPreviewRef.current = undefined;
    auditionLast.current = 0;
    if (rRef.current?.motionPreview) {
      rRef.current.motionPreview = undefined;
      rRef.current.invalidate();
      setMotionPreviewId("");
    }
  }
  function updateAudition(patch: Partial<AuditionState>) {
    const a = motionPreviewRef.current,
      r = rRef.current;
    if (!a || !r?.motionPreview) return;
    const next = { ...a, ...patch };
    motionPreviewRef.current = next;
    auditionLast.current = 0;
    r.motionPreview.time = auditionSample(next.time, next.duration);
    r.invalidate();
  }
  function previewMotion(asset: Asset, targetId = motionLayer?.id) {
    if (!targetId) {
      notify("先指定预览对象");
      return;
    }
    if (
      motionPreviewRef.current?.id === asset.id &&
      rRef.current?.motionPreview?.layerId === targetId
    ) {
      stopMotionPreview();
      return;
    }
    stopMotionPreview();
    setPlaying(false);
    playRef.current = false;
    preview.current?.pause();
    setPreviewId("");
    for (const a of audioPlayers.current.values()) a.pause();
    const target = sRef.current.layers.find((l) => l.id === targetId);
    if (!target?.model) return;
    const { project, stage } = auditionProject(
      sRef.current,
      target,
      asset,
      tRef.current,
    );
    rRef.current!.motionPreview = {
      layerId: targetId,
      project,
      stage,
      orbit: stage
        ? fitOrbit(stage, tRef.current, "perspective", targetId)
        : undefined,
      time: 0,
    };
    motionPreviewRef.current = {
      id: asset.id,
      name: asset.name,
      time: 0,
      duration: project.duration,
      fps: asset.fps || sRef.current.fps,
      speed: 1,
      playing: true,
      loop: false,
      isolated: !!stage,
    };
    setMotionPreviewId(asset.id);
    rRef.current!.invalidate();
  }
  function previewAudio(a: MediaAsset) {
    stopMotionPreview();
    if (previewId === a.id) {
      preview.current?.pause();
      setPreviewId("");
      return;
    }
    preview.current?.pause();
    const player = new Audio(media(a.path));
    preview.current = player;
    player.onended = () => setPreviewId("");
    player.play().catch((e) => notify(e.message));
    setPreviewId(a.id);
  }
  function updateLayer(mut: (l: Layer) => void) {
    if (!selectedLayer) return;
    change((s) => {
      const l = s.layers.find((l) => l.id === selectedLayer.id);
      if (l) mut(l);
    });
  }
  function updateClip(mut: (c: SceneClip) => void) {
    if (!selectedClip) return;
    change((s) => {
      const c = s.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === selectedClip.id);
      if (c) mut(c);
    });
  }
  function openPreprocess(id = resource?.id || scene.models[0]?.id || "") {
    stopMotionPreview();
    setPlaying(false);
    playRef.current = false;
    preview.current?.pause();
    setPreviewId("");
    for (const a of audioPlayers.current.values()) a.pause();
    for (const n of rRef.current?.nodes.values() || []) n.runtime?.cancelWarm();
    setPreprocessId(id);
    setWorkspaceMode("preprocess");
    setLibraryTab("model");
    setCurveOpen(false);
    setInspectorOpen(true);
  }
  function addLight(type: SceneLight["type"]) {
    document
      .querySelector<HTMLDetailsElement>(".layer-title details")
      ?.removeAttribute("open");
    if (scene.layers.filter((l) => l.light).length >= MAX_SCENE_LIGHTS) {
      notify("已达到光源数量上限");
      return;
    }
    const names = {
        point: "点光源",
        area: "面光源",
        sun: "日光",
        ambient: "环境光",
      },
      l = layer(
        "light",
        names[type] + " " + (scene.layers.filter((l) => l.light).length + 1),
      );
    l.light = defaultLight(type);
    const cam = animatedCamera(scene, tRef.current),
      count = scene.layers.filter((l) => l.light).length;
    l.transform.x =
      cam.x + (scene.width * ((count % 3) * 0.12 - 0.18)) / cam.zoom;
    l.transform.y =
      cam.y + (scene.height * (Math.floor(count / 3) * 0.06 - 0.12)) / cam.zoom;
    l.transform.z = cam.z - Math.min(500, cam.focalLength * 0.45);
    change((s) => {
      s.lighting = s.lighting || {
        enabled: true,
        ambient: 0.7,
        color: "#ffffff",
        exposure: 1,
      };
      addVisual(s, l, tRef.current, Math.max(0.1, s.duration - tRef.current));
    });
    selectLayer(l.id);
    setWorkspaceMode("scene");
  }
  function addLayer(kind: Layer["kind"]) {
    document
      .querySelector<HTMLDetailsElement>(".layer-title details")
      ?.removeAttribute("open");
    const names = {
        text: "对白",
        color: "背景色",
        adjustment: "后处理",
        group: "图层组",
        image: "图片",
        audio: "音频",
        model: "角色",
        light: "点光源",
      },
      l = layer(kind, names[kind]);
    if (kind === "text") {
      l.width = scene.width * 0.75;
      l.height = 170;
      l.transform.y = scene.height * 0.3;
    }
    if (kind === "color") {
      l.width = scene.width;
      l.height = scene.height;
    }
    change((s) => {
      if (kind === "group") s.layers.push(l);
      else {
        addVisual(s, l, tRef.current, Math.max(0.1, s.duration - tRef.current));
        if (kind === "color") {
          s.layers = s.layers.filter((x) => x.id !== l.id);
          s.layers.unshift(l);
        }
        if (kind === "text" && l.text!.animation.includes("fade")) {
          const c = s.tracks
            .flatMap((t) => t.clips)
            .find((c) => c.layerId === l.id)!;
          c.fadeIn = 0.25;
          c.fadeOut = 0.25;
        }
      }
    });
    selectLayer(l.id);
    setSelection([]);
  }
  function duplicateLayer() {
    if (!selectedLayer) return;
    let id = "";
    change((s) => {
      id = duplicateTree(s, selectedLayer.id);
    });
    selectLayer(id);
  }
  function deleteLayer(
    targets = selectedIds.length ? selectedIds : [selected],
  ) {
    const ids = new Set(
      targets.filter((id) =>
        sRef.current.layers.some(
          (l) => l.id === id && editable(sRef.current, l),
        ),
      ),
    );
    if (!ids.size) return;
    let again = true;
    while (again) {
      again = false;
      for (const l of scene.layers)
        if (l.parentId && ids.has(l.parentId) && !ids.has(l.id)) {
          ids.add(l.id);
          again = true;
        }
    }
    change((s) => {
      s.layers = s.layers.filter((l) => !ids.has(l.id));
      for (const tr of s.tracks)
        tr.clips = tr.clips.filter((c) => !ids.has(c.layerId));
    });
    selectObjects([]);
  }
  function deleteClips(ripple = false) {
    if (!selection.length) return;
    change((s) => {
      for (const tr of s.tracks) {
        const removed = tr.clips.filter((c) => selection.includes(c.id));
        tr.clips = tr.clips.filter((c) => !selection.includes(c.id));
        if (ripple) {
          for (const cut of removed.sort((a, b) => b.start - a.start))
            for (const c of tr.clips)
              if (c.start >= cut.start + cut.duration) c.start -= cut.duration;
        }
      }
    });
    setSelection([]);
  }
  function duplicateClips() {
    if (!selection.length) return;
    const out: string[] = [];
    change((s) => {
      const picked = s.tracks
          .flatMap((t) => t.clips)
          .filter((c) => selection.includes(c.id)),
        offset =
          Math.max(...picked.map((c) => c.start + c.duration)) -
          Math.min(...picked.map((c) => c.start));
      for (const tr of s.tracks) {
        for (const c of [...tr.clips])
          if (selection.includes(c.id)) {
            const copy = {
              ...cloneData(c),
              id: uid(),
              start: c.start + offset,
            };
            tr.clips.push(copy);
            out.push(copy.id);
            s.duration = Math.max(s.duration, copy.start + copy.duration);
          }
      }
    });
    setSelection(out);
  }
  function split() {
    const now = tRef.current;
    change((s) => {
      for (const tr of s.tracks)
        for (const c of [...tr.clips])
          if (
            selection.includes(c.id) &&
            now > c.start &&
            now < c.start + c.duration
          ) {
            const copy = {
              ...cloneData(c),
              id: uid(),
              start: now,
              duration: c.start + c.duration - now,
              trimIn: c.trimIn + (now - c.start) * c.speed,
              fadeIn: 0,
            };
            if (c.kind === "audio" && c.gainKeys.length) {
              const cut = now - c.start,
                value = sampleKeys(c.gainKeys, cut, 1);
              copy.gainKeys = [
                { t: 0, v: value, mode: "linear" },
                ...cloneData(c.gainKeys)
                  .filter((k) => k.t > cut)
                  .map((k) => ({ ...k, t: k.t - cut })),
              ];
              c.gainKeys = [
                ...c.gainKeys.filter((k) => k.t < cut),
                { t: cut, v: value, mode: "linear" },
              ];
            }
            c.duration = now - c.start;
            c.fadeOut = 0;
            tr.clips.push(copy);
          }
    });
  }
  function marker() {
    change((s) =>
      s.markers.push({
        id: uid(),
        t: tRef.current,
        name: "标记 " + (s.markers.length + 1),
      }),
    );
  }
  function addClipToTrack(s: Scene, c: SceneClip, id?: string) {
    const target =
      s.tracks.find((t) => t.id === id && !t.clips.length) || track(c.name);
    if (!s.tracks.includes(target)) s.tracks.push(target);
    target.clips.push(c);
    s.duration = Math.max(s.duration, c.start + c.duration);
  }
  function addAsset(
    payload: { kind: string; id: string; targetLayerId?: string },
    trackId?: string,
    start = tRef.current,
    targetLayerId?: string,
  ) {
    if (payload.kind === "motion") {
      const l = sRef.current.layers.find(
        (l) =>
          l.id ===
            (targetLayerId || payload.targetLayerId || motionLayer?.id) &&
          l.model,
      );
      const res = sRef.current.models.find(
          (r) => r.id === l?.model?.resourceId,
        ),
        a =
          res?.assets.find((a) => a.id === payload.id) ||
          sRef.current.models
            .flatMap((r) => r.assets)
            .find((a) => a.id === payload.id);
      if (!l || !a || !res) {
        notify("先选择一个模型容器");
        return;
      }
      const c = sceneClip("motion", l.id, a.id, a.name, start, a.duration);
      if (a.kind === "expression") c.blend = "override";
      change((s) => {
        const r = s.models.find((r) => r.id === res.id)!;
        if (!r.assets.some((v) => v.id === a.id)) r.assets.push(cloneData(a));
        addClipToTrack(s, c, trackId);
      });
      selectClips([c.id]);
      return;
    }
    const a = scene.assets.find((a) => a.id === payload.id);
    if (!a) return;
    if (a.kind === "font") return;
    const l = layer(a.kind === "audio" ? "audio" : "image", a.name);
    l.assetId = a.id;
    if (a.kind === "image") {
      l.width = a.width || 640;
      l.height = a.height || 360;
      const k = Math.min(1, scene.width / l.width, scene.height / l.height);
      l.transform.scaleX = l.transform.scaleY = k;
    }
    const c = sceneClip(
      a.kind === "audio" ? "audio" : "visual",
      l.id,
      a.id,
      a.name,
      start,
      a.kind === "audio" ? a.duration : Math.max(0.1, scene.duration - start),
    );
    change((s) => {
      s.layers.push(l);
      addClipToTrack(s, c, trackId);
    });
    selectClips([c.id]);
  }
  async function importFolder(files: FileList) {
    setBusy("打包模型文件夹…");
    try {
      const { zipSync } = await import("fflate");
      const entries: Record<string, Uint8Array> = {};
      for (const f of Array.from(files))
        entries[(f as any).webkitRelativePath || f.name] = new Uint8Array(
          await f.arrayBuffer(),
        );
      await importModel(
        new File([zipSync(entries, { level: 0 }) as any], "模型文件夹.zip"),
      );
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy("");
    }
  }
  async function importModel(file: File) {
    setBusy("导入模型…");
    try {
      const m = await api<ModelEntry>("model-import", file, {
        "X-File-Name": encodeURIComponent(file.name),
      });
      setModelEntries((v) => [...v, m]);
      await addModel(m.id, m.files[0].path, file.name.replace(/\.zip$/i, ""));
      notify("模型容器已创建");
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy("");
    }
  }
  async function importMedia(files: FileList) {
    setBusy("导入媒体…");
    try {
      for (const f of Array.from(files)) {
        if (/\.(wav|mp3|ogg|m4a|flac)$/i.test(f.name)) {
          const v = await api("audio-import?analyze=0", f, {
            "X-File-Name": encodeURIComponent(f.name),
          });
          const a: MediaAsset = {
            id: v.id,
            name: v.name,
            kind: "audio",
            path: v.audioPath,
            duration: v.duration,
            waveform: v.waveform,
            cues: v.cues,
            analysis: v.analysis,
          };
          change((s) => s.assets.push(a));
          setLibraryTab("audio");
        } else {
          const a = await api<MediaAsset>("media-import", f, {
            "X-File-Name": encodeURIComponent(f.name),
          });
          if (a.kind === "image") {
            const img = new Image();
            img.src = media(a.path);
            await img.decode();
            a.width = img.naturalWidth;
            a.height = img.naturalHeight;
            setLibraryTab("image");
          } else setLibraryTab("font");
          change((s) => s.assets.push(a));
        }
      }
      notify("媒体已加入素材库，可先试听或拖入时间线");
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy("");
    }
  }
  async function importMotions(files: FileList) {
    if (!resource) {
      notify("先选择模型容器");
      return;
    }
    try {
      const assets: Asset[] = [];
      for (const f of Array.from(files)) {
        const text = await f.text();
        assets.push(
          /\.mtn$/i.test(f.name)
            ? parseLegacy(text, f.name)
            : parseAsset(JSON.parse(text), f.name),
        );
      }
      change((s) =>
        s.models.find((m) => m.id === resource.id)!.assets.push(...assets),
      );
      setLibraryTab("motion");
      notify("动作预设已导入所选模型的素材库");
    } catch (e: any) {
      notify(e.message);
    }
  }
  async function analyze(a: MediaAsset) {
    if (a.cues?.length) return;
    setBusy("Rhubarb 正在离线生成口型…");
    try {
      const data = await api("audio-analyze", { path: a.path });
      change((s) => {
        const target = s.assets.find((v) => v.id === a.id)!;
        target.cues = data.cues;
        target.analysis = data.analysis;
      });
      notify("口型已生成，可绑定到任一独立模型控制器");
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy("");
    }
  }
  async function bindLip(id: string) {
    if (!selectedClip || !selectedMedia) return;
    // Binding is explicit and does not start speech recognition.
    updateClip((c) => {
      c.lipTarget = id;
      c.lipEnabled = !!id;
    });
  }
  async function projectThumbnail() {
    const r = rRef.current;
    if (!r || !ready) return undefined;
    r.renderAt(sRef.current, tRef.current, true);
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = Math.round((320 * scene.height) / scene.width);
    c.getContext("2d")!.drawImage(r.app.view, 0, 0, c.width, c.height);
    r.invalidate();
    return c.toDataURL("image/png");
  }
  async function saveProject() {
    try {
      setBusy("打包 .livemg 工程与全部资源…");
      const res = await fetch("/api/project-save?format=livemg", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          project: sRef.current,
          thumbnail: await projectThumbnail(),
        }),
      });
      if (!res.ok) throw Error((await res.json()).error);
      const blob = await res.blob();
      if (window.studioDesktop?.saveFile) {
        const saved = await window.studioDesktop.saveFile(
          sRef.current.name + ".livemg",
          await blob.arrayBuffer(),
        );
        if (saved.canceled) return;
      } else download(blob, sRef.current.name + ".livemg");
      setDirty(false);
      notify("工程已保存：模型、媒体、字体、控制器与动画均已打包");
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy("");
    }
  }
  async function openProject(file: File) {
    setBusy("校验并读取工程资源…");
    try {
      const p = await api("project-open?format=livemg", file);
      history.current = [];
      future.current = [];
      await loadScene(migrateScene(p));
      setDirty(false);
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy("");
    }
  }
  async function exportVideo() {
    if (!ready) return;
    stopMotionPreview();
    const p = sRef.current,
      start = onlyWork ? p.workArea.start : 0,
      end = onlyWork ? p.workArea.end : p.duration;
    setPlaying(false);
    playRef.current = false;
    preview.current?.pause();
    for (const a of audioPlayers.current.values()) a.pause();
    setBusy("导出");
    setExportResult(null);
    setProgress(0);
    setExportStatus("准备合成…");
    cancel.current = false;
    let job: any;
    try {
      await rRef.current!.ensure(p);
      rRef.current!.exportBackground = ["mp4", "hevc", "gif"].includes(
        exportFormat,
      )
        ? exportMatte
        : undefined;
      job = await api("export-start", {
        width: p.width,
        height: p.height,
        fps: p.fps,
        duration: end - start,
        format: exportFormat,
        audio: collectAudio(p, start, end),
      });
      for (const n of rRef.current!.nodes.values()) n.runtime?.resetPhysics();
      for (let i = 0; i < job.total; i++) {
        if (cancel.current) throw Error("已取消导出");
        rRef.current!.renderAt(p, start + i / p.fps, true);
        await api(`export-frame/${job.id}/${i}`, await rRef.current!.png());
        setProgress(((i + 1) / job.total) * 0.86);
        setExportStatus(`合成第 ${i + 1} / ${job.total} 帧`);
        await new Promise<void>((r) => setTimeout(r, 0));
      }
      setExportStatus("编码视频与混合音轨…");
      const result = await api("export-finish", { id: job.id });
      setExportResult(result);
      setProgress(1);
      setExportStatus(
        exportFormat === "gif"
          ? "GIF 导出完成（不含音频）"
          : ["mp4", "hevc"].includes(exportFormat)
            ? "导出完成 · 背景合成与音轨已保留"
            : "导出完成 · 透明通道与音频已保留",
      );
    } catch (e: any) {
      setExportStatus(e.message);
      if (job) await api("export-cancel", { id: job.id }).catch(() => {});
    } finally {
      setBusy("");
      if (rRef.current) rRef.current.exportBackground = undefined;
      rRef.current?.invalidate();
    }
  }
  function selectProperty(binding: Binding) {
    selectLayer(binding.layerId);
    setSelection(binding.clipId ? [binding.clipId] : []);
    setChannel(binding.channel);
    if (
      binding.channel.startsWith("param:") ||
      binding.channel.startsWith("motion:")
    )
      setInspector("controller");
    if (binding.channel === "gain") setInspector("audio");
  }
  function openCurves(seed?: Binding) {
    setCurveSeed(seed);
    setCurveOpen(true);
  }
  function editProperty(binding: Binding, v: number, force = false) {
    if (!Number.isFinite(v)) return;
    const data = readProperty(sRef.current, binding, tRef.current),
      l = sRef.current.layers.find((l) => l.id === binding.layerId);
    const param = paramsByLayer[binding.layerId]?.find(
        (p) => "param:" + p.id === binding.channel,
      ),
      base = param
        ? (l?.model?.baseValues[param.id] ?? param.default)
        : data.base;
    if (l?.locked) return;
    const driven = parameterDriven(sRef.current, binding, tRef.current);
    change((s) => {
      const target = s.layers.find((l) => l.id === binding.layerId),
        local = Math.max(0, (tRef.current - data.offset) * data.speed);
      if (
        force ||
        driven ||
        autoKey ||
        data.keys.length ||
        binding.channel.startsWith("motion:")
      ) {
        const keys = cloneData(data.keys);
        if (!keys.length && local > 1 / s.fps)
          keys.push({ t: 0, v: base, mode: "bezier" });
        upsertKey(keys, local, v, s.fps);
        writeProperty(s, binding, keys);
      } else if (binding.layerId === "@camera")
        (s.camera as any)[binding.channel] = v;
      else if (target) {
        if (binding.channel.startsWith("param:") && target.model)
          target.model.baseValues[binding.channel.slice(6)] = v;
        else if (binding.channel.startsWith("effects."))
          (target.effects as any)[binding.channel.slice(8)] = v;
        else if (binding.channel.startsWith("light.") && target.light)
          (target.light as any)[binding.channel.slice(6)] = v;
        else if (binding.channel.startsWith("surface.")) {
          target.surface = target.surface || {
            roughness: 0.55,
            specular: 0.25,
            rim: 0.25,
            bump: 0,
          };
          (target.surface as any)[binding.channel.slice(8)] = v;
        } else if (binding.channel === "gain") {
          const keys = [{ t: 0, v, mode: "linear" as const }];
          writeProperty(s, binding, keys);
        } else (target.transform as any)[binding.channel] = v;
      }
    });
  }
  function recordProperty(binding: Binding) {
    const data = readProperty(sRef.current, binding, tRef.current),
      p = paramsByLayer[binding.layerId]?.find(
        (p) => "param:" + p.id === binding.channel,
      ),
      l = sRef.current.layers.find((l) => l.id === binding.layerId),
      value = data.keys.length
        ? data.value
        : p
          ? l?.model
            ? modelValues(
                sRef.current,
                l,
                paramsByLayer[binding.layerId] || [],
                tRef.current,
              )[p.id]
            : p.default
          : data.base;
    selectProperty(binding);
    editProperty(binding, value, true);
  }
  function setValue(id: string, v: number, force = false) {
    setChannel(id);
    editProperty(
      { layerId: selected, channel: id, clipId: selectedClip?.id },
      v,
      force,
    );
  }
  function toggleSpatial(enabled: boolean) {
    const r = rRef.current;
    if (!r) return;
    if (enabled && !r.orbit) r.orbit = fitOrbit(sRef.current, tRef.current);
    r.orbitEnabled = enabled;
    setSpatialView(enabled);
    r.invalidate();
  }
  function focusViewport(all: boolean, preset?: ViewPreset) {
    const r = rRef.current;
    if (!r?.viewportOrbit) return;
    const { yaw, pitch } = r.viewportOrbit;
    r.setViewportOrbit(
      fitOrbit(
        r.motionPreview?.stage ?? sRef.current,
        tRef.current,
        preset || [yaw, pitch],
        all ? "" : selected,
        all && r.showCamera && !r.motionPreview?.stage,
      ),
    );
  }
  function orientViewport(axis: Axis, sign: number) {
    const r = rRef.current;
    if (!r || busy) return;
    const angle: [number, number] =
      axis === "x"
        ? [(-sign * Math.PI) / 2, 0]
        : axis === "y"
          ? [0, (sign * Math.PI) / 2]
          : [sign > 0 ? Math.PI : 0, 0];
    toggleSpatial(true);
    const existing = r.viewportOrbit!;
    r.setViewportOrbit({ ...existing, yaw: angle[0], pitch: angle[1] });
  }
  function watchPointer(
    e: React.PointerEvent,
    move: (v: PointerEvent) => void,
    end: (v: PointerEvent) => void,
  ) {
    const el = e.currentTarget,
      id = e.pointerId;
    el.setPointerCapture(id);
    const motion = (v: PointerEvent) => {
      if (v.pointerId === id) move(v);
    };
    const stop = (v: PointerEvent) => {
      if (v.pointerId !== id) return;
      window.removeEventListener("pointermove", motion);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
      end(v);
    };
    window.addEventListener("pointermove", motion);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }
  function transformDrag(
    e: React.PointerEvent,
    make: (
      dx: number,
      dy: number,
    ) => { id: string; values: Record<string, number> }[],
    base: Scene,
    t: number,
  ) {
    stopMotionPreview();
    playRef.current = false;
    setPlaying(false);
    const x = e.clientX,
      y = e.clientY;
    let recorded = false,
      rafId = 0,
      pending: PointerEvent | undefined;
    const apply = (ev: PointerEvent) => {
      const dx = ev.clientX - x,
        dy = ev.clientY - y;
      if (!recorded && Math.hypot(dx, dy) < 3) return;
      const operations = make(dx, dy);
      if (!operations.some((o) => Object.keys(o.values).length)) return;
      if (!recorded) {
        history.current.push(base);
        if (history.current.length > 35) history.current.shift();
        future.current = [];
        setHistoryVersion((v) => v + 1);
        recorded = true;
      }
      change(
        produce(base, (s) => {
          for (const { id, values } of operations) {
            const target = s.layers.find((l) => l.id === id);
            for (const [channel, v] of Object.entries(values)) {
              const value = channel.startsWith("scale")
                ? clamp(v, 0.02, 25)
                : clamp(v, -100000, 100000);
              const binding = { layerId: id, channel },
                data = readProperty(base, binding, t);
              if (autoKey || data.keys.length) {
                const keys = cloneData(data.keys),
                  local = Math.max(0, (t - data.offset) * data.speed);
                if (!keys.length && local > 1 / s.fps)
                  keys.push({ t: 0, v: data.base, mode: "bezier" });
                upsertKey(keys, local, value, s.fps);
                writeProperty(s, binding, keys);
              } else if (id === "@camera") (s.camera as any)[channel] = value;
              else if (target) (target.transform as any)[channel] = value;
            }
          }
        }),
        false,
      );
    };
    watchPointer(
      e,
      (v) => {
        pending = v;
        if (!rafId)
          rafId = requestAnimationFrame(() => {
            rafId = 0;
            if (pending) apply(pending);
          });
      },
      (v) => {
        cancelAnimationFrame(rafId);
        if (v.type === "pointerup") apply(v);
        lastEdit.current = 0;
      },
    );
  }
  function beginGizmo(
    e: React.PointerEvent,
    mode: GizmoTool,
    handle: Handle,
    gizmo: NonNullable<OverlayFrame["gizmo"]>,
    pane: "main" | "mirror" = "main",
  ) {
    if (e.button !== 0 || busy || boxTool || e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    const base = sRef.current,
      t = tRef.current,
      roots = selectionRoots(base, gizmo.ids);
    if (!gizmo.camera && !roots.length) return;
    const rect = (
      pane === "main" ? host : mirrorHost
    ).current!.getBoundingClientRect();
    const x = e.clientX - rect.left - gizmo.center.x,
      y = e.clientY - rect.top - gizmo.center.y,
      radius = Math.hypot(x, y);
    const axis = gizmo.axes.find((a) => a.axis === handle),
      l = roots[0];
    const pose = (gizmo.camera
      ? animatedCamera(base, t)
      : animatedLayer(base, l, t).transform) as unknown as Record<
      string,
      number
    >;
    transformDrag(
      e,
      (dx, dy) => {
        const along = axis ? dx * axis.dx + dy * axis.dy : dx - dy;
        let value = 0,
          action: Parameters<typeof groupTransform>[4] | undefined;
        if (mode === "move" && axis) {
          value = along / axis.pixels;
          action = {
            move: ["x", "y", "z"].map((a) =>
              a === handle ? value : 0,
            ) as Vec3,
          };
          if (roots.length <= 1)
            return [
              {
                id: gizmo.camera ? "@camera" : l.id,
                values: { [handle]: pose[handle] + value },
              },
            ];
        } else if (mode === "scale") {
          value =
            handle === "uniform" && radius > 20
              ? Math.hypot(x + dx, y + dy) / radius
              : Math.exp(clamp(along / 100, -5, 5));
          value = clamp(value, 0.02, 25);
          action = {
            scale:
              handle === "uniform"
                ? [value, value, value]
                : handle === "x"
                  ? [value, 1, 1]
                  : [1, value, 1],
          };
        } else if (mode === "rotate" && axis && handle !== "uniform") {
          value = handle === "x" ? dy * 0.6 : dx * 0.6;
          if (handle === "z") {
            const a = Math.atan2(y + dy, x + dx) - Math.atan2(y, x);
            value = (Math.atan2(Math.sin(a), Math.cos(a)) * 180) / Math.PI;
          }
          action = { axis: handle, angle: value };
        }
        return action
          ? groupTransform(base, roots, t, gizmo.pivot, action)
          : [];
      },
      base,
      t,
    );
  }
  function paneView(pane: "main" | "mirror") {
    const r = rRef.current!;
    return pane === "main"
      ? {
          snapshot: r.snapshot,
          view: r.view,
          orbit: modeRef.current === "scene" ? r.viewportOrbit : undefined,
        }
      : {
          snapshot: mirror.current.snapshot,
          view: mirror.current.view,
          orbit: mirror.current.spatial ? mirror.current.orbit : undefined,
        };
  }
  function putOrbit(
    pane: "main" | "mirror",
    orbit: NonNullable<ReturnType<typeof paneView>["orbit"]>,
  ) {
    if (pane === "main") rRef.current?.setViewportOrbit(orbit);
    else {
      mirror.current.orbit = orbit;
      rRef.current?.invalidate();
    }
  }
  function setSplit(layout: typeof splitLayout) {
    if (splitLayout === "single" && layout !== "single") {
      mirror.current.spatial = !spatialView;
      setMirrorSpatial(!spatialView);
      mirror.current.key = undefined;
    }
    setSplitLayout(layout);
    rRef.current?.invalidate();
  }
  function resizeSplit(e: React.PointerEvent) {
    e.preventDefault();
    const rect = e.currentTarget.parentElement!.getBoundingClientRect();
    watchPointer(
      e,
      (v) => {
        setSplitRatio(
          clamp(
            splitLayout === "side"
              ? (v.clientX - rect.left) / rect.width
              : (v.clientY - rect.top) / rect.height,
            0.25,
            0.75,
          ),
        );
        rRef.current?.invalidate();
      },
      () => {},
    );
  }
  function contextViewport(e: React.MouseEvent, pane: "main" | "mirror") {
    e.preventDefault();
    if (busy || modeRef.current !== "scene" || !rRef.current) return;
    const snap = paneView(pane).snapshot;
    if (!snap) return;
    const id = rRef.current.pick(
      e.clientX,
      e.clientY,
      sRef.current,
      snap,
      true,
    );
    const ids =
      id && id !== "@camera"
        ? selectedIds.includes(id)
          ? selectedIds
          : [id]
        : [];
    if (ids.length && !selectedIds.includes(id)) selectObjects(ids);
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      ids,
    });
  }
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!contextMenu || !el) return;
    const place = () => {
      const gap = 6;
      el.style.left =
        clamp(
          contextMenu.x,
          gap,
          Math.max(gap, window.innerWidth - el.offsetWidth - gap),
        ) + "px";
      el.style.top =
        clamp(
          contextMenu.y,
          gap,
          Math.max(gap, window.innerHeight - el.offsetHeight - gap),
        ) + "px";
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [contextMenu]);
  function canvasPointer(
    e: React.PointerEvent,
    pane: "main" | "mirror" = "main",
  ) {
    const r = rRef.current;
    if (!r || busy || e.button > 1) return;
    setContextMenu(undefined);
    const state = paneView(pane),
      snap = state.snapshot;
    if (!snap) return;
    e.preventDefault();
    const rect = snap.host.getBoundingClientRect(),
      start = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const pixels = (dx: number, dy: number) => ({
      x: (dx * snap.width) / rect.width / snap.scale,
      y: (dy * snap.height) / rect.height / snap.scale,
    });
    const base = sRef.current,
      t = tRef.current;
    if (
      e.button === 0 &&
      modeRef.current === "scene" &&
      (boxTool || e.shiftKey)
    ) {
      let box: SelectionBox | undefined;
      watchPointer(
        e,
        (v) => {
          if (
            Math.hypot(v.clientX - e.clientX, v.clientY - e.clientY) < 3 &&
            !box
          )
            return;
          box = dragBox(start, {
            x: v.clientX - rect.left,
            y: v.clientY - rect.top,
          });
          setViewBox({ pane, box });
        },
        (v) => {
          setViewBox(undefined);
          if (v.type !== "pointerup") return;
          if (box) {
            const rx = snap.width / rect.width,
              ry = snap.height / rect.height;
            const b = {
              x: box.x * rx,
              y: box.y * ry,
              w: box.w * rx,
              h: box.h * ry,
            };
            const picked = snap.hits
              .filter(
                (h) =>
                  boxHits(b, h.points) &&
                  base.layers.some((l) => l.id === h.id && editable(base, l)),
              )
              .map((h) => h.id);
            selectObjects(
              e.shiftKey || e.ctrlKey ? [...selectedIds, ...picked] : picked,
            );
          } else {
            const id = r.pick(v.clientX, v.clientY, base, snap);
            if (id && id !== "@camera")
              selectObjects(e.shiftKey ? [...selectedIds, id] : [id]);
            else if (!e.shiftKey) selectObjects([]);
          }
        },
      );
      return;
    }
    const id =
      e.button === 0 && modeRef.current === "scene" && !r.motionPreview?.stage
        ? r.pick(e.clientX, e.clientY, base, snap)
        : "";
    if (id === "@camera") {
      selectLayer(id);
      return;
    }
    if (id && e.ctrlKey) {
      selectObjects(
        selectedIds.includes(id)
          ? selectedIds.filter((v) => v !== id)
          : [...selectedIds, id],
      );
      return;
    }
    if (id) {
      const ids = selectedIds.includes(id) ? selectedIds : [id];
      if (!selectedIds.includes(id)) selectObjects(ids);
      const roots = selectionRoots(base, ids);
      if (!roots.length) return;
      const pivot = pivotOf(base, roots, t),
        proj =
          state.orbit || roots.some((l) => spatialLayer(base, l))
            ? snap.projection
            : outputProjection(animatedCamera(base, t), false);
      const projected = (p: Vec3) => projectView(cameraPoint(p, proj), proj),
        o = projected(pivot),
        x = projected([pivot[0] + 1, pivot[1], pivot[2]]),
        y = projected([pivot[0], pivot[1] + 1, pivot[2]]);
      const a = x.x - o.x,
        b = y.x - o.x,
        c = x.y - o.y,
        d = y.y - o.y,
        det = a * d - b * c;
      transformDrag(
        e,
        (dx, dy) => {
          const p = pixels(dx, dy);
          if (Math.abs(det) > 1e-5)
            return groupTransform(base, roots, t, pivot, {
              move: [(p.x * d - p.y * b) / det, (p.y * a - p.x * c) / det, 0],
            });
          // At an edge-on view, move parallel to the viewing plane instead.
          const r = proj.rotation,
            depth = cameraPoint(pivot, proj)[2] / (proj.focal * proj.zoom);
          return groupTransform(base, roots, t, pivot, {
            move: [0, 1, 2].map(
              (i) => (r[i * 3] * p.x + r[i * 3 + 1] * p.y) * depth,
            ) as Vec3,
          });
        },
        base,
        t,
      );
      return;
    }
    const initial = { ...state.view },
      orbit = state.orbit;
    let moved = false;
    watchPointer(
      e,
      (v) => {
        const dx = v.clientX - e.clientX,
          dy = v.clientY - e.clientY;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        if (orbit) {
          const d = pixels(dx, dy);
          putOrbit(
            pane,
            e.button === 1 && !e.shiftKey
              ? orbitRotate(orbit, dx, dy)
              : orbitPan(orbit, d.x, d.y, viewportFocal(base)),
          );
        } else {
          state.view.panX = initial.panX + dx;
          state.view.panY = initial.panY + dy;
          r.invalidate();
        }
      },
      (v) => {
        if (
          v.type === "pointerup" &&
          !moved &&
          e.button === 0 &&
          modeRef.current === "scene"
        )
          selectObjects([]);
      },
    );
  }
  useEffect(() => {
    const listen = (el: HTMLDivElement, pane: "main" | "mirror") => {
      const wheel = (e: WheelEvent) => {
        e.preventDefault();
        const r = rRef.current;
        if (!r) return;
        const state = paneView(pane),
          dy =
            e.deltaY *
            (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1);
        if (state.orbit) {
          putOrbit(pane, orbitZoom(state.orbit, dy));
          return;
        }
        const rect = el.getBoundingClientRect(),
          view = state.view,
          old = view.zoom,
          next = clamp(old * Math.exp(-dy * 0.0015), 0.08, 8);
        const x = e.clientX - rect.left - rect.width / 2,
          y = e.clientY - rect.top - rect.height / 2;
        view.panX = x - ((x - view.panX) * next) / old;
        view.panY = y - ((y - view.panY) * next) / old;
        view.zoom = next;
        if (pane === "main") setViewZoom(next);
        r.invalidate();
      };
      const resize = new ResizeObserver(() => rRef.current?.invalidate());
      resize.observe(el);
      el.addEventListener("wheel", wheel, { passive: false });
      return () => {
        resize.disconnect();
        el.removeEventListener("wheel", wheel);
      };
    };
    const clean = listen(host.current!, "main"),
      alt = mirrorHost.current
        ? listen(mirrorHost.current, "mirror")
        : undefined;
    return () => {
      clean();
      alt?.();
    };
  }, [splitLayout, workspaceMode]);
  useEffect(() => {
    if (!contextMenu) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest(".viewport-context"))
        setContextMenu(undefined);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [contextMenu]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement,
        editing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (e.key === "Escape") {
        if (contextMenu) {
          setContextMenu(undefined);
          return;
        }
        if (!modal && expandedView) {
          setExpandedView(false);
          return;
        }
        if (!modal && motionPreviewRef.current) {
          stopMotionPreview();
          return;
        }
        if (!busy) setModal("");
        setCurveOpen(false);
        if (modeRef.current === "preprocess" && !modal)
          setWorkspaceMode("scene");
        else setInspectorOpen(false);
        return;
      }
      if (modeRef.current === "preprocess") {
        if (e.ctrlKey && e.key.toLowerCase() === "z" && !editing) {
          e.preventDefault();
          e.shiftKey ? redo() : undo();
          return;
        }
        if (e.ctrlKey && e.key.toLowerCase() === "s") {
          e.preventDefault();
          saveProject();
        }
        return;
      }
      if (editing || modal) return;
      if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "v") {
        toggleSpatial(!rRef.current?.orbitEnabled);
        return;
      }
      if (
        !e.ctrlKey &&
        !e.metaKey &&
        e.key.toLowerCase() === "f" &&
        rRef.current?.orbitEnabled
      ) {
        e.preventDefault();
        focusViewport(e.shiftKey);
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) {
          const a = motionPreviewRef.current;
          if (a) {
            updateAudition({
              playing: !a.playing,
              time: !a.playing && a.time >= a.duration ? 0 : a.time,
            });
            return;
          }
          stopMotionPreview();
          space.current = true;
          if (tRef.current >= sRef.current.workArea.end)
            seek(sRef.current.workArea.start);
          setPlaying((v) => !v);
        }
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const direction = e.key === "ArrowLeft" ? -1 : 1;
        const a = motionPreviewRef.current;
        if (a)
          updateAudition({
            playing: false,
            time: clamp(a.time + direction / a.fps, 0, a.duration),
          });
        else seek(tRef.current + direction / scene.fps);
      }
      if (e.key === "Home") seek(0);
      if (e.key === "End") seek(scene.duration);
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        selection.length ? deleteClips(e.shiftKey) : deleteLayer();
      }
      if (e.key.toLowerCase() === "s" && !e.ctrlKey) split();
      if (e.key.toLowerCase() === "m") marker();
      if (e.ctrlKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
      if (e.ctrlKey && e.key === "d") {
        e.preventDefault();
        selection.length ? duplicateClips() : duplicateLayer();
      }
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        saveProject();
      }
      if (e.ctrlKey && e.key === "c")
        clipboard.current = structuredClone(
          scene.tracks
            .flatMap((t) => t.clips)
            .filter((c) => selection.includes(c.id)),
        );
      if (e.ctrlKey && e.key === "v" && clipboard.current.length) {
        const min = Math.min(...clipboard.current.map((c) => c.start));
        change((s) => {
          for (const c of clipboard.current)
            addClipToTrack(s, {
              ...cloneData(c),
              id: uid(),
              start: tRef.current + c.start - min,
            });
        });
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [
    scene,
    selected,
    selectedIds,
    selection,
    modal,
    busy,
    expandedView,
    contextMenu,
  ]);
  useEffect(() => {
    window.theater = {
      get selectedObjects() {
        return selectedIds;
      },
      get secondView() {
        return mirror.current.snapshot;
      },
      get scene() {
        return sRef.current;
      },
      get renderer() {
        return rRef.current;
      },
      get ready() {
        return ready;
      },
      get time() {
        return tRef.current;
      },
      get playing() {
        return playRef.current;
      },
      change,
      seek,
      selectLayer,
      selectClips,
      addLayer,
      addAsset,
      duplicateLayer,
      saveProject,
      exportVideo,
      loadScene,
      addLight,
      openPreprocess,
      get displayScene() {
        return displayRef.current;
      },
      setWorkspaceMode,
      editProperty,
      selectProperty,
      previewMotion,
      stopMotionPreview,
    };
  }, [
    ready,
    scene,
    selection,
    selected,
    selectedIds,
    exportFormat,
    onlyWork,
    exportMatte,
  ]);
  const filteredAssets = scene.assets.filter(
      (a) =>
        a.kind === libraryTab &&
        a.name.toLowerCase().includes(search.toLowerCase()),
    ),
    motions = (motionResource?.assets || []).filter((a) =>
      a.name.toLowerCase().includes(search.toLowerCase()),
    );
  const layerRows: { l: Layer; depth: number }[] = [];
  function rows(parent: string | null, depth = 0, seen = new Set<string>()) {
    for (const l of [...scene.layers]
      .reverse()
      .filter((l) => l.parentId === parent)) {
      if (seen.has(l.id)) continue;
      layerRows.push({ l, depth });
      if (l.kind === "group" && !foldedGroups[l.id])
        rows(l.id, depth + 1, new Set([...seen, l.id]));
    }
  }
  rows(null);
  const paramMatches = params.filter(
      (p) =>
        p.id.toLowerCase().includes(paramSearch.toLowerCase()) ||
        p.name.includes(paramSearch),
    ),
    paramSlice = paramMatches.slice(paramPage * 20, (paramPage + 1) * 20);
  const effectFields = [
    ["outline", "描边宽度", 0, 12],
    ["glow", "边缘发光", 0, 2],
    ["bloom", "泛光", 0, 2],
    ["brightness", "亮度", 0.2, 2],
    ["contrast", "对比度", 0.2, 2],
    ["saturation", "饱和度", 0, 2],
    ["blur", "模糊", 0, 32],
  ] as const;
  return (
    <div
      className="theater-app"
      style={{
        gridTemplateRows:
          "64px minmax(180px,1fr) " +
          (workspaceMode === "preprocess" ? 0 : timelineHeight) +
          "px 25px",
      }}
    >
      <header className="theater-header">
        <div className="theater-brand">
          <span>
            <Layers size={23} />
          </span>
          <strong>FrameStudio</strong>
        </div>
        <input
          className="scene-title"
          aria-label="工程名称"
          value={scene.name}
          onChange={(e) =>
            change((s) => {
              s.name = e.target.value;
            })
          }
        />
        <div className="header-actions">
          <select
            className="appearance-select"
            aria-label="外观"
            value={appearance}
            onChange={(e) => {
              const next = e.target.value;
              setAppearance(next);
              api("preferences", { appearance: next }).catch(() =>
                notify("外观设置未保存"),
              );
            }}
          >
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
          <button
            title="新建工程"
            onClick={() => {
              if (
                dirty &&
                !confirm("新建前请确认需要的工程已经保存。继续创建空白工程？")
              )
                return;
              loadScene(emptyScene());
            }}
          >
            新建
          </button>
          <button
            title="打开 .livemg 工程"
            onClick={() => projectInput.current?.click()}
          >
            <FolderOpen size={17} />
          </button>
          <button title="保存 .livemg（Ctrl+S）" onClick={saveProject}>
            <Save size={17} />
          </button>
          <button
            title="撤销"
            disabled={!history.current.length}
            onClick={undo}
          >
            <Undo2 size={17} />
          </button>
          <button title="重做" disabled={!future.current.length} onClick={redo}>
            <Redo2 size={17} />
          </button>
          <button onClick={() => setModal("canvas")}>
            <Settings2 size={16} />
            画布
          </button>
          <button
            className="export-button"
            disabled={!ready}
            onClick={() => setModal("export")}
          >
            <Upload size={16} />
            导出
          </button>
        </div>
      </header>
      <div
        className={
          "theater-workspace " + (!inspectorOpen ? "inspector-closed" : "")
        }
      >
        {workspaceMode === "preprocess" && (
          <aside className="theater-library preprocess-library">
            <h3>模型素材</h3>
            <p className="property-note">选择要准备基础质感的模型</p>
            <div className="scene-asset-list">
              {scene.models.map((r) => (
                <button
                  className={
                    "preprocess-resource " +
                    (preprocessingResource?.id === r.id ? "active" : "")
                  }
                  key={r.id}
                  onClick={() => setPreprocessId(r.id)}
                >
                  {r.name}
                  <small>
                    {r.preprocess?.enabled === false
                      ? "预处理关闭"
                      : r.preprocess
                        ? "已设置基础质感"
                        : "原始质感"}
                  </small>
                </button>
              ))}
            </div>
            <button
              className="wide-button"
              onClick={() => modelInput.current?.click()}
            >
              导入模型 ZIP
            </button>
            <button
              className="wide-button"
              onClick={() => setWorkspaceMode("scene")}
            >
              返回场景
            </button>
          </aside>
        )}
        <aside
          className="theater-library"
          hidden={workspaceMode === "preprocess"}
        >
          <nav className="manager-tabs" aria-label="场景管理">
            <button
              className={managerTab === "layers" ? "active" : ""}
              aria-pressed={managerTab === "layers"}
              onClick={() => setManagerTab("layers")}
            >
              <Layers size={15} />
              图层
            </button>
            <button
              className={managerTab === "assets" ? "active" : ""}
              aria-pressed={managerTab === "assets"}
              onClick={() => setManagerTab("assets")}
            >
              <FolderOpen size={15} />
              资产
            </button>
          </nav>
          <nav hidden={managerTab !== "assets"}>
            {[
              ["model", "模型"],
              ["motion", "动作"],
              ["image", "图像"],
              ["audio", "音频"],
              ["font", "字体"],
            ].map(([id, name]) => (
              <button
                className={libraryTab === id ? "active" : ""}
                key={id}
                onClick={() => setLibraryTab(id)}
              >
                {name}
              </button>
            ))}
          </nav>
          <div className="search-field" hidden={managerTab !== "assets"}>
            <Search size={14} />
            <input
              aria-label="搜索素材"
              placeholder="搜索素材"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="scene-asset-list" hidden={managerTab !== "assets"}>
            {libraryTab === "model" && (
              <>
                {scene.models
                  .filter((m) =>
                    m.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((m) => (
                    <div className="media-card" key={m.id}>
                      <Layers size={23} />
                      <div>
                        <strong>{m.name}</strong>
                        <small>
                          {m.assets.length} 个动作 ·{" "}
                          {
                            scene.layers.filter(
                              (l) => l.model?.resourceId === m.id,
                            ).length
                          }{" "}
                          个实例
                        </small>
                      </div>
                      <button
                        title={"预处理 " + m.name}
                        onClick={() => openPreprocess(m.id)}
                      >
                        <SlidersHorizontal size={15} />
                      </button>
                      <button
                        title="创建独立模型容器"
                        onClick={() => {
                          const l = layer("model", m.name + " 实例");
                          l.width = scene.width * 0.38;
                          l.height = scene.height * 0.9;
                          l.model = {
                            resourceId: m.id,
                            physics: true,
                            parameterMap: {},
                            groupOverrides: {},
                            baseValues: {},
                            keys: [],
                            lipOpen: "ParamMouthOpenY",
                            lipForm: "ParamMouthForm",
                          };
                          change((s) => addVisual(s, l));
                          selectLayer(l.id);
                        }}
                      >
                        ＋
                      </button>
                    </div>
                  ))}
                <details className="available-models">
                  <summary>本机已导入模型</summary>
                  {modelEntries.map((m) =>
                    m.files.map((f) => (
                      <button
                        key={m.id + f.path}
                        onClick={async () => {
                          setBusy("创建独立模型容器…");
                          try {
                            await addModel(m.id, f.path, m.name);
                          } catch (e: any) {
                            notify(e.message);
                          } finally {
                            setBusy("");
                          }
                        }}
                      >
                        {m.name} / {f.name}
                      </button>
                    )),
                  )}
                </details>
                <button
                  className="wide-button"
                  onClick={() => modelInput.current?.click()}
                >
                  <Plus size={15} />
                  导入模型 ZIP
                </button>
                <button
                  className="wide-button"
                  onClick={() => folderInput.current?.click()}
                >
                  导入模型文件夹
                </button>
              </>
            )}
            {libraryTab === "motion" && (
              <>
                <label className="stack-field">
                  预览 / 添加到对象
                  <select
                    aria-label="动作目标对象"
                    value={motionLayer?.id || ""}
                    onChange={(e) => selectLayer(e.target.value)}
                  >
                    <option value="">选择模型对象</option>
                    {scene.layers
                      .filter((l) => l.model)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </select>
                </label>
                {motionPreviewId && (
                  <button className="wide-button" onClick={stopMotionPreview}>
                    停止动作预览 · 恢复场景
                  </button>
                )}
                {!motionResource ? (
                  <p className="empty-state">
                    先选择一个模型容器，
                    <br />
                    每个模型使用独立动作控制器。
                  </p>
                ) : (
                  motions.map((a) => (
                    <div
                      key={a.id}
                      data-motion-id={a.id}
                      className={
                        "motion-card " +
                        (motionPreviewId === a.id ? "audition-active" : "")
                      }
                      onClick={() => previewMotion(a)}
                      draggable
                      onDragStart={(e) =>
                        e.dataTransfer.setData(
                          "theater",
                          JSON.stringify({
                            kind: "motion",
                            id: a.id,
                            targetLayerId: motionLayer?.id,
                          }),
                        )
                      }
                      onDoubleClick={() =>
                        addAsset({ kind: "motion", id: a.id })
                      }
                    >
                      <span>
                        {a.kind === "expression" ? (
                          <Eye size={16} />
                        ) : (
                          <Move size={16} />
                        )}
                      </span>
                      <div>
                        <strong>{a.name}</strong>
                        <small>
                          {a.duration.toFixed(4)}s ·{" "}
                          {a.curves.length || a.expression?.length} 参数
                        </small>
                      </div>
                      <button
                        title="将动作加入指定对象"
                        onClick={(e) => {
                          e.stopPropagation();
                          addAsset({ kind: "motion", id: a.id });
                        }}
                      >
                        ＋
                      </button>
                    </div>
                  ))
                )}
                <button
                  className="wide-button"
                  onClick={() => motionInput.current?.click()}
                >
                  导入预设动作
                </button>
              </>
            )}
            {filteredAssets.map((a) => (
              <div
                className={"media-card " + a.kind}
                key={a.id}
                draggable
                onDragStart={(e) =>
                  e.dataTransfer.setData(
                    "theater",
                    JSON.stringify({ kind: a.kind, id: a.id }),
                  )
                }
                onDoubleClick={() =>
                  a.kind === "audio"
                    ? previewAudio(a)
                    : addAsset({ kind: a.kind, id: a.id })
                }
              >
                {a.kind === "image" ? (
                  <img src={media(a.path)} alt="" />
                ) : a.kind === "audio" ? (
                  <button
                    title={previewId === a.id ? "停止库内预览" : "库内预览播放"}
                    onClick={() => previewAudio(a)}
                  >
                    {previewId === a.id ? (
                      <Pause size={17} />
                    ) : (
                      <Play size={17} />
                    )}
                  </button>
                ) : (
                  <Type size={20} />
                )}
                <div>
                  <strong>{a.name}</strong>
                  <small>
                    {a.kind === "audio"
                      ? a.duration.toFixed(3) + "s"
                      : a.kind === "font"
                        ? "已嵌入工程"
                        : `${a.width}×${a.height}`}
                  </small>
                </div>
                {a.kind !== "font" && (
                  <button
                    title="加入时间线"
                    onClick={() => addAsset({ kind: a.kind, id: a.id })}
                  >
                    ＋
                  </button>
                )}
                {a.kind === "audio" && previewId === a.id && (
                  <AudioLibraryPreview audio={preview.current!} asset={a} />
                )}
              </div>
            ))}
            {["audio", "image", "font"].includes(libraryTab) && (
              <button
                className="wide-button"
                onClick={() =>
                  libraryTab === "audio"
                    ? audioInput.current?.click()
                    : mediaInput.current?.click()
                }
              >
                <Plus size={14} />
                导入
                {libraryTab === "audio"
                  ? "音频"
                  : libraryTab === "font"
                    ? "字体"
                    : "图像"}
              </button>
            )}
          </div>
          <div className="layer-manager" hidden={managerTab !== "layers"}>
            <div className="layer-title">
              <strong>
                <FolderOpen size={14} />
                场景集合
              </strong>
              <button
                className={scene.depthOcclusion !== false ? "active" : ""}
                aria-pressed={scene.depthOcclusion !== false}
                title="场景深度遮挡"
                onClick={() =>
                  change((s) => {
                    s.depthOcclusion = s.depthOcclusion === false;
                  })
                }
              >
                {scene.depthOcclusion === false ? "叠放" : "深度"}
              </button>
              <details>
                <summary title="添加场景对象">
                  <Plus size={17} />
                </summary>
                <div className="popup-menu">
                  <button
                    onClick={() => {
                      setManagerTab("assets");
                      setLibraryTab("model");
                      modelInput.current?.click();
                    }}
                  >
                    <Layers size={14} />
                    导入模型 ZIP
                  </button>
                  {(["text", "color", "adjustment", "group"] as const).map(
                    (k) => (
                      <button key={k} onClick={() => addLayer(k)}>
                        {icons[k]}
                        {
                          {
                            text: "文本浮层",
                            color: "色块图层",
                            adjustment: "后处理层",
                            group: "图层组",
                          }[k]
                        }
                      </button>
                    ),
                  )}
                  <div className="menu-divider" />
                  {(["point", "area", "sun", "ambient"] as const).map(
                    (type) => (
                      <button key={type} onClick={() => addLight(type)}>
                        <Lamp size={14} />
                        {
                          {
                            point: "点光源",
                            area: "面光源",
                            sun: "日光 / 平行光",
                            ambient: "环境光",
                          }[type]
                        }
                      </button>
                    ),
                  )}
                </div>
              </details>
            </div>
            <div className="layer-list">
              <button
                className={
                  "layer-camera " + (selected === "@camera" ? "active" : "")
                }
                onClick={() => selectLayer("@camera")}
              >
                <Camera size={15} />
                成片相机
              </button>
              {layerRows.map(({ l, depth }) => (
                <div
                  className={
                    "layer-row " +
                    (selectedIds.includes(l.id) ? "selected" : "")
                  }
                  key={l.id}
                  style={{ paddingLeft: 9 + depth * 14 }}
                  draggable
                  onDragStart={(e) =>
                    e.dataTransfer.setData("scene-layer", l.id)
                  }
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("scene-layer");
                    if (!id || id === l.id) return;
                    change((s) => {
                      const index = s.layers.findIndex((v) => v.id === id),
                        target = s.layers.findIndex((v) => v.id === l.id);
                      if (index < 0 || target < 0) return;
                      const [moving] = s.layers.splice(index, 1);
                      s.layers.splice(target, 0, moving);
                    });
                  }}
                  onClick={(e) => {
                    if (e.ctrlKey || e.shiftKey)
                      selectObjects(
                        selectedIds.includes(l.id)
                          ? selectedIds.filter((id) => id !== l.id)
                          : [...selectedIds, l.id],
                      );
                    else selectLayer(l.id);
                    setSelection([]);
                  }}
                >
                  {l.kind === "group" && (
                    <button
                      className="layer-fold"
                      title={foldedGroups[l.id] ? "展开组" : "折叠组"}
                      aria-expanded={!foldedGroups[l.id]}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFoldedGroups((f) => ({ ...f, [l.id]: !f[l.id] }));
                      }}
                    >
                      <ChevronDown
                        size={12}
                        style={{
                          transform: foldedGroups[l.id]
                            ? "rotate(-90deg)"
                            : undefined,
                        }}
                      />
                    </button>
                  )}
                  <span>{icons[l.kind]}</span>
                  <input
                    aria-label={"图层名称 " + l.id}
                    value={l.name}
                    onClick={(e) => {
                      e.stopPropagation();
                      selectLayer(l.id);
                    }}
                    onFocus={() => selectLayer(l.id)}
                    onChange={(e) =>
                      change((s) => {
                        s.layers.find((v) => v.id === l.id)!.name =
                          e.target.value;
                      })
                    }
                  />
                  {l.is3D && (
                    <small
                      title={
                        l.depthMode === "stack"
                          ? "三维 · 按图层叠放"
                          : "三维 · 深度遮挡"
                      }
                    >
                      {l.depthMode === "stack" ? "叠放" : "3D"}
                    </small>
                  )}
                  <button
                    title="图层显示"
                    onClick={(e) => {
                      e.stopPropagation();
                      change((s) => {
                        s.layers.find((v) => v.id === l.id)!.visible =
                          !l.visible;
                      });
                    }}
                  >
                    {l.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                  <button
                    title="图层锁定"
                    onClick={(e) => {
                      e.stopPropagation();
                      change((s) => {
                        s.layers.find((v) => v.id === l.id)!.locked = !l.locked;
                      });
                    }}
                  >
                    {l.locked ? <Lock size={11} /> : <Unlock size={11} />}
                  </button>
                </div>
              ))}
            </div>
            <div className="layer-actions">
              <button
                title="复制独立图层"
                onClick={duplicateLayer}
                disabled={!selectedLayer}
              >
                <Copy size={14} />
              </button>
              <button
                title="删除图层"
                onClick={() => deleteLayer()}
                disabled={!selectedLayer}
              >
                <Trash2 size={14} />
              </button>
              <button
                disabled={!selectedLayer}
                title="向上一层"
                onClick={() =>
                  change((s) => {
                    const at = s.layers.findIndex((l) => l.id === selected);
                    if (at < s.layers.length - 1) {
                      const [l] = s.layers.splice(at, 1);
                      s.layers.splice(at + 1, 0, l);
                    }
                  })
                }
              >
                上移
              </button>
              <button
                disabled={!selectedLayer}
                title="向下一层"
                onClick={() =>
                  change((s) => {
                    const at = s.layers.findIndex((l) => l.id === selected);
                    if (at > 0) {
                      const [l] = s.layers.splice(at, 1);
                      s.layers.splice(at - 1, 0, l);
                    }
                  })
                }
              >
                下移
              </button>
            </div>
          </div>
        </aside>
        <main
          className={
            "theater-center" + (expandedView ? " viewport-expanded" : "")
          }
        >
          <div className="scene-view-toolbar">
            <div>
              {workspaceMode === "scene" && (
                <div className="viewport-switch" aria-label="画布视图">
                  <button
                    className={!spatialView ? "active" : ""}
                    aria-pressed={!spatialView}
                    onClick={() => toggleSpatial(false)}
                  >
                    成片
                  </button>
                  <button
                    className={spatialView ? "active" : ""}
                    aria-pressed={spatialView}
                    onClick={() => toggleSpatial(true)}
                    title="切换视图（V）"
                  >
                    <Box size={14} />
                    三维预览
                  </button>
                </div>
              )}
              <button
                className={workspaceMode === "preprocess" ? "active" : ""}
                onClick={() =>
                  workspaceMode === "preprocess"
                    ? setWorkspaceMode("scene")
                    : openPreprocess()
                }
              >
                模型预处理
              </button>
              {workspaceMode === "preprocess" && (
                <button onClick={() => setWorkspaceMode("scene")}>
                  返回场景
                </button>
              )}
              <button
                className={
                  workspaceMode === "scene" &&
                  inspectorOpen &&
                  inspector === "layer"
                    ? "active"
                    : ""
                }
                onClick={() => {
                  setWorkspaceMode("scene");
                  setInspector("layer");
                  setInspectorOpen((v) => !v || inspector !== "layer");
                }}
              >
                图层
              </button>
              <button
                className={
                  workspaceMode === "scene" &&
                  inspectorOpen &&
                  inspector === "controller"
                    ? "active"
                    : ""
                }
                onClick={() => {
                  setWorkspaceMode("scene");
                  setInspector("controller");
                  setInspectorOpen((v) => !v || inspector !== "controller");
                }}
              >
                模型控制器
              </button>
              <button
                className={
                  workspaceMode === "scene" &&
                  inspectorOpen &&
                  inspector === "camera"
                    ? "active"
                    : ""
                }
                onClick={() => {
                  setWorkspaceMode("scene");
                  selectLayer("@camera");
                  setChannel("focusZ");
                  setInspector("camera");
                  setInspectorOpen((v) => !v || inspector !== "camera");
                }}
              >
                <Camera size={15} />
                相机
              </button>
            </div>
            <div>
              <select
                aria-label="预览质量"
                value={quality}
                onChange={(e) => setQuality(+e.target.value)}
              >
                <option value="720">流畅</option>
                <option value="960">均衡</option>
                <option value="1440">高清</option>
              </select>
              {(!spatialView || workspaceMode === "preprocess") && (
                <button
                  onClick={() => {
                    if (rRef.current) {
                      rRef.current.view = { panX: 0, panY: 0, zoom: 1 };
                      rRef.current.invalidate();
                      setViewZoom(1);
                    }
                  }}
                  title="画布适配"
                >
                  <Maximize2 size={15} />
                  {Math.round(viewZoom * 100)}%
                </button>
              )}
              <button
                title={expandedView ? "还原预览" : "放大预览"}
                onClick={() => setExpandedView((v) => !v)}
              >
                {expandedView ? (
                  <Minimize2 size={16} />
                ) : (
                  <Maximize2 size={16} />
                )}
              </button>
              <button
                title="原尺寸透明截图"
                onClick={async () => {
                  if (!ready) return;
                  rRef.current!.renderAt(sRef.current, tRef.current, true);
                  download(await rRef.current!.png(), scene.name + ".png");
                  rRef.current!.invalidate();
                }}
              >
                <Download size={16} />
              </button>
            </div>
          </div>
          {workspaceMode === "scene" && (
            <div className="gizmo-toolbar" aria-label="变换工具">
              <button
                className={boxTool ? "active" : ""}
                aria-pressed={boxTool}
                onClick={() => setBoxTool((v) => !v)}
              >
                框选
              </button>
              {(
                [
                  ["move", "移动", Move],
                  ["rotate", "旋转", Undo2],
                  ["scale", "缩放", Maximize2],
                ] as const
              ).map(([id, name, Icon]) => (
                <button
                  key={id}
                  className={gizmoTool === id ? "active" : ""}
                  aria-pressed={gizmoTool === id}
                  onClick={() => {
                    setGizmoTool(id);
                    setBoxTool(false);
                  }}
                >
                  <Icon size={14} />
                  {name}
                </button>
              ))}
              <span>
                {spatialView
                  ? "可拖动轴手柄或外框角点"
                  : "选择对象后拖动控制器"}
              </span>
              {selectedIds.length > 1 && (
                <small>{selectedIds.length} 个对象</small>
              )}
              <details className="viewport-layout-menu">
                <summary title="预览分区">分区 ▾</summary>
                <div className="popup-menu">
                  {(
                    [
                      ["side", "左右拆分"],
                      ["stack", "上下拆分"],
                      ["single", "单一预览"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      className={splitLayout === id ? "active" : ""}
                      onClick={(e) => {
                        setSplit(id);
                        e.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </details>
            </div>
          )}
          {spatialView && workspaceMode === "scene" && (
            <div className="viewport-tools">
              <div className="viewport-angles" aria-label="三维查看方向">
                {(
                  [
                    ["perspective", "透视"],
                    ["front", "正视"],
                    ["side", "侧视"],
                    ["top", "俯视"],
                  ] as const
                ).map(([id, name]) => (
                  <button key={id} onClick={() => focusViewport(true, id)}>
                    {name}
                  </button>
                ))}
              </div>
              <span className="viewport-tool-divider" />
              <button
                title="聚焦选中对象（F）"
                onClick={() => focusViewport(false)}
              >
                <Focus size={14} />
                聚焦
              </button>
              <button
                title="适配全场（Shift+F）"
                onClick={() => focusViewport(true)}
              >
                全场
              </button>
              <span className="viewport-tools-spacer" />
              <button
                title="地面网格"
                aria-pressed={viewGrid}
                className={viewGrid ? "active" : ""}
                onClick={() => {
                  const r = rRef.current!;
                  r.showGrid = !viewGrid;
                  setViewGrid(!viewGrid);
                  r.invalidate();
                }}
              >
                <Grid2X2 size={14} />
              </button>
              <button
                title="成片相机范围"
                aria-pressed={viewCamera}
                className={viewCamera ? "active" : ""}
                onClick={() => {
                  const r = rRef.current!;
                  r.showCamera = !viewCamera;
                  setViewCamera(!viewCamera);
                  r.invalidate();
                }}
              >
                <Camera size={14} />
              </button>
            </div>
          )}
          <div
            className={
              "viewport-panes " +
              (workspaceMode === "scene" ? splitLayout : "single")
            }
          >
            <div
              className="viewport-pane"
              style={
                workspaceMode === "scene" && splitLayout !== "single"
                  ? { flexBasis: splitRatio * 100 + "%" }
                  : undefined
              }
            >
              <div
                className={
                  "scene-canvas" +
                  (spatialView && workspaceMode === "scene"
                    ? " is-spatial"
                    : "")
                }
                ref={host}
                onPointerDown={(e) => canvasPointer(e)}
                onContextMenu={(e) => contextViewport(e, "main")}
              >
                {workspaceMode === "scene" && ready && (
                  <ViewportOverlay
                    store={overlay}
                    tool={gizmoTool}
                    begin={beginGizmo}
                    orient={orientViewport}
                  />
                )}
                {viewBox?.pane === "main" && (
                  <div
                    className="viewport-marquee"
                    style={{
                      left: viewBox.box.x,
                      top: viewBox.box.y,
                      width: viewBox.box.w,
                      height: viewBox.box.h,
                    }}
                  />
                )}
                {!ready && (
                  <div className="scene-loading">
                    <Loader2 size={27} className="spin" />
                    载入场景…
                  </div>
                )}
              </div>
            </div>
            {workspaceMode === "scene" && splitLayout !== "single" && (
              <>
                <div
                  className="viewport-divider"
                  title="拖动调整分区比例"
                  role="separator"
                  aria-label="预览分隔条"
                  onPointerDown={resizeSplit}
                />
                <div className="viewport-pane mirror-pane">
                  <div className="mirror-toolbar">
                    <select
                      aria-label="第二预览类型"
                      value={mirrorSpatial ? "space" : "camera"}
                      onChange={(e) => {
                        const value = e.target.value === "space";
                        mirror.current.spatial = value;
                        setMirrorSpatial(value);
                        rRef.current?.invalidate();
                      }}
                    >
                      <option value="camera">成片</option>
                      <option value="space">三维预览</option>
                    </select>
                    <button
                      title="适配第二预览"
                      onClick={() => {
                        mirror.current.view = { panX: 0, panY: 0, zoom: 1 };
                        mirror.current.orbit = fitOrbit(
                          sRef.current,
                          tRef.current,
                        );
                        rRef.current?.invalidate();
                      }}
                    >
                      <Focus size={14} />
                    </button>
                    <button
                      title="关闭第二预览"
                      onClick={() => setSplit("single")}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div
                    className={
                      "scene-canvas mirror-canvas" +
                      (mirrorSpatial ? " is-spatial" : "")
                    }
                    ref={mirrorHost}
                    onPointerDown={(e) => canvasPointer(e, "mirror")}
                    onContextMenu={(e) => contextViewport(e, "mirror")}
                  >
                    <canvas ref={mirrorCanvas} aria-label="第二预览画布" />
                    <ViewportOverlay
                      store={mirrorOverlay}
                      tool={gizmoTool}
                      begin={(e, m, h, g) => beginGizmo(e, m, h, g, "mirror")}
                      orient={(axis, sign) => {
                        const o =
                          mirror.current.orbit ??
                          fitOrbit(sRef.current, tRef.current);
                        mirror.current.spatial = true;
                        setMirrorSpatial(true);
                        putOrbit("mirror", {
                          ...o,
                          yaw:
                            axis === "x"
                              ? (-sign * Math.PI) / 2
                              : axis === "z" && sign > 0
                                ? Math.PI
                                : 0,
                          pitch: axis === "y" ? (sign * Math.PI) / 2 : 0,
                        });
                      }}
                    />
                    {viewBox?.pane === "mirror" && (
                      <div
                        className="viewport-marquee"
                        style={{
                          left: viewBox.box.x,
                          top: viewBox.box.y,
                          width: viewBox.box.w,
                          height: viewBox.box.h,
                        }}
                      />
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="scene-canvas-hint">
            <span>
              {workspaceMode === "preprocess"
                ? "模型素材预览 · 原始姿态 · 不含场景光与实例后处理"
                : spatialView
                  ? "中键环绕 · 左拖移动 · Shift＋左拖框选 · 右键菜单"
                  : "左拖移动 · 滚轮缩放 · Shift＋左拖框选 · 右键菜单"}
            </span>
            <span>
              {spatialView && workspaceMode === "scene"
                ? "三维视角 · 不改变成片"
                : `${displayScene.width}×${displayScene.height}`}
            </span>
          </div>
          {motionPreviewId && workspaceMode === "scene" && (
            <AuditionControls
              key={motionPreviewId}
              clock={motionPreviewRef}
              change={updateAudition}
              close={stopMotionPreview}
            />
          )}
          {expandedView && workspaceMode === "scene" && !motionPreviewId && (
            <div className="audition-controls" aria-label="放大预览播放控制">
              <button
                title={playing ? "暂停场景" : "播放场景"}
                onClick={() => {
                  if (tRef.current >= sRef.current.workArea.end)
                    seek(sRef.current.workArea.start);
                  setPlaying((v) => !v);
                }}
              >
                {playing ? <Pause size={15} /> : <Play size={15} />}
              </button>
              <input
                aria-label="场景预览进度"
                type="range"
                min={0}
                max={scene.duration}
                step={1 / scene.fps}
                value={time}
                onChange={(e) => seek(+e.target.value)}
              />
              <span className="audition-time">
                {time.toFixed(3)} / {scene.duration.toFixed(3)} s
              </span>
            </div>
          )}
        </main>
        <aside className="theater-inspector" hidden={!inspectorOpen}>
          <div className="inspector-header">
            <strong>
              {workspaceMode === "preprocess"
                ? "模型预处理 · 素材级"
                : inspector === "controller"
                  ? "独立模型控制器"
                  : inspector === "audio"
                    ? "音频编辑器"
                    : inspector === "camera"
                      ? "透视相机与景深"
                      : inspector === "effects"
                        ? "后处理层"
                        : "图层属性"}
            </strong>
            <button
              aria-label="关闭属性面板"
              onClick={() => setInspectorOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="scene-properties">
            {workspaceMode === "preprocess" ? (
              <ModelPreprocessPanel
                resource={preprocessingResource}
                onChange={(value) =>
                  change((s) => {
                    const r = s.models.find(
                      (r) => r.id === preprocessingResource?.id,
                    );
                    if (r) r.preprocess = value;
                  })
                }
              />
            ) : inspector === "camera" ? (
              <>
                <p className="property-note">
                  增大相机 Z 会向空间对象推进。二维图层固定在屏幕上。
                </p>
                {scene.layers.some(
                  (l) => l.model && !spatialLayer(scene, l),
                ) && (
                  <button
                    className="wide-button"
                    onClick={() =>
                      change((s) => {
                        for (const l of s.layers)
                          if (l.model && !spatialLayer(s, l) && !l.locked)
                            l.is3D = true;
                      })
                    }
                  >
                    让模型跟随相机
                  </button>
                )}
                <div className="property-grid">
                  {cameraChannels.map(([id, name]) => (
                    <Num
                      key={id}
                      label={name}
                      value={(camera as any)[id]}
                      min={id === "zoom" ? 0.1 : id === "aperture" ? 0 : -10000}
                      max={id === "zoom" ? 8 : id === "aperture" ? 4 : 10000}
                      onChange={(v) => setValue(id, v)}
                      keyed={!!scene.camera.animation[id]?.length}
                      onKey={() => setValue(id, (camera as any)[id], true)}
                    />
                  ))}
                </div>
                <Num
                  label="焦距 / 空间单位"
                  value={scene.camera.focalLength}
                  min={200}
                  max={5000}
                  onChange={(v) => setValue("focalLength", v)}
                  keyed={!!scene.camera.animation.focalLength?.length}
                  onKey={() =>
                    setValue("focalLength", camera.focalLength, true)
                  }
                />
                <label className="toggle-line">
                  <input
                    type="checkbox"
                    checked={scene.camera.dof}
                    onChange={(e) =>
                      change((s) => {
                        s.camera.dof = e.target.checked;
                      })
                    }
                  />
                  启用景深
                </label>
                <label className="stack-field">
                  景深算法
                  <select
                    aria-label="景深算法"
                    value={scene.camera.blurMode || "lens"}
                    onChange={(e) =>
                      change((s) => {
                        s.camera.blurMode = e.target.value as any;
                      })
                    }
                  >
                    <option value="lens">镜头散景（圆形光圈）</option>
                    <option value="gaussian">高质量高斯</option>
                  </select>
                </label>
                <button
                  className="wide-button"
                  onClick={() => {
                    const l =
                      scene.layers.find((l) => l.id === selected) ||
                      scene.layers.find((l) => l.kind === "model");
                    if (l)
                      change((s) => {
                        s.camera.focusZ = worldMatrix(scene, l, time)[14];
                        s.camera.dof = true;
                      });
                  }}
                >
                  <Focus size={15} />
                  对焦角色深度
                </button>
                <p className="hint">
                  图层 Z 与焦平面距离越大，失焦越明显。3D
                  图层是可透视旋转的平面，不导入三维网格。
                </p>
              </>
            ) : !selectedLayer ? (
              <div className="empty-state">
                选择画布或图层列表中的对象。
                <br />
                每个模型容器拥有自己的动作与参数。
              </div>
            ) : (
              <>
                <div className="selected-layer-heading">
                  {icons[selectedLayer.kind]}
                  <strong>{selectedLayer.name}</strong>
                  <small>{selectedLayer.kind}</small>
                </div>
                <div className="property-tabs">
                  <button
                    className={inspector === "layer" ? "active" : ""}
                    onClick={() => setInspector("layer")}
                  >
                    属性
                  </button>
                  {selectedLayer.model && (
                    <button
                      className={inspector === "controller" ? "active" : ""}
                      onClick={() => setInspector("controller")}
                    >
                      动作 / 参数
                    </button>
                  )}
                  {selectedClip?.kind === "audio" && (
                    <button
                      className={inspector === "audio" ? "active" : ""}
                      onClick={() => setInspector("audio")}
                    >
                      音频
                    </button>
                  )}
                  {!selectedLayer.light && (
                    <button
                      className={inspector === "effects" ? "active" : ""}
                      onClick={() => setInspector("effects")}
                    >
                      场景后处理
                    </button>
                  )}
                </div>
                {inspector === "layer" && (
                  <>
                    {selectedLayer.light && (
                      <LightPanel
                        scene={scene}
                        layer={animated!}
                        onChange={(patch) =>
                          updateLayer((l) => Object.assign(l.light!, patch))
                        }
                        onScene={(value) =>
                          change((s) => {
                            s.lighting = value;
                          })
                        }
                        onValue={setValue}
                        onKey={(id) =>
                          setValue(
                            id,
                            (animated!.light as any)[id.slice(6)],
                            true,
                          )
                        }
                      />
                    )}
                    <label className="stack-field">
                      所属图层组
                      <select
                        value={selectedLayer.parentId || ""}
                        onChange={(e) =>
                          change((s) => {
                            if (
                              !reparentSafe(
                                s,
                                selectedLayer.id,
                                e.target.value || null,
                              )
                            )
                              notify("不能将图层放入自身或子组");
                          })
                        }
                      >
                        <option value="">场景根节点</option>
                        {scene.layers
                          .filter(
                            (l) =>
                              l.kind === "group" && l.id !== selectedLayer.id,
                          )
                          .map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <div className="property-grid">
                      <Num
                        label="宽度"
                        value={selectedLayer.width}
                        min={2}
                        max={8000}
                        onChange={(v) =>
                          updateLayer((l) => {
                            l.width = v;
                          })
                        }
                      />
                      <Num
                        label="高度"
                        value={selectedLayer.height}
                        min={2}
                        max={8000}
                        onChange={(v) =>
                          updateLayer((l) => {
                            l.height = v;
                          })
                        }
                      />
                      {channels
                        .filter(([id]) =>
                          [
                            "x",
                            "y",
                            "scaleX",
                            "scaleY",
                            "rotation",
                            "opacity",
                          ].includes(id),
                        )
                        .map(([id, name]) => (
                          <Num
                            key={id}
                            label={name}
                            value={(animated!.transform as any)[id]}
                            min={
                              id === "opacity"
                                ? 0
                                : id.startsWith("scale")
                                  ? 0.01
                                  : -10000
                            }
                            max={
                              id === "opacity"
                                ? 1
                                : id.startsWith("scale")
                                  ? 20
                                  : 10000
                            }
                            onChange={(v) => setValue(id, v)}
                            onKey={() =>
                              setValue(
                                id,
                                (animated!.transform as any)[id],
                                true,
                              )
                            }
                            keyed={!!selectedLayer.animation[id]?.length}
                          />
                        ))}
                    </div>
                    <label className="toggle-line">
                      <input
                        type="checkbox"
                        checked={selectedLayer.is3D}
                        onChange={(e) =>
                          updateLayer((l) => {
                            l.is3D = e.target.checked;
                          })
                        }
                      />
                      3D 空间图层
                    </label>
                    {(selectedLayer.is3D || selectedLayer.kind === "group") && (
                      <label className="toggle-line depth-mode">
                        <input
                          type="checkbox"
                          checked={selectedLayer.depthMode === "stack"}
                          onChange={(e) =>
                            updateLayer((l) => {
                              l.depthMode = e.target.checked
                                ? "stack"
                                : "scene";
                            })
                          }
                        />
                        忽略遮挡，按图层叠放
                      </label>
                    )}
                    {selectedLayer.is3D && (
                      <div className="property-grid">
                        {(["z", "rotationX", "rotationY"] as const).map(
                          (id) => (
                            <Num
                              key={id}
                              label={
                                id === "z"
                                  ? "深度 Z"
                                  : id === "rotationX"
                                    ? "旋转 X"
                                    : "旋转 Y"
                              }
                              value={animated!.transform[id]}
                              min={id === "z" ? -1000 : -180}
                              max={id === "z" ? 10000 : 180}
                              onChange={(v) => setValue(id, v)}
                              onKey={() =>
                                setValue(id, animated!.transform[id], true)
                              }
                              keyed={!!selectedLayer.animation[id]?.length}
                            />
                          ),
                        )}
                      </div>
                    )}
                    <label className="stack-field">
                      混合模式
                      <select
                        value={selectedLayer.blend}
                        onChange={(e) =>
                          updateLayer((l) => {
                            l.blend = e.target.value as any;
                          })
                        }
                      >
                        <option value="normal">正常</option>
                        <option value="add">相加</option>
                        <option value="multiply">正片叠底</option>
                        <option value="screen">滤色</option>
                      </select>
                    </label>
                    {selectedLayer.kind === "color" && (
                      <label className="color-field">
                        颜色
                        <input
                          type="color"
                          value={selectedLayer.color}
                          onChange={(e) =>
                            updateLayer((l) => {
                              l.color = e.target.value;
                            })
                          }
                        />
                      </label>
                    )}
                    {selectedLayer.text && (
                      <>
                        <h3>文本浮层</h3>
                        <textarea
                          aria-label="文本内容"
                          rows={4}
                          value={selectedLayer.text.value}
                          onChange={(e) =>
                            updateLayer((l) => {
                              l.text!.value = e.target.value;
                            })
                          }
                        />
                        <label className="stack-field">
                          字体
                          <select
                            value={selectedLayer.text.fontFamily}
                            onChange={(e) =>
                              updateLayer((l) => {
                                l.text!.fontFamily = e.target.value;
                              })
                            }
                          >
                            {[
                              "Microsoft YaHei",
                              "Arial",
                              "SimSun",
                              ...scene.assets
                                .filter((a) => a.kind === "font")
                                .map((a) => a.fontFamily!),
                            ].map((f) => (
                              <option key={f} value={f}>
                                {scene.assets.find((a) => a.fontFamily === f)
                                  ?.name || f}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="property-grid">
                          <Num
                            label="字号"
                            value={selectedLayer.text.fontSize}
                            min={8}
                            max={240}
                            onChange={(v) =>
                              updateLayer((l) => {
                                l.text!.fontSize = v;
                              })
                            }
                          />
                          <Num
                            label="描边"
                            value={selectedLayer.text.strokeWidth}
                            min={0}
                            max={20}
                            onChange={(v) =>
                              updateLayer((l) => {
                                l.text!.strokeWidth = v;
                              })
                            }
                          />
                        </div>
                        <label className="color-field">
                          文字颜色
                          <input
                            type="color"
                            value={selectedLayer.text.fill}
                            onChange={(e) =>
                              updateLayer((l) => {
                                l.text!.fill = e.target.value;
                              })
                            }
                          />
                        </label>
                        <label className="stack-field">
                          对齐
                          <select
                            value={selectedLayer.text.align}
                            onChange={(e) =>
                              updateLayer((l) => {
                                l.text!.align = e.target.value as any;
                              })
                            }
                          >
                            <option value="left">左对齐</option>
                            <option value="center">居中</option>
                            <option value="right">右对齐</option>
                          </select>
                        </label>
                        <label className="stack-field">
                          文本动画
                          <select
                            value={selectedLayer.text.animation}
                            onChange={(e) =>
                              updateLayer((l) => {
                                l.text!.animation = e.target.value as any;
                              })
                            }
                          >
                            <option value="none">无</option>
                            <option value="typewriter">打字机</option>
                            <option value="fade">淡入淡出（片段渐变）</option>
                            <option value="typewriter-fade">
                              打字机 + 淡入淡出
                            </option>
                          </select>
                        </label>
                        <Num
                          label="打字速度 / 字每秒"
                          value={selectedLayer.text.charsPerSecond}
                          min={1}
                          max={100}
                          onChange={(v) =>
                            updateLayer((l) => {
                              l.text!.charsPerSecond = v;
                            })
                          }
                        />
                      </>
                    )}
                  </>
                )}
                {inspector === "controller" && selectedLayer.model && (
                  <>
                    <p className="property-note">
                      此容器的动作、参数关键帧、基础姿态和物理均独立于其他实例。
                      受预设驱动的参数在手动调节时会记录覆盖关键帧。
                    </p>
                    <label className="toggle-line">
                      <input
                        type="checkbox"
                        checked={selectedLayer.model.physics}
                        onChange={(e) =>
                          updateLayer((l) => {
                            l.model!.physics = e.target.checked;
                          })
                        }
                      />
                      模型物理
                    </label>
                    <label className="toggle-line">
                      <input
                        type="checkbox"
                        checked={autoKey}
                        onChange={(e) => setAutoKey(e.target.checked)}
                      />
                      自动记录参数关键帧
                    </label>
                    <div className="search-field">
                      <Search size={13} />
                      <input
                        aria-label="搜索模型参数"
                        placeholder="参数名称 / ID"
                        value={paramSearch}
                        onChange={(e) => {
                          setParamSearch(e.target.value);
                          setParamPage(0);
                        }}
                      />
                    </div>
                    {paramSlice.map((p) => (
                      <div className="scene-param" key={p.id}>
                        <div>
                          <span title={p.id}>{p.name}</span>
                          <button
                            title={"记录 " + p.id}
                            onClick={() =>
                              setValue(
                                "param:" + p.id,
                                values[p.id] ?? p.default,
                                true,
                              )
                            }
                          >
                            <Diamond size={12} />
                          </button>
                          <b>{format(values[p.id] ?? p.default)}</b>
                        </div>
                        <input
                          aria-label={p.id}
                          type="range"
                          min={p.min}
                          max={p.max}
                          step={Math.max(0.001, (p.max - p.min) / 200)}
                          value={values[p.id] ?? p.default}
                          onChange={(e) =>
                            setValue("param:" + p.id, +e.target.value)
                          }
                        />
                      </div>
                    ))}
                    <div className="page-controls">
                      <button
                        disabled={!paramPage}
                        onClick={() => setParamPage((v) => v - 1)}
                      >
                        上一页
                      </button>
                      <span>
                        {paramPage + 1}/
                        {Math.max(1, Math.ceil(paramMatches.length / 20))}
                      </span>
                      <button
                        disabled={(paramPage + 1) * 20 >= paramMatches.length}
                        onClick={() => setParamPage((v) => v + 1)}
                      >
                        下一页
                      </button>
                    </div>
                    <button
                      className="wide-button"
                      onClick={() => {
                        openCurves(
                          currentBinding.channel.startsWith("param:")
                            ? currentBinding
                            : undefined,
                        );
                      }}
                    >
                      打开模型参数曲线
                    </button>
                    <details>
                      <summary>高级：口型参数与分组</summary>
                      {(
                        [
                          ["lipOpen", "嘴部开合参数"],
                          ["lipForm", "嘴部形状参数"],
                        ] as const
                      ).map(([key, label]) => (
                        <label className="stack-field" key={key}>
                          {label}
                          <select
                            value={selectedLayer.model![key]}
                            onChange={(e) =>
                              updateLayer((l) => {
                                l.model![key] = e.target.value;
                              })
                            }
                          >
                            <option value="">不驱动此通道</option>
                            {params.map((p) => (
                              <option value={p.id} key={p.id}>
                                {p.name} · {p.id}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                      {paramSlice.map((p) => (
                        <label className="stack-field" key={p.id}>
                          {p.name}
                          <select
                            value={
                              selectedLayer.model!.groupOverrides[p.id] ||
                              p.group
                            }
                            onChange={(e) =>
                              updateLayer((l) => {
                                l.model!.groupOverrides[p.id] = e.target
                                  .value as Group;
                              })
                            }
                          >
                            {Object.entries(groupNames).map(([id, name]) => (
                              <option value={id} key={id}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </details>
                  </>
                )}
                {inspector === "effects" && (
                  <>
                    <p className="property-note">
                      此处是当前场景实例的后处理，独立于模型素材预处理。
                    </p>
                    {selectedLayer.model && (
                      <button
                        className="wide-button"
                        onClick={() =>
                          openPreprocess(selectedLayer.model!.resourceId)
                        }
                      >
                        打开模型素材预处理
                      </button>
                    )}
                    {["model", "image", "text", "color", "group"].includes(
                      selectedLayer.kind,
                    ) && (
                      <div className="receiver-panel">
                        <label className="toggle-line">
                          <input
                            aria-label="接收场景光源"
                            type="checkbox"
                            checked={receivesLight(scene, selectedLayer)}
                            onChange={(e) =>
                              updateLayer((l) => {
                                l.receiveLight = e.target.checked;
                              })
                            }
                          />
                          接收场景光源
                        </label>
                        {receivesLight(scene, selectedLayer) &&
                          selectedLayer.kind !== "group" && (
                            <div className="property-grid">
                              {(
                                [
                                  ["roughness", "粗糙度", 0.05, 1],
                                  ["specular", "高光反射", 0, 2],
                                  ["rim", "轮廓反射", 0, 2],
                                  ["bump", "轮廓凹凸", 0, 1],
                                ] as const
                              ).map(([id, name, min, max]) => (
                                <Num
                                  key={id}
                                  label={name}
                                  value={(animated!.surface as any)[id]}
                                  min={min}
                                  max={max}
                                  onChange={(v) => setValue("surface." + id, v)}
                                  onKey={() =>
                                    setValue(
                                      "surface." + id,
                                      (animated!.surface as any)[id],
                                      true,
                                    )
                                  }
                                  keyed={
                                    !!selectedLayer.animation["surface." + id]
                                      ?.length
                                  }
                                />
                              ))}
                            </div>
                          )}
                      </div>
                    )}
                    <p className="property-note">
                      {selectedLayer.kind === "adjustment"
                        ? "调节同组中位于本层下方的合成画面；上方图层不受影响。"
                        : "局部效果只作用于此图层，可在其上方创建后处理层调节整组画面。"}
                    </p>
                    <label className="stack-field">
                      模糊算法
                      <select
                        aria-label="模糊算法"
                        value={selectedLayer.effects.blurMode || "gaussian"}
                        onChange={(e) =>
                          updateLayer((l) => {
                            l.effects.blurMode = e.target.value as any;
                          })
                        }
                      >
                        <option value="gaussian">
                          高质量高斯（可分离多遍）
                        </option>
                        <option value="lens">镜头散景（圆形光圈）</option>
                      </select>
                    </label>
                    <Range
                      label="散景高光"
                      value={animated!.effects.bokeh ?? 0.25}
                      max={2}
                      onChange={(v) => setValue("effects.bokeh", v)}
                    />
                    {effectFields.map(([id, name, min, max]) => (
                      <Range
                        key={id}
                        label={name}
                        value={(animated!.effects as any)[id]}
                        min={min}
                        max={max}
                        onChange={(v) => setValue("effects." + id, v)}
                      />
                    ))}
                    <label className="color-field">
                      描边颜色
                      <input
                        type="color"
                        value={selectedLayer.effects.outlineColor}
                        onChange={(e) =>
                          updateLayer((l) => {
                            l.effects.outlineColor = e.target.value;
                          })
                        }
                      />
                    </label>
                    <label className="color-field">
                      发光颜色
                      <input
                        type="color"
                        value={selectedLayer.effects.glowColor}
                        onChange={(e) =>
                          updateLayer((l) => {
                            l.effects.glowColor = e.target.value;
                          })
                        }
                      />
                    </label>
                    <label className="stack-field">
                      旧版局部补光（兼容旧工程）
                      <select
                        value={selectedLayer.effects.lightType}
                        onChange={(e) =>
                          updateLayer((l) => {
                            l.effects.lightType = e.target.value as any;
                          })
                        }
                      >
                        <option value="off">关闭</option>
                        <option value="point">点光</option>
                        <option value="area">面光</option>
                        <option value="sun">日光</option>
                      </select>
                    </label>
                    {selectedLayer.effects.lightType !== "off" && (
                      <>
                        <Range
                          label="光强"
                          value={animated!.effects.lightIntensity}
                          max={2}
                          onChange={(v) =>
                            setValue("effects.lightIntensity", v)
                          }
                        />
                        <Range
                          label="光源 X"
                          value={animated!.effects.lightX}
                          onChange={(v) => setValue("effects.lightX", v)}
                        />
                        <Range
                          label="光源 Y"
                          value={animated!.effects.lightY}
                          onChange={(v) => setValue("effects.lightY", v)}
                        />
                        <Range
                          label="轮廓光"
                          value={animated!.effects.rim}
                          max={2}
                          onChange={(v) => setValue("effects.rim", v)}
                        />
                        <Range
                          label="光泽"
                          value={animated!.effects.gloss}
                          max={2}
                          onChange={(v) => setValue("effects.gloss", v)}
                        />
                      </>
                    )}
                  </>
                )}
                {inspector === "audio" &&
                  selectedClip?.kind === "audio" &&
                  selectedMedia && (
                    <>
                      <button
                        className="wide-button"
                        onClick={() => {
                          setLibraryTab("audio");
                          setManagerTab("assets");
                          previewAudio(selectedMedia);
                        }}
                      >
                        {previewId === selectedMedia.id ? (
                          <Pause size={15} />
                        ) : (
                          <Play size={15} />
                        )}
                        在音频库预览
                      </button>
                      <button
                        className="wide-button"
                        disabled={!!busy}
                        onClick={() => analyze(selectedMedia)}
                      >
                        识别口型（仅此音频）
                      </button>
                      <p className="property-note">
                        背景音乐无需识别口型。识别后，手动选择要驱动的角色。
                      </p>
                      <label className="stack-field">
                        口型绑定模型
                        <select
                          value={selectedClip.lipTarget}
                          onChange={(e) => bindLip(e.target.value)}
                        >
                          <option value="">不驱动口型</option>
                          {scene.layers
                            .filter((l) => l.kind === "model")
                            .map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <small>
                        {selectedMedia.analysis || "可按需生成离线口型"}
                      </small>
                      <Range
                        label="口型幅度（独立于音量）"
                        value={selectedClip.lipWeight ?? 1}
                        onChange={(v) =>
                          updateClip((c) => {
                            c.lipWeight = v;
                          })
                        }
                      />
                      <button
                        className="wide-button"
                        onClick={() => {
                          setChannel("gain");
                          openCurves({
                            layerId: selectedClip.layerId,
                            channel: "gain",
                            clipId: selectedClip.id,
                          });
                        }}
                      >
                        编辑音量关键帧
                      </button>
                    </>
                  )}
                {selectedClip && (
                  <div className="clip-properties">
                    <h3>选中片段</h3>
                    <input
                      aria-label="片段名称"
                      value={selectedClip.name}
                      onChange={(e) =>
                        updateClip((c) => {
                          c.name = e.target.value;
                        })
                      }
                    />
                    <div className="property-grid">
                      <Num
                        label="起始 / 秒"
                        value={selectedClip.start}
                        min={0}
                        onChange={(v) =>
                          updateClip((c) => {
                            c.start = v;
                          })
                        }
                      />
                      <Num
                        label="时长 / 秒"
                        value={selectedClip.duration}
                        min={1 / scene.fps}
                        onChange={(v) =>
                          updateClip((c) => {
                            c.duration = v;
                          })
                        }
                      />
                      <Num
                        label="源入点"
                        value={selectedClip.trimIn}
                        min={0}
                        onChange={(v) =>
                          updateClip((c) => {
                            c.trimIn = v;
                          })
                        }
                      />
                      <Num
                        label="速度"
                        value={selectedClip.speed}
                        min={0.25}
                        max={4}
                        onChange={(v) =>
                          updateClip((c) => {
                            c.duration *= c.speed / v;
                            c.speed = v;
                          })
                        }
                      />
                      <Num
                        label="淡入"
                        value={selectedClip.fadeIn}
                        min={0}
                        max={selectedClip.duration}
                        onChange={(v) =>
                          updateClip((c) => {
                            c.fadeIn = v;
                          })
                        }
                      />
                      <Num
                        label="淡出"
                        value={selectedClip.fadeOut}
                        min={0}
                        max={selectedClip.duration}
                        onChange={(v) =>
                          updateClip((c) => {
                            c.fadeOut = v;
                          })
                        }
                      />
                    </div>
                    <div className="toggle-row">
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedClip.enabled}
                          onChange={(e) =>
                            updateClip((c) => {
                              c.enabled = e.target.checked;
                            })
                          }
                        />
                        启用
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedClip.loop}
                          onChange={(e) =>
                            updateClip((c) => {
                              c.loop = e.target.checked;
                            })
                          }
                        />
                        循环源
                      </label>
                    </div>
                    {selectedClip.kind === "motion" && (
                      <>
                        <Range
                          label="叠加权重"
                          value={selectedClip.weight}
                          onChange={(v) =>
                            updateClip((c) => {
                              c.weight = v;
                            })
                          }
                        />
                        <label className="stack-field">
                          混合方式
                          <select
                            value={selectedClip.blend}
                            onChange={(e) =>
                              updateClip((c) => {
                                c.blend = e.target.value as any;
                              })
                            }
                          >
                            <option value="mix">归一化混合</option>
                            <option value="add">相对默认姿态叠加</option>
                            <option value="override">覆盖</option>
                          </select>
                        </label>
                        <div className="group-mask">
                          {Object.entries(groupNames).map(([id, name]) => (
                            <label key={id}>
                              <input
                                type="checkbox"
                                checked={
                                  !selectedClip.disabledGroups.includes(
                                    id as Group,
                                  )
                                }
                                onChange={(e) =>
                                  updateClip((c) => {
                                    c.disabledGroups = e.target.checked
                                      ? c.disabledGroups.filter((v) => v !== id)
                                      : [...c.disabledGroups, id as Group];
                                  })
                                }
                              />
                              {name}
                            </label>
                          ))}
                        </div>
                        <details className="parameter-mask">
                          <summary>单个动作参数开关</summary>
                          {(
                            resource?.assets.find(
                              (a) => a.id === selectedClip.assetId,
                            )?.curves || []
                          ).map((cv) => (
                            <label key={cv.id}>
                              <input
                                type="checkbox"
                                checked={
                                  !selectedClip.disabledIds.includes(cv.id)
                                }
                                onChange={(e) =>
                                  updateClip((c) => {
                                    c.disabledIds = e.target.checked
                                      ? c.disabledIds.filter(
                                          (id) => id !== cv.id,
                                        )
                                      : [...c.disabledIds, cv.id];
                                  })
                                }
                              />
                              {cv.id}
                            </label>
                          ))}
                        </details>
                        <button
                          className="wide-button"
                          onClick={() => {
                            const cv = resource?.assets.find(
                              (a) => a.id === selectedClip.assetId,
                            )?.curves[0];
                            if (cv) {
                              setChannel("motion:" + cv.id);
                              openCurves({
                                layerId: selectedClip.layerId,
                                channel: "motion:" + cv.id,
                                clipId: selectedClip.id,
                              });
                            }
                          }}
                        >
                          编辑此预设的独立参数曲线
                        </button>
                        {selectedLayer?.model && (
                          <details>
                            <summary>旧动作参数映射（此模型容器）</summary>
                            {[
                              ...new Set(
                                (
                                  resource?.assets.find(
                                    (a) => a.id === selectedClip.assetId,
                                  )?.curves || []
                                ).map((c) => c.id),
                              ),
                            ]
                              .filter(
                                (id) =>
                                  !params.some((p) => p.id === id) ||
                                  selectedLayer.model!.parameterMap[id],
                              )
                              .map((id) => (
                                <label className="stack-field" key={id}>
                                  {id}
                                  <select
                                    value={
                                      selectedLayer.model!.parameterMap[id] ||
                                      ""
                                    }
                                    onChange={(e) =>
                                      updateLayer((l) => {
                                        l.model!.parameterMap[id] =
                                          e.target.value;
                                      })
                                    }
                                  >
                                    <option value="">
                                      未匹配 · 选择目标参数
                                    </option>
                                    {params.map((p) => (
                                      <option value={p.id} key={p.id}>
                                        {p.name} · {p.id}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              ))}
                          </details>
                        )}
                      </>
                    )}
                  </div>
                )}
              </>
            )}
            <div
              className="inspector-bottom"
              style={{
                display: workspaceMode === "preprocess" ? "none" : undefined,
              }}
            >
              <label>
                <input
                  type="checkbox"
                  checked={autoKey}
                  onChange={(e) => setAutoKey(e.target.checked)}
                />
                自动关键帧
              </label>
              <button onClick={() => setCurveOpen((v) => !v)}>
                <Diamond size={13} />
                曲线
              </button>
              <button onClick={() => setModal("help")}>帮助</button>
            </div>
          </div>
        </aside>
      </div>
      <div
        className="timeline-slot"
        style={{
          visibility: workspaceMode === "preprocess" ? "hidden" : "visible",
        }}
      >
        <div className="timeline-original" hidden={curveOpen}>
          <SceneTimeline
            visible={!curveOpen && workspaceMode === "scene"}
            scene={scene}
            selectedLayerId={selected}
            selectedBinding={currentBinding}
            paramsByLayer={paramsByLayer}
            onSelectLayer={selectLayer}
            onBinding={selectProperty}
            onRecord={recordProperty}
            onValue={editProperty}
            onWriteKeys={(b, keys) => change((s) => writeProperty(s, b, keys))}
            height={timelineHeight}
            onHeight={setTimelineHeight}
            time={time}
            playing={playing}
            selection={selection}
            zoom={zoom}
            snap={snap}
            onSeek={seek}
            onPlay={() => {
              stopMotionPreview();
              if (tRef.current >= scene.workArea.end)
                seek(scene.workArea.start);
              setPlaying((v) => !v);
            }}
            onChange={change}
            onSelect={selectClips}
            onDrop={addAsset}
            onZoom={setZoom}
            onSnap={() => setSnap((v) => !v)}
            onSplit={split}
            onDuplicate={duplicateClips}
            onDelete={deleteClips}
            onMarker={marker}
            onCurve={(binding) => openCurves(binding)}
            curveOpen={curveOpen}
          />
        </div>
        {curveOpen && workspaceMode === "scene" && (
          <div className="curve-area">
            <div
              className="curve-resize"
              title="调整曲线区高度"
              onPointerDown={(e) => {
                const y = e.clientY,
                  start = timelineHeight;
                watchPointer(
                  e,
                  (v) =>
                    setTimelineHeight(
                      clamp(
                        start + y - v.clientY,
                        210,
                        window.innerHeight * 0.68,
                      ),
                    ),
                  () => {},
                );
              }}
            />
            <CurveWorkspace
              scene={scene}
              binding={currentBinding}
              paramsByLayer={paramsByLayer}
              seed={curveSeed}
              time={time}
              snap={snap}
              autoKey={autoKey}
              toggleAutoKey={() => setAutoKey((v) => !v)}
              seek={seek}
              value={editProperty}
              write={(b, k) => change((s) => writeProperty(s, b, k))}
              record={recordProperty}
              editClip={(id, patch) =>
                change((s) => {
                  const c = s.tracks
                    .flatMap((t) => t.clips)
                    .find((c) => c.id === id);
                  if (c) Object.assign(c, patch);
                })
              }
              close={() => setCurveOpen(false)}
            />
          </div>
        )}
      </div>
      <footer className="theater-status">
        <span>
          <i className={ready ? "ready-dot" : "waiting-dot"} />
          {busy ||
            `${scene.layers.length} 个图层 · ${scene.layers.filter((l) => l.model).length} 个独立模型容器`}
        </span>
        <span>{dirty ? "草稿自动保存" : "工程就绪"} · 本地离线 · .livemg</span>
      </footer>
      {contextMenu && (
        <div
          className="viewport-context popup-menu"
          role="menu"
          ref={menuRef}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.ids.length > 0 ? (
            <>
              <small>
                {contextMenu.ids.length === 1
                  ? scene.layers.find((l) => l.id === contextMenu.ids[0])?.name
                  : contextMenu.ids.length + " 个对象"}
              </small>
              <button
                role="menuitem"
                onClick={() => {
                  const ids = contextMenu.ids,
                    hide = scene.layers.some(
                      (l) => ids.includes(l.id) && l.visible,
                    );
                  change((s) => {
                    for (const l of s.layers)
                      if (ids.includes(l.id)) l.visible = !hide;
                  });
                  setContextMenu(undefined);
                }}
              >
                <Eye size={14} />
                {scene.layers.some(
                  (l) => contextMenu.ids.includes(l.id) && l.visible,
                )
                  ? "隐藏"
                  : "显示"}
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  const ids = contextMenu.ids,
                    lock = scene.layers.some(
                      (l) => ids.includes(l.id) && !l.locked,
                    );
                  change((s) => {
                    for (const l of s.layers)
                      if (ids.includes(l.id)) l.locked = lock;
                  });
                  setContextMenu(undefined);
                }}
              >
                <Lock size={14} />
                {scene.layers.some(
                  (l) => contextMenu.ids.includes(l.id) && !l.locked,
                )
                  ? "锁定"
                  : "解锁"}
              </button>
              {contextMenu.ids.length === 1 &&
                scene.layers.find((l) => l.id === contextMenu.ids[0])
                  ?.model && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      openPreprocess(
                        scene.layers.find((l) => l.id === contextMenu.ids[0])!
                          .model!.resourceId,
                      );
                      setContextMenu(undefined);
                    }}
                  >
                    <SlidersHorizontal size={14} />
                    模型预处理
                  </button>
                )}
              <button
                role="menuitem"
                disabled={
                  !scene.layers.some(
                    (l) => contextMenu.ids.includes(l.id) && editable(scene, l),
                  )
                }
                onClick={() => {
                  deleteLayer(contextMenu.ids);
                  setContextMenu(undefined);
                }}
              >
                <Trash2 size={14} />
                删除
              </button>
            </>
          ) : (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  setBoxTool(true);
                  setContextMenu(undefined);
                }}
              >
                框选对象
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setSplit("side");
                  setContextMenu(undefined);
                }}
              >
                左右拆分预览
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setSplit("stack");
                  setContextMenu(undefined);
                }}
              >
                上下拆分预览
              </button>
            </>
          )}
        </div>
      )}
      <input
        type="file"
        hidden
        {...({ webkitdirectory: "", directory: "" } as any)}
        ref={folderInput}
        onChange={(e) => {
          if (e.target.files?.length) importFolder(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        type="file"
        accept=".zip"
        ref={modelInput}
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) importModel(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <input
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.svg,.ttf,.otf"
        multiple
        ref={mediaInput}
        hidden
        onChange={(e) => {
          if (e.target.files) importMedia(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        type="file"
        accept="audio/*,.wav,.mp3,.flac,.m4a"
        multiple
        ref={audioInput}
        hidden
        onChange={(e) => {
          if (e.target.files) importMedia(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        type="file"
        accept=".motion3.json,.exp3.json,.json,.mtn"
        multiple
        ref={motionInput}
        hidden
        onChange={(e) => {
          if (e.target.files) importMotions(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        type="file"
        accept=".livemg,.l2dstudio"
        ref={projectInput}
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) openProject(e.target.files[0]);
          e.target.value = "";
        }}
      />
      {toast && <div className="toast">{toast}</div>}
      {busy && modal !== "export" && (
        <div className="busy-strip">
          <Loader2 size={15} className="spin" />
          {busy}
        </div>
      )}
      {modal && (
        <div className="modal-backdrop">
          <div
            className={"modal " + (modal === "help" ? "help-modal" : "")}
            role="dialog"
            aria-modal="true"
          >
            <button
              className="modal-close"
              aria-label="关闭对话框"
              disabled={!!busy}
              onClick={() => setModal("")}
            >
              <X size={18} />
            </button>
            {modal === "canvas" && (
              <>
                <h1>画布与时间</h1>
                <div className="canvas-presets">
                  {[
                    [1280, 720, "横屏"],
                    [1080, 1920, "竖屏"],
                    [1080, 1080, "方形"],
                  ].map(([w, h, n]) => (
                    <button
                      key={n}
                      onClick={() =>
                        change((s) => {
                          s.width = +w;
                          s.height = +h;
                        })
                      }
                    >
                      {n}
                      <small>
                        {w}×{h}
                      </small>
                    </button>
                  ))}
                </div>
                <div className="property-grid">
                  <Num
                    label="宽度"
                    min={64}
                    max={3840}
                    step={2}
                    value={scene.width}
                    onChange={(v) =>
                      change((s) => {
                        s.width = Math.round(v / 2) * 2;
                      })
                    }
                  />
                  <Num
                    label="高度"
                    min={64}
                    max={3840}
                    step={2}
                    value={scene.height}
                    onChange={(v) =>
                      change((s) => {
                        s.height = Math.round(v / 2) * 2;
                      })
                    }
                  />
                  <Num
                    label="帧率"
                    min={1}
                    max={60}
                    step={1}
                    value={scene.fps}
                    onChange={(v) =>
                      change((s) => {
                        s.fps = Math.round(v);
                      })
                    }
                  />
                  <Num
                    label="总时长 / 秒"
                    min={0.1}
                    max={3600}
                    value={scene.duration}
                    onChange={(v) =>
                      change((s) => {
                        s.duration = v;
                      })
                    }
                  />
                </div>
                <button
                  className="wide-button primary"
                  onClick={() => setModal("")}
                >
                  完成
                </button>
              </>
            )}
            {modal === "export" && (
              <>
                <h1>导出小剧场</h1>
                <p>包括图层、相机、景深、后处理、文本与混合音频。</p>
                <div className="export-options">
                  {[
                    ["mp4", "MP4 H.264", "通用兼容 · AAC 音频"],
                    ["hevc", "MP4 H.265 / HEVC", "高压缩率 · AAC 音频"],
                    ["gif", "GIF 动图", "循环动图 · 不含音频"],
                    ["webm", "WebM VP9", "透明背景 · 体积小"],
                    ["prores", "ProRes 4444", "透明背景 · 剪辑中间格式"],
                    ["png", "PNG 序列", "透明逐帧图像 · 不含音频"],
                  ].map(([id, name, description]) => (
                    <button
                      key={id}
                      className={exportFormat === id ? "selected" : ""}
                      disabled={!!busy}
                      onClick={() => {
                        setExportFormat(id);
                        setExportResult(null);
                        setExportStatus("");
                        setProgress(0);
                      }}
                    >
                      <span>
                        <strong>{name}</strong>
                        <small>{description}</small>
                      </span>
                    </button>
                  ))}
                </div>
                {["mp4", "hevc", "gif"].includes(exportFormat) && (
                  <label className="color-field">
                    透明区域填充色
                    <input
                      aria-label="导出背景颜色"
                      type="color"
                      value={exportMatte}
                      onInput={(e) => setExportMatte(e.currentTarget.value)}
                      onChange={(e) => setExportMatte(e.target.value)}
                    />
                    <small>
                      这些格式输出实色背景；MP4 奇数尺寸会补齐到偶数。
                    </small>
                  </label>
                )}
                <label className="toggle-line">
                  <input
                    type="checkbox"
                    checked={onlyWork}
                    onChange={(e) => setOnlyWork(e.target.checked)}
                  />
                  仅导出工作区 {scene.workArea.start.toFixed(2)}–
                  {scene.workArea.end.toFixed(2)}s
                </label>
                <p>
                  {scene.width}×{scene.height} · {scene.fps} FPS ·{" "}
                  {onlyWork
                    ? (scene.workArea.end - scene.workArea.start).toFixed(2)
                    : scene.duration}
                  s
                </p>
                {exportStatus && (
                  <div className="export-progress">
                    <div>
                      <i style={{ width: progress * 100 + "%" }} />
                    </div>
                    {exportStatus}
                  </div>
                )}
                {exportResult ? (
                  <>
                    <button
                      className="wide-button primary"
                      onClick={() => {
                        const name =
                          scene.name +
                          ({
                            mp4: ".mp4",
                            hevc: ".mp4",
                            gif: ".gif",
                            prores: ".mov",
                            png: ".zip",
                            webm: ".webm",
                          }[exportFormat] || ".mp4");
                        if (window.studioDesktop?.saveExport) {
                          window.studioDesktop
                            .saveExport(exportResult.path, name)
                            .then((v) => {
                              if (!v.canceled) notify("导出文件已保存");
                            })
                            .catch((e) => notify(e.message));
                        } else {
                          const a = document.createElement("a");
                          a.href = exportResult.url;
                          a.download = name;
                          a.click();
                        }
                      }}
                    >
                      保存视频文件
                    </button>
                    <button className="wide-button" onClick={exportVideo}>
                      重新导出
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
                    className="wide-button primary"
                    disabled={!!busy || !ready}
                    onClick={exportVideo}
                  >
                    {busy ? (
                      <Loader2 className="spin" size={16} />
                    ) : (
                      <Upload size={16} />
                    )}
                    开始导出
                  </button>
                )}
                {busy && progress < 0.86 && (
                  <button
                    className="wide-button"
                    onClick={() => {
                      cancel.current = true;
                    }}
                  >
                    取消
                  </button>
                )}
                <p className="hint">
                  棋盘格和画布边框不会导出。普通播放器可能将透明区域显示为黑色。
                </p>
              </>
            )}
            {modal === "help" && (
              <>
                <h1>小剧场工作流</h1>
                <ol>
                  <li>
                    在模型库创建容器；复制实例会产生独立的动作与参数控制器。
                  </li>
                  <li>
                    导入图像、音频、字体，或添加文本、色块、后处理层和图层组。拖动图层列表排序，属性中可设置父组。
                  </li>
                  <li>
                    画布滚轮缩放，中键平移。拖动图层和角点构图；画框外仍是可编辑空间，导出仅保留画框内。
                  </li>
                  <li>
                    启用 3D 图层后设置 Z 与 X/Y
                    旋转；相机里设置焦平面和景深，产生平面透视与失焦。
                  </li>
                  <li>
                    动作轨道通过片段目标绑定模型；参数遮罩仅影响当前动作。音频可试听，导入时不强制分析口型，按需生成后绑定模型。
                  </li>
                  <li>
                    文本支持打字机和片段渐入渐出。后处理层只影响同组下方图层，可制作独立效果区间。
                  </li>
                  <li>
                    数字字段旁的菱形记录关键帧；曲线编辑器支持贝塞尔手柄、阶跃、数值和时间编辑。模型参数、变换、相机、效果和音量共用关键帧系统。
                  </li>
                  <li>
                    时间线支持多选、移动、裁切、复制、分割、波纹删除、标记和工作区循环。轨道名称与内容类型独立。
                  </li>
                  <li>
                    保存 .livemg
                    打包所有模型、媒体、导入字体与控制器；资源清单带 SHA-256
                    校验。旧 .l2dstudio 可迁移打开。
                  </li>
                </ol>
                <p className="hint">
                  景深使用 3D
                  平面透视与深度相关模糊；不支持三维网格、真实法线光照或体积阴影。系统字体未导入时仍依赖目标电脑字体。
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
