import { animatedLayer, identity, worldMatrix } from "./scene-engine";
import { cross3, dot3 } from "./depth-order";
import { point3, type Vec3 } from "./viewport";
import type { Layer, Scene } from "./schema";
import type { Axis } from "./ViewportOverlay";

export function editable(s: Scene, l: Layer) {
  const seen = new Set<string>();
  let node: Layer | undefined = l;
  while (node && !seen.has(node.id)) {
    if (node.locked) return false;
    seen.add(node.id);
    node = s.layers.find((l) => l.id === node!.parentId);
  }
  return true;
}
export function selectionRoots(s: Scene, ids: string[]) {
  const selected = new Set(ids);
  return s.layers.filter((l) => {
    if (
      !selected.has(l.id) ||
      !editable(s, l) ||
      ["audio", "adjustment"].includes(l.kind)
    )
      return false;
    let id = l.parentId;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      if (selected.has(id)) return false;
      seen.add(id);
      id = s.layers.find((l) => l.id === id)?.parentId || null;
    }
    return true;
  });
}
export function pivotOf(s: Scene, layers: Layer[], t: number): Vec3 {
  const sum: Vec3 = [0, 0, 0];
  for (const l of layers)
    point3(worldMatrix(s, l, t)).forEach(
      (v, i) => (sum[i] += v / layers.length),
    );
  return sum;
}
export function parentDelta(s: Scene, l: Layer, t: number, delta: Vec3): Vec3 {
  const parent = s.layers.find((p) => p.id === l.parentId),
    m = parent ? worldMatrix(s, parent, t) : identity();
  const [a, b, c] = [m.slice(0, 3), m.slice(4, 7), m.slice(8, 11)] as Vec3[];
  const det = dot3(a, cross3(b, c));
  if (Math.abs(det) < 1e-8) return [0, 0, 0];
  return [
    dot3(delta, cross3(b, c)) / det,
    dot3(delta, cross3(c, a)) / det,
    dot3(delta, cross3(a, b)) / det,
  ];
}
type TransformAction =
  { move: Vec3 } | { axis: Axis; angle: number } | { scale: Vec3 };
export function groupTransform(
  s: Scene,
  layers: Layer[],
  t: number,
  pivot: Vec3,
  action: TransformAction,
) {
  return layers.map((l) => {
    const tr = animatedLayer(s, l, t).transform,
      p = point3(worldMatrix(s, l, t));
    const rel = p.map((v, i) => v - pivot[i]) as Vec3;
    let delta: Vec3,
      values: Record<string, number> = {};
    if ("move" in action) delta = action.move;
    else if ("scale" in action) {
      delta = rel.map((v, i) => v * (action.scale[i] - 1)) as Vec3;
      values = {
        scaleX: tr.scaleX * action.scale[0],
        scaleY: tr.scaleY * action.scale[1],
      };
    } else {
      const i = ["x", "y", "z"].indexOf(action.axis),
        j = (i + 1) % 3,
        k = (i + 2) % 3;
      const a = (action.angle * Math.PI) / 180,
        c = Math.cos(a),
        sn = Math.sin(a);
      delta = [0, 0, 0];
      delta[j] = rel[j] * (c - 1) - rel[k] * sn;
      delta[k] = rel[k] * (c - 1) + rel[j] * sn;
      const key =
        action.axis === "z"
          ? "rotation"
          : action.axis === "x"
            ? "rotationX"
            : "rotationY";
      if (l.is3D || action.axis === "z") values[key] = tr[key] + action.angle;
    }
    const d = parentDelta(s, l, t, delta);
    if (Math.abs(d[0]) > 1e-7) values.x = tr.x + d[0];
    if (Math.abs(d[1]) > 1e-7) values.y = tr.y + d[1];
    if (l.is3D && Math.abs(d[2]) > 1e-7) values.z = tr.z + d[2];
    return { id: l.id, values };
  });
}

export type Point2 = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };
export function dragBox(a: Point2, b: Point2): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}
// Separating-axis test for a convex projected plane and the marquee.
export function boxHits(box: Box, poly: Point2[]) {
  if (poly.length < 3) return false;
  const rect = [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
  ];
  const normals = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    ...poly.map((a, i) => {
      const b = poly[(i + 1) % poly.length];
      return { x: a.y - b.y, y: b.x - a.x };
    }),
  ];
  return normals.every((n) => {
    const p = poly.map((v) => v.x * n.x + v.y * n.y),
      r = rect.map((v) => v.x * n.x + v.y * n.y);
    return Math.max(...p) >= Math.min(...r) && Math.max(...r) >= Math.min(...p);
  });
}
