import { cross3, dot3, sub3 } from "./depth-order";
import type { Vec3 } from "./viewport";

// Intersect a perspective ray (z = 1) with the rendered plane and return
// its texture coordinates. The frame's own opacity and alpha finish the test.
export function planeRay(quad: Vec3[], ray: Vec3) {
  const o = quad[0],
    a = sub3(quad[1], o),
    b = sub3(quad[3], o),
    n = cross3(a, b);
  const denominator = dot3(n, ray),
    aa = dot3(a, a),
    ab = dot3(a, b),
    bb = dot3(b, b),
    det = aa * bb - ab * ab;
  if (Math.abs(denominator) < 1e-7 || det < 1e-10) return;
  const depth = dot3(n, o) / denominator;
  if (depth < 20) return;
  const q = ray.map((v, i) => v * depth - o[i]) as Vec3,
    d = dot3(q, a),
    e = dot3(q, b);
  const u = (d * bb - e * ab) / det,
    v = (e * aa - d * ab) / det;
  if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return { depth, u, v };
}

export function clippedStroke(
  points: { x: number; y: number; visible: boolean }[],
) {
  let path = "",
    open = false;
  for (const p of points) {
    if (!p.visible) {
      open = false;
      continue;
    }
    path += (open ? "L" : "M") + p.x.toFixed(2) + " " + p.y.toFixed(2) + " ";
    open = true;
  }
  return path;
}
