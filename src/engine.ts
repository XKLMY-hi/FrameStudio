import { Asset, Clip, Curve, Group, Key, Param, Project, uid } from "./types";
export const clamp = (v: number, a: number, b: number) =>
  Math.max(a, Math.min(b, v));
export function classify(id: string): Group {
  if (/mouth|lip|口/i.test(id)) return "mouth";
  if (/eye|brow|cheek|tear|face.?form|smile|exp_|表情|眉|目|瞳/i.test(id))
    return "expression";
  if (
    /hair|ribbon|skirt|coat|sleeve|bust|pendant|breast|sway|shake|髪|揺/i.test(
      id,
    )
  )
    return "physics";
  if (
    /angle|body|arm|hand|leg|shoulder|breath|base|pose|head|neck|足|腕|体/i.test(
      id,
    )
  )
    return "body";
  return "other";
}
export function decodeSegments(a: number[]): Key[] {
  if (a.length < 2 || a.some((v) => !Number.isFinite(v)))
    throw Error("动作曲线包含无效数字");
  const keys: Key[] = [{ t: a[0], v: a[1], mode: "linear" }];
  let i = 2;
  while (i < a.length) {
    const type = a[i++],
      last = keys[keys.length - 1];
    if (type === 1) {
      if (i + 5 >= a.length) throw Error("贝塞尔曲线不完整");
      last.mode = "bezier";
      last.out = [a[i], a[i + 1]];
      keys.push({
        t: a[i + 4],
        v: a[i + 5],
        in: [a[i + 2], a[i + 3]],
        mode: "linear",
      });
      i += 6;
    } else if (type === 0 || type === 2 || type === 3) {
      if (i + 1 >= a.length) throw Error("曲线不完整");
      last.mode = type === 2 ? "step" : type === 3 ? "inverse" : "linear";
      keys.push({ t: a[i], v: a[i + 1], mode: "linear" });
      i += 2;
    } else throw Error("未知曲线类型 " + type);
  }
  if (keys.some((k, n) => n > 0 && k.t < keys[n - 1].t))
    throw Error("曲线时间必须递增");
  return keys;
}
function cubic(a: number, b: number, c: number, d: number, u: number) {
  const v = 1 - u;
  return v * v * v * a + 3 * v * v * u * b + 3 * v * u * u * c + u * u * u * d;
}
export function sampleCurve(curve: Curve, t: number): number {
  const k = curve.keys;
  if (!k.length) return 0;
  if (t <= k[0].t) return k[0].v;
  if (t >= k[k.length - 1].t) return k[k.length - 1].v;
  let lo = 0,
    hi = k.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (k[m].t <= t) lo = m;
    else hi = m;
  }
  const a = k[lo],
    b = k[hi];
  if (a.mode === "step") return a.v;
  if (a.mode === "inverse") return b.v;
  if (a.mode !== "bezier") return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
  const c = a.out ?? [a.t + (b.t - a.t) / 3, a.v],
    d = b.in ?? [b.t - (b.t - a.t) / 3, b.v];
  let l = 0,
    r = 1;
  for (let n = 0; n < 28; n++) {
    const u = (l + r) / 2;
    if (cubic(a.t, c[0], d[0], b.t, u) < t) l = u;
    else r = u;
  }
  return cubic(a.v, c[1], d[1], b.v, (l + r) / 2);
}
export function parseAsset(json: any, name: string): Asset {
  if (json.Curves) {
    const curves: Curve[] = json.Curves.map((c: any) => ({
      id: String(c.Id),
      target: c.Target || "Parameter",
      keys: decodeSegments(c.Segments),
      fadeIn: c.FadeInTime,
      fadeOut: c.FadeOutTime,
    }));
    const last = Math.max(0, ...curves.map((c) => c.keys.at(-1)?.t || 0));
    const duration = Number(json.Meta?.Duration ?? last);
    if (!Number.isFinite(duration) || duration <= 0)
      throw Error("动作时长无效");
    return {
      id: uid(),
      name,
      kind: "motion",
      duration,
      fps: Number(json.Meta?.Fps) || 30,
      curves,
      fadeIn: json.Meta?.FadeInTime,
      fadeOut: json.Meta?.FadeOutTime,
    };
  }
  if (json.Parameters)
    return {
      id: uid(),
      name,
      kind: "expression",
      duration: 3,
      fps: 30,
      curves: [],
      fadeIn: json.FadeInTime ?? 0.2,
      fadeOut: json.FadeOutTime ?? 0.2,
      expression: json.Parameters.map((p: any) => ({
        id: p.Id,
        value: p.Value,
        blend: p.Blend || "Add",
      })),
    };
  throw Error("请选择 .motion3.json 或 .exp3.json 文件");
}
export function parseLegacy(text: string, name: string): Asset {
  let fps = 30;
  const curves: Curve[] = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const n = s.indexOf("=");
    if (n < 0) continue;
    const id = s.slice(0, n).trim(),
      v = s
        .slice(n + 1)
        .split(",")
        .map(Number);
    if (id === "$fps") {
      fps = v[0] || 30;
      continue;
    }
    if (id.startsWith("$")) continue;
    if (v.some((x) => !Number.isFinite(x))) continue;
    curves.push({
      id,
      target: "Parameter",
      keys: v.map((x, i) => ({ t: i / fps, v: x, mode: "linear" })),
    });
  }
  if (!curves.length) throw Error("未找到旧版动作参数");
  return {
    id: uid(),
    name,
    kind: "motion",
    duration: Math.max(...curves.map((c) => c.keys.length)) / fps,
    fps,
    curves,
  };
}
export function clipTime(c: Clip, a: Asset, t: number) {
  let v = c.trimIn + (t - c.start) * c.speed;
  if (c.loop && a.duration > 0)
    v = ((v % a.duration) + a.duration) % a.duration;
  return clamp(v, 0, a.duration);
}
function ease(v: number) {
  return 0.5 - 0.5 * Math.cos(clamp(v, 0, 1) * Math.PI);
}
export function clipWeight(c: Clip, t: number, fi = c.fadeIn, fo = c.fadeOut) {
  if (!c.enabled || t < c.start || t >= c.start + c.duration) return 0;
  return (
    clamp(c.weight, 0, 1) *
    (fi > 0 ? ease((t - c.start) / fi) : 1) *
    (fo > 0 ? ease((c.start + c.duration - t) / fo) : 1)
  );
}
export type Evaluated = {
  parameters: Record<string, number>;
  parts: Record<string, number>;
  model: Record<string, number>;
};
export function evaluationContext(p: Project, params: Param[]) {
  return {defaults:new Map(params.map(v=>[v.id,v.default])),groups:new Map(params.map(v=>[v.id,p.groupOverrides[v.id]||v.group])),assets:new Map(p.assets.map(a=>[a.id,a]))};
}
export function evaluate(p: Project, params: Param[], t: number, context = evaluationContext(p,params)): Evaluated {
  const {defaults,groups,assets}=context;
  const sums = new Map<string, { s: number; w: number; base: number }>();
  const operations: { id: string; v: number; w: number; mode: string }[] = [];
  const solo = p.tracks.some((tr) => tr.solo && !tr.muted);
  for (const track of p.tracks) {
    if (track.muted || (solo && !track.solo)) continue;
    for (const c of track.clips) {
      const a = assets.get(c.assetId);
      if (!a) continue;
      const w = clipWeight(c, t);
      if (w <= 0) continue;
      const local = clipTime(c, a, t);
      const emit = (
        source: string,
        target: string,
        v: number,
        mode: string = c.blend,
        cw = w,
      ) => {
        const id = p.parameterMap[source] || source;
        const group = groups.get(id) || classify(id);
        if (
          c.disabledIds.includes(source) ||
          c.disabledIds.includes(id) ||
          c.disabledGroups.includes(group)
        )
          return;
        const key = target === "Parameter" ? id : target + ":" + id;
        const base =
          target === "PartOpacity" ||
          (target === "Model" && (id === "Opacity" || id === "EyeBlink"))
            ? 1
            : (defaults.get(id) ?? 0);
        if (mode === "mix") {
          const s = sums.get(key) ?? { s: 0, w: 0, base };
          s.s += v * cw;
          s.w += cw;
          sums.set(key, s);
        } else
          operations.push({
            id: key,
            v: mode === "add" ? v - base : v,
            w: cw,
            mode,
          });
      };
      if (a.expression)
        for (const exp of a.expression) {
          const id = p.parameterMap[exp.id] || exp.id;
          const d = defaults.get(id) ?? 0;
          const mode = exp.blend.toLowerCase();
          if (c.blend === "override" && (mode === "add" || mode === "multiply"))
            emit(
              exp.id,
              "Parameter",
              exp.value,
              mode === "add" ? "expressionAdd" : "multiply",
            );
          else {
            const v =
              mode === "add"
                ? d + exp.value
                : mode === "multiply"
                  ? d * exp.value
                  : exp.value;
            emit(exp.id, "Parameter", v);
          }
        }
      for (const curve of a.curves) {
        const cw = clipWeight(
          c,
          t,
          curve.fadeIn ?? c.fadeIn,
          curve.fadeOut ?? c.fadeOut,
        );
        emit(curve.id, curve.target, sampleCurve(curve, local), c.blend, cw);
      }
    }
  }
  const values: Record<string, number> = Object.fromEntries(defaults);
  for (const [id, s] of sums)
    values[id] = s.base * (1 - Math.min(1, s.w)) + s.s / Math.max(1, s.w);
  for (const op of operations) {
    const d =
      values[op.id] ??
      defaults.get(op.id) ??
      (op.id.startsWith("PartOpacity:") ||
      op.id === "Model:EyeBlink" ||
      op.id === "Model:Opacity"
        ? 1
        : 0);
    values[op.id] =
      op.mode === "add" || op.mode === "expressionAdd"
        ? d + op.v * op.w
        : op.mode === "multiply"
          ? d * (1 + (op.v - 1) * op.w)
          : d + (op.v - d) * op.w;
  }
  for (const param of params)
    values[param.id] = clamp(values[param.id], param.min, param.max);
  const result: Evaluated = { parameters: {}, parts: {}, model: {} };
  for (const [id, v] of Object.entries(values)) {
    if (id.startsWith("PartOpacity:"))
      result.parts[id.slice(12)] = clamp(v, 0, 1);
    else if (id.startsWith("Model:")) result.model[id.slice(6)] = v;
    else result.parameters[id] = v;
  }
  return result;
}
export function exportMotion(asset: Asset) {
  let segments = 0,
    points = 0;
  const curves = asset.curves.map((c) => {
    const a: number[] = [];
    c.keys.forEach((k, i) => {
      if (i === 0) {
        a.push(k.t, k.v);
        points++;
        return;
      }
      const prev = c.keys[i - 1];
      segments++;
      if (prev.mode === "bezier") {
        const out = prev.out ?? [prev.t + (k.t - prev.t) / 3, prev.v],
          inside = k.in ?? [k.t - (k.t - prev.t) / 3, k.v];
        a.push(1, ...out, ...inside, k.t, k.v);
        points += 3;
      } else {
        a.push(
          prev.mode === "step" ? 2 : prev.mode === "inverse" ? 3 : 0,
          k.t,
          k.v,
        );
        points++;
      }
    });
    return { Target: c.target, Id: c.id, Segments: a };
  });
  return {
    Version: 3,
    Meta: {
      Duration: asset.duration,
      Fps: asset.fps,
      Loop: false,
      AreBeziersRestricted: false,
      CurveCount: curves.length,
      TotalSegmentCount: segments,
      TotalPointCount: points,
    },
    Curves: curves,
  };
}
export const phonemes: Record<string, [number, number]> = {
  X: [0, 0],
  A: [0, 0],
  B: [0.18, 0.2],
  C: [0.55, 0.55],
  D: [0.95, 0.15],
  E: [0.48, -0.45],
  F: [0.25, -0.9],
  G: [0.18, -0.2],
  H: [0.65, 0.1],
};
export function cuesToCurves(
  cues: { start: number; end: number; value: string }[],
  duration: number,
  openId = "ParamMouthOpenY",
  formId = "ParamMouthForm",
): Curve[] {
  return [openId, formId].map((id, axis) => {
    const keys: Key[] = [{ t: 0, v: 0, mode: "linear" }];
    for (const cue of cues) {
      const value = (phonemes[cue.value] || [0, 0])[axis];
      const start = clamp(cue.start, 0, duration),
        end = clamp(cue.end, 0, duration);
      const prev = keys.at(-1)!;
      if (start > prev.t) keys.push({ t: start, v: prev.v, mode: "linear" });
      keys.push({ t: Math.min(end, start + 0.035), v: value, mode: "linear" });
      if (end > start + 0.035) keys.push({ t: end, v: value, mode: "linear" });
    }
    keys.push({ t: duration, v: 0, mode: "linear" });
    return {
      id,
      target: "Parameter" as const,
      keys: keys
        .sort((a, b) => a.t - b.t)
        .filter((k, i, a) => i === a.length - 1 || k.t !== a[i + 1].t),
    };
  });
}
