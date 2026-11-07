import type { Key, Mode } from "../types";

const points = (...v: [number, number, number, number]) => v;
export const curvePresets = [
  { id: "linear", label: "线性 · 匀速", mode: "linear" },
  { id: "hold", label: "保持 · 到点切换", mode: "step" },
  { id: "jump", label: "跳入 · 立即切换", mode: "inverse" },
  { id: "easeIn", label: "缓入 · 逐渐加速", control: points(0.42, 0, 1, 1) },
  { id: "easeOut", label: "缓出 · 自然停下", control: points(0, 0, 0.58, 1) },
  { id: "smooth", label: "柔和缓入缓出", control: points(0.42, 0, 0.58, 1) },
  { id: "soft", label: "舒缓 · 长呼吸", control: points(0.5, 0, 0.5, 1) },
  { id: "snap", label: "快切 · 中段加速", control: points(0.78, 0, 0.22, 1) },
  {
    id: "emphasis",
    label: "强调 · 快起慢收",
    control: points(0.18, 0.8, 0.24, 1),
  },
  {
    id: "anticipate",
    label: "预备 · 先反向蓄力",
    control: points(0.32, -0.5, 0.65, 0.7),
  },
  {
    id: "overshoot",
    label: "回弹 · 越过终点",
    control: points(0.22, 0.9, 0.5, 1.46),
  },
  {
    id: "spring",
    label: "弹性 · 轻摆两次",
    samples: [
      [0.5, 1.13],
      [0.73, 0.95],
      [0.89, 1.025],
    ],
  },
  {
    id: "bounce",
    label: "落地 · 两次小反弹",
    samples: [
      [0.52, 1],
      [0.67, 0.85],
      [0.8, 1],
      [0.89, 0.96],
    ],
  },
] as const;
export type PresetId = (typeof curvePresets)[number]["id"];

// Segment presets modify only the outgoing and incoming handles of that
// segment. Extra bounce points remain ordinary exportable Cubism keys.
export function applyCurvePreset(
  input: Key[],
  segments: number[],
  id: PresetId,
): Key[] {
  const keys = structuredClone(input);
  const preset = curvePresets.find((p) => p.id === id)!;
  for (const i of [...new Set(segments)].sort((a, b) => b - a)) {
    const a = keys[i],
      b = keys[i + 1];
    if (!a || !b || b.t <= a.t) continue;
    const dt = b.t - a.t,
      dv = b.v - a.v;
    delete a.out;
    delete b.in;
    if ("mode" in preset) {
      a.mode = preset.mode as Mode;
      continue;
    }
    if ("control" in preset) {
      const [x, y, u, v] = preset.control;
      a.mode = "bezier";
      a.out = [a.t + x * dt, a.v + y * dv];
      b.in = [a.t + u * dt, a.v + v * dv];
    } else {
      a.mode = "bezier";
      keys.splice(
        i + 1,
        0,
        ...preset.samples.map(([x, y]) => ({
          t: a.t + x * dt,
          v: a.v + y * dv,
          mode: "bezier" as const,
        })),
      );
    }
  }
  return keys;
}
