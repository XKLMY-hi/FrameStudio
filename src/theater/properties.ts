import { Key, Param, uid } from "../types";
import { clamp, classify } from "../engine";
import { Scene, Layer, SceneClip, channels, cameraChannels } from "./schema";
import {
  cloneData,
  sampleKeys,
  visualClip,
  modelProject,
  active,
} from "./scene-engine";

// The owner is part of every edit operation; selection is never used to infer it.
export type Binding = { layerId: string; channel: string; clipId?: string };
export function parameterDriven(s: Scene, b: Binding, t: number) {
  if (!b.channel.startsWith("param:")) return false;
  const l = s.layers.find((l) => l.id === b.layerId);
  if (!l?.model) return false;
  const id = b.channel.slice(6),
    p = modelProject(s, l),
    group = l.model.groupOverrides[id] || classify(id);
  return p.tracks.some((tr) =>
    tr.clips.some((c) => {
      if (!active(c as any, t) || !c.weight || c.disabledGroups.includes(group))
        return false;
      const a = p.assets.find((a) => a.id === c.assetId);
      if (!a) return false;
      const matches = (source: string) =>
        (l.model!.parameterMap[source] || source) === id &&
        !c.disabledIds.includes(source) &&
        !c.disabledIds.includes(id);
      return (
        a.curves.some((cv) => matches(cv.id)) ||
        a.expression?.some((cv) => matches(cv.id))
      );
    }),
  );
}
export type Property = Binding & {
  name: string;
  group: string;
  min: number;
  max: number;
  base: number;
};
export const bindingId = (b: Binding) =>
  `${b.layerId}/${b.channel === "gain" || b.channel.startsWith("motion:") ? b.clipId || "" : ""}/${b.channel}`;
