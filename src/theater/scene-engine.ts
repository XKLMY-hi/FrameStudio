import { Asset, Curve, Key, Param, Project, defaultEffects, uid } from "../types";
import { clamp, cuesToCurves, evaluate, sampleCurve } from "../engine";
import {
  Camera,
  Layer,
  Scene,
  SceneClip,
  SceneTrack,
  Transform,
} from "./schema";
import { current, isDraft } from "immer";
import { titleCharacters } from "./text-motion";
export function cloneData<T>(value: T): T {
  return structuredClone(isDraft(value) ? current(value as any) : value);
}
export function splitSceneClip(clip: SceneClip, time: number): SceneClip | undefined {
  const cut = time - clip.start;
  if (cut <= 0 || cut >= clip.duration) return;
  const right = {
    ...cloneData(clip),
    id: uid(),
    start: time,
    duration: clip.duration - cut,
    trimIn: clip.trimIn + cut * clip.speed,
    fadeIn: 0,
  };
  if (clip.kind === "audio" && clip.gainKeys.length) {
    const value = sampleKeys(clip.gainKeys,cut,1);
    right.gainKeys = [
      {t:0,v:value,mode:"linear"},
      ...right.gainKeys.filter(k=>k.t>cut).map(k=>({...k,t:k.t-cut})),
    ];
    clip.gainKeys = [...clip.gainKeys.filter(k=>k.t<cut),{t:cut,v:value,mode:"linear"}];
  }
  clip.duration = cut;
  clip.fadeOut = 0;
  return right;
}
export function sampleKeys(keys: Key[] | undefined, t: number, base: number) {
  return keys?.length
    ? sampleCurve({ id: "", target: "Parameter", keys }, t)
    : base;
}
export function enabledTracks(s: Scene) {
  const lights = new Set(
    s.layers.filter((l) => l.kind === "light").map((l) => l.id),
  );
  const lightOnly = (t: SceneTrack) =>
    t.clips.length > 0 && t.clips.every((c) => lights.has(c.layerId));
  const solo = s.tracks.some(
    (t) =>
      t.solo && !t.muted && !lightOnly(t) && t.clips.some((c) => c.enabled),
  );
  return s.tracks.filter((t) => !t.muted && (!solo || t.solo || lightOnly(t)));
}
export function previewFrameTime(duration:number,fps:number,time:number) {
  if(time<duration) return Math.max(0,time);
  return Math.max(0,Math.ceil(duration*fps-1e-9)-1)/fps;
}
export function active(c: SceneClip, t: number) {
  return c.enabled && t >= c.start && t < c.start + c.duration;
}
export function sourceTime(c: SceneClip, t: number, duration = Infinity) {
  const v = c.trimIn + (t - c.start) * c.speed;
  return c.loop && Number.isFinite(duration) && duration > 0
    ? ((v % duration) + duration) % duration
    : Math.max(0, v);
}
export function fade(c: SceneClip, t: number) {
  if (!active(c, t)) return 0;
  let a = c.fadeIn > 0 ? clamp((t - c.start) / c.fadeIn, 0, 1) : 1,
    b = c.fadeOut > 0 ? clamp((c.start + c.duration - t) / c.fadeOut, 0, 1) : 1;
  if (c.fadeCurve === "equalPower") {
    a = Math.sin((a * Math.PI) / 2);
    b = Math.sin((b * Math.PI) / 2);
  }
  return c.weight * a * b;
}
function indexVisualClips(s: Scene) {
  const enabled = new Set(enabledTracks(s));
  const primary = new Map<string, SceneClip[]>(),
    fallback = new Map<string, SceneClip[]>();
  const soloOwners = new Set<string>();
  const append = (map: Map<string, SceneClip[]>, c: SceneClip) => {
    if (!map.has(c.layerId)) map.set(c.layerId, []);
    map.get(c.layerId)!.push(c);
  };
  for (const tr of s.tracks) {
    if (tr.muted) continue;
    for (const c of tr.clips) {
      if (c.kind === "visual") {
        append(fallback, c);
        if (enabled.has(tr)) append(primary, c);
      } else if (tr.solo && enabled.has(tr)) {
        if (c.kind === "motion") soloOwners.add(c.layerId);
        else if (c.lipTarget) soloOwners.add(c.lipTarget);
      }
    }
  }
  return { primary, fallback, soloOwners };
}
const visualIndex = new WeakMap<Scene, ReturnType<typeof indexVisualClips>>();
export function visualClip(s: Scene, id: string, t: number) {
  const cacheable = Object.isFrozen(s) && !isDraft(s);
  let idx = cacheable ? visualIndex.get(s) : undefined;
  if (!idx) {
    idx = indexVisualClips(s);
    if (cacheable) visualIndex.set(s, idx);
  }
  return (
    idx.primary.get(id)?.find((c) => active(c, t)) ??
    (idx.soloOwners.has(id)
      ? idx.fallback.get(id)?.find((c) => active(c, t))
      : undefined)
  );
}
export function localLayerTime(s: Scene, l: Layer, t: number) {
  const c = visualClip(s, l.id, t);
  return c ? sourceTime(c, t) : t;
}
export function animatedLayer(s: Scene, l: Layer, t: number): Layer {
  const local = localLayerTime(s, l, t),
    v = {
      ...l,
      transform: { ...l.transform },
      effects: { ...l.effects },
      light: l.light ? { ...l.light } : undefined,
      surface: {
        roughness: 0.55,
        specular: 0.25,
        rim: 0.25,
        bump: 0,
        ...l.surface,
      },
    };
  for (const [id, k] of Object.entries(l.animation)) {
    if (id.startsWith("postGraph.")) {
      const key = id.slice(10), param = l.effects.graph?.parameters?.[key];
      if (param) (v.effects.graphValues ??= {})[key] = sampleKeys(k,local,param.value);
    } else if (id.startsWith("effects."))
      (v.effects as any)[id.slice(8)] = sampleKeys(
        k,
        local,
        (l.effects as any)[id.slice(8)],
      );
    else if (id.startsWith("light.") && v.light)
      (v.light as any)[id.slice(6)] = sampleKeys(
        k,
        local,
        (l.light as any)[id.slice(6)],
      );
    else if (id.startsWith("surface.") && v.surface)
      (v.surface as any)[id.slice(8)] = sampleKeys(
        k,
        local,
        (v.surface as any)[id.slice(8)],
      );
    else if (id in v.transform)
      (v.transform as any)[id] = sampleKeys(k, local, (l.transform as any)[id]);
  }
  return v;
}
export function animatedCamera(s: Scene, t: number): Camera {
  const c = { ...s.camera };
  for (const [id, k] of Object.entries(c.animation))
    (c as any)[id] = sampleKeys(k, t, (s.camera as any)[id]);
  return c;
}
export function layerVisible(
  s: Scene,
  l: Layer,
  t: number,
  seen = new Set<string>(),
): boolean {
  if (seen.has(l.id) || !l.visible) return false;
  seen.add(l.id);
  if (l.parentId) {
    const parent = s.layers.find((v) => v.id === l.parentId);
    if (!parent || !layerVisible(s, parent, t, seen)) return false;
  }
  if (l.kind === "group" || l.kind === "audio") return true;
  return !!visualClip(s, l.id, t);
}
export function layerAlpha(
  s: Scene,
  l: Layer,
  t: number,
  seen = new Set<string>(),
): number {
  if (seen.has(l.id) || !layerVisible(s, l, t)) return 0;
  seen.add(l.id);
  let a = animatedLayer(s, l, t).transform.opacity;
  const c = visualClip(s, l.id, t);
  if (c) a *= fade(c, t);
  if (l.parentId) {
    const p = s.layers.find((v) => v.id === l.parentId);
    if (p) a *= layerAlpha(s, p, t, seen);
  }
  return clamp(a, 0, 1);
}
export function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
export function multiply(a: number[], b: number[]) {
  const r = Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let i = 0; i < 4; i++)
      for (let k = 0; k < 4; k++) r[c * 4 + i] += a[k * 4 + i] * b[c * 4 + k];
  return r;
}
export function transformMatrix(t: Transform, threeD = true) {
  const z = (t.rotation * Math.PI) / 180,
    x = ((threeD ? t.rotationX : 0) * Math.PI) / 180,
    y = ((threeD ? t.rotationY : 0) * Math.PI) / 180;
  const rz = [
      Math.cos(z),
      Math.sin(z),
      0,
      0,
      -Math.sin(z),
      Math.cos(z),
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
    ],
    rx = [
      1,
      0,
      0,
      0,
      0,
      Math.cos(x),
      Math.sin(x),
      0,
      0,
      -Math.sin(x),
      Math.cos(x),
      0,
      0,
      0,
      0,
      1,
    ],
    ry = [
      Math.cos(y),
      0,
      -Math.sin(y),
      0,
      0,
      1,
      0,
      0,
      Math.sin(y),
      0,
      Math.cos(y),
      0,
      0,
      0,
      0,
      1,
    ];
  const tr = identity();
  tr[12] = t.x;
  tr[13] = t.y;
  tr[14] = threeD ? t.z : 0;
  const sc = identity();
  sc[0] = t.scaleX;
  sc[5] = t.scaleY;
  return multiply(multiply(multiply(multiply(tr, rz), ry), rx), sc);
}
export function worldMatrix(
  s: Scene,
  l: Layer,
  t: number,
  seen = new Set<string>(),
): number[] {
  if (seen.has(l.id)) return identity();
  seen.add(l.id);
  const m = transformMatrix(animatedLayer(s, l, t).transform, l.is3D);
  const p = l.parentId ? s.layers.find((x) => x.id === l.parentId) : null;
  return p ? multiply(worldMatrix(s, p, t, seen), m) : m;
}
export function projectPoint(m: number[], x: number, y: number, c: Camera) {
  const wx = m[0] * x + m[4] * y + m[12],
    wy = m[1] * x + m[5] * y + m[13],
    z = m[2] * x + m[6] * y + m[14],
    depth = Math.max(20, c.focalLength + z - c.z),
    scale = (c.focalLength / depth) * c.zoom;
  return { x: (wx - c.x) * scale, y: (wy - c.y) * scale, z, depth };
}
export function dofBlur(z: number, c: Camera) {
  return c.dof
    ? Math.min(
        32,
        (Math.abs(z - c.focusZ) / Math.max(100, c.focalLength + z - c.z)) *
          c.aperture *
          35,
      )
    : 0;
}
export function spatialLayer(
  s: Scene,
  l: Layer,
  seen = new Set<string>(),
): boolean {
  if (l.is3D) return true;
  if (seen.has(l.id) || !l.parentId) return false;
  seen.add(l.id);
  const p = s.layers.find((p) => p.id === l.parentId);
  return p ? spatialLayer(s, p, seen) : false;
}
export function textAt(s: Scene, l: Layer, t: number) {
  if (!l.text) return "";
  const typewriter = !l.text.graph && l.text.animation?.includes("typewriter");
  if (!typewriter && !l.animation.reveal?.length) return l.text.value;
  const value = l.text.value,
    local = localLayerTime(s, l, t),
    characters = titleCharacters(value);
  let n = 1;
  if (typewriter)
    n = clamp(
      (local * l.text.charsPerSecond) / Math.max(1, characters.length),
      0,
      1,
    );
  n = sampleKeys(l.animation.reveal, local, n);
  return characters
    .slice(0, Math.floor(characters.length * clamp(n, 0, 1)))
    .join("");
}
const graphCache = new WeakMap<Scene, Map<string, Project>>();
export function modelProject(s: Scene, l: Layer): Project {
  let cache = graphCache.get(s);
  if (!cache) {
    cache = new Map();
    graphCache.set(s, cache);
  }
  const cached = cache.get(l.id);
  if (cached) return cached;
  const config = l.model!,
    resource = s.models.find((r) => r.id === config.resourceId)!;
  const assets = [...resource.assets];
  const tracks = enabledTracks(s).map((tr) => ({
    id: tr.id,
    name: tr.name,
    type: "generic" as const,
    muted: false,
    solo: false,
    clips: tr.clips
      .filter((c) => c.kind === "motion" && c.layerId === l.id)
      .map((c) => ({ ...c })),
  }));
  for (const tr of enabledTracks(s))
    for (const c of tr.clips) {
      if (c.kind !== "audio" || !c.lipEnabled || c.lipTarget !== l.id) continue;
      const a = s.assets.find((a) => a.id === c.assetId);
      if (!a?.cues?.length) continue;
      const id = "lip:" + c.id;
      assets.push({
        id,
        name: "口型",
        kind: "audio",
        duration: a.duration,
        fps: s.fps,
        curves: cuesToCurves(
          a.cues,
          a.duration,
          config.lipOpen,
          config.lipForm,
        ),
      });
      tracks.push({
        id,
        name: "口型",
        type: "generic",
        muted: false,
        solo: false,
        clips: [
          { ...c, assetId: id, weight: c.lipWeight ?? 1, blend: "override" },
        ],
      });
    }
  if (config.keys.length) {
    const id = "keys:" + l.id;
    assets.push({
      id,
      name: "模型参数",
      kind: "keyframe",
      duration: Math.max(
        s.duration,
        ...config.keys.flatMap((c) => c.keys.map((k) => k.t)),
      ),
      fps: s.fps,
      curves: config.keys,
    });
    const vc = enabledTracks(s)
      .flatMap((t) => t.clips)
      .filter((c) => c.kind === "visual" && c.layerId === l.id);
    tracks.push({
      id,
      name: "模型参数",
      type: "generic",
      muted: false,
      solo: false,
      clips: vc.map((c) => ({
        ...c,
        assetId: id,
        fadeIn: 0,
        fadeOut: 0,
        blend: "override",
      })),
    });
  }
  const p: Project = {
    version: 1,
    name: l.name,
    width: s.width,
    height: s.height,
    fps: s.fps,
    duration: s.duration,
    modelId: resource.modelId,
    modelFile: resource.file,
    assets,
    tracks,
    groupOverrides: config.groupOverrides,
    parameterMap: config.parameterMap,
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    effects: { ...defaultEffects },
    physics: config.physics,
    view: "full",
  };
  cache.set(l.id, p);
  return p;
}
export function modelValues(s: Scene, l: Layer, params: Param[], t: number) {
  return evaluate(
    modelProject(s, l),
    params.map((p) => ({
      ...p,
      default: l.model!.baseValues[p.id] ?? p.default,
    })),
    t,
  ).parameters;
}
export function audioGain(s: Scene, c: SceneClip, t: number) {
  const l = s.layers.find((l) => l.id === c.layerId);
  return (
    fade(c, t) *
    (l ? layerAlpha(s, l, t) : 1) *
    clamp(sampleKeys(c.gainKeys, t - c.start, 1), 0, 1)
  );
}
export function collectAudio(s: Scene, start = 0, end = s.duration) {
  return enabledTracks(s)
    .flatMap((t) => t.clips)
    .filter(
      (c) =>
        c.kind === "audio" &&
        c.enabled &&
        c.start < end &&
        c.start + c.duration > start,
    )
    .flatMap((c) => {
      const a = s.assets.find((a) => a.id === c.assetId),
        l = s.layers.find((l) => l.id === c.layerId);
      if (!a || !l || !l.visible) return [];
      const first = Math.max(start, c.start),
        last = Math.min(end, c.start + c.duration),
        duration = last - first;
      return [
        {
          path: a.path,
          start: first - start,
          duration,
          speed: c.speed,
          trimIn: sourceTime(c, first, a.duration),
          loop: c.loop,
          weight: 1,
          fadeIn: 0,
          fadeOut: 0,
          volumeSamples: Array.from(
            { length: Math.ceil(duration * 60) + 1 },
            (_, i) => ({
              t: Math.min(duration, i / 60),
              v: audioGain(s, c, Math.min(last - 1e-7, first + i / 60)),
            }),
          ),
        },
      ];
    });
}
export function upsertKey(keys: Key[], t: number, v: number, fps: number) {
  const found = keys.find((k) => Math.abs(k.t - t) < 0.5 / fps);
  if (found) found.v = v;
  else keys.push({ t, v, mode: "bezier" });
  keys.sort((a, b) => a.t - b.t);
}
export function reparentSafe(s: Scene, id: string, parentId: string | null) {
  if (id === parentId) return false;
  let p = parentId,
    seen = new Set<string>();
  while (p) {
    if (p === id || seen.has(p)) return false;
    seen.add(p);
    p = s.layers.find((l) => l.id === p)?.parentId || null;
  }
  const l = s.layers.find((l) => l.id === id);
  if (l) l.parentId = parentId;
  return !!l;
}
export type LayerClipboard = {
  sceneId: string;
  roots: string[];
  layers: Layer[];
  tracks: SceneTrack[];
  parentOffsets: Record<string, [number, number, number]>;
};

