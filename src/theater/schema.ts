import {
  Asset,
  Clip,
  Curve,
  Effects,
  Group,
  Key,
  Project,
  defaultEffects,
  uid,
} from "../types";
import type { TextAnimation, TitleMotion } from "./text-motion";
import type { ShaderRecipe } from "./stylize";
import type { ModelLook } from "./model-look";
export type Transform = {
  x: number;
  y: number;
  z: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  rotationX: number;
  rotationY: number;
  opacity: number;
};
export type SceneEffects = Effects & {
  blur: number;
  blurMode?: "gaussian" | "lens";
  bokeh?: number;
  stylize?: ShaderRecipe;
  stylizeMix?: number;
};
export type MediaAsset = {
  id: string;
  name: string;
  kind: "image" | "audio" | "font";
  path: string;
  duration: number;
  width?: number;
  height?: number;
  waveform?: number[];
  cues?: { start: number; end: number; value: string }[];
  analysis?: string;
  fontFamily?: string;
};
export type ModelResource = {
  id: string;
  name: string;
  modelId: string;
  file: string;
  assets: Asset[];
  preprocess?: { enabled: boolean; effects: SceneEffects; look?: ModelLook };
};
export type SceneLight = {
  type: "point" | "area" | "sun" | "ambient";
  color: string;
  intensity: number;
  range: number;
  decay: number;
  width: number;
  height: number;
  specular: number;
  rim: number;
  targets: string[];
};
export const MAX_SCENE_LIGHTS = 16;
export const defaultLight = (
  type: SceneLight["type"] = "point",
): SceneLight => ({
  type,
  color: "#fff1df",
  intensity: type === "ambient" ? 0.25 : 1,
  range: 1800,
  decay: 2,
  width: 600,
  height: 400,
  specular: 0.25,
  rim: 0.3,
  targets: [],
});
export type Layer = {
  id: string;
  name: string;
  kind:
    | "model"
    | "image"
    | "text"
    | "color"
    | "adjustment"
    | "group"
    | "audio"
    | "light";
  parentId: string | null;
  visible: boolean;
  locked: boolean;
  is3D: boolean;
  depthMode?: "scene" | "stack";
  blend: "normal" | "add" | "multiply" | "screen";
  width: number;
  height: number;
  transform: Transform;
  animation: Record<string, Key[]>;
  effects: SceneEffects;
  light?: SceneLight;
  receiveLight?: boolean;
  surface?: { roughness: number; specular: number; rim: number; bump: number };
  assetId?: string;
  color?: string;
  text?: {
    value: string;
    fontFamily: string;
    fontSize: number;
    fill: string;
    align: "left" | "center" | "right";
    stroke: string;
    strokeWidth: number;
    animation: TextAnimation;
    charsPerSecond: number;
    entranceDuration?: number;
    exit?: TitleMotion;
    exitDuration?: number;
    motionAmount?: number;
  };
  model?: {
    resourceId: string;
    physics: boolean;
    parameterMap: Record<string, string>;
    groupOverrides: Record<string, Group>;
    baseValues: Record<string, number>;
    keys: Curve[];
    lipOpen: string;
    lipForm: string;
  };
};
export type SceneClip = Clip & {
  kind: "visual" | "motion" | "audio";
  layerId: string;
  name: string;
  lipTarget: string;
  lipEnabled: boolean;
  lipWeight?: number;
  fadeCurve: "linear" | "equalPower";
  gainKeys: Key[];
};
export type SceneTrack = {
  id: string;
  name: string;
  locked: boolean;
  muted: boolean;
  solo: boolean;
  clips: SceneClip[];
};
export type Camera = {
  x: number;
  y: number;
  z: number;
  zoom: number;
  focalLength: number;
  focusZ: number;
  aperture: number;
  dof: boolean;
  blurMode?: "gaussian" | "lens";
  animation: Record<string, Key[]>;
};
export type Scene = {
  format: "livemg";
  version: 2;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  models: ModelResource[];
  assets: MediaAsset[];
  layers: Layer[];
  tracks: SceneTrack[];
  camera: Camera;
  depthOcclusion?: boolean;
  lighting?: {
    enabled: boolean;
    ambient: number;
    color: string;
    exposure: number;
  };
  workArea: { start: number; end: number; loop: boolean };
  markers: { id: string; t: number; name: string }[];
};
export const sceneEffects = (): SceneEffects => ({
  ...defaultEffects,
  blur: 0,
  blurMode: "gaussian",
  bokeh: 0.25,
});
export const transform = (): Transform => ({
  x: 0,
  y: 0,
  z: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  rotationX: 0,
  rotationY: 0,
  opacity: 1,
});
export const track = (name: string): SceneTrack => ({
  id: uid(),
  name,
  locked: false,
  muted: false,
  solo: false,
  clips: [],
});
export function emptyScene(): Scene {
  return {
    format: "livemg",
    version: 2,
    id: uid(),
    name: "未命名小剧场",
    width: 1280,
    height: 720,
    fps: 30,
    duration: 12,
    models: [],
    assets: [],
    layers: [],
    tracks: [
      track("轨道 1"),
      track("轨道 2"),
      track("轨道 3"),
      track("轨道 4"),
    ],
    camera: {
      x: 0,
      y: 0,
      z: 0,
      zoom: 1,
      focalLength: 1200,
      focusZ: 0,
      aperture: 0.6,
      dof: false,
      animation: {},
    },
    workArea: { start: 0, end: 12, loop: false },
    markers: [],
  };
}
export function layer(kind: Layer["kind"], name: string): Layer {
  return {
    id: uid(),
    name,
    kind,
    parentId: null,
    visible: true,
    locked: false,
    is3D: kind === "model",
    blend: "normal",
    width: 640,
    height: 360,
    transform: transform(),
    animation: {},
    effects: sceneEffects(),
    ...(kind === "text"
      ? {
          text: {
            value: "在这里写下对白",
            fontFamily: "Microsoft YaHei",
            fontSize: 48,
            fill: "#ffffff",
            align: "center",
            stroke: "#30303a",
            strokeWidth: 0,
            animation: "typewriter-fade",
            charsPerSecond: 12,
          },
        }
      : {}),
    ...(kind === "color" ? { color: "#dcd4ed" } : {}),
    ...(kind === "light"
      ? {
          is3D: true,
          width: 32,
          height: 32,
          light: defaultLight(),
          transform: { ...transform(), x: -200, y: -200, z: -500 },
        }
      : {}),
  };
}
export function sceneClip(
  kind: SceneClip["kind"],
  layerId: string,
  assetId: string,
  name: string,
  start = 0,
  duration = 3,
): SceneClip {
  return {
    id: uid(),
    kind,
    layerId,
    assetId,
    name,
    start,
    duration,
    trimIn: 0,
    speed: 1,
    weight: 1,
    fadeIn: kind === "audio" ? 0.05 : kind === "visual" ? 0 : 0.2,
    fadeOut: kind === "audio" ? 0.15 : kind === "visual" ? 0.15 : 0.2,
    blend: kind === "motion" ? "mix" : "override",
    disabledGroups: [],
    disabledIds: [],
    loop: false,
    enabled: true,
    lipTarget: "",
    lipEnabled: false,
    fadeCurve: "linear",
    gainKeys: [],
  };
}
export function addVisual(
  s: Scene,
  l: Layer,
  start = 0,
  duration = s.duration,
) {
  s.layers.push(l);
  const tr =
    s.tracks.find((t) => !t.clips.length) ||
    track("轨道 " + (s.tracks.length + 1));
  if (!s.tracks.includes(tr)) s.tracks.push(tr);
  tr.clips.push(sceneClip("visual", l.id, l.id, l.name, start, duration));
}
export function migrateScene(p: Scene | Project): Scene {
  if (p.version === 2)
    return {
      ...p,
      tracks: p.tracks.flatMap((t) =>
        t.clips.length > 1
          ? t.clips.map((c) => ({ ...t, id: t.id + ":" + c.id, clips: [c] }))
          : [t],
      ),
    };
  const s = emptyScene();
  Object.assign(s, {
    name: p.name,
    width: p.width,
    height: p.height,
    fps: p.fps,
    duration: p.duration,
    workArea: { start: 0, end: p.duration, loop: false },
  });
  const r: ModelResource = {
    id: uid(),
    name: p.name,
    modelId: p.modelId,
    file: p.modelFile,
    assets: p.assets.filter((a) => a.kind !== "audio"),
  };
  s.models = [r];
  const m = layer("model", "角色 1");
  m.width = p.width * 0.6;
  m.height = p.view === "bust" ? p.height * 1.9 : p.height * 0.92;
  m.transform = {
    ...transform(),
    x: p.transform.x * p.width,
    y: p.transform.y * p.height,
    scaleX: p.transform.scale,
    scaleY: p.transform.scale,
    rotation: p.transform.rotation,
  };
  m.effects = { ...p.effects, blur: 0 };
  m.model = {
    resourceId: r.id,
    physics: p.physics,
    parameterMap: p.parameterMap,
    groupOverrides: p.groupOverrides,
    baseValues: {},
    keys: [],
    lipOpen: "ParamMouthOpenY",
    lipForm: "ParamMouthForm",
  };
  s.layers = [m];
  s.tracks = [
    {
      ...track("画面"),
      clips: [sceneClip("visual", m.id, m.id, m.name, 0, p.duration)],
    },
    ...p.tracks.map((t) => ({
      ...track(t.name),
      muted: t.muted,
      solo: t.solo,
      clips: t.clips.map((c) => {
        const a = p.assets.find((a) => a.id === c.assetId);
        if (a?.kind === "audio") {
          let ma = s.assets.find((x) => x.id === a.id);
          if (!ma) {
            ma = {
              id: a.id,
              name: a.name,
              kind: "audio",
              path: a.audioPath!,
              duration: a.duration,
              waveform: a.waveform,
              cues: a.cues,
              analysis: a.analysis,
            };
            s.assets.push(ma);
          }
          let al = s.layers.find(
            (l) => l.kind === "audio" && l.assetId === a.id,
          );
          if (!al) {
            al = layer("audio", a.name);
            al.assetId = a.id;
            s.layers.push(al);
          }
          return {
            ...sceneClip("audio", al.id, a.id, a.name),
            ...c,
            kind: "audio" as const,
            layerId: al.id,
            lipTarget: m.id,
            lipEnabled: true,
          };
        }
        return {
          ...sceneClip("motion", m.id, c.assetId, a?.name || "动作"),
          ...c,
          kind: "motion" as const,
          layerId: m.id,
        };
      }),
    })),
  ];
  return s;
}
export const channels = [
  ["x", "位置 X"],
  ["y", "位置 Y"],
  ["z", "深度 Z"],
  ["scaleX", "缩放 X"],
  ["scaleY", "缩放 Y"],
  ["rotation", "旋转 Z"],
  ["rotationX", "旋转 X"],
  ["rotationY", "旋转 Y"],
  ["opacity", "不透明度"],
  ["effects.brightness", "亮度"],
  ["effects.contrast", "对比度"],
  ["effects.saturation", "饱和度"],
  ["effects.glow", "边缘发光"],
  ["effects.bloom", "泛光"],
  ["effects.blur", "模糊"],
  ["effects.outline", "描边"],
  ["effects.bokeh", "散景高光"],
  ["effects.lightX", "灯光 X"],
  ["effects.lightY", "灯光 Y"],
  ["effects.lightIntensity", "灯光强度"],
  ["effects.rim", "轮廓光"],
  ["effects.gloss", "光泽"],
  ["reveal", "文本显示比例"],
] as const;
export const cameraChannels = [
  ["x", "相机 X"],
  ["y", "相机 Y"],
  ["z", "相机 Z"],
  ["zoom", "镜头缩放"],
  ["focusZ", "焦平面 Z"],
  ["aperture", "景深强度"],
] as const;
