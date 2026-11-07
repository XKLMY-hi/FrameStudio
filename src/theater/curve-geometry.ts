import type { Key } from "../types";

export function lowerKey(keys: Key[], time: number) {
  let a = 0,
    b = keys.length;
  while (a < b) {
    const m = (a + b) >>> 1;
    if (keys[m].t < time) a = m + 1;
    else b = m;
  }
  return a;
}
export function segmentAt(keys: Key[], time: number) {
  if (keys.length < 2) return -1;
  const i = lowerKey(keys, time);
  return Math.max(
    0,
    Math.min(keys.length - 2, i - (keys[i]?.t === time ? 0 : 1)),
  );
}
export const diamond = (x: number, y: number, r: number) =>
  `M${x} ${y - r}l${r} ${r}l${-r} ${r}l${-r} ${-r}Z`;
export function curveGeometry(
  keys: Key[],
  from: number,
  to: number,
  x: (t: number) => number,
  y: (v: number) => number,
) {
  const start = lowerKey(keys, from),
    end = lowerKey(keys, to),
    segments = new Map<number, string>();
  const points: { i: number; x: number; y: number }[] = [];
  let path = "",
    glyphs = "",
    targets = "";
  for (let i = Math.max(0, start - 1); i < keys.length - 1 && i <= end; i++) {
    const a = keys[i],
      b = keys[i + 1],
      xx = x(a.t),
      ex = x(b.t),
      yy = y(a.v),
      ey = y(b.v);
    const p = a.out ?? [a.t + (b.t - a.t) / 3, a.v],
      q = b.in ?? [b.t - (b.t - a.t) / 3, b.v];
    const d =
      `M${xx} ${yy}` +
      (a.mode === "bezier"
        ? `C${x(p[0])} ${y(p[1])} ${x(q[0])} ${y(q[1])} ${ex} ${ey}`
        : a.mode === "step"
          ? `H${ex}V${ey}`
          : a.mode === "inverse"
            ? `V${ey}H${ex}`
            : `L${ex} ${ey}`);
    path += d;
    segments.set(i, d);
  }
  for (let i = start; i < keys.length && keys[i].t <= to; i++) {
    const xx = x(keys[i].t),
      yy = y(keys[i].v);
    points.push({ i, x: xx, y: yy });
    glyphs += diamond(xx, yy, 5);
    targets += diamond(xx, yy, 8);
  }
  return { path, segments, points, glyphs, targets };
}
