import { Layer, Scene, SceneLight, MAX_SCENE_LIGHTS } from "./schema";
import {
  animatedLayer,
  layerAlpha,
  layerVisible,
  worldMatrix,
} from "./scene-engine";
export const normalize = (v: number[]) => {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};
const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export type WorldLight = {
  id: string;
  config: SceneLight;
  position: number[];
  direction: number[];
  right: number[];
  up: number[];
  power: number;
  range: number;
};
export function worldLights(s: Scene, t: number): WorldLight[] {
  const soloIds = new Set(
    s.tracks
      .filter((tr) => tr.solo && !tr.muted)
      .flatMap((tr) =>
        tr.clips
          .filter(
            (c) =>
              c.enabled && s.layers.some((l) => l.id === c.layerId && l.light),
          )
          .map((c) => c.layerId),
      ),
  );
  return s.layers
    .filter(
      (l) =>
        l.light &&
        (!soloIds.size || soloIds.has(l.id)) &&
        layerVisible(s, l, t),
    )
    .map((l) => {
      const posed = animatedLayer(s, l, t),
        m = worldMatrix(s, l, t),
        right = m.slice(0, 3),
        up = m.slice(4, 7),
        scale = (Math.hypot(...right) + Math.hypot(...up)) / 2;
      return {
        id: l.id,
        config: posed.light!,
        position: m.slice(12, 15),
        right,
        up,
        direction: normalize(
          posed.light!.type === "area" ? cross(right, up) : m.slice(8, 11),
        ),
        power: posed.light!.intensity * layerAlpha(s, l, t),
        range: posed.light!.range * scale,
      };
    });
}
export function receivesLight(s: Scene, l: Layer) {
  let node: Layer | undefined = l;
  const seen = new Set<string>();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    if (node.receiveLight !== undefined) return node.receiveLight;
    node = s.layers.find((v) => v.id === node!.parentId);
  }
  return l.kind === "model";
}
export function lightAffects(s: Scene, light: WorldLight, l: Layer) {
  if (!receivesLight(s, l)) return false;
  if (!light.config.targets.length) return true;
  let node: Layer | undefined = l;
  const seen = new Set<string>();
  while (node && !seen.has(node.id)) {
    if (light.config.targets.includes(node.id)) return true;
    seen.add(node.id);
    node = s.layers.find((v) => v.id === node!.parentId);
  }
  return false;
}
const linearColor = (hex: string) =>
  [1, 3, 5].map((i) => Math.pow(parseInt(hex.slice(i, i + 2), 16) / 255, 2.2));
export function lightUniforms(s: Scene, l: Layer, lights: WorldLight[]) {
  const enabled =
      s.lighting?.enabled !== false &&
      s.layers.some((l) => l.kind === "light") &&
      receivesLight(s, l),
    chosen = lights
      .filter((light) => lightAffects(s, light, l))
      .slice(0, MAX_SCENE_LIGHTS);
  const pos = new Float32Array(MAX_SCENE_LIGHTS * 4),
    color = new Float32Array(pos.length),
    dir = new Float32Array(pos.length),
    right = new Float32Array(pos.length),
    up = new Float32Array(pos.length),
    params = new Float32Array(pos.length);
  chosen.forEach((v, i) => {
    const c = v.config,
      o = i * 4;
    pos.set(
      [...v.position, { ambient: 0, point: 1, area: 2, sun: 3 }[c.type]],
      o,
    );
    color.set([...linearColor(c.color), v.power], o);
    dir.set([...v.direction, v.range], o);
    right.set([...v.right, c.width * 0.5], o);
    up.set([...v.up, c.height * 0.5], o);
    params.set([c.decay, c.specular, c.rim, 0], o);
  });
  return {
    uLighting: enabled ? 1 : 0,
    uLightCount: chosen.length,
    uLightPos: pos,
    uLightColor: color,
    uLightDir: dir,
    uLightRight: right,
    uLightUp: up,
    uLightParams: params,
    uAmbient: [
      ...linearColor(s.lighting?.color || "#ffffff"),
      s.lighting?.ambient ?? 0.7,
    ],
    uExposure: s.lighting?.exposure ?? 1,
    uMaterial: [
      l.surface?.roughness ?? 0.55,
      l.surface?.specular ?? 0.25,
      l.surface?.rim ?? 0.25,
      l.surface?.bump ?? 0,
    ],
  };
}
export function pointAttenuation(distance: number, range: number, decay = 2) {
  if (range <= 0 || distance >= range) return 0;
  const x = Math.max(0, Math.min(1, (distance / range - 0.75) / 0.25)),
    cutoff = 1 - x * x * (3 - 2 * x);
  return cutoff / (1 + Math.pow(distance / Math.max(1, range * 0.5), decay));
}
