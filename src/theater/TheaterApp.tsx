import React, {
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ProjectCanvases } from "./ProjectCanvases";
import { MontageWorkspace } from "./MontageWorkspace";
import { MontageRenderer } from "./montage-renderer";
import { editMontage, emptyMontage, isMontage, loadMontage, montageAudio, montageEnd,
  withMontageCanvas, type Montage } from "./montage";
import { AgentCursor, agentCanvasActivity, type AgentFocus } from "./AgentCursor";
import { SceneJsonEditor } from "./SceneJsonEditor";
import { defaultShape, shapeSvg, validateShape } from "./shape";
import { textAnimationFile, applyTextAnimation } from "./appearance-preset";
import { emptyGraph,graphOrder, validateEffectGraph } from "./effect-graph";
import { freeze, produce } from "immer";
import { createPortal } from "react-dom";
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
  ClipboardPaste,
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
  Clapperboard,
  FilePlus2,
  ArrowUpRight,
  Minus,
  SquareDashed,
  Square,
  Code2,
  Activity,
} from "lucide-react";
import { api, download, media, token } from "../api";
import { McpControls, shaderTargets, useShaderAgent, type ShaderDraft } from "./CodeShaderPanel";
import { validateCodeShader, type CodeShader } from "../../backend/shader-format.mjs";
import { appendShader, currentPostGraph, editAgentGraph, postRevision, writePostGraph } from "./agent-graph";
import { AgentPanel } from "./AgentPanel";
import { editDesignScene, numberArgument, objectArgument } from "./agent-edit";
import { inspectDesignScene, type DesignDraft } from "./agent-inspect";
import { graphInstructions } from "../../backend/graph-tools.mjs";
import designSkill from "../../backend/skills/framestudio-design/SKILL.md?raw";
import layoutSkill from "../../backend/skills/framestudio-design/references/layout.md?raw";
import timelineSkill from "../../backend/skills/framestudio-design/references/timeline.md?raw";
import {
  Asset,
  Group,
  Key,
  ModelEntry,
  Param,
  groupNames,
  uid,
} from "../types";
import { clamp, classify, parseAsset, parseCatalogAsset, parseLegacy } from "../engine";
import { cubism2, isCubism2File, lipParameters } from "../cubism2";
import { CurveWorkspace, type AgentCurveSelection } from "./CurveWorkspace";
import { LightPanel } from "./LightPanel";
import { ModelPreprocessPanel } from "./ModelPreprocessPanel";
import { ModelWorkbench, type ModelWorkbenchTab } from "./ModelWorkbench";
import { ModelPoseControls, modelControls, modelPoseStore, type PoseInput } from "./ModelPoseControls";
import { applyTextureCopy,checkedStrokes,drawTextureStroke,editMotion,loadTextureCanvas,newMotion,saveMotion,saveTexture,textureCatalog,textureUrl } from "./model-edit";
import { ShaderControls } from "./ShaderControls";
import { EffectGraphControls } from "./EffectGraphControls";
import { AppearancePresetControls } from "./AppearancePresetControls";
import { appearanceCurves, lightAppearance, setAppearanceCurves, textAppearance } from "./appearance-preset";
import type { EffectGraph } from "./effect-graph";
import { defaultTitleAmount, defaultTitleDuration, isTitleMotion, titleMotions, type TextAnimation, type TitleMotion } from "./text-motion";
import { preprocessingScene } from "./preprocess";
import { lightAffects, receivesLight, worldLights } from "./lighting";
import { SceneTimeline, formatTimecode } from "./SceneTimeline";
import {
  Binding,
  readProperty,
  writeProperty,
  propertiesOf,
  clipById,
  parameterDriven,
} from "./properties";
import { effectParameter } from "./properties";
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
import { normalizePreferences, type Preferences } from "./AppearanceMenu";
import { StudioSettings, type SettingsPage } from "./StudioSettings";
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
  type ModelControl,
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
  copyLayerTrees,
  pasteLayerTrees,
  type LayerClipboard,
  enabledTracks,
  previewFrameTime,
  layerAlpha,
  modelValues,
  modelProject,
  projectPoint,
  reparentSafe,
  splitSceneClip,
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
function agentHandle(channel:string) {
  if (["x","y","z"].includes(channel)) return "move-"+channel;
  if (channel==="scaleX" || channel==="scaleY") return "scale-"+channel.slice(-1).toLowerCase();
  if (channel==="rotation") return "rotate-z";
  if (channel==="rotationX" || channel==="rotationY") return "rotate-"+channel.slice(-1).toLowerCase();
}

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
const noWorkbenchParams: Param[]=[];
const ShaderGraphEditor = React.lazy(() => import("./EffectNodeEditor"));
export default function TheaterApp() {
  const [shaderDraft, setShaderDraft] = useState<ShaderDraft>();
  const [montage,setMontage]=useState<Montage>();
  const montageRef=useRef<Montage>(undefined);
  const [montageDraft,setMontageDraft]=useState<{base?:Montage;sceneBase:Scene;value:Montage;name:string;revision:number;target?:string;targetCanvasId?:string}>();
  const montageDraftRef=useRef<typeof montageDraft>(undefined);
  const appliedDraft=useRef<{kind:"scene";draft:DesignDraft;after:Scene}|
    {kind:"montage";draft:NonNullable<typeof montageDraft>;after:Montage;activeAfter:Scene;before?:Montage}>(undefined);
  const [workbenchTab,setWorkbenchTab]=useState<ModelWorkbenchTab>("look");
  const [textureBoard,setTextureBoard]=useState<HTMLDivElement|null>(null);
  const [motionDock,setMotionDock]=useState<HTMLDivElement|null>(null);
  const [modelDockHeight,setModelDockHeight]=useState(330);
  const [selectedControl,setSelectedControl]=useState("");
  const [sceneControls,setSceneControls]=useState(false);
  const poseStore=useMemo(modelPoseStore,[]);
  const poseActor=useRef("");
  const motionPose=useRef<PoseInput|undefined>(undefined);
  const workbenchEdits=useRef({motion:false,texture:false});
  const setMotionDirty=useCallback((dirty:boolean)=>{workbenchEdits.current.motion=dirty;},[]);
  const setTextureDirty=useCallback((dirty:boolean)=>{workbenchEdits.current.texture=dirty;},[]);
  function allowWorkbenchExit() {
    const {motion,texture}=workbenchEdits.current;
    return (!motion && !texture) || confirm("模型工作台有未保存的动作或贴图。离开会丢弃这些改动，继续吗？");
  }
  function returnFromWorkbench() {
    if(allowWorkbenchExit())setWorkspaceMode("scene");
  }
  const attachMotionPose=useCallback((input?:PoseInput)=>{motionPose.current=input;},[]);
  const [settingsTab,setSettingsTab]=useState<SettingsPage>("appearance");
  const [settingsHost,setSettingsHost]=useState<HTMLElement|null>(null);
  const [montageMode,setMontageMode]=useState(false);
  const [montageTime,setMontageTime]=useState(0);
  const montageClock=useRef(0);
  const sceneSaveQueue=useRef(Promise.resolve());
  const [montagePlaying,setMontagePlaying]=useState(false);
  const [montageSelection,setMontageSelection]=useState("");
  const [exportScope,setExportScope]=useState<"canvas"|"montage">("canvas");
  const montageRenderer=useRef<MontageRenderer>(undefined);
  const montageInput=useRef<HTMLInputElement>(null);
  type MontageChange={before:Montage;after:Montage};
  const montageHistory=useRef<{past:MontageChange[];future:MontageChange[]}>({past:[],future:[]});
  const canvasHistory=useRef(new Map<string,{past:Scene[];future:Scene[];time:number;selected:string}>());
  const [designDraft, setDesignDraft] = useState<DesignDraft>();
  const designRef = useRef<DesignDraft | undefined>(undefined);
  const designRevision = useRef(0);
  const [graphLocation, setGraphLocation] = useState<{target:string;canvasId?:string}>();
  const graphTarget=graphLocation?.target;
  function setGraphTarget(target?:string,canvasId?:string) {
    setGraphLocation(target ? {target,canvasId} : undefined);
  }
  const agentActivity = useMemo(agentCanvasActivity, []);
  const agentViewport = useRef<HTMLDivElement>(null);
  const [jsonEdit, setJsonEdit] = useState<"shape"|"text">();
  const selectedLibraryAudio = useRef<string>(undefined);
  const curveSelection = useRef<AgentCurveSelection>(undefined);
  const focusedControl = useRef<{layerId:string; binding?:Binding; label:string; value:string|boolean}>(undefined);

  const shaderDraftRef = useRef<ShaderDraft | undefined>(undefined);
  const shaderDocument = useRef(crypto.randomUUID());
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
    [sceneList, setSceneList] = useState<"layers" | "tree">("layers"),
    [foldedGroups, setFoldedGroups] = useState<Record<string, boolean>>({}),
    [gizmoTool, setGizmoTool] = useState<GizmoTool>("move"),
    [preferences, setPreferences] = useState(() => normalizePreferences()),
    [preferencesReady, setPreferencesReady] = useState(false),
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

    [paramSearch, setParamSearch] = useState(""),
    [paramPage, setParamPage] = useState(0),
    [modal, setModal] = useState<"" | "canvas" | "export" | "help" | "settings">(""),
    [exportFormat, setExportFormat] = useState("mp4"),
    [exportStatus, setExportStatus] = useState(""),
    [progress, setProgress] = useState(0),
    [exportResult, setExportResult] = useState<any>(null),
    [onlyWork, setOnlyWork] = useState(false),
    [previewId, setPreviewId] = useState(""),
    [motionPreviewId, setMotionPreviewId] = useState(""),
    [motionTargetId, setMotionTargetId] = useState(""),
    [timelineHeight, setTimelineHeight] = useState(316),
    [exportMatte, setExportMatte] = useState("#ffffff"),
    [historyVersion, setHistoryVersion] = useState(0),
    [modelVersion, setModelVersion] = useState(0),
    [dirty, setDirty] = useState(false),
    [workspaceMode, setWorkspaceMode] = useState<"scene" | "preprocess">(
      "scene",
    ),
    [preprocessId, setPreprocessId] = useState(""),
    [preprocessOriginal, setPreprocessOriginal] = useState(false);
  const overlay = useMemo(viewportStore, []),
    mirrorOverlay = useMemo(viewportStore, []);
  const preferenceWrite = useRef(Promise.resolve());
  const { appearance, accent,previewQuality:quality } = preferences;
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
    clipboard = useRef<
      | { kind: "objects"; snapshot: LayerClipboard }
      | { kind: "clips"; sceneId: string; clips: SceneClip[] }
      | null
    >(null),
    motionPreviewRef = useRef<AuditionState | undefined>(undefined),
    auditionLast = useRef(0);
  sRef.current = scene;
  playRef.current = playing;
  busyRef.current = busy;
  liveRef.current = curveOpen || inspectorOpen || expandedView;
  const montageCommitted=useMemo(()=>montage && withMontageCanvas(montage,montage.activeCanvasId,scene),[montage,scene]);
  const visibleMontageDraft=montageDraft?.base===montage && montageDraft?.sceneBase===scene ? montageDraft : undefined;
  const montagePreview=visibleMontageDraft?.value ?? montageCommitted;
  const activePreview=visibleMontageDraft?.value.canvases.find(c=>c.id===montage?.activeCanvasId)?.scene;
  const visibleDesign = designDraft?.base === scene ? designDraft.scene : activePreview!==scene ? activePreview : undefined;
  const inspection = visibleDesign ?? scene;
  const selectedLayer = inspection.layers.find((l) => l.id === selected),
    selectedClip = inspection.tracks
      .flatMap((t) => t.clips)
      .find((c) => selection.includes(c.id) && c.layerId === selected),
    selectedMedia = inspection.assets.find((a) => a.id === selectedClip?.assetId),
    resource = selectedLayer?.model
      ? inspection.models.find((m) => m.id === selectedLayer.model!.resourceId)
      : undefined,
    runtime = selectedLayer
      ? rRef.current?.nodes.get(selectedLayer.id)?.runtime
      : undefined,
    params = runtime?.params || [],
    values =
      selectedLayer?.model && workspaceMode === "scene"
        ? modelValues(inspection, selectedLayer, params, time)
        : {},
    animated = selectedLayer
      ? animatedLayer(inspection, selectedLayer, time)
      : undefined,
    camera = animatedCamera(inspection, time);
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
    inspection.models.find((r) => r.id === preprocessId) ||
    resource ||
    inspection.models[0];
  const modelWorkspace=workspaceMode==="preprocess";
  const motionWorkspace=modelWorkspace && workbenchTab==="motion";
  const textureWorkspace=modelWorkspace && workbenchTab==="texture";
  const previewModelId=preprocessingResource ? "@preprocess:"+preprocessingResource.id : "";
  const previewModelParams=rRef.current?.nodes.get(previewModelId)?.runtime?.params ?? noWorkbenchParams;
  const workbenchControls=useMemo(()=>modelControls(preprocessingResource?.controls),[preprocessingResource?.controls]);
  const instanceControls=useMemo(()=>modelControls(resource?.controls),[resource?.controls]);
  const poseActorId=modelWorkspace
    ? ((workbenchTab==="rig"||motionWorkspace) && workbenchControls.length ? previewModelId : "")
    : (sceneControls && selectedLayer?.model && instanceControls.length && !visibleDesign ? selectedLayer.id : "");
  poseActor.current=poseActorId;
  useEffect(()=>{poseStore.publish();rRef.current?.invalidate();},[poseActorId,poseStore]);
  const poseWorkbench=useCallback((values:Record<string,number>)=>{
    const r=rRef.current?.nodes.get(previewModelId)?.runtime;
    if(r){r.previewOverrides=values;r.invalidate();rRef.current?.invalidate();}
  },[previewModelId]);
  function saveModelControls(controls:ModelControl[]) {
    if (!preprocessingResource) return;
    change(s=>{
      const model=s.models.find(r=>r.id===preprocessingResource.id);
      if(model)model.controls=controls;
    });
  }
  function instancePose():PoseInput|undefined {
    if(!selectedLayer?.model || selectedLayer.locked || !runtime || draftLocked())return;
    const id=selectedLayer.id,at=tRef.current;
    playRef.current=false;setPlaying(false);stopMotionPreview();
    const preview=(next:Record<string,number>)=>{
      runtime.previewOverrides=next;runtime.invalidate();rRef.current?.invalidate();
    };
    return {values,preview,commit:next=>{
      preview({});
      const first=Object.keys(next)[0];
      if(!first)return;
      setChannel("param:"+first);
      if(curveOpen)setCurveSeed({layerId:id,channel:"param:"+first});
      lastEdit.current=0;
      change(s=>{
        for(const [param,value] of Object.entries(next)) {
          const binding={layerId:id,channel:"param:"+param};
          const data=readProperty(s,binding,at),keys=cloneData(data.keys);
          const local=Math.max(0,(at-data.offset)*data.speed);
          if(!keys.length && local>1/s.fps)keys.push({t:0,v:values[param]??data.base,mode:"bezier"});
          upsertKey(keys,local,value,s.fps);
          writeProperty(s,binding,keys);
        }
      });
    }};
  }
  const displayScene = useMemo(
    () =>
      workspaceMode === "preprocess"
        ? freeze(
            preprocessingScene(visibleDesign ?? scene, preprocessingResource?.id || "", preprocessOriginal),
            true,
          )
        : visibleDesign ?? scene,
    [scene, visibleDesign, workspaceMode, preprocessingResource?.id, preprocessOriginal],
  );
  displayRef.current = displayScene;
  modeRef.current = workspaceMode;
  const currentBinding: Binding = {
    layerId: selected,
    channel,
    clipId: selectedClip?.id,
  };
  function getMontageRenderer() {
    return montageRenderer.current ??= new MontageRenderer(rRef.current!,()=>sRef.current);
  }
  function updateMontage(p?:Montage) {
    montageRef.current=p;
    setMontage(p);
  }
  function currentMontage() {
    const p=montageRef.current;
    return p && withMontageCanvas(p,p.activeCanvasId,sRef.current);
  }
  function discardMontageDraft(keepView=false) {
    montageDraftRef.current=undefined;setMontageDraft(undefined);rRef.current?.invalidate();
    if(!montageRef.current && !keepView) setMontageMode(false);
  }
  function activeMontage() {
    const draft=montageDraftRef.current;
    if(draft && (draft.base!==montageRef.current || draft.sceneBase!==sRef.current)) throw Error("工程已变更，请重新读取总时间线");
    return draft?.value ?? currentMontage();
  }
  function seekMontage(at:number) {
    const p=montageDraftRef.current?.value ?? currentMontage();
    const next=Math.max(0,Math.min(p ? montageEnd(p) : 0,at));
    montageClock.current=next;setMontageTime(next);
  }
  function playMontage(value:boolean) {
    if(!value) seekMontage(montageClock.current);
    setMontagePlaying(value);
  }
  function showMontage() {
    if(!ready || busy || (modeRef.current==="preprocess" && !allowWorkbenchExit())) return;
    if(designRef.current || shaderDraftRef.current) {notify("请先应用或丢弃当前 Agent / 着色器草稿");return;}
    setContextMenu(undefined);
    setGraphTarget(undefined);
    setPlaying(false);playRef.current=false;stopMotionPreview();syncRef.current();
    setMontageMode(true);
  }
  function showCanvas() {
    if (modeRef.current==="preprocess" && !allowWorkbenchExit()) return;
    if (montageMode) playMontage(false);
    setMontageMode(false);
    setWorkspaceMode("scene");
    setGraphTarget(undefined);
  }
  async function openMontageCanvas(id:string,p=currentMontage()) {
    if(!p || !p.canvases.some(c=>c.id===id)) return;
    const current=p.activeCanvasId;
    if (id===current) { showCanvas(); return; }
    canvasHistory.current.set(current,{past:history.current,future:future.current,time:tRef.current,selected});
    const stacks=canvasHistory.current.get(id);
    history.current=stacks?.past??[];future.current=stacks?.future??[];
    updateMontage({...p,activeCanvasId:id});
    playMontage(false);setMontageMode(false);
    const source=p.canvases.find(c=>c.id===id)!.scene;
    await loadScene(source,true);
    if(stacks) {
      seek(stacks.time);
      if(stacks.selected==="@camera" || source.layers.some(l=>l.id===stacks.selected)) selectLayer(stacks.selected);
    }
  }
  function applyMontage(p:Montage,record=true) {
    const previous=currentMontage();
    if(previous===p) return;
    if(record && previous) {
      montageHistory.current.past.push({before:previous,after:p});
      if(montageHistory.current.past.length>60) montageHistory.current.past.shift();
      montageHistory.current.future=[];
    }
    updateMontage(p);setDirty(true);
    const source=p.canvases.find(c=>c.id===p.activeCanvasId)!;
    if((previous && previous.activeCanvasId!==p.activeCanvasId) || source.scene.id!==sRef.current.id) {
      if(previous) canvasHistory.current.set(previous.activeCanvasId,{past:history.current,future:future.current,time:tRef.current,selected});
      const stacks=canvasHistory.current.get(p.activeCanvasId);
      history.current=stacks?.past??[];future.current=stacks?.future??[];
      void loadScene(source.scene,true);
    } else if(source.scene!==sRef.current) change(source.scene,record);
    seekMontage(montageClock.current);
  }
  function editMontageUI(edits:unknown) {
    try {
      if(draftLocked()) throw Error("请先应用或丢弃当前草稿");
      const p=currentMontage();
      if(!p) throw Error("请先打开总时间线");
      const next=editMontage(p,edits).montage;
      if(next.outputGraph && next.outputGraph!==p.outputGraph) rRef.current?.probePostGraph(next.outputGraph);
      applyMontage(next);
      if (next.clips.length>p.clips.length) setMontageSelection(next.clips.at(-1)!.id);
      else if (montageSelection && !next.clips.some(clip=>clip.id===montageSelection)) setMontageSelection("");
    } catch(error) {notify(error instanceof Error ? error.message : String(error));}
  }
  function stepMontageHistory(redo:boolean) {
    if(!redo && restoreMontageDraft()) return;
    const {past,future}=montageHistory.current,p=currentMontage();
    const from=redo ? future : past, to=redo ? past : future;
    if(!p || !from.length || montageDraftRef.current) return;
    const entry=from.pop()!;
    to.push(entry);
    const target=redo ? entry.after : entry.before, source=redo ? entry.before : entry.after;
    const merged=target.canvases.reduce((next,c)=>{
      const current=p.canvases.find(x=>x.id===c.id), old=source.canvases.find(x=>x.id===c.id);
      return current && current.scene!==old?.scene ? withMontageCanvas(next,c.id,current.scene) : next;
    },target);
    applyMontage({...merged,activeCanvasId:merged.canvases.some(c=>c.id===p.activeCanvasId) ? p.activeCanvasId : merged.activeCanvasId},false);
  }
  function previewMontage(p:Montage,name:string,target?:string,show=false,targetCanvasId?:string) {
    if(busyRef.current || !ready) throw Error("编辑器正在加载或导出");
    const previous=activeMontage();
    if(p.outputGraph && p.outputGraph!==previous?.outputGraph) rRef.current?.probePostGraph(p.outputGraph);
    const draft={base:montageRef.current,sceneBase:sRef.current,value:p,name,
      revision:++designRevision.current,target:target??montageDraftRef.current?.target,
      targetCanvasId:target ? targetCanvasId : montageDraftRef.current?.targetCanvasId};
    montageDraftRef.current=draft;setMontageDraft(draft);
    if(show) {
      setPlaying(false);playRef.current=false;stopMotionPreview();syncRef.current();
      setMontageMode(true);
    }
    rRef.current?.invalidate();
    return {status:"ready",revision:draft.revision};
  }
  function commitMontageDraft() {
    const draft=montageDraftRef.current;
    if(!draft || busyRef.current) return;
    const after=activeMontage()!,before=currentMontage();
    discardMontageDraft(true);applyMontage(after);
    appliedDraft.current={kind:"montage",draft,after,activeAfter:sRef.current,before};
  }
  function restoreMontageDraft() {
    const entry=appliedDraft.current;
    if(entry?.kind!=="montage" || montageDraftRef.current || montageRef.current!==entry.after || sRef.current!==entry.activeAfter) return false;
    appliedDraft.current=undefined;
    const last=montageHistory.current.past.at(-1);
    if(last?.after===entry.after) montageHistory.current.past.pop();
    if(entry.before) applyMontage(entry.before,false);
    else {
      updateMontage(undefined);
      if(sRef.current!==entry.draft.sceneBase) change(entry.draft.sceneBase,false);
    }
    const draft={...entry.draft,base:montageRef.current,sceneBase:sRef.current,revision:++designRevision.current};
    montageDraftRef.current=draft;setMontageDraft(draft);setMontageMode(true);
    return true;
  }
  function showSettings(tab:SettingsPage="appearance") {
    setPlaying(false);playRef.current=false;playMontage(false);stopMotionPreview();
    setGraphTarget(undefined);setSettingsTab(tab);setModal("settings");
  }
  function resetMontage() {
    discardMontageDraft();updateMontage(undefined);setMontagePlaying(false);setMontageMode(false);
    montageClock.current=0;setMontageTime(0);setMontageSelection("");montageHistory.current={past:[],future:[]};canvasHistory.current.clear();
  }
  async function importMontageCanvas(file:File) {
    setBusy("读取画布素材…");
    try {
      const p=currentMontage();
      if(!p || draftLocked()) throw Error("请先打开总时间线并确认当前草稿");
      if(p.canvases.length>=120) throw Error("画布已达上限");
      const input=await api<Scene|Montage>("project-open?format=livemg",file);
      if(isMontage(input)) throw Error("请先在该总工程中另存需要的独立画布");
      const scene=freeze(migrateScene(input),true),id=crypto.randomUUID();
      const current=currentMontage();
      if (!current || draftLocked()) throw Error("工程已变更，请重新导入");
      applyMontage({...current,canvases:[...current.canvases,{id,scene}]});
      notify("已导入「"+scene.name+"」。可在项目中将它加入总时间线。");
    } catch(error) {notify(error instanceof Error ? error.message : String(error));}
    finally {setBusy("");}
  }
  useEffect(()=>{
    if(montageDraft && !visibleMontageDraft) {discardMontageDraft();notify("已撤下过期的总时间线草稿");}
  },[montageDraft,visibleMontageDraft]);
  useEffect(()=>{
    if(montageMode) return;
    montageRenderer.current?.close();
    montageRenderer.current=undefined;
  },[montageMode]);
  useEffect(()=>()=>montageRenderer.current?.close(),[]);
  function notify(s: string) {
    setToast(s);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4200);
  }
  function checkedModelName(value:unknown) {
    if(typeof value!=="string" || !value.trim() || value.trim().length>150) throw Error("模型名称需为 1–150 个字符");
    return value.trim();
  }
  function storePresetMotion(scene:Scene,resourceId:string,asset:Asset) {
    const model=scene.models.find(m=>m.id===resourceId);
    if(!model) throw Error("找不到模型素材");
    const index=model.assets.findIndex(a=>a.id===asset.id);
    if(index<0)model.assets.push(asset);else model.assets[index]=asset;
    const owners=new Set(scene.layers.filter(l=>l.model?.resourceId===resourceId).map(l=>l.id));
    for(const track of scene.tracks) for(const c of track.clips)
      if(c.kind==="motion" && c.assetId===asset.id && owners.has(c.layerId)) c.name=asset.name;
  }
  function updatePreferences(next: Preferences) {
    setPreferences(next);
    preferenceWrite.current = preferenceWrite.current
      .then(() => api("preferences", next))
      .catch(() => notify("外观设置未保存"));
  }
  function draftLocked(ignoreShader=false) {
    return !!(designRef.current || montageDraftRef.current || (!ignoreShader && rRef.current?.shaderPreview));
  }
  function change(mut: Scene | ((s: Scene) => void), record=true,applyShader=false) {
    if(draftLocked(applyShader)){notify("确认草稿后即可编辑");return;}
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
  function clearShaderPreview(graph?: EffectGraph) {
    const r = rRef.current;
    if (graph && r?.shaderPreview?.graph !== graph) return;
    if (r?.shaderPreview) {
      r.shaderPreview = undefined;
      r.invalidate();
    }
    shaderDraftRef.current = undefined;
    setShaderDraft(undefined);
  }
  function requireShaderTarget(target: string) {
    if (!shaderTargets(sRef.current).some(t => t.id === target && t.available))
      throw Error("目标图层已锁定或不存在");
  }
  function previewPostGraph(target: string, graph: EffectGraph) {
    const p = sRef.current, r = rRef.current;
    if (!r || busyRef.current) throw Error("画布正在加载或导出");
    requireShaderTarget(target);
    r.probePostGraph(graph);
    stopMotionPreview();
    if (modeRef.current === "preprocess") setWorkspaceMode("scene");
    if (target === "output" && r.orbitEnabled && (!mirrorHost.current || mirror.current.spatial))
      toggleSpatial(false);
    r.shaderPreview = { sceneId: p.id, target, graph };
    r.invalidate();
    return graph;
  }
  function savePostGraph(target: string, graph: EffectGraph, separateUndo = false) {
    if (busyRef.current) throw Error("画布正在加载或导出");
    requireShaderTarget(target);
    const before=sRef.current;
    if (separateUndo) lastEdit.current = 0;
    if(draftLocked(separateUndo)) throw Error("确认当前草稿后即可编辑节点");
    change(s => writePostGraph(s,target,graph),true,separateUndo);
    if(separateUndo) appliedDraft.current={kind:"scene",after:sRef.current,draft:{
      base:before,scene:sRef.current,name:graph.name,target,revision:++designRevision.current,
    }};
    if (rRef.current?.shaderPreview?.target === target) clearShaderPreview();
  }
  function localGraphDraft(target: string, graph: EffectGraph, name: string) {
    previewPostGraph(target,graph);
    const draft = {target,graph,name,revision:postRevision(sRef.current,target)};
    shaderDraftRef.current = draft;
    setShaderDraft(draft);
    return draft;
  }
  function applyLocalGraphDraft() {
    const draft = shaderDraftRef.current;
    if (!draft) return;
    if (draft.revision !== postRevision(sRef.current,draft.target) || rRef.current?.shaderPreview?.graph !== draft.graph)
      throw Error("节点图已变更，请重新试渲染");
    savePostGraph(draft.target,draft.graph,true);
  }
  function readPostGraph(target: string) {
    requireShaderTarget(target);
    return {graph:currentPostGraph(sRef.current,target),revision:postRevision(sRef.current,target)};
  }
  function shaderContext() {
    const p = sRef.current;
    return {document:shaderDocument.current,width:p.width,height:p.height,time:tRef.current,
      busy:!!busyRef.current || !ready || !!designRef.current || !!montageDraftRef.current,
      targets:shaderTargets(p), selected};
  }
  function clearDesignDraft() {
    designRef.current = undefined;
    setDesignDraft(undefined);
    if (rRef.current) rRef.current.invalidate();
  }
  function activeDesignScene(canvasId?:string) {
    const master=activeMontage();
    if(master) {
      const target=master.canvases.find(c=>c.id===(canvasId??master.activeCanvasId));
      if(!target) throw Error("找不到总时间线中的画布");
      return target.scene;
    }
    if(canvasId) throw Error("当前工程只有一张画布");
    const draft = designRef.current;
    if (draft && draft.base !== sRef.current) throw Error("工程已被手动编辑，请丢弃过期草稿后重试");
    return draft?.scene ?? sRef.current;
  }
  function previewDesign(next: Scene, label: string, target?: string,canvasId?:string) {
    if (busyRef.current || !ready) throw Error("编辑器正在加载或导出");
    const previous = activeDesignScene(canvasId), r = rRef.current!;
    if (next === previous) return {status:"unchanged",revision:montageDraftRef.current?.revision ?? designRef.current?.revision ?? 0};
    const graphs = new Set<EffectGraph>();
    if (next.outputGraph !== previous.outputGraph && next.outputGraph) graphs.add(next.outputGraph);
    for (const l of next.layers) {
      const graph = l.effects.graph;
      if (graph && previous.layers.find(p=>p.id===l.id)?.effects.graph !== graph) graphs.add(graph);
    }
    for (const m of next.models) {
      const graph = m.preprocess?.effects.graph;
      if (graph && previous.models.find(p=>p.id===m.id)?.preprocess?.effects.graph !== graph) graphs.add(graph);
    }
    for (const graph of graphs) r.probePostGraph(graph);
    const master=activeMontage();
    if(master) {
      const id=canvasId??master.activeCanvasId;
      if(id===master.activeCanvasId && !montageMode) {
        displayRef.current=next;
        stopMotionPreview();
        if (target==="output" && r.orbitEnabled) toggleSpatial(false);
      }
      return previewMontage(withMontageCanvas(master,id,next),label,target,false,id);
    }
    stopMotionPreview();
    if (r.shaderPreview) clearShaderPreview();
    setWorkspaceMode("scene");
    if (target?.startsWith("@preprocess:")) {
      openPreprocess(target.slice(12));
      setPreprocessOriginal(false);
    }
    if (target==="output" && r.orbitEnabled && (!mirrorHost.current || mirror.current.spatial)) toggleSpatial(false);
    const draft = {name:label,base:sRef.current,scene:next,revision:++designRevision.current,target:target ?? designRef.current?.target};
    designRef.current = draft;
    setDesignDraft(draft);
    displayRef.current = next;
    if (tRef.current > next.duration) seek(next.duration);
    r.invalidate();
    return {status:"ready",revision:draft.revision};
  }
  function applyDesignDraft() {
    const draft=designRef.current,next=activeDesignScene();
    if (!draft || next === sRef.current) return;
    if (busyRef.current) throw Error("画布正在加载或导出");
    clearDesignDraft();
    lastEdit.current=0;
    change(next);
    appliedDraft.current={kind:"scene",draft,after:sRef.current};
    if (selected !== "@camera" && !next.layers.some(l=>l.id===selected)) selectLayer("");
  }
  useEffect(() => {
    if (designDraft && designDraft.base !== scene) {
      clearDesignDraft();
      notify("已撤下过期的 Agent 草稿");
    }
  }, [scene, designDraft]);
  async function runAgentTool(name: string, value: unknown, canShare: boolean, signal: AbortSignal) {
    const args=objectArgument(value);
    if (name==="editor_skill") {
      const skills={design:designSkill,layout:layoutSkill,timeline:timelineSkill,effects:graphInstructions+
        "\nUse editor_edit {op:'graph',scope:'post'|'text'|'preprocess',id,resourceId,edits}. Text graphs use $identity, number nodes enter/exit/wave/ease, transform(progress,x,y,scale,opacity,angle), and combine(a,b). Read graph first; scopes post and preprocess are image graphs."};
      if (typeof args.name!=="string" || !Object.hasOwn(skills,args.name)) throw Error("找不到对应设计技能");
      return {skill:args.name,instructions:skills[args.name as keyof typeof skills]};
    }
    if(name.startsWith("montage_")) {
      const current=activeMontage();
      if(name==="montage_inspect") {
        if(!current) return {active:false,currentCanvas:{name:sRef.current.name,duration:sRef.current.duration}};
        const offset=typeof args.offset==="number" ? Math.max(0,Math.floor(args.offset)) : 0;
        return {active:true,id:current.id,name:current.name,width:current.width,height:current.height,fps:current.fps,
          duration:montageEnd(current),time:montageClock.current,selectedClip:montageSelection,activeCanvasId:current.activeCanvasId,
          canvasCount:current.canvases.length,clipCount:current.clips.length,outputGraph:args.graph===true ? current.outputGraph : current.outputGraph?.name,
          canvases:current.canvases.slice(offset,offset+24).map(({id,scene})=>({id,name:scene.name,duration:scene.duration,width:scene.width,height:scene.height,fps:scene.fps})),
          clips:current.clips.slice(offset,offset+48)};
      }
      if(name==="montage_edit") {
        const base=current ?? emptyMontage(activeDesignScene());
        let output=base.outputGraph??currentPostGraph(emptyScene(),"output");
        const edits=Array.isArray(args.edits) ? args.edits.map(input=>{
          const e={...objectArgument(input)};
          if(e.id==="selected") e.id=montageSelection;
          if(e.op==="graph_nodes") {
            output=editAgentGraph(output,e.edits);
            return {op:"graph",graph:output};
          }
          if(e.op==="shader") {
            output=appendShader(output,validateCodeShader(e.shader));return {op:"graph",graph:output};
          }
          if(e.op==="graph") output=e.graph===null ? currentPostGraph(emptyScene(),"output") : validateEffectGraph(e.graph);
          return e;
        }) : args.edits;
        const {montage:value,created}=editMontage(base,edits);
        const state=previewMontage(value,typeof args.label==="string" ? args.label.slice(0,80) : "编排总时间线",
          value.outputGraph!==base.outputGraph ? "@master" : undefined,true);
        if(!current && designRef.current) clearDesignDraft();
        return {...state,created,activeCanvasId:value.activeCanvasId,duration:montageEnd(value)};
      }
      if(!current) throw Error("请先创建总时间线");
      if(name==="montage_view") {
        if(args.action==="open_canvas") {
          if(montageDraftRef.current) throw Error("可用 canvasId 直接编辑草稿中的画布。应用草稿后即可切换工作区。");
          if(typeof args.canvasId!=="string" || !current.canvases.some(c=>c.id===args.canvasId)) throw Error("找不到画布");
          await openMontageCanvas(args.canvasId);
        } else {
          setPlaying(false);playRef.current=false;setMontageMode(true);
          if(args.action==="seek") {const at=numberArgument(args.time,0,montageEnd(current),"总播放头");playMontage(false);seekMontage(at);}
          else if(args.action==="play") {if(montageClock.current>=montageEnd(current)) seekMontage(0);playMontage(true);}
          else if(args.action==="pause") playMontage(false);
          else if(args.action!=="show") throw Error("未知总时间线视图操作");
        }
        return {status:"ready"};
      }
      if(name==="montage_render") {
        const end=montageEnd(current),time=args.time===undefined ? montageClock.current : numberArgument(args.time,0,end,"总预览时间");
        const preview=document.createElement("canvas");
        await getMontageRenderer().render(current,previewFrameTime(end,current.fps,time),{maxEdge:360,preview});
        signal.throwIfAborted();
        const image=preview.toDataURL("image/jpeg",.78);
        return {status:"ready",time,width:current.width,height:current.height,
          artifact:{name:"总成片预览.jpg",mime:"image/jpeg",preview:image},...(canShare ? {previewImage:image} : {})};
      }
      throw Error("未知总时间线工具");
    }
    const master=activeMontage(), canvasId=typeof args.canvasId==="string" ? args.canvasId : master?.activeCanvasId;
    const local=!master || canvasId===master.activeCanvasId;
    const p=activeDesignScene(canvasId), r=rRef.current;
    const targetSelected=local ? selected : "";
    const wantsModelParams=(!local || montageMode) && (args.section==="model_params" || args.section==="property" ||
      (name==="editor_edit" && Array.isArray(args.edits) && args.edits.some(e=>typeof e?.channel==="string" && e.channel.startsWith("param:"))));
    const catalog=wantsModelParams ? await getMontageRenderer().parameters(p) : undefined;
    signal.throwIfAborted();
    const params=(id:string)=>catalog?.get(id) ?? (local ? r?.nodes.get(id)?.runtime?.params ?? [] : []);
    const head=Math.min(local ? tRef.current : 0,p.duration), revision=montageDraftRef.current?.revision ?? designRef.current?.revision ?? 0;
    const focused=local && focusedControl.current?.layerId===selected ? focusedControl.current : undefined;
    const curve=local && curveOpen ? curveSelection.current : undefined;
    const contextBinding=curve?.binding ?? focused?.binding ?? (local ? currentBinding : {layerId:"",channel:""});
    const binding:Binding={...contextBinding,clipId:contextBinding.channel==="gain" || contextBinding.channel.startsWith("motion:")
      ? contextBinding.clipId : undefined};
    if(name==="model_inspect" || name==="model_edit") {
      const model=p.models.find(m=>m.id===args.resourceId);
      if(!model) throw Error("请指定画布中的模型素材 resourceId");
      if(name==="model_inspect") {
        const modelLayer=p.layers.find(l=>l.model?.resourceId===model.id);
        let parameters=modelLayer ? params(modelLayer.id) : [];
        if(!parameters.length) {
          const view=preprocessingScene(p,model.id);
          const catalog=await getMontageRenderer().parameters(view);
          parameters=catalog.get("@preprocess:"+model.id)??[];
        }
        signal.throwIfAborted();
        const offset=typeof args.offset==="number" ? Math.max(0,Math.floor(args.offset)) : 0;
        const motion=model.assets.find(a=>a.id===args.motionId && a.kind==="motion");
        const textures=await textureCatalog(model);
        let image:string|undefined;
        if(args.textureIndex!==undefined) {
          const slot=textures.find(s=>s.index===args.textureIndex);
          if(!slot) throw Error("贴图索引无效");
          const source=document.createElement("canvas"),cv=document.createElement("canvas");
          await loadTextureCanvas(textureUrl(model,p.assets,slot),source);
          const scale=Math.min(1,360/Math.max(source.width,source.height));
          cv.width=Math.max(1,Math.round(source.width*scale));cv.height=Math.max(1,Math.round(source.height*scale));
          const ctx=cv.getContext("2d")!;ctx.fillStyle="#777777";ctx.fillRect(0,0,cv.width,cv.height);ctx.drawImage(source,0,0,cv.width,cv.height);
          image=cv.toDataURL("image/jpeg",.78);
        }
        signal.throwIfAborted();
        return {resourceId:model.id,name:model.name,textures:textures.map(x=>({index:x.index,name:x.name,edited:!!model.textureOverrides?.[x.index]})),
          ...(image ? {artifact:{name:"贴图预览.jpg",mime:"image/jpeg",preview:image},...(canShare ? {previewImage:image} : {})} : {}),
          motion:motion && {...motion,motionFile:undefined,curves:motion.curves.slice(offset,offset+16),curveCount:motion.curves.length},
          motions:model.assets.filter(a=>a.kind==="motion").slice(offset,offset+32).map(({id,name,duration,fps,curves})=>({id,name,duration,fps,curves:curves.length})),
          parameters:parameters.slice(offset,offset+48),parameterCount:parameters.length};
      }
      const values=objectArgument(args.values);
      let next:Scene,result:unknown;
      if(args.action==="rename") {
        const name=checkedModelName(values.name);
        next=produce(p,d=>{d.models.find(m=>m.id===model.id)!.name=name;});
      } else if(args.action==="motion") {
        const original=typeof values.id==="string" ? model.assets.find(a=>a.id===values.id && a.kind==="motion") : newMotion();
        if(!original) throw Error("找不到要编辑的动作");
        const modelLayer=p.layers.find(l=>l.model?.resourceId===model.id);
        let parameters=modelLayer ? params(modelLayer.id) : [];
        if(!parameters.length && Array.isArray(values.curves) && values.curves.length) {
          const catalog=await getMontageRenderer().parameters(preprocessingScene(p,model.id));
          parameters=catalog.get("@preprocess:"+model.id)??[];
        }
        const asset=await saveMotion(editMotion(values,original,parameters));
        next=produce(p,d=>storePresetMotion(d,model.id,asset));
        result={id:asset.id,name:asset.name,duration:asset.duration,curveCount:asset.curves.length,format:"motion3.json"};
      } else if(args.action==="paint") {
        const slots=await textureCatalog(model),slot=slots.find(s=>s.index===values.index);
        if(!slot) throw Error("贴图索引无效");
        const canvas=document.createElement("canvas");
        const strokes=checkedStrokes(values.strokes);
        await loadTextureCanvas(textureUrl(model,p.assets,slot),canvas);
        for(const stroke of strokes) drawTextureStroke(canvas.getContext("2d")!,stroke);
        const asset=await saveTexture(canvas);
        next=produce(p,d=>applyTextureCopy(d,model.id,slot.index,asset));
        result={index:slot.index,assetId:asset.id,width:asset.width,height:asset.height};
      } else throw Error("未知模型编辑操作");
      signal.throwIfAborted();
      if(p!==activeDesignScene(canvasId)) throw Error("模型编辑期间画布已变更");
      const state=previewDesign(next,"模型素材编辑",undefined,canvasId);
      return {...state,result};
    }
    if (name==="editor_inspect") {
      if (args.section==="selection") {
        if(!local) return {revision,canvasId,layers:[],primary:"",playhead:head};
        const clips=p.tracks.flatMap(t=>t.clips).filter(c=>selection.includes(c.id) || c.id===binding.clipId);
        const property=propertiesOf(p,binding.layerId,Array.from(params(binding.layerId)))
          .find(b=>b.channel===binding.channel && b.clipId===binding.clipId);
        const data=property && readProperty(p,binding,head);
        const model=p.layers.find(l=>l.id===binding.layerId && l.model);
        const effective=property && binding.channel.startsWith("param:") && model
          ? modelValues(p,model,Array.from(params(model.id)),head)[binding.channel.slice(6)] : data?.value;
        const audio=p.assets.find(a=>a.kind==="audio" && a.id===selectedLibraryAudio.current);
        return {revision,playhead:head,layers:selectedIds,primary:selected,view:workspaceMode==="preprocess" ? workspaceMode : spatialView ? "spatial" : "camera",
          control:focused, binding:property ? binding : undefined,curve,
          libraryAudio:audio && {id:audio.id,name:audio.name,duration:audio.duration,lipCues:audio.cues?.length??0},
          property:property && data && {...data,base:property.base,value:effective??data.value,totalKeys:data.keys.length,keys:data.keys.slice(0,32)},
          clips:clips.map(({gainKeys,disabledIds,...c})=>{
            const asset=p.assets.find(a=>a.id===c.assetId);
            return {...c,gainKeys:gainKeys.length,disabledIds:disabledIds.length,
              audio:asset?.kind==="audio" ? {id:asset.id,name:asset.name,duration:asset.duration,lipCues:asset.cues?.length??0} : undefined};
          })};
      }
      const id=args.id==="selected" || (args.id===undefined && ["layer","property","model_params","text_animation"].includes(String(args.section)))
        ? args.section==="property" ? binding.layerId : targetSelected : args.id;
      return {revision,...inspectDesignScene(p,{...args,id,
        channel:args.channel??(args.section==="property" && id===binding.layerId ? binding.channel : undefined),
        clipId:args.clipId??(args.section==="property" && id===binding.layerId ? binding.clipId : undefined),
      },head,targetSelected,params)};
    }
    if (name==="editor_edit" || name==="editor_shader" || name==="editor_light") {
      let requested=args.edits;
      if (name==="editor_shader") {
        const picked=shaderTargets(p).find(t=>t.id===targetSelected && t.available);
        requested=[{op:"shader",id:args.target ?? (!montageMode ? picked?.id : undefined) ?? "output",shader:args.shader}];
      }
      if (name==="editor_light") {
        const cam=animatedCamera(p,head);
        const position=args.position===undefined ? {x:cam.x-p.width*.18/cam.zoom,y:cam.y-p.height*.12/cam.zoom,
          z:cam.z-Math.min(500,cam.focalLength*.45)} : objectArgument(args.position);
        requested=[
          {op:"add_layer",kind:"light",as:"light",name:args.name??"场景光源"},
          {op:"light",id:"$light",values:{type:args.type??"point",...(args.color===undefined?{}:{color:args.color}),
            ...(args.intensity===undefined?{}:{intensity:args.intensity}),...(args.range===undefined?{}:{range:args.range}),
            ...(args.targets===undefined?{}:{targets:args.targets})}},
          {op:"transform",id:"$light",values:position},
          {op:"lighting",values:{enabled:true}},
        ];
      }
      const edits=Array.isArray(requested) ? requested.map(value=>{
        const e={...objectArgument(value)};
        if (e.id==="selected") e.id=["clip","split_clip","remove_clip","duplicate_clip"].includes(String(e.op))
          ? curve?.binding.clipId ?? selection[0] ?? binding.clipId : targetSelected;
        if (["property","curve_preset","curve_key","keyframes"].includes(String(e.op))) {
          if (e.layerId===undefined || e.layerId==="selected") e.layerId=binding.layerId;
          if (e.layerId===binding.layerId && e.channel===undefined) e.channel=binding.channel;
          if (e.layerId===binding.layerId && e.channel===binding.channel && e.clipId===undefined) e.clipId=binding.clipId;
          if (e.op==="property" && e.time===undefined) e.time=head;
          if (e.op==="curve_preset" && e.segment===undefined && curve?.index!==undefined) e.segment=curve.index;
          if (e.op==="curve_key" && e.index===undefined && curve?.index!==undefined) e.index=curve.index;
        }
        if (e.layerId==="selected") e.layerId=targetSelected;
        return e;
      }) : requested;
      const edited=editDesignScene(p,edits,params);
      const graphEdit=Array.isArray(edits) ? edits.filter(e=>e.op==="shader" || e.op==="replace_graph" ||
        (e.op==="graph" && e.scope!=="text")).at(-1) : undefined;
      const resolve=(id:unknown)=>typeof id==="string" ? (id.startsWith("$") ? edited.created[id.slice(1)] : id) : undefined;
      const graphTarget=graphEdit?.scope==="preprocess" && typeof graphEdit.resourceId==="string" ?
        "@preprocess:"+graphEdit.resourceId : resolve(graphEdit?.id);
      const state=previewDesign(edited.scene,typeof args.label==="string" ? args.label.slice(0,80) :
        name==="editor_light" ? "场景灯光" : name==="editor_shader" ? "GLSL 着色器" : "场景设计",graphTarget,canvasId);
      const newLayers=edited.scene.layers.filter(l=>!p.layers.some(before=>before.id===l.id));
      const light=newLayers.find(l=>l.light);
      if (light && local && !montageMode) {
        setManagerTab("layers");
        selectLayer(light.id);
      }
      const focuses=new Map<string,AgentFocus>();
      for (const l of newLayers) if (l.kind!=="audio")
        focuses.set(l.id,{layerId:l.id,label:l.light ? "放置灯光" : "放置 "+l.name});
      for (const e of Array.isArray(edits) ? edits : []) {
        const id=e.op==="camera" ? "@camera" : e.op==="canvas" ? "output" : resolve(e.layerId ?? e.id);
        const clip=clipById(p,id);
        const layerId=clip?.layerId ?? id;
        const l=edited.scene.layers.find(l=>l.id===layerId);
        const old=p.layers.find(l=>l.id===layerId);
        if (!layerId || (layerId!=="@camera" && layerId!=="output" && (!l || l.kind==="audio" || l===old))) continue;
        const fields=(e.op==="transform" || e.op==="camera") && e.values && typeof e.values==="object" ? Object.keys(e.values) : [];
        const channel=typeof e.channel==="string" ? e.channel : fields.length===1 ? fields[0] : "";
        const handle=agentHandle(channel);
        focuses.set(layerId,{layerId,handle,label:focuses.get(layerId)?.label ?? (l ? "调整 "+l.name : layerId==="output" ? "调整画布" : "调整相机")});
      }
      if (graphTarget && !graphTarget.startsWith("@preprocess:"))
        focuses.set(graphTarget,{layerId:graphTarget,label:"调整着色"});
      if (local && focuses.size) agentActivity.point(...focuses.values());
      else if (local && edited.scene!==p) agentActivity.point({layerId:graphTarget?.startsWith("@preprocess:") ? graphTarget : undefined,label:"更新场景"});
      const graph=graphTarget && agentPostGraph(edited.scene,graphTarget);
      const lights=worldLights(edited.scene,head);
      return {...state,created:edited.created,operations:edited.changes,
        layers:newLayers.map(l=>({id:l.id,name:l.name,kind:l.shape ? "shape" : l.kind})),
        light:light && {id:light.id,active:lights.some(l=>l.id===light.id),world:lights.find(l=>l.id===light.id)?.position,
          receivers:edited.scene.layers.filter(l=>lights.some(w=>w.id===light.id && lightAffects(edited.scene,w,l))).map(l=>l.id)},
        graph:graph && {target:graphTarget,output:graph.output,activeNodes:graphOrder(graph).map(n=>n.id)}};
    }
    if (name==="editor_view") {
      if(!local) throw Error("使用 montage_view 打开画布后再操作编辑器视图");
      switch (args.action) {
        case "seek": seek(numberArgument(args.time,0,p.duration,"播放头")); break;
        case "select":
          if (typeof args.id!=="string" || (args.id!=="@camera" && !p.layers.some(l=>l.id===args.id))) throw Error("找不到要选中的图层");
          selectLayer(args.id); agentActivity.point({layerId:args.id,label:"选中对象"}); break;
        case "view":
          if (args.mode==="preprocess") {
            if (typeof args.id!=="string" || !p.models.some(m=>m.id===args.id)) throw Error("请指定预处理模型资源");
            openPreprocess(args.id);
          } else if (args.mode==="curves") {
            setWorkspaceMode("scene");openCurves();
          } else if (args.mode==="camera" || args.mode==="spatial") {
            setWorkspaceMode("scene");toggleSpatial(args.mode==="spatial");
          } else throw Error("未知编辑视图");
          break;
        case "play": setPlaying(true);break;
        case "pause": setPlaying(false);break;
        case "prepare_export":
          if (!["mp4","hevc","gif","webm","prores","png"].includes(String(args.format))) throw Error("导出格式无效");
          setExportScope("canvas");setExportFormat(String(args.format));setOnlyWork(args.range==="work_area");setExportResult(null);setExportStatus("");setProgress(0);setModal("export");break;
        default: throw Error("未知视图操作");
      }
      return {status:"ready",action:args.action,revision};
    }
    if (name==="editor_render") {
      if (!r || busyRef.current || !ready) throw Error("画布正在加载或导出");
      const time=args.time===undefined ? head : numberArgument(args.time,0,p.duration,"预览时间");
      let image:string;
      if(!local || montageMode) image=await getMontageRenderer().renderCanvas(p,time,false) as string;
      else {
        await r.ensure(p,sRef.current);
        image=r.captureShaderPreview(p,previewFrameTime(p.duration,p.fps,time),true);
      }
      if (signal.aborted || busyRef.current || p!==activeDesignScene(canvasId)) throw Error("预览目标已变更");
      return {status:"ready",time,width:p.width,height:p.height,revision,visual:canShare,
        artifact:{name:"画布预览.jpg",mime:"image/jpeg",preview:image},
        ...(canShare ? {previewImage:image} : {})};
    }
    if (name==="editor_deliver") {
      const format=String(args.format);
      const filename=(typeof args.name==="string" ? args.name : p.name).replace(/[<>:"/\\|?*\x00-\x1f]/g,"_").slice(0,100).trim() || "FrameStudio";
      let blob:Blob,preview:string|undefined;
      if (format==="png") {
        if (!r || busyRef.current || !ready) throw Error("画布正在加载或导出");
        const time=args.time===undefined ? head : numberArgument(args.time,0,p.duration,"交付时间");
        if(!local || montageMode) blob=await getMontageRenderer().renderCanvas(p,time,true) as Blob;
        else {
          await r.ensure(p,sRef.current);
          if (p!==activeDesignScene(canvasId)) throw Error("交付目标已变更");
          signal.throwIfAborted();
          try {
            const frameTime=previewFrameTime(p.duration,p.fps,time);
            preview=r.captureShaderPreview(p,frameTime,true);
            r.renderAt(p,frameTime,true);
            blob=await r.png();
          } finally {r.invalidate();}
        }
      } else if (format==="livemg") {
        const res=await fetch("/api/project-save?format=livemg",{method:"POST",signal,
          headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({project:p})});
        if (!res.ok) throw Error((await res.json()).error);
        blob=await res.blob();
      } else if (format==="svg") {
        const l=p.layers.find(l=>l.id===(args.id==="selected" ? selected : args.id));
        const shape=l?.shape ?? validateShape({kind:"svg",svg:args.content});
        blob=new Blob([shapeSvg(shape,l?.width,l?.height)],{type:"image/svg+xml"});
      } else if (format==="json" || format==="txt") {
        const content=typeof args.content==="string" ? args.content : JSON.stringify(args.content,null,2);
        if (content===undefined || content.length>500000) throw Error("文件内容为空或超过 500 KB");
        if (format==="json") JSON.parse(content);
        blob=new Blob([content],{type:format==="json" ? "application/json" : "text/plain"});
      } else throw Error("不支持的交付格式");
      signal.throwIfAborted();
      const name=filename.toLowerCase().endsWith("."+format) ? filename : filename+"."+format;
      return {status:"ready",revision,delivery:{name,size:blob.size,mime:blob.type},
        artifact:{name,mime:blob.type,blob,preview}};
    }
    if (name==="editor_analyze_audio") {
      const assetId=args.id===undefined || args.id==="selected" ? local ? selectedMedia?.id ?? selectedLibraryAudio.current : undefined : args.id;
      const a=p.assets.find(a=>a.id===assetId && a.kind==="audio");
      if (!a) throw Error("请指定已导入的音频素材");
      if (a.cues?.length) return {status:"ready",asset:a.id,cues:a.cues.length,revision};
      const data=await api("audio-analyze",{path:a.path});
      if (signal.aborted || p!==activeDesignScene(canvasId)) throw Error("音频分析期间工程已变更");
      const next=produce(p,s=>{
        const media=s.assets.find(v=>v.id===a.id)!;
        media.cues=data.cues;media.analysis=data.analysis;
      });
      const state=previewDesign(next,"口型分析",undefined,canvasId);
      return {...state,asset:a.id,cues:data.cues?.length ?? 0};
    }
    if (name==="graph_context")
      return {width:p.width,height:p.height,time:head,selected,targets:shaderTargets(p),revision};
    const target=args.target;
    if (typeof target!=="string" || !shaderTargets(p).some(t=>t.id===target && t.available))
      throw Error("请指定可编辑的后处理目标");
    const graph=currentPostGraph(p,target);
    if (name==="graph_read") return {target,graph,draft:!!designRef.current,revision};
    if (name!=="graph_edit") throw Error("未知工具");
    const edited=editDesignScene(p,[{op:"graph",id:target,edits:args.edits}],params);
    const output=currentPostGraph(edited.scene,target);
    const shader=output.nodes.find(n=>"@"+n.id===output.output && n.op==="glsl")?.inputs.shader as CodeShader | undefined;
    const state=previewDesign(edited.scene,shader?.name ?? output.name,target,canvasId);
    agentActivity.point({layerId:target,label:"调整着色"});
    return {...state,target,output:output.output,nodes:output.nodes.map(n=>({id:n.id,type:n.op})),activeNodes:graphOrder(output).map(n=>n.id)};
  }
  const shaderAgent = useShaderAgent({
    context: shaderContext,
    version: target => postRevision(sRef.current,target),
    read: readPostGraph,
    preview: candidate => {
      const {target,shader,edits} = candidate;
      const base = readPostGraph(target).graph;
      const graph = shader ? appendShader(base,shader) : editAgentGraph(base,edits);
      previewPostGraph(target,graph);
      shaderDraftRef.current = undefined;
      setShaderDraft(undefined);
      return graph;
    },
    apply: (target, graph) => {
      if (rRef.current?.shaderPreview?.graph !== graph) throw Error("预览已被替换，请重新试渲染");
      savePostGraph(target,graph,true);
    },
    clear: clearShaderPreview,
    capture: () => rRef.current!.captureShaderPreview(sRef.current, tRef.current),
  });
  const graphCanvas=graphLocation?.canvasId
    ? montagePreview?.canvases.find(c=>c.id===graphLocation.canvasId)
    : undefined;
  const graphScene=graphLocation?.canvasId ? graphCanvas?.scene : inspection;
  const foreignGraph=!!graphCanvas && graphCanvas.id!==montagePreview?.activeCanvasId;
  const editorDraft = graphTarget && !foreignGraph && rRef.current?.shaderPreview?.target === graphTarget
    ? rRef.current.shaderPreview.graph : undefined;
  function agentPostGraph(s:Scene,target:string) {
    if (target.startsWith("@preprocess:"))
      return s.models.find(m=>m.id===target.slice(12))?.preprocess?.effects.graph;
    return currentPostGraph(s,target);
  }
  const masterGraph=useMemo(()=>montagePreview && (montagePreview.outputGraph??emptyGraph("post","总成片效果")),[montagePreview]);
  const nodeTargets=graphTarget==="@master" ? [{id:"@master",name:"总成片效果",available:true}]
    : !graphScene ? [] : [
      ...shaderTargets(graphScene).map(t=>({...t,name:t.id==="output" ? "画布输出效果" : t.name+" · 图层效果"})),
      ...graphScene.models.map(m=>({id:"@preprocess:"+m.id,name:m.name+" · 素材预处理",available:true})),
    ];
  const nodeTarget=nodeTargets.find(target=>target.id===graphTarget);
  const editorGraph = useMemo(() => {
    if (graphTarget==="@master") return masterGraph;
    if (!graphTarget || !graphScene || !nodeTarget) return undefined;
    return editorDraft ?? agentPostGraph(graphScene,graphTarget) ?? emptyGraph("post","素材预处理");
  },[graphScene,graphTarget,!!nodeTarget,editorDraft,masterGraph]);
  const graphScope=graphTarget==="@master"
    ? montagePreview?.name
    : graphScene?.name;
  const editorAgentDraft=visibleMontageDraft ?? designDraft ?? shaderDraft;
  const draftScope=editorAgentDraft?.target==="@master" ? "总成片效果"
    : editorAgentDraft?.target ? postScopeName(
        visibleMontageDraft?.value.canvases.find(c=>c.id===visibleMontageDraft.targetCanvasId)?.scene ?? inspection,
        editorAgentDraft.target)
    : undefined;
  const agentMontageClip=montagePreview?.clips.find(clip=>clip.id===montageSelection);
  const agentMontageSource=montagePreview?.canvases.find(canvas=>canvas.id===agentMontageClip?.canvasId);
  function postScopeName(source:Scene,target:string) {
    if (target==="output") return source.name+" / 画布输出效果";
    const model=target.startsWith("@preprocess:") && source.models.find(m=>m.id===target.slice(12));
    if (model) return source.name+" / "+model.name+" / 素材预处理";
    const layer=source.layers.find(l=>l.id===target);
    return layer ? source.name+" / "+layer.name+" / 图层效果" : source.name;
  }
  function writeScopedGraph(target:string,graph:EffectGraph) {
    if (busyRef.current || draftLocked()) throw Error("请确认草稿并等待当前操作结束");
    if (target==="@master") {changeMasterGraph(graph);return;}
    const canvasId=graphLocation?.canvasId;
    if (foreignGraph && canvasId) {
      const project=currentMontage();
      const source=project?.canvases.find(c=>c.id===canvasId);
      if (!project || !source) throw Error("找不到节点所属的画布");
      const result=editDesignScene(source.scene,[{op:"replace_graph",id:target,graph,
        ...(target.startsWith("@preprocess:") ? {scope:"preprocess",resourceId:target.slice(12)} : {})}]);
      rRef.current?.probePostGraph(graph);
      applyMontage(withMontageCanvas(project,canvasId,result.scene));
      return;
    }
    rRef.current?.probePostGraph(graph);
    if (target.startsWith("@preprocess:")) {
      change(s=>{
        const model=s.models.find(m=>m.id===target.slice(12));
        if (!model) throw Error("找不到模型素材");
        model.preprocess ??= {enabled:true,effects:sceneEffects()};
        model.preprocess.effects.graph=graph;
      });
      setPreprocessOriginal(false);
    } else savePostGraph(target,graph);
  }
  function changeMasterGraph(graph?:EffectGraph) {
    const p=activeMontage();
    if(!p) throw Error("找不到总时间线");
    if(montageDraftRef.current) throw Error("确认草稿后即可编辑节点");
    const next=editMontage(p,[{op:"graph",graph:graph??null}]).montage;
    if(graph) rRef.current?.probePostGraph(graph);
    applyMontage(next);
  }

  function seek(t: number) {
    stopMotionPreview();
    tRef.current = clamp(t, 0, designRef.current?.base === sRef.current ? designRef.current.scene.duration : sRef.current.duration);
    setTime(tRef.current);
    rRef.current?.invalidate();
    syncRef.current();
  }
  function selectLayer(id: string) {
    focusedControl.current=undefined;
    stopMotionPreview();
    setSelection([]);
    if (channel === "gain" || channel.startsWith("motion:") || id === "@camera")
      setChannel("x");
    if ((designRef.current?.scene ?? sRef.current).layers.find((l) => l.id === id)?.model)
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
        : (designRef.current?.scene ?? sRef.current).layers.find((l) => l.id === id)?.kind === "audio"
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
    if(restoreMontageDraft()) return;
    if (draftLocked() || !history.current.length) return;
    const entry=appliedDraft.current,after=sRef.current;
    future.current.push(after);
    const p = history.current.pop()!;
    sRef.current = p;
    setScene(p);
    if(entry?.kind==="scene" && entry.after===after && entry.draft.base===p) {
      appliedDraft.current=undefined;
      const draft={...entry.draft,base:p,revision:++designRevision.current};
      designRef.current=draft;setDesignDraft(draft);
    }
    rRef.current?.invalidate();
    setHistoryVersion((v) => v + 1);
  }
  function redo() {
    if(draftLocked()) return;
    if (!future.current.length) return;
    history.current.push(sRef.current);
    const p = future.current.pop()!;
    sRef.current = p;
    setScene(p);
    rRef.current?.invalidate();
    setHistoryVersion((v) => v + 1);
  }
  async function loadScene(s: Scene, keepDocument=false) {
    if(!keepDocument) shaderDocument.current = crypto.randomUUID();
    clearDesignDraft();
    clearShaderPreview();
    setGraphTarget(undefined);
    setWorkspaceMode("scene");
    toggleSpatial(false);
    if (rRef.current) rRef.current.orbit = undefined;
    stopMotionPreview();
    setBusy("载入场景与独立模型控制器…");
    setReady(false);playRef.current=false;
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
      if(rRef.current!.host.clientWidth>0) rRef.current!.renderAt(p,0);
      setReady(true);
      const firstModel = p.layers.find((l) => l.kind === "model")?.id || "";
      setSelected(firstModel);
      setInspector("layer");
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
    if (isCubism2File(file)) await cubism2();
    const catalog = await api(
      "model-catalog?id=" +
        encodeURIComponent(modelId) +
        "&file=" +
        encodeURIComponent(file),
    );
    const assets: Asset[] = catalog.assets.map(parseCatalogAsset);
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
      ...lipParameters(file, assets),
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
        api<Partial<Preferences>>("preferences")
          .then((value) => {
            if (!live) return;
            const next=normalizePreferences(value);
            setPreferences(next);setSnap(next.defaultSnap);setAutoKey(next.defaultAutoKey);
            setViewGrid(next.defaultGrid);r.showGrid=next.defaultGrid;r.invalidate();
          })
          .catch(() => {})
          .finally(() => {
            if (live) setPreferencesReady(true);
          });
        setModelEntries(info.models);
        const saved = await api<Scene | Montage | null>("scene-autosave");
        if (isMontage(saved)) {
          const p=loadMontage(saved);
          updateMontage(p);setMontageMode(true);
          await loadScene(p.canvases.find(c=>c.id===p.activeCanvasId)!.scene);
        } else if (saved) {
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
              try {
                await addModel(m.id, file.path, "角色 1", p);
              } catch (e: any) {
                notify(e.message);
              }
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
      const root = document.documentElement;
      root.dataset.theme = dark ? "dark" : "light";
      root.dataset.accent = accent;
      const primary = getComputedStyle(root).getPropertyValue(
        dark ? "--dark-primary" : "--light-primary",
      ).trim();
      rRef.current?.setAppearance(dark, Number.parseInt(primary.slice(1), 16));
    };
    window.studioDesktop?.setAppearance?.(appearance);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [appearance, accent]);
  useEffect(() => {
    if(montageMode) return;
    rRef.current
      ?.ensure(displayScene,visibleDesign ? scene : undefined)
      .then(() => rRef.current?.invalidate())
      .catch((e) => notify(e.message));
  }, [displayScene.layers, displayScene.models, displayScene.assets,montageMode]);
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
    if (!ready || busy || !preferences.autoSave) return;
    const timer=setTimeout(()=>{
      sceneSaveQueue.current=sceneSaveQueue.current.then(async()=>{
        await api("scene-autosave",montageCommitted??scene);
      }).catch(()=>{});
    },preferences.autosaveDelay*1000);
    return () => clearTimeout(timer);
  }, [scene, montageCommitted, ready, busy,preferences.autoSave,preferences.autosaveDelay]);
  useEffect(()=>window.studioDesktop?.onSaveBeforeClose?.(async()=>{
    await sceneSaveQueue.current;
    await api("scene-autosave",currentMontage()??sRef.current);
  }),[]);
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
      clock = -1,
      clockRate = 0;
    function tick(now: number) {
      const dt = Math.min(0.15, (now - last) / 1000);
      last = now;
      if (modeRef.current === "scene" && playRef.current && !busyRef.current) {
        let t = tRef.current + dt;
        const p = displayRef.current;
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
        t=modeRef.current==="preprocess" ? 0 : tRef.current,
        frameTime=previewFrameTime(p.duration,p.fps,t);
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
        !montageMode &&
        !busyRef.current &&
        r &&
        r.needsRender(p,frameTime) &&
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
          r.renderViews(p,frameTime,alternate);
          agentActivity.publish(r.snapshot,alternate?.snapshot);
          const snap=r.snapshot,id=poseActor.current;
          if(id && snap) {
            const hit=snap.hits.find(item=>item.id===id);
            poseStore.publish(hit?.points.length===4 ? {points:hit.points,width:snap.width,height:snap.height} : undefined);
          }
        } catch (e: any) {
          console.error(e);
          playRef.current = false;
          setPlaying(false);
        }
        paint = now;
      }
      if (t !== clock || p.fps !== clockRate) {
        const c = document.querySelector<HTMLElement>(".scene-nowclock");
        const frame = Math.round(t * p.fps);
        if (c) {
          c.textContent = formatTimecode(frame, p.fps);
          c.title = t.toFixed(3) + " 秒";
        }
        const frameLabel = document.querySelector("[data-now-frame]");
        if (frameLabel) frameLabel.textContent = String(frame);
        const h = document.querySelector<HTMLElement>(".scene-playhead");
        if (h)
          h.style.left =
            Number(h.dataset.label) +
            t * Number(h.dataset.zoom || 70) +
            "px";
        clock = t;
        clockRate = p.fps;
      }
      if (playRef.current && now - audio > 70) {
        syncRef.current();
        audio = now;
      }
      raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [ready,montageMode]);
  syncRef.current = () => {
    const p = modeRef.current === "scene" ? displayRef.current : sRef.current,
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
  }, [scene, designDraft, time, busy]);
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
    selectedLibraryAudio.current=a.id;
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
    if(modeRef.current==="preprocess" && id!==preprocessId && !allowWorkbenchExit())return;
    setPreprocessOriginal(false);
    setWorkbenchTab("look");
    setSelectedControl("");
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
  function addLayer(kind: Layer["kind"], geometry = false) {
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
      l.width = geometry ? 320 : scene.width;
      l.height = geometry ? 240 : scene.height;
      if (geometry) { l.shape = {...defaultShape}; l.name = "几何图形"; }
    }
    change((s) => {
      if (kind === "group") s.layers.push(l);
      else {
        addVisual(s, l, tRef.current, Math.max(0.1, s.duration - tRef.current));
        if (kind === "color" && !geometry) {
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
  function copyObjects(ids = selectedIds) {
    const snapshot = copyLayerTrees(sRef.current, ids, tRef.current);
    if (!snapshot.roots.length) return false;
    clipboard.current = { kind: "objects", snapshot };
    notify(`已复制 ${snapshot.roots.length} 个对象`);
    return true;
  }
  function copySelection() {
    if (!selection.length) return copyObjects();
    const s = sRef.current;
    const clips = s.tracks.flatMap(t => t.clips)
      .filter(c => selection.includes(c.id)).map(cloneData);
    if (!clips.length) return false;
    clipboard.current = { kind: "clips", sceneId: s.id, clips };
    notify(`已复制 ${clips.length} 个片段`);
    return true;
  }
  function canPaste(objectsOnly = false) {
    const saved = clipboard.current;
    return saved?.kind === "objects"
      ? saved.snapshot.sceneId === sRef.current.id
      : !objectsOnly && saved?.kind === "clips" && saved.sceneId === sRef.current.id;
  }
  function pasteSelection(objectsOnly = false) {
    const saved = clipboard.current;
    if (!saved || !canPaste(objectsOnly)) return false;
    if (saved.kind === "objects") {
      let ids: string[] = [];
      change(s => { ids = pasteLayerTrees(s, saved.snapshot); });
      selectObjects(ids);
      notify(`已原地粘贴 ${ids.length} 个对象`);
      return true;
    }
    const at = tRef.current, start = Math.min(...saved.clips.map(c => c.start));
    const clips = saved.clips.filter(c => sRef.current.layers.some(l => l.id === c.layerId));
    if (!clips.length) return false;
    const ids: string[] = [];
    change(s => {
      for (const c of clips) {
        const id = uid();
        addClipToTrack(s, { ...cloneData(c), id, start: at + c.start - start });
        ids.push(id);
      }
    });
    selectClips(ids);
    notify(`已在播放头粘贴 ${ids.length} 个片段`);
    return true;
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
          if (selection.includes(c.id)) {
            const right=splitSceneClip(c,now);
            if (right) tr.clips.push(right);
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
  async function saveProject(scope:"workspace"|"canvas"="workspace") {
    const project=scope==="canvas" ? sRef.current : currentMontage() ?? sRef.current;
    const filename=project.name+(isMontage(project) ? ".livemgs" : ".livemg");
    try {
      setBusy("打包 .livemg 工程与全部资源…");
      const res = await fetch("/api/project-save?format=livemg", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          project,
          thumbnail: isMontage(project) ? undefined : await projectThumbnail(),
          options:isMontage(project) ? {container:true,embedCanvases:preferences.embedCanvases} : {includeAssets:preferences.embedSingle},
        }),
      });
      if (!res.ok) throw Error((await res.json()).error);
      const blob = await res.blob();
      if (window.studioDesktop?.saveFile) {
        const saved = await window.studioDesktop.saveFile(
          filename,
          await blob.arrayBuffer(),
        );
        if (saved.canceled) return;
      } else download(blob,filename);
      if(scope==="workspace") setDirty(false);
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
      const input = await api<Scene|Montage>("project-open?format=livemg", file);
      const p=isMontage(input) ? loadMontage(input) : migrateScene(input);
      resetMontage();
      history.current = [];
      future.current = [];
      if(isMontage(p)) {
        updateMontage(p);setMontageMode(true);
        await loadScene(p.canvases.find(c=>c.id===p.activeCanvasId)!.scene);
      } else await loadScene(p);
      setDirty(false);
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy("");
    }
  }
  async function exportVideo() {
    if (!ready) return;
    if (designRef.current || montageDraftRef.current) { setExportStatus("请先应用或丢弃 Agent 草稿，再导出成片。");return; }
    stopMotionPreview();
    const p = sRef.current, master=exportScope==="montage" ? currentMontage() : undefined,
      spec=master ?? p,
      start = !master && onlyWork ? p.workArea.start : 0,
      end = master ? montageEnd(master) : onlyWork ? p.workArea.end : p.duration;
    if(end<=start) {setExportStatus("总时间线没有可导出的片段");return;}
    playMontage(false);
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
      if(!master) await rRef.current!.ensure(p);
      const matte=["mp4", "hevc", "gif"].includes(
        exportFormat,
      )
        ? exportMatte
        : undefined;
      if(!master) rRef.current!.exportBackground=matte;
      job = await api("export-start", {
        width: spec.width,
        height: spec.height,
        fps: spec.fps,
        duration: end - start,
        format: exportFormat,
        audio: master ? montageAudio(master) : collectAudio(p, start, end),
      });
      if(master) await getMontageRenderer().resetPhysics();
      else for (const n of rRef.current!.nodes.values()) n.runtime?.resetPhysics();
      for (let i = 0; i < job.total; i++) {
        if (cancel.current) throw Error("已取消导出");
        const at=start+i/spec.fps;
        let frame:Blob;
        if(master) frame=(await getMontageRenderer().render(master,at,{matte,png:true}))!;
        else {rRef.current!.renderAt(p,at,true);frame=await rRef.current!.png();}
        await api("export-frame/"+job.id+"/"+i,frame);
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
      if(!montageMode && master) {montageRenderer.current?.close();montageRenderer.current=undefined;}
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
    const target=seed ?? (currentBinding.layerId ? currentBinding : undefined);
    if(seed && (seed.layerId!==currentBinding.layerId || seed.channel!==currentBinding.channel || seed.clipId!==currentBinding.clipId))
      selectProperty(seed);
    setCurveSeed(target);
    setCurveOpen(true);
  }
  function previewEffectGraph(source?: EffectGraph, output?: string) {
    const renderer = rRef.current;
    if (!renderer) return;
    renderer.graphPreview = source && output ? {source,output} : undefined;
    renderer.invalidate();
  }
  function graphParameterControls(layer: Layer, kind: "post"|"text") {
    const binding = (id: string) => ({layerId:layer.id,channel:kind+"Graph."+id});
    return {
      value: (id:string) => readProperty(scene,binding(id),time).value,
      onValue: (id:string,value:number,key?:boolean) => editProperty(binding(id),value,key),
      keyed: (id:string) => !!layer.animation[binding(id).channel]?.length,
      onPreview: previewEffectGraph,
    };
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
        const graphParam = effectParameter(target,binding.channel);
        if (graphParam) graphParam.value = v;
        else if (binding.channel.startsWith("param:") && target.model)
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
    if(draftLocked()){notify("确认草稿后即可变换对象");return;}
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
  function zoomViewport(pane: "main" | "mirror", dy: number, x = 0, y = 0) {
    const renderer = rRef.current;
    if (!renderer) return;
    const { orbit, view } = paneView(pane);
    if (orbit) {
      putOrbit(pane, orbitZoom(orbit, dy));
      return;
    }
    const old = view.zoom;
    const next = clamp(old * Math.exp(-dy * 0.0015), 0.08, 8);
    view.panX = x - ((x - view.panX) * next) / old;
    view.panY = y - ((y - view.panY) * next) / old;
    view.zoom = next;
    if (pane === "main") setViewZoom(next);
    renderer.invalidate();
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
      if(draftLocked()) return;
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
        const rect = el.getBoundingClientRect();
        zoomViewport(
          pane,
          e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1),
          e.clientX - rect.left - rect.width / 2,
          e.clientY - rect.top - rect.height / 2,
        );
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
      if (document.getElementById("appearance-menu")?.matches(":popover-open")) return;
      const target = e.target as HTMLElement,
        editing = target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
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
        if (modal) {
          if (!busy) setModal("");
          return;
        }
        if (curveOpen) {
          setCurveOpen(false);
          return;
        }
        if (modeRef.current === "preprocess")
          returnFromWorkbench();
        else setInspectorOpen(false);
        return;
      }
      if(montageMode) {
        if(editing || modal || busy) return;
        const key=e.key.toLowerCase(), modifier=e.ctrlKey || e.metaKey;
        if(modifier && key==="s") {e.preventDefault();void saveProject();}
        if(modifier && key==="z") {e.preventDefault();stepMontageHistory(e.shiftKey);}
        if(e.code==="Space" && target.tagName!=="BUTTON" && !e.repeat) {
          e.preventDefault();
          if(!montagePlaying && montagePreview && montageClock.current>=montageEnd(montagePreview)) seekMontage(0);
          playMontage(!montagePlaying);
        }
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
      if ((e.ctrlKey || e.metaKey) && !e.repeat) {
        const key = e.key.toLowerCase();
        if (key === "c" ? copySelection() : key === "v" && pasteSelection())
          e.preventDefault();
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
    curveOpen,
    montageMode,montagePlaying,montagePreview,
  ]);
  useEffect(() => {
    window.theater = {
      get montage() {return currentMontage();},
      get displayMontage() {return montageDraftRef.current?.value ?? currentMontage();},
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
  const layerRows = useMemo(() => {
    const result: { l: Layer; depth: number }[] = [];
    const children = new Map<string | null, Layer[]>();
    const visited = new Set<string>();
    for (const l of [...inspection.layers].reverse()) {
      if (!children.has(l.parentId)) children.set(l.parentId, []);
      children.get(l.parentId)!.push(l);
    }
    function visit(parent: string | null, depth = 0) {
      for (const l of children.get(parent) ?? []) {
        if (visited.has(l.id)) continue;
        visited.add(l.id);
        result.push({ l, depth });
        if (l.kind === "group" && !foldedGroups[l.id]) visit(l.id, depth + 1);
      }
    }
    visit(null);
    return result;
  }, [inspection.layers, foldedGroups]);
  const sceneActions = useMemo(() => {
    const result = new Map<string, SceneClip[]>();
    for (const track of scene.tracks) for (const clip of track.clips) {
      if (clip.kind === "visual") continue;
      if (!result.has(clip.layerId)) result.set(clip.layerId, []);
      result.get(clip.layerId)!.push(clip);
    }
    return result;
  }, [scene.tracks]);
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
      className={"theater-app" + (curveOpen && workspaceMode === "scene" ? " curves-open" : "")}
      style={{
        gridTemplateRows:
          "var(--header-height) minmax(180px,1fr) " +
          (montageMode || (modelWorkspace && !motionWorkspace) ? "0px"
            : motionWorkspace ? "clamp(225px, "+modelDockHeight+"px, 54vh)"
            : `clamp(210px, ${timelineHeight + (curveOpen ? 95 : 0)}px, ${curveOpen ? 62 : 47}vh)`) +
          " 20px",
      }}
    >
      <header className="theater-header" inert={modal==="settings"}>
        <div className="theater-brand">
          <img className="theater-brand-icon" src="/icon.svg" width={42} height={42} alt="" />
          <label className="scene-name">
            <small>
              <span className="theater-wordmark"><strong>Frame</strong>Studio</span>
              <span className="studio-document-path" title={montagePreview?.name}>
                {montageMode ? "总时间线" : montagePreview ? montagePreview.name + " / 画布" : "独立画布"}
                {workspaceMode==="preprocess" && !montageMode ? " / 模型素材" : ""}
              </span>
              {dirty && <i title="草稿已更改" />}
            </small>
            <input
              className="scene-title"
              aria-label={montageMode || !montageCommitted ? "工程名称" : "画布名称"}
              value={montageMode ? montagePreview?.name??scene.name : scene.name}
              readOnly={montageMode ? !montageCommitted || !!montageDraft : !!visibleDesign}
              onChange={(e) => montageMode ? editMontageUI([{op:"settings",values:{name:e.target.value}}]) : change(s=>{s.name=e.target.value;})}
            />
          </label>
        </div>
        <nav className="studio-mode-switch" aria-label="工作区">
          <button aria-label={montageMode ? "返回当前画布" : "画布工作区"} aria-pressed={!montageMode}
            disabled={!ready || !!busy} onClick={showCanvas}>
            <Layers size={16}/><span>画布</span>
          </button>
          <button aria-label="总时间线" aria-pressed={montageMode} disabled={!ready || !!busy}
            onClick={()=>{if(!montageMode)showMontage();}}>
            <Clapperboard size={16}/><span>总时间线</span>
          </button>
        </nav>
        <div className="header-actions">
          <div className="action-group" aria-label="工程文件">
          <button
            title="新建工程"
            onClick={() => {
              if (
                dirty &&
                !confirm("新建前请确认需要的工程已经保存。继续创建空白工程？")
              )
                return;
              resetMontage();history.current=[];future.current=[];
              const next=emptyScene();
              next.fps=preferences.defaultFps;
              next.workArea.end=next.duration=preferences.defaultDuration;
              void loadScene(next);
            }}
          >
            <FilePlus2 size={17} />
          </button>
          <button
            title="打开 .livemg / .livemgs 工程"
            onClick={() => projectInput.current?.click()}
          >
            <FolderOpen size={17} />
          </button>
          <button title="保存工程（Ctrl+S）" onClick={()=>void saveProject()}>
            <Save size={17} />
          </button>
          </div>
          <div className="action-group" aria-label="编辑历史">
          <button
            title="撤销"
            disabled={montageMode ? !montageHistory.current.past.length || !!montageDraft : !history.current.length}
            onClick={()=>montageMode ? stepMontageHistory(false) : undo()}
          >
            <Undo2 size={17} />
          </button>
          <button title="重做" disabled={montageMode ? !montageHistory.current.future.length || !!montageDraft : !future.current.length}
            onClick={()=>montageMode ? stepMontageHistory(true) : redo()}>
            <Redo2 size={17} />
          </button>
          </div>
          {montage && !montageMode && <button className="header-tool" title="另存当前画布 .livemg" disabled={!!busy}
            onClick={()=>void saveProject("canvas")}><Download size={16}/></button>}
          <button className="header-tool" style={montageMode?{display:"none"}:undefined} title="画布与时间设置" onClick={() => setModal("canvas")}>
            <Settings2 size={16} />
            <span>画布设置</span>
          </button>
          <button className="header-tool" disabled={!preferencesReady} aria-label="软件设置" onClick={()=>showSettings()}>
            <Settings2 size={16}/><span>设置</span>
          </button>
          <button
            className="export-button"
            disabled={!ready}
            onClick={() => {
              playMontage(false);setExportScope(montageMode && montage ? "montage" : "canvas");
              setExportFormat(preferences.defaultExportFormat);
              setExportStatus("");setExportResult(null);setModal("export");
            }}
          >
            <ArrowUpRight size={17} />
            导出成片
          </button>
        </div>
      </header>
      {montageMode && !montagePreview && (
        <section className="montage-onboarding" aria-label="总时间线">
          <Clapperboard size={32}/>
          <h1>总时间线</h1>
          <p>把独立画布编排成一条成片。创建后，可以继续导入或新建画布。</p>
          <button className="primary" disabled={!!busy || !!visibleDesign || !!shaderDraft}
            onClick={()=>{if (!currentMontage() && !draftLocked()) applyMontage(emptyMontage(sRef.current));}}>
            <Plus size={16}/> 创建总时间线并加入当前画布
          </button>
        </section>
      )}
      {montageMode && montagePreview && <MontageWorkspace project={montagePreview} renderer={getMontageRenderer()}
        busy={!!busy} draft={!!visibleMontageDraft} time={montageTime} selected={montageSelection}
        select={setMontageSelection} seek={seekMontage} onTime={at=>{montageClock.current=at;}} playing={montagePlaying} play={playMontage} edit={editMontageUI}
        openGraph={()=>setGraphTarget("@master")}
        open={id=>void openMontageCanvas(id)} importCanvas={()=>montageInput.current?.click()}
        previewError={error=>notify(error instanceof Error ? error.message : String(error))}/>}
      <div
        style={montageMode ? {display:"none"} : undefined}
        inert={modal==="settings"}
        className={
          "theater-workspace " + (!inspectorOpen ? "inspector-closed " : "")+(modelWorkspace ? "model-workspace" : "")
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
                  onClick={() => {
                    if(r.id===preprocessingResource?.id || !allowWorkbenchExit())return;
                    setPreprocessId(r.id);setSelectedControl("");setPreprocessOriginal(false);
                  }}
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
              onClick={returnFromWorkbench}
            >
              返回场景
            </button>
          </aside>
        )}
        <aside
          className="theater-library"
          hidden={workspaceMode === "preprocess"}
        >
          <div className="workspace-panel-heading">
            <strong>{managerTab==="assets" ? "项目浏览器" : "场景对象"}</strong>
            <small>{managerTab==="assets" ? "PROJECT" : scene.layers.length+" 个图层"}</small>
          </div>
          <nav className="manager-tabs" aria-label="浏览范围">
            <button aria-pressed={managerTab==="assets"} onClick={()=>setManagerTab("assets")}>
              <FolderOpen size={14}/> 项目
            </button>
            <button aria-pressed={managerTab==="layers"} onClick={()=>setManagerTab("layers")}>
              <Layers size={15}/> 场景
            </button>
          </nav>
          {managerTab==="assets" && montagePreview && (
            <details className="scene-project-canvases">
              <summary>项目画布 <small>{montagePreview.canvases.length}</small></summary>
              <ProjectCanvases project={montagePreview} current={montagePreview.activeCanvasId}
                disabled={!!busy || !!visibleMontageDraft || !!visibleDesign || !!shaderDraft}
                open={id=>void openMontageCanvas(id)} importCanvas={()=>montageInput.current?.click()} edit={editMontageUI}/>
            </details>
          )}
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
                        title={"编辑模型素材 " + m.name}
                        aria-label={"编辑模型素材 " + m.name}
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
                            ...lipParameters(m.file, m.assets),
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
                onClick={()=>{if(a.kind==="audio") selectedLibraryAudio.current=a.id;}}
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
          <div className="layer-manager" hidden={managerTab === "assets"}>
            <div className="layer-title">
              <strong>
                <FolderOpen size={14} />
                <select aria-label="场景对象视图" value={sceneList} onChange={e=>setSceneList(e.target.value as typeof sceneList)}>
                  <option value="layers">图层顺序</option>
                  <option value="tree">场景树</option>
                </select>
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
                  <button onClick={() => addLayer("color",true)}><Square size={14}/> 几何图形</button>
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
              <button className="layer-camera" onClick={()=>setGraphTarget("output")}>
                <Code2 size={15}/> 画布输出效果
              </button>
              {layerRows.map(({ l, depth }) => visibleDesign ? (
                <div key={l.id} className={"layer-row "+(selectedIds.includes(l.id) ? "selected" : "")+
                    (scene.layers.find(layer=>layer.id===l.id)!==l?" agent-outline":"")}
                  style={{paddingLeft:9+depth*14}}>
                  <button className="layer-label" onClick={()=>selectLayer(l.id)}>{icons[l.kind]} {l.name}</button>
                  {l.light && <small>{l.light.type}</small>}
                </div>
              ) : (
                <React.Fragment key={l.id}>
                <div
                  className={
                    "layer-row " +
                    (selectedIds.includes(l.id) ? "selected" : "")
                  }
                  data-layer-kind={l.kind}
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
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const ids = selectedIds.includes(l.id) ? selectedIds : [l.id];
                    if (!selectedIds.includes(l.id)) selectLayer(l.id);
                    setContextMenu({ x: e.clientX, y: e.clientY, ids });
                  }}
                >
                  {(l.kind === "group" || (sceneList === "tree" && sceneActions.has(l.id))) && (
                    <button
                      className="layer-fold"
                      title={foldedGroups[l.id] ? "展开子项" : "折叠子项"}
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
                    title="双击重命名"
                    onMouseDown={e => {
                      if (e.button === 0 && e.detail === 1 && document.activeElement !== e.currentTarget) {
                        e.preventDefault();
                        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
                      }
                    }}
                    onDoubleClick={e => {
                      e.currentTarget.focus();
                      e.currentTarget.select();
                    }}
                    onClick={(e) => {
                      if (e.ctrlKey || e.shiftKey) return;
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
                {sceneList === "tree" && !foldedGroups[l.id] && sceneActions.get(l.id)?.map((clip) => (
                  <button
                    key={clip.id}
                    className={"outliner-clip" + (selection.includes(clip.id) ? " active" : "")}
                    style={{ paddingLeft: 24 + depth * 14 }}
                    onClick={() => selectClips([clip.id])}
                    title={clip.name + " · " + clip.duration.toFixed(3) + " 秒"}
                  >
                    {clip.kind === "motion" ? <Clapperboard size={13} /> : <Music2 size={13} />}
                    <span>{clip.name}</span>
                    <small>{Number(clip.duration.toFixed(3))} s</small>
                  </button>
                ))}
                </React.Fragment>
              ))}
            </div>
            <div className="layer-actions">
              <button
                title="复制对象（Ctrl+C）"
                onClick={() => copyObjects()}
                disabled={!selectedLayer}
              >
                <Copy size={14} />
              </button>
              <button
                title="原地粘贴对象（Ctrl+V）"
                onClick={() => pasteSelection(true)}
                disabled={!canPaste(true)}
              >
                <ClipboardPaste size={14} />
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
              {workspaceMode==="scene" ? (
                <div className="viewport-switch" aria-label="画布视图">
                  <button aria-pressed={!spatialView} onClick={()=>toggleSpatial(false)}>相机视图</button>
                  <button aria-pressed={spatialView} onClick={()=>toggleSpatial(true)} title="切换视图（V）">
                    <Box size={14}/> 三维视图
                  </button>
                </div>
              ) : <strong className="studio-preview-label">{textureWorkspace ? "贴图编辑" : motionWorkspace ? "动作预览" : "模型素材预览"}</strong>}
            </div>
            <div>
              {workspaceMode==="scene" && !!instanceControls.length && <button aria-pressed={sceneControls}
                onClick={()=>setSceneControls(value=>!value)} title="拖动已绑定的模型控制点以记录关键帧">
                模型控制点
              </button>}
              {!inspectorOpen && <button onClick={()=>setInspectorOpen(true)} title="显示检查器">
                <SlidersHorizontal size={15}/> 检查器
              </button>}
              {!textureWorkspace && <>
              <div className="viewport-zoom" aria-label="预览缩放">
                <button title="缩小画布" onClick={() => zoomViewport("main", 120)}>
                  <Minus size={15} />
                </button>
                <button title="放大画布" onClick={() => zoomViewport("main", -120)}>
                  <Plus size={15} />
                </button>
              </div>
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
                  rRef.current!.renderAt(displayRef.current, modelWorkspace ? 0 : tRef.current, true);
                  download(await rRef.current!.png(), (modelWorkspace ? preprocessingResource?.name??scene.name : scene.name) + ".png");
                  rRef.current!.invalidate();
                }}
              >
                <Download size={16} />
              </button>
              </>}
            </div>
          </div>
          {workspaceMode === "scene" && (
            <div className="gizmo-toolbar" aria-label="变换工具">
              <button
                className={boxTool ? "active" : ""}
                aria-pressed={boxTool}
                onClick={() => setBoxTool((v) => !v)}
              >
                <SquareDashed size={14} />
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
            ref={agentViewport}
            className={
              "viewport-panes " + (modelWorkspace ? "workbench-viewports " : "") +
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
                  "scene-canvas" + (visibleDesign || rRef.current?.shaderPreview ? " agent-outline" : "") +
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
                {poseActorId && <ModelPoseControls store={poseStore}
                  controls={modelWorkspace ? workbenchControls : instanceControls}
                  params={modelWorkspace ? previewModelParams : params}
                  selected={selectedControl}
                  input={motionWorkspace ? ()=>motionPose.current : modelWorkspace ? undefined : instancePose}
                  place={modelWorkspace && workbenchTab==="rig" && !visibleDesign ? (id,x,y)=>{
                    setSelectedControl(id);
                    saveModelControls(workbenchControls.map(c=>c.id===id ? {...c,x,y} : c));
                  } : undefined}/>}
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
            {modelWorkspace && <div className="model-board-host" ref={setTextureBoard} hidden={!textureWorkspace}/>}
            <AgentCursor activity={agentActivity} viewport={agentViewport}/>
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
                    <button title="缩小第二预览" onClick={() => zoomViewport("mirror", 120)}>
                      <Minus size={14} />
                    </button>
                    <button title="放大第二预览" onClick={() => zoomViewport("mirror", -120)}>
                      <Plus size={14} />
                    </button>
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
                      "scene-canvas mirror-canvas" + (visibleDesign || rRef.current?.shaderPreview ? " agent-outline" : "") +
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
              {motionWorkspace ? "动作预览 · 拖动模型控制点可记录参数关键帧"
                : textureWorkspace ? "贴图编辑 · 保存后生成独立贴图副本"
                : modelWorkspace ? "模型素材预览 · 使用独立姿势与素材效果"
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
            <strong>{workspaceMode==="preprocess" ? "模型素材编辑" : "检查器"}</strong>
            <button
              aria-label="关闭属性面板"
              onClick={() => setInspectorOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="inspector-target">
            <span className="inspector-target-icon">
              {workspaceMode === "preprocess" ? <Layers size={19} /> :
                selected === "@camera" ? <Camera size={19} /> :
                selectedLayer ? icons[selectedLayer.kind] : <Focus size={18} />}
            </span>
            <div>
              <small>{workspaceMode === "preprocess" ? "当前模型素材" : "当前编辑目标"}</small>
              <strong title={selectedLayer?.name}>
                {workspaceMode === "preprocess" ? preprocessingResource?.name || "选择模型" :
                  selected === "@camera" ? "成片相机" :
                  selectedIds.length > 1 ? `${selectedIds.length} 个对象` :
                  selectedLayer?.name || "未选择对象"}
              </strong>
              {workspaceMode === "scene" && selectedClip && <small>{selectedClip.name}</small>}
            </div>
          </div>
          <div className={"scene-properties"+(visibleDesign?" agent-outline":"")} title={visibleDesign?"确认草稿后即可编辑":undefined} inert={!!visibleDesign} onFocusCapture={e=>{
            const el=e.target;
            if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return;
            const label=el.getAttribute("aria-label") || el.closest("label")?.querySelector("span")?.textContent ||
              el.closest("label")?.childNodes[0]?.textContent?.trim();
            if (!label) return;
            const binding=propertiesOf(inspection,selected,params).find(b=>b.name===label || b.channel==="param:"+label);
            focusedControl.current={layerId:selected,binding,label,value:el instanceof HTMLInputElement && el.type==="checkbox" ? el.checked : el.value};
          }}>
            {workspaceMode === "preprocess" ? (
              preprocessingResource ? <ModelWorkbench key={preprocessingResource.id}
                resource={preprocessingResource} assets={inspection.assets} readOnly={!!visibleDesign}
                params={previewModelParams} tab={workbenchTab} selectTab={setWorkbenchTab}
                board={textureBoard} dock={motionDock} dockHeight={setModelDockHeight}
                controls={workbenchControls} selectedControl={selectedControl} selectControl={setSelectedControl}
                saveControls={saveModelControls} attachPose={attachMotionPose}
                textureDirty={setTextureDirty} motionDirty={setMotionDirty}
                rename={name=>change(s=>{s.models.find(m=>m.id===preprocessingResource.id)!.name=checkedModelName(name);})}
                texture={(index,asset)=>change(s=>applyTextureCopy(s,preprocessingResource.id,index,asset))}
                motion={asset=>change(s=>storePresetMotion(s,preprocessingResource.id,asset))}
                pose={poseWorkbench}
                preprocess={<ModelPreprocessPanel
                resource={preprocessingResource}
                onOpenGraph={()=>setGraphTarget("@preprocess:"+preprocessingResource.id)}
                original={preprocessOriginal}
                onCompare={setPreprocessOriginal}
                onGraphPreview={previewEffectGraph}
                instances={scene.layers
                  .filter((l) => l.model && l.model.resourceId === preprocessingResource?.id)
                  .map((l) => l.name)}
                onChange={(value) =>
                  change((s) => {
                    const r = s.models.find(
                      (r) => r.id === preprocessingResource?.id,
                    );
                    if (r) r.preprocess = value;
                  })
                }
              />}/>
                : <p className="empty-state">先导入或选择模型。</p>
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
                  {!["light","audio"].includes(selectedLayer.kind) && (
                    <button
                      className={inspector === "effects" ? "active" : ""}
                      onClick={() => setInspector("effects")}
                    >
                      图层效果
                    </button>
                  )}
                </div>
                {inspector === "layer" && (
                  <>
                    {selectedLayer.light && (<>
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
                      <AppearancePresetControls key={selectedLayer.id} kind="light" data={lightAppearance(selectedLayer)}
                        apply={preset=>updateLayer(l=>{
                          l.light={...preset.light,targets:l.light!.targets};
                          l.transform=preset.transform;
                          setAppearanceCurves(l,"light",preset.curves);
                        })}/>
                    </>)}
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
                    {selectedLayer.kind === "color" && (!selectedLayer.shape || /^(rect|ellipse|star)$/.test(selectedLayer.shape.kind)) && (
                      <label className="color-field">
                        {selectedLayer.shape ? "图形填色" : "颜色"}
                        <input type="color" value={selectedLayer.shape?.fill.match(/^#[0-9a-f]{6}$/i)?.[0] ??
                          (selectedLayer.shape ? defaultShape.fill : selectedLayer.color)}
                          onChange={(e)=>updateLayer(l=>{
                            if(l.shape) l.shape.fill=e.target.value;
                            else l.color=e.target.value;
                          })}/>
                      </label>
                    )}
                    {selectedLayer.shape && <>
                      <h3>几何图形</h3>
                      <label className="stack-field">形状
                        <select aria-label="几何形状" value={selectedLayer.shape.kind} onChange={e=>{
                          const kind=e.target.value;
                          if (kind==="svg" || kind==="expression") {setJsonEdit("shape");return;}
                          updateLayer(l=>{l.shape=validateShape({...defaultShape,kind,fill:l.shape?.fill==="none" ? defaultShape.fill : l.shape?.fill});});
                        }}>
                          <option value="rect">矩形</option><option value="ellipse">椭圆</option><option value="star">星形</option>
                          <option value="svg">SVG 源码</option><option value="expression">表达式路径</option>
                        </select>
                      </label>
                      <div className="shader-actions">
                        <button onClick={()=>setJsonEdit("shape")}>编辑图形 JSON</button>
                        <button onClick={()=>download(new Blob([shapeSvg(selectedLayer.shape!,selectedLayer.width,selectedLayer.height)],{type:"image/svg+xml"}),selectedLayer.name+".svg")}>导出 SVG</button>
                      </div>
                    </>}
                    {selectedLayer.text && (
                      <>
                        <h3>文本浮层</h3>
                        <button onClick={()=>setJsonEdit("text")}>编辑文本动画 JSON</button>
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
                        <EffectGraphControls key={selectedLayer.id + ":text"} kind="text"
                          graph={selectedLayer.text.graph}
                          onChange={graph=>updateLayer(l=>{l.text!.graph=graph;})}
                          {...graphParameterControls(selectedLayer,"text")}/>
                        <AppearancePresetControls key={selectedLayer.id+":text-settings"} kind="text" data={textAppearance(selectedLayer)}
                          apply={preset=>updateLayer(l=>{
                            l.text={value:l.text!.value,...preset.style};
                            setAppearanceCurves(l,"text",preset.curves);
                          })}/>
                        <label className="stack-field">
                          旧版文本动画
                          <select
                            aria-label="文本动画"
                            value={selectedLayer.text.animation}
                            onChange={(e) =>
                              updateLayer((l) => {
                                l.text!.animation = e.target.value as TextAnimation;
                                l.text!.graph = undefined;
                              })
                            }
                          >
                            <option value="none">无</option>
                            <option value="typewriter">打字机</option>
                            <option value="fade">淡入淡出（片段渐变）</option>
                            <option value="typewriter-fade">
                              打字机 + 淡入淡出
                            </option>
                            <optgroup label="动效预设">
                              {Object.entries(titleMotions).map(([id, label]) =>
                                <option value={id} key={id}>{label}</option>
                              )}
                            </optgroup>
                          </select>
                        </label>
                        <button className="wide-button" onClick={() => {
                          const start = sRef.current.tracks
                            .flatMap(t => t.clips)
                            .filter(c => c.layerId === selectedLayer.id && c.kind === "visual" && c.enabled)
                            .reduce((first, c) => Math.min(first, c.start), Infinity);
                          if (Number.isFinite(start)) seek(start);
                        }}>
                          定位文字入场
                        </button>
                        {selectedLayer.text.animation.includes("typewriter") && <Num
                          label="打字速度 / 字每秒"
                          value={selectedLayer.text.charsPerSecond}
                          min={1}
                          max={100}
                          onChange={(v) =>
                            updateLayer((l) => {
                              l.text!.charsPerSecond = v;
                            })
                          }
                        />}
                        <label className="stack-field">
                          退场动效
                          <select aria-label="退场动效" value={selectedLayer.text.exit ?? ""} onChange={e =>
                            updateLayer(l => { l.text!.exit = (e.target.value || undefined) as TitleMotion | undefined; })
                          }>
                            <option value="">无</option>
                            {Object.entries(titleMotions)
                              .filter(([id]) => id !== "drift" && id !== "pulse")
                              .map(([id, label]) => <option value={id} key={id}>{label}</option>)}
                          </select>
                        </label>
                        {(isTitleMotion(selectedLayer.text.animation) || selectedLayer.text.exit) &&
                          <div className="property-grid">
                            {isTitleMotion(selectedLayer.text.animation) && !["drift", "pulse"].includes(selectedLayer.text.animation) &&
                              <Num label="入场时长 / 秒" min={.01} max={10} value={selectedLayer.text.entranceDuration ?? defaultTitleDuration}
                                onChange={v => updateLayer(l => { l.text!.entranceDuration = v; })} />}
                            {selectedLayer.text.exit &&
                              <Num label="退场时长 / 秒" min={.01} max={10} value={selectedLayer.text.exitDuration ?? .35}
                                onChange={v => updateLayer(l => { l.text!.exitDuration = v; })} />}
                            <Num label="动效幅度" min={0} max={1} value={selectedLayer.text.motionAmount ?? defaultTitleAmount}
                              onChange={v => updateLayer(l => { l.text!.motionAmount = v; })} />
                          </div>
                        }
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
                    <button className="wide-button" onClick={()=>openPreprocess(selectedLayer.model!.resourceId)}>
                      <Layers size={15}/> 编辑源模型素材
                    </button>
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
                          <button title={"在曲线中显示 "+p.id} aria-label={"在曲线中显示 "+p.id}
                            onClick={()=>openCurves({layerId:selectedLayer.id,channel:"param:"+p.id})}>
                            <Activity size={13}/>
                          </button>
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
                    <button className="wide-button" disabled={selectedLayer.locked}
                      onClick={()=>setGraphTarget(selectedLayer.id)}>
                      <Code2 size={15}/> 编辑此图层的效果节点
                    </button>
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
                    <ShaderControls
                      key={selectedLayer.id}
                      effects={selectedLayer.effects}
                      onRecipe={recipe => updateLayer(l => { l.effects.stylize = recipe; l.effects.graph = undefined; })}
                      amount={animated!.effects.stylizeMix ?? 1}
                      onAmount={v => setValue("effects.stylizeMix", v)}
                      onKey={() => setValue("effects.stylizeMix", animated!.effects.stylizeMix ?? 1, true)}
                      keyed={!!selectedLayer.animation["effects.stylizeMix"]?.length}
                    />
                    <EffectGraphControls key={selectedLayer.id + ":post"} kind="post"
                      graph={selectedLayer.effects.graph} legacy={selectedLayer.effects.stylize}
                      onChange={graph=>updateLayer(l=>{l.effects.graph=graph;})}
                      {...graphParameterControls(selectedLayer,"post")}/>
                    <AppearancePresetControls key={selectedLayer.id+":post-settings"} kind="post"
                      data={{effects:selectedLayer.effects,surface:selectedLayer.surface,
                        receiveLight:selectedLayer.receiveLight,curves:appearanceCurves(selectedLayer,"post")}}
                      apply={preset=>updateLayer(l=>{
                        l.effects=preset.effects;
                        l.surface=preset.surface;
                        l.receiveLight=preset.receiveLight;
                        setAppearanceCurves(l,"post",preset.curves);
                      })}/>
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
          </div>
        </aside>
      </div>
      <div
        className="timeline-slot"
        inert={modal==="settings"}
        hidden={montageMode}
        style={{
          display: montageMode ? "none" : undefined,
          visibility: modelWorkspace && !motionWorkspace ? "hidden" : "visible",
        }}
      >
        {modelWorkspace && <div ref={setMotionDock} className="model-dock-host" hidden={!motionWorkspace}/>}
        <div className={"timeline-original"+(visibleDesign?" agent-outline":"")} title={visibleDesign?"确认草稿后即可编辑":undefined}
          hidden={curveOpen || modelWorkspace} inert={!!visibleDesign}>
          <SceneTimeline
            visible={!montageMode && !curveOpen && workspaceMode === "scene"}
            scene={visibleDesign ?? scene}
            selectedLayerId={selected}
            selectedBinding={currentBinding}
            paramsByLayer={paramsByLayer}
            onSelectLayer={selectLayer}
            onBinding={selectProperty}
            onRecord={recordProperty}
            onValue={editProperty}
            onWriteKeys={(b, keys) => change((s) => writeProperty(s, b, keys))}
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
            onCurve={openCurves}
            autoKey={autoKey}
            onToggleAutoKey={()=>setAutoKey(value=>!value)}
          />
        </div>
        {curveOpen && workspaceMode === "scene" && (
          <div className="curve-area" inert={!!visibleDesign}>
            <div
              className="curve-resize"
              title="调整曲线区高度"
              onPointerDown={(e) => {
                const y = e.clientY,
                  start = e.currentTarget.parentElement!.clientHeight;
                watchPointer(
                  e,
                  (v) =>
                    setTimelineHeight(
                      clamp(
                        start + y - v.clientY,
                        210,
                        window.innerHeight * 0.62,
                      ) - 95,
                    ),
                  () => {},
                );
              }}
            />
            <CurveWorkspace
              scene={visibleDesign ?? scene}
              binding={currentBinding}
              paramsByLayer={paramsByLayer}
              seed={curveSeed}
              agentSelection={curveSelection}
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
        <span>{dirty ? "工程有改动" : "工程就绪"} · 本地离线 · {montageCommitted ? ".livemgs" : ".livemg"}</span>
      </footer>
      {contextMenu && (
        <div
          className="viewport-context popup-menu"
          role="menu"
          ref={menuRef}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.ids.length > 0 && (
            <>
              <small>
                {contextMenu.ids.length === 1
                  ? scene.layers.find(l => l.id === contextMenu.ids[0])?.name
                  : contextMenu.ids.length + " 个对象"}
              </small>
              <button role="menuitem" onClick={() => {
                copyObjects(contextMenu.ids);
                setContextMenu(undefined);
              }}>
                <Copy size={14} /> 复制对象 <kbd>Ctrl+C</kbd>
              </button>
            </>
          )}
          <button role="menuitem" disabled={!canPaste(true)} onClick={() => {
            pasteSelection(true);
            setContextMenu(undefined);
          }}>
            <ClipboardPaste size={14} /> 原地粘贴 <kbd>Ctrl+V</kbd>
          </button>
          {contextMenu.ids.length > 0 ? (
            <>
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
        accept=".livemgs,.livemg,.l2dstudio"
        ref={projectInput}
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) openProject(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <input type="file" accept=".livemg,.l2dstudio" aria-label="导入画布工程" ref={montageInput} hidden onChange={e=>{
        const file=e.target.files?.[0];e.target.value="";
        if(file) void importMontageCanvas(file);
      }}/>
      {editorGraph && graphTarget && createPortal(<React.Suspense fallback={null}>
        <ShaderGraphEditor key={(graphLocation?.canvasId??"")+":"+graphTarget} graph={editorGraph}
          preview={graphTarget==="@master" || foreignGraph || montageMode ? undefined : previewEffectGraph}
          scopeLabel={graphScope} targets={nodeTargets} target={graphTarget}
          selectTarget={id=>setGraphTarget(id,graphLocation?.canvasId)}
          readOnly={!!(editorDraft || designDraft || visibleMontageDraft || shaderDraft) || !nodeTarget?.available}
          readOnlyReason={!nodeTarget?.available ? "此图层已锁定" : undefined}
          close={()=>setGraphTarget(undefined)} change={graph=>writeScopedGraph(graphTarget,graph)}/>
      </React.Suspense>,document.body)}
      {jsonEdit && selectedLayer && !visibleDesign && <SceneJsonEditor kind={jsonEdit} key={selectedLayer.id+jsonEdit}
        value={jsonEdit==="shape" ? selectedLayer.shape : textAnimationFile(selectedLayer)} close={()=>setJsonEdit(undefined)}
        apply={value=>{
          if (jsonEdit==="shape") {
            const shape=validateShape(value); updateLayer(l=>{l.shape=shape;});
          } else {
            const candidate=structuredClone(selectedLayer);
            applyTextAnimation(candidate,value);
            updateLayer(l=>{l.text=candidate.text;l.animation=candidate.animation;});
          }
        }}/>}
      <AgentPanel documentId={() => shaderDocument.current} activeDocument={shaderDocument.current} runTool={runAgentTool}
        onTurnActive={active=>agentActivity.turn(active,active ? {layerId:selected,label:"正在思考"} : undefined)}
        settingsHost={settingsHost} onSettings={()=>showSettings("agent")} closeSettings={()=>setModal("")}
        mcp={<McpControls agent={shaderAgent} openGraph={setGraphTarget}/>}
        context={montageMode ? {
            label:"总时间线"+(agentMontageSource ? " / "+agentMontageSource.scene.name+" · 片段" : ""),
            instructions:"当前编辑范围为总时间线。总成片效果请使用 montage_edit。"+
              (agentMontageClip ? "选中片段 clipId="+agentMontageClip.id+"，源画布 canvasId="+agentMontageClip.canvasId+"。" : ""),
          }
          : workspaceMode==="preprocess" && preprocessingResource ? {
            label:scene.name+" / "+preprocessingResource.name+" / 模型素材",
            instructions:"当前模型素材 resourceId="+preprocessingResource.id+
              (montageCommitted ? "，canvasId="+montageCommitted.activeCanvasId : "")+"。素材效果请使用 preprocess 范围。",
          } : {
            label:scene.name+(selectedLayer ? " / "+selectedLayer.name : selected==="@camera" ? " / 成片相机" : ""),
            instructions:"当前画布"+(montageCommitted ? " canvasId="+montageCommitted.activeCanvasId : "")+
              (selected ? "；选中对象 ID="+selected : "")+(selectedClip ? "；选中片段 clipId="+selectedClip.id : "")+
              (selectedLayer && shaderTargets(inspection).some(t=>t.id===selectedLayer.id && t.available)
                ? "。如果请求指的是选中对象的效果，使用该对象 ID 作为明确的后处理目标。" : "。"),
          }}
        draft={editorAgentDraft} draftScope={draftScope}
        openGraph={target=>setGraphTarget(target,visibleMontageDraft?.targetCanvasId)}
        apply={montageDraft ? commitMontageDraft : designDraft ? applyDesignDraft : applyLocalGraphDraft}
        discard={montageDraft ? ()=>discardMontageDraft() : designDraft ? clearDesignDraft : () => clearShaderPreview()}/>
      {toast && <div className="toast">{toast}</div>}
      {busy && modal !== "export" && (
        <div className="busy-strip">
          <Loader2 size={15} className="spin" />
          {busy}
        </div>
      )}
      {modal==="settings" && (
        <div className="modal-backdrop studio-settings-backdrop" role="dialog" aria-modal="true" aria-label="FrameStudio 设置">
          <StudioSettings page={settingsTab} select={setSettingsTab} prefs={preferences} change={updatePreferences}
            close={()=>setModal("")} help={()=>setModal("help")} agent={<>
              <McpControls agent={shaderAgent} openGraph={id=>{setModal("");setGraphTarget(id);}}/>
              <div ref={setSettingsHost}/>
            </>}/>
        </div>
      )}
      {modal && modal!=="settings" && (
        <div className="modal-backdrop">
          <div
            className={`modal ${modal}-modal`}
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
                <h1>导出成片</h1>
                {(visibleDesign || visibleMontageDraft) && <p className="hint">请先应用或丢弃 Agent 草稿，再导出成片。</p>}
                {montageCommitted && <div className="export-range" aria-label="导出对象">
                  <button disabled={!!busy} aria-pressed={exportScope==="canvas"} onClick={()=>{setExportScope("canvas");setExportResult(null);setExportStatus("");}}>当前画布</button>
                  <button disabled={!!busy} aria-pressed={exportScope==="montage"} onClick={()=>{setExportScope("montage");setExportResult(null);setExportStatus("");}}>完整总时间线</button>
                </div>}
                <div className="export-summary" aria-label="成片规格">
                  <span><small>分辨率</small><strong>{(exportScope==="montage" ? montageCommitted??scene : scene).width} × {(exportScope==="montage" ? montageCommitted??scene : scene).height}</strong></span>
                  <span><small>帧率</small><strong>{(exportScope==="montage" ? montageCommitted??scene : scene).fps} fps</strong></span>
                  <span><small>时长</small><strong>{(exportScope==="montage" && montageCommitted ? montageEnd(montageCommitted) :
                    onlyWork ? scene.workArea.end-scene.workArea.start : scene.duration).toFixed(2)} s</strong></span>
                </div>
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
                      aria-pressed={exportFormat === id}
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
                <div className="export-range" aria-label="导出范围" style={exportScope==="montage"?{display:"none"}:undefined}>
                  <button disabled={!!busy} aria-pressed={!onlyWork} onClick={() => setOnlyWork(false)}>整段</button>
                  <button disabled={!!busy} aria-pressed={onlyWork} onClick={() => setOnlyWork(true)}>
                    工作区 {scene.workArea.start.toFixed(2)}–{scene.workArea.end.toFixed(2)} s
                  </button>
                </div>
                {exportStatus && (
                  <div className="export-progress" role="status">
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
                          (exportScope==="montage" ? montageCommitted?.name??scene.name : scene.name) +
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
