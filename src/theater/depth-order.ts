import { point3, type Vec3 } from "./viewport";

export type Vertex = { position: Vec3; x: number; y: number };
export type DepthPolygon<T> = { item: T; vertices: Vertex[]; split?: true };
export const dot3 = (a: Vec3, b: Vec3) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub3 = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const epsilon = 1e-5;

export function planeQuad(
  matrix: number[],
  width: number,
  height: number,
): Vertex[] {
  const w = width / 2,
    h = height / 2;
  return [
    [-w, -h],
    [w, -h],
    [w, h],
    [-w, h],
  ].map(([x, y]) => ({ position: point3(matrix, x, y), x, y }));
}

// Split flat textured surfaces at their intersections. Each viewing ray then
// receives the pieces far-to-near, retaining ordinary premultiplied alpha.
export function depthOrder<T>(
  polygons: DepthPolygon<T>[],
  eye: Vec3,
): DepthPolygon<T>[] {
  const result: DepthPolygon<T>[] = [];
  function visit(list: DepthPolygon<T>[]) {
    if (list.length < 2) {
      result.push(...list);
      return;
    }
    const pivot = list[list.length >> 1];
    const [a, b, c] = pivot.vertices.map((v) => v.position);
    const n = cross3(sub3(b, a), sub3(c, a)),
      length = Math.hypot(...n);
    if (length < epsilon) {
      visit(list.filter((p) => p !== pivot));
      result.push(pivot);
      return;
    }
    const normal = n.map((v) => v / length) as Vec3;
    const side = (p: Vec3) => dot3(sub3(p, a), normal);
    const positive: DepthPolygon<T>[] = [],
      negative: DepthPolygon<T>[] = [],
      coplanar: DepthPolygon<T>[] = [];
    for (const poly of list) {
      if (poly === pivot) {
        coplanar.push(poly);
        continue;
      }
      const distances = poly.vertices.map((v) => side(v.position));
      const plus = distances.some((d) => d > epsilon),
        minus = distances.some((d) => d < -epsilon);
      if (!plus && !minus) {
        coplanar.push(poly);
        continue;
      }
      if (!minus) {
        positive.push(poly);
        continue;
      }
      if (!plus) {
        negative.push(poly);
        continue;
      }
      const front: Vertex[] = [],
        back: Vertex[] = [];
      for (let i = 0; i < poly.vertices.length; i++) {
        const j = (i + 1) % poly.vertices.length,
          v = poly.vertices[i],
          w = poly.vertices[j];
        const d = distances[i],
          e = distances[j];
        if (d >= -epsilon) front.push(v);
        if (d <= epsilon) back.push(v);
        if ((d > epsilon && e < -epsilon) || (d < -epsilon && e > epsilon)) {
          const k = d / (d - e);
          const at = {
            x: v.x + (w.x - v.x) * k,
            y: v.y + (w.y - v.y) * k,
            position: v.position.map(
              (p, axis) => p + (w.position[axis] - p) * k,
            ) as Vec3,
          };
          front.push(at);
          back.push(at);
        }
      }
      if (front.length >= 3)
        positive.push({ ...poly, vertices: front, split: true });
      if (back.length >= 3)
        negative.push({ ...poly, vertices: back, split: true });
    }
    const onFront = side(eye) >= 0;
    visit(onFront ? negative : positive);
    result.push(...coplanar);
    visit(onFront ? positive : negative);
  }
  visit(polygons);
  return result;
}
