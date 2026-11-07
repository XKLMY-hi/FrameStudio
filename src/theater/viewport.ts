import { clamp } from "../engine";
import { animatedCamera, worldMatrix } from "./scene-engine";
import type { Camera, Scene } from "./schema";

export type Vec3 = [number, number, number];
export type ViewPreset = "perspective" | "front" | "side" | "top";
export type Orbit = {
  target: Vec3;
  distance: number;
  yaw: number;
  pitch: number;
};
export type Projection = {
  origin: Vec3;
  rotation: number[];
  focal: number;
  zoom: number;
};
export const NEAR = 20;
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const presets: Record<ViewPreset, [number, number]> = {
  perspective: [-0.48, -0.24],
  front: [0, 0],
  side: [Math.PI / 2, 0],
  top: [0, -Math.PI / 2],
};
export const point3 = (m: number[], x = 0, y = 0): Vec3 => [
  m[0] * x + m[4] * y + m[12],
  m[1] * x + m[5] * y + m[13],
  m[2] * x + m[6] * y + m[14],
];
export function outputProjection(c: Camera, spatial = true): Projection {
  return {
    origin: spatial ? [c.x, c.y, c.z - c.focalLength] : [0, 0, -c.focalLength],
    rotation: identity,
    focal: c.focalLength,
    zoom: spatial ? c.zoom : 1,
  };
}
export function orbitProjection(o: Orbit, focal: number): Projection {
  const cy = Math.cos(o.yaw),
    sy = Math.sin(o.yaw);
  const cp = Math.cos(o.pitch),
    sp = Math.sin(o.pitch);
  const forward: Vec3 = [sy * cp, -sp, cy * cp];
  return {
    origin: o.target.map((v, i) => v - forward[i] * o.distance) as Vec3,
    rotation: [
      cy,
      sy * sp,
      forward[0],
      0,
      cp,
      forward[1],
      -sy,
      cy * sp,
      forward[2],
    ],
    focal,
    zoom: 1,
  };
}
export function cameraPoint(p: Vec3, v: Projection): Vec3 {
  const [x, y, z] = p.map((a, i) => a - v.origin[i]);
  const r = v.rotation;
  return [
    r[0] * x + r[3] * y + r[6] * z,
    r[1] * x + r[4] * y + r[7] * z,
    r[2] * x + r[5] * y + r[8] * z,
  ];
}
export function projectView(p: Vec3, v: Projection) {
  const scale = (v.focal * v.zoom) / Math.max(NEAR, p[2]);
  return { x: p[0] * scale, y: p[1] * scale };
}
export function clipNear(poly: Vec3[], closed = true): Vec3[] {
  if (!poly.length) return [];
  const result: Vec3[] = [];
  let a = closed ? poly.at(-1)! : poly[0];
  if (!closed && a[2] >= NEAR) result.push(a);
  for (const b of closed ? poly : poly.slice(1)) {
    if (a[2] >= NEAR !== b[2] >= NEAR) {
      const k = (NEAR - a[2]) / (b[2] - a[2]);
      result.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, NEAR]);
    }
    if (b[2] >= NEAR) result.push(b);
    a = b;
  }
  return result;
}
export function orbitPan(
  o: Orbit,
  dx: number,
  dy: number,
  focal: number,
): Orbit {
  const r = orbitProjection(o, focal).rotation,
    scale = o.distance / focal;
  return {
    ...o,
    target: o.target.map(
      (x, i) => x - (r[3 * i] * dx + r[3 * i + 1] * dy) * scale,
    ) as Vec3,
  };
}
export function orbitRotate(o: Orbit, dx: number, dy: number): Orbit {
  return {
    ...o,
    yaw: o.yaw + dx * 0.008,
    pitch: clamp(o.pitch - dy * 0.008, -Math.PI / 2, Math.PI / 2),
  };
}
export function orbitZoom(o: Orbit, delta: number): Orbit {
  return {
    ...o,
    distance: clamp(o.distance * Math.exp(delta * 0.0015), 40, 100000),
  };
}
export function fitOrbit(
  s: Scene,
  t: number,
  preset: ViewPreset | [number, number] = "perspective",
  selected = "",
  includeCamera = false,
): Orbit {
  const points: Vec3[] = [];
  const layers = s.layers.filter((l) => {
    if (!selected)
      return l.visible && !["audio", "adjustment", "group"].includes(l.kind);
    let id: string | null = l.id;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      if (id === selected)
        return !["audio", "adjustment", "group"].includes(l.kind);
      seen.add(id);
      id = s.layers.find((l) => l.id === id)?.parentId || null;
    }
    return false;
  });
  for (const l of layers) {
    const m = worldMatrix(s, l, t),
      w = l.kind === "light" ? 42 : l.width / 2,
      h = l.kind === "light" ? 42 : l.height / 2;
    for (const x of [-w, w])
      for (const y of [-h, h]) points.push(point3(m, x, y));
  }
  if (selected === "@camera" || includeCamera) {
    const c = animatedCamera(s, t);
    points.push([c.x, c.y, c.z - c.focalLength]);
    const hw = s.width / (2 * c.zoom),
      hh = s.height / (2 * c.zoom);
    points.push([c.x - hw, c.y - hh, c.z], [c.x + hw, c.y + hh, c.z]);
  }
  if (!points.length || !selected)
    points.push(
      [-s.width / 2, -s.height / 2, 0],
      [s.width / 2, s.height / 2, 0],
    );
  const lo = points[0].slice(),
    hi = points[0].slice();
  for (const p of points)
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], p[i]);
      hi[i] = Math.max(hi[i], p[i]);
    }
  const target = lo.map((v, i) => (v + hi[i]) / 2) as Vec3;
  const [yaw, pitch] = typeof preset === "string" ? presets[preset] : preset;
  const o = { target, distance: 0, yaw, pitch },
    focal = viewportFocal(s);
  const v = orbitProjection(o, focal);
  const distance = Math.max(
    160,
    ...points.map((p) => {
      const [x, y, z] = cameraPoint(p, v);
      return (
        Math.max(
          NEAR,
          1.18 *
            focal *
            Math.max(Math.abs(x) / (s.width / 2), Math.abs(y) / (s.height / 2)),
        ) - z
      );
    }),
  );
  return { ...o, distance };
}
export const viewportFocal = (s: Scene) => Math.max(s.width, s.height) * 1.1;
