export type Group = "body" | "expression" | "mouth" | "physics" | "other";
export type Mode = "linear" | "bezier" | "step" | "inverse";
export type Key = {
  t: number;
  v: number;
  mode: Mode;
  out?: [number, number];
  in?: [number, number];
};
export type Curve = {
  id: string;
  target: "Parameter" | "PartOpacity" | "Model";
  keys: Key[];
  fadeIn?: number;
  fadeOut?: number;
};
export type Asset = {
  id: string;
  name: string;
  kind: "motion" | "expression" | "keyframe" | "audio";
  duration: number;
  fps: number;
  curves: Curve[];
  source?: string;
  expression?: { id: string; value: number; blend: string }[];
  audioPath?: string;
  waveform?: number[];
  cues?: { start: number; end: number; value: string }[];
  analysis?: string;
  fadeIn?: number;
  fadeOut?: number;
};
export type Clip = {
  id: string;
  assetId: string;
  start: number;
  trimIn: number;
  duration: number;
  speed: number;
  weight: number;
  fadeIn: number;
  fadeOut: number;
  blend: "mix" | "add" | "override";
  disabledGroups: Group[];
  disabledIds: string[];
  loop: boolean;
  enabled: boolean;
};
export type Track = {
  id: string;
  name: string;
  type: "generic" | "motion" | "expression" | "keyframe" | "audio";
  muted: boolean;
  solo: boolean;
  clips: Clip[];
};
export type Param = {
  id: string;
  name: string;
  min: number;
  max: number;
  default: number;
  group: Group;
};
export type Effects = {
  outline: number;
  outlineColor: string;
  glow: number;
  glowColor: string;
  bloom: number;
  brightness: number;
  contrast: number;
  saturation: number;
  lightType: "off" | "point" | "area" | "sun";
  lightX: number;
  lightY: number;
  lightIntensity: number;
  lightColor: string;
  rim: number;
  gloss: number;
};
export type Project = {
  version: 1;
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  modelId: string;
  modelFile: string;
  assets: Asset[];
  tracks: Track[];
  groupOverrides: Record<string, Group>;
  parameterMap: Record<string, string>;
  transform: { x: number; y: number; scale: number; rotation: number };
  effects: Effects;
  physics: boolean;
  view: "full" | "bust";
};
export type ModelEntry = {
  id: string;
  name: string;
  files: { path: string; name: string }[];
};
export const defaultEffects: Effects = {
  outline: 0,
  outlineColor: "#ffffff",
  glow: 0,
  glowColor: "#bcb5ff",
  bloom: 0,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  lightType: "off",
  lightX: 0.25,
  lightY: 0.2,
  lightIntensity: 0.3,
  lightColor: "#ffe5c6",
  rim: 0,
  gloss: 0,
};
export const groupNames: Record<Group, string> = {
  body: "身体 / 姿态",
  expression: "眼睛 / 表情",
  mouth: "嘴部 / 口型",
  physics: "头发 / 服装",
  other: "其他参数",
};
export const uid = () => crypto.randomUUID();
export function emptyProject(): Project {
  return {
    version: 1,
    name: "未命名作品",
    width: 1080,
    height: 1080,
    fps: 30,
    duration: 12,
    modelId: "demo",
    modelFile: "coat/coat.model3.json",
    assets: [],
    tracks: Array.from({length:4},(_,i)=>({id:uid(),name:`轨道 ${i+1}`,type:'generic' as const,muted:false,solo:false,clips:[]})),
    groupOverrides: {},
    parameterMap: {},
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    effects: { ...defaultEffects },
    physics: true,
    view: "full",
  };
}
export function normalizeTracks(p:Project){for(const tr of p.tracks)tr.type='generic';return p;}