export function copyLayerTrees(s: Scene, selection: readonly string[], t = 0): LayerClipboard {
  const layerIndex = new Map(s.layers.map(l => [l.id, l]));
  const selected = new Set(selection);
  const roots = s.layers.filter(l => {
    if (!selected.has(l.id)) return false;
    const seen = new Set([l.id]);
    for (let parent = l.parentId; parent && !seen.has(parent); parent = layerIndex.get(parent)?.parentId ?? null) {
      if (selected.has(parent)) return false;
      seen.add(parent);
    }
    return true;
  });
  const ids = new Set(roots.map(l => l.id));
  let more = true;
  while (more) {
    more = false;
    for (const l of s.layers)
      if (l.parentId && ids.has(l.parentId) && !ids.has(l.id)) {
        ids.add(l.id);
        more = true;
      }
  }
  const parentOffsets: LayerClipboard["parentOffsets"] = {};
  for (const root of roots) {
    const matrix = worldMatrix(s, root, t);
    const { x, y, z } = animatedLayer(s, root, t).transform;
    parentOffsets[root.id] = [matrix[12] - x, matrix[13] - y, matrix[14] - z];
  }
  return {
    sceneId: s.id,
    roots: roots.map(l => l.id),
    layers: s.layers.filter(l => ids.has(l.id)).map(cloneData),
    tracks: s.tracks.flatMap(tr => {
      const clips = tr.clips.filter(c => ids.has(c.layerId)).map(cloneData);
      return clips.length ? [{ ...cloneData(tr), clips }] : [];
    }),
    parentOffsets,
  };
}