function indexClips(s: Scene) {
  const owners = new Map<string, SceneClip[]>(),
    byId = new Map<string, SceneClip>();
  for (const t of s.tracks)
    for (const c of t.clips) {
      if (!owners.has(c.layerId)) owners.set(c.layerId, []);
      owners.get(c.layerId)!.push(c);
      byId.set(c.id, c);
    }
  return { owners, byId };
}
const clipIndex = new WeakMap<Scene, ReturnType<typeof indexClips>>();
function clipsIndex(s: Scene) {
  if (!Object.isFrozen(s)) return indexClips(s);
  let idx = clipIndex.get(s);
  if (!idx) {
    idx = indexClips(s);
    clipIndex.set(s, idx);
  }
  return idx;
}
export function clipsOf(s: Scene, id: string) {
  return clipsIndex(s).owners.get(id) || [];
}
export function clipById(s: Scene, id?: string) {
  return id ? clipsIndex(s).byId.get(id) : undefined;
}
export function readProperty(s: Scene, b: Binding, t: number) {
  const l = s.layers.find((l) => l.id === b.layerId),
    clip = clipById(s, b.clipId),
    c = clip?.layerId === b.layerId ? clip : undefined;
  let keys: Key[] = [],
    base = 0,
    offset = 0,
    speed = 1,
    duration = s.duration;
  if (b.layerId === "@camera") {
    keys = s.camera.animation[b.channel] || [];
    base = (s.camera as any)[b.channel] ?? 0;
  } else if (l) {
    if (!c || (b.channel !== "gain" && !b.channel.startsWith("motion:"))) {
      const visual =
        visualClip(s, l.id, t) ||
        clipsOf(s, l.id).find((c) => c.kind === "visual");
      if (visual) {
        offset = visual.start - visual.trimIn / visual.speed;
        speed = visual.speed;
      }
    }
    if (b.channel === "gain" && c?.kind === "audio") {
      keys = c.gainKeys;
      offset = c.start;
      speed = 1;
      duration = c.duration;
      base = 1;
    } else if (b.channel.startsWith("motion:") && c?.kind === "motion") {
      const asset = s.models
        .find((r) => r.id === l.model?.resourceId)
        ?.assets.find((a) => a.id === c.assetId);
      keys = asset?.curves.find((v) => v.id === b.channel.slice(7))?.keys || [];
      offset = c.start - c.trimIn / c.speed;
      speed = c.speed;
      duration = asset?.duration || c.duration;
    } else if (b.channel.startsWith("param:")) {
      keys = l.model?.keys.find((v) => v.id === b.channel.slice(6))?.keys || [];
      base = l.model?.baseValues[b.channel.slice(6)] ?? 0;
    } else {
      keys = l.animation[b.channel] || [];
      base = b.channel.startsWith("effects.")
        ? ((l.effects as any)[b.channel.slice(8)] ??
          (b.channel === "effects.bokeh" ? 0.25 : 0))
        : b.channel.startsWith("light.")
          ? ((l.light as any)?.[b.channel.slice(6)] ?? 0)
          : b.channel.startsWith("surface.")
            ? ((l.surface as any)?.[b.channel.slice(8)] ??
              ({ roughness: 0.55, specular: 0.25, rim: 0.25, bump: 0 } as any)[
                b.channel.slice(8)
              ] ??
              0)
            : ((l.transform as any)[b.channel] ?? 1);
    }
  }
  return {
    keys,
    offset,
    speed,
    duration,
    base,
    value: sampleKeys(keys, (t - offset) * speed, base),
  };
}
export function writeProperty(s: Scene, b: Binding, keys: Key[]) {
  if (b.layerId === "@camera") {
    s.camera.animation[b.channel] = keys;
    return;
  }
  const l = s.layers.find((l) => l.id === b.layerId);
  if (!l || l.locked) return;
  if (b.channel === "gain") {
    const c = clipsOf(s, l.id).find(
      (c) => c.id === b.clipId && c.kind === "audio",
    );
    if (c) c.gainKeys = keys;
  } else if (b.channel.startsWith("param:") && l.model) {
    let c = l.model.keys.find((v) => v.id === b.channel.slice(6));
    if (!c) {
      c = { id: b.channel.slice(6), target: "Parameter", keys: [] };
      l.model.keys.push(c);
    }
    c.keys = keys;
  } else if (b.channel.startsWith("motion:") && l.model) {
    const c = clipsOf(s, l.id).find(
      (c) => c.id === b.clipId && c.kind === "motion",
    );
    if (!c) return;
    const r = s.models.find((r) => r.id === l.model!.resourceId),
      asset = r?.assets.find((a) => a.id === c.assetId);
    if (!r || !asset) return;
    let owned = asset;
    if (!(c as any).ownedAsset) {
      owned = cloneData(asset);
      owned.id = uid();
      owned.name += " · 独立副本";
      r.assets.push(owned);
      c.assetId = owned.id;
      (c as any).ownedAsset = true;
    }
    const curve = owned.curves.find((v) => v.id === b.channel.slice(7));
    if (curve) curve.keys = keys;
  } else l.animation[b.channel] = keys;
}
export function propertiesOf(
  s: Scene,
  id: string,
  params: Param[] = [],
): Property[] {
  if (id === "@camera")
    return [...cameraChannels, ["focalLength", "焦距"]].map(
      ([channel, name]) => ({
        layerId: id,
        channel,
        name,
        group: "相机",
        base: (s.camera as any)[channel],
        min: channel === "zoom" ? 0.05 : channel === "aperture" ? 0 : -10000,
        max: channel === "zoom" ? 10 : channel === "aperture" ? 5 : 10000,
      }),
    );
  const l = s.layers.find((l) => l.id === id);
  if (!l) return [];
  const specs: Property[] = [];
  const add = (
    channel: string,
    name: string,
    group: string,
    base: number,
    min: number,
    max: number,
    clipId?: string,
  ) =>
    specs.push({ layerId: id, channel, name, group, base, min, max, clipId });
  if (l.kind !== "audio") {
    for (const [channel, name] of channels) {
      if (channel.startsWith("effects.")) continue;
      if (channel === "reveal") {
        if (l.text) add(channel, name, "文本", 1, 0, 1);
        continue;
      }
      if (!l.is3D && ["z", "rotationX", "rotationY"].includes(channel))
        continue;
      add(
        channel,
        name,
        "变换",
        (l.transform as any)[channel],
        channel === "opacity" ? 0 : channel.startsWith("scale") ? 0.01 : -10000,
        channel === "opacity" ? 1 : channel.startsWith("scale") ? 10 : 10000,
      );
    }
    if (l.kind !== "light")
      for (const [channel, name, max] of [
        ["outline", "描边", 12],
        ["glow", "边缘发光", 2],
        ["bloom", "泛光", 2],
        ["brightness", "亮度", 2],
        ["contrast", "对比度", 2],
        ["saturation", "饱和度", 2],
        ["blur", "模糊半径", 64],
        ["bokeh", "散景高光", 2],
        ["lightX", "灯光 X", 1],
        ["lightY", "灯光 Y", 1],
        ["lightIntensity", "灯光强度", 3],
        ["rim", "轮廓光", 2],
        ["gloss", "光泽", 2],
      ] as const) {
        add(
          "effects." + channel,
          name,
          "效果",
          (l.effects as any)[channel] ?? (channel === "bokeh" ? 0.25 : 0),
          0,
          max,
        );
      }
  }
  if (l.light)
    for (const [id, name, min, max] of [
      ["intensity", "强度", 0, 8],
      ["range", "照射范围", 10, 20000],
      ["decay", "衰减", 0.25, 4],
      ["width", "发光面宽度", 1, 10000],
      ["height", "发光面高度", 1, 10000],
      ["specular", "高光贡献", 0, 2],
      ["rim", "轮廓光贡献", 0, 2],
    ] as const)
      add("light." + id, name, "光源", l.light[id], min, max);
  if (["model", "image", "color", "text"].includes(l.kind))
    for (const [id, name, min, max, base] of [
      ["roughness", "粗糙度", 0.05, 1, 0.55],
      ["specular", "高光反射", 0, 2, 0.25],
      ["rim", "轮廓反射", 0, 2, 0.25],
      ["bump", "轮廓凹凸", 0, 1, 0],
    ] as const)
      add("surface." + id, name, "材质", l.surface?.[id] ?? base, min, max);
  if (l.model) {
    const known = new Map(params.map((p) => [p.id, p]));
    for (const c of l.model.keys)
      if (!known.has(c.id))
        known.set(c.id, {
          id: c.id,
          name: c.id,
          min: -30,
          max: 30,
          default: 0,
          group: "other",
        });
    for (const p of known.values())
      add(
        "param:" + p.id,
        p.name,
        "模型参数",
        l.model.baseValues[p.id] ?? p.default,
        p.min,
        p.max,
      );
  }
  for (const c of clipsOf(s, id))
    if (c.kind === "audio") add("gain", "音量包络", "音频", 1, 0, 1, c.id);
  return specs;
}
export function movePropertyKey(
  s: Scene,
  b: Binding,
  index: number,
  globalTime: number,
  fps = s.fps,
) {
  const data = readProperty(s, b, globalTime),
    keys = cloneData(data.keys);
  if (!keys[index]) return;
  const key = keys[index],
    local = Math.round((globalTime - data.offset) * data.speed * fps) / fps;
  const next = clamp(
    local,
    index ? keys[index - 1].t + 1 / fps : 0,
    index < keys.length - 1
      ? keys[index + 1].t - 1 / fps
      : Math.max(data.duration, local),
  );
  const delta = next - key.t;
  key.t = next;
  if (key.in) key.in[0] += delta;
  if (key.out) key.out[0] += delta;
  writeProperty(s, b, keys);
}