export function pasteLayerTrees(s: Scene, copied: LayerClipboard, offset = 0) {
  if (s.id !== copied.sceneId) return [];
  const map = new Map(copied.layers.map((l) => [l.id, crypto.randomUUID()]));
  const roots = new Set(copied.roots);
  const layers = copied.layers.map((original) => {
      const l = cloneData(original);
      l.id = map.get(l.id)!;
      if (l.parentId && map.has(l.parentId)) l.parentId = map.get(l.parentId)!;
      else if (l.parentId && !s.layers.some(parent => parent.id === l.parentId)) {
        l.parentId = null;
        const position = copied.parentOffsets[original.id];
        if (position) {
          // An absent parent cannot contribute its transform to the pasted layer.
          for (const [index, id] of (["x", "y", "z"] as const).entries()) {
            const shift = position[index];
            l.transform[id] += shift;
            for (const key of l.animation[id] ?? []) key.v += shift;
          }
        }
      }
      if (l.light)
        l.light.targets = l.light.targets.map((id) => map.get(id) || id);
      if (roots.has(original.id)) {
        l.name += " 副本";
        l.transform.x += offset;
        for (const key of l.animation.x ?? []) key.v += offset;
      }
      return l;
    });
  const tracks: SceneTrack[] = [];
  for (const tr of copied.tracks) {
    const clips = tr.clips
      .map((c) => ({
        ...cloneData(c),
        id: crypto.randomUUID(),
        layerId: map.get(c.layerId)!,
        assetId: c.kind === "visual" ? map.get(c.layerId)! : c.assetId,
        lipTarget: map.get(c.lipTarget) || c.lipTarget,
      }));
    if (clips.length)
      tracks.push({
        id: crypto.randomUUID(),
        name: tr.name + " 副本",
        locked: false,
        muted: tr.muted,
        solo: false,
        clips,
      });
  }
  s.layers.push(...layers);
  s.tracks.push(...tracks);
  return copied.roots.map(id => map.get(id)!);
}

export function duplicateTree(s: Scene, id: string) {
  return pasteLayerTrees(s, copyLayerTrees(s, [id]), 80)[0];
}
