import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Plus, Focus } from "lucide-react";
import type { Key, Param } from "../types";
import { clamp, sampleCurve } from "../engine";
import { bindingId, readProperty, type Binding } from "./properties";
import { applyCurvePreset, curvePresets, type PresetId } from "./curve-presets";
import { fade, sourceTime } from "./scene-engine";
import type { Scene, SceneClip } from "./schema";
import { buildPropertyCatalog } from "./property-catalog";
import { CurveChannelTree } from "./CurveChannelTree";
import { curveGeometry, diamond, segmentAt } from "./curve-geometry";
import { clipById } from "./properties";

type Props = {
  scene: Scene;
  binding: Binding;
  paramsByLayer: Record<string, Param[]>;
  seed?: Binding;
  value: (b: Binding, value: number) => void;
  time: number;
  snap: boolean;
  autoKey: boolean;
  toggleAutoKey: () => void;
  seek: (t: number) => void;
  write: (b: Binding, k: Key[]) => void;
  record: (b: Binding) => void;
  editClip: (id: string, patch: Partial<SceneClip>) => void;
  close: () => void;
};
const colors = [
  "var(--primary)",
  "#5aa6d9",
  "#67b694",
  "#db877e",
  "#e77d9f",
  "#78b6bb",
];
const clone = (keys: Key[]) => structuredClone(keys);
const fmt = (x: number) => Number(x.toFixed(4));

export function CurveWorkspace(p: Props) {
  const id = p.seed ? bindingId(p.seed) : undefined,
    plot = useRef<SVGSVGElement>(null);
  const [chosen, setChosen] = useState<string[]>(id ? [id] : []);
  const [focus, setFocus] = useState<{
    id: string;
    index: number;
    segment: boolean;
  }>();
  const [draft, setDraft] = useState<{ id: string; keys: Key[] }>();
  const [audioDraft, setAudioDraft] = useState<{
    id: string;
    patch: Partial<SceneClip>;
  }>();
  const [size, setSize] = useState({ w: 720, h: 280 });
  const [range, setRange] = useState<[number, number]>([0, p.scene.duration]);
  const catalog = useMemo(
    () => buildPropertyCatalog(p.scene, p.paramsByLayer),
    [p.scene, p.paramsByLayer],
  );
  useEffect(() => {
    setChosen(id ? [id] : []);
    setFocus(undefined);
  }, [id]);
  useEffect(() => {
    setRange([0, p.scene.duration]);
  }, [p.scene.id, p.scene.duration]);
  useEffect(() => {
    const el = plot.current!;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const visible = useMemo(
    () =>
      chosen.flatMap((id) => {
        const b = catalog.properties.get(id);
        return b ? [b] : [];
      }),
    [chosen, catalog],
  );
  const resolved = visible.map((b) => readProperty(p.scene, b, p.time));
  const timing = resolved
    .map((d) => [d.offset, d.speed, d.duration].join(":"))
    .join("|");
  // Time changes the playhead and numeric values; the geometry only changes
  // when keys, zoom, or the mapping of a visual clip changes.
  const series = useMemo(
    () =>
      visible.map((b, i) => {
        const d = resolved[i],
          id = bindingId(b),
          keys = draft?.id === id ? draft.keys : d.keys;
        let min = d.base,
          max = d.base;
        for (const k of d.keys) {
          min = Math.min(min, k.v, k.in?.[1] ?? k.v, k.out?.[1] ?? k.v);
          max = Math.max(max, k.v, k.in?.[1] ?? k.v, k.out?.[1] ?? k.v);
        }
        const span = Math.max(
          0.2,
          (max - min) * 1.22,
          Math.min(1, (b.max - b.min) / 8),
        );
        return {
          ...d,
          b,
          id,
          keys,
          min: b.channel === "gain" ? 0 : (min + max - span) / 2,
          max:
            b.channel === "gain"
              ? Math.max(1, max) * 1.08
              : (min + max + span) / 2,
          color: colors[i % colors.length],
        };
      }),
    [visible, p.scene, draft, timing],
  );
  const selectedColors = useMemo(
    () => new Map(series.map((s) => [s.id, s.color])),
    [series],
  );
  const active =
    series.find((s) => s.id === focus?.id) ||
    series.find((s) => s.id === id) ||
    series[0];
  const clipSource =
    active?.b.channel === "gain"
      ? clipById(p.scene, active.b.clipId)
      : undefined;
  const clip =
    clipSource && audioDraft?.id === clipSource.id
      ? { ...clipSource, ...audioDraft.patch }
      : clipSource;
  const asset = clip && p.scene.assets.find((a) => a.id === clip.assetId);
  const key = focus && active?.keys[focus.index];
  const L = 57,
    T = 23,
    R = 13,
    B = 20,
    W = Math.max(110, size.w),
    H = Math.max(105, size.h),
    pw = W - L - R,
    ph = H - T - B;
  const x = (t: number) => L + ((t - range[0]) / (range[1] - range[0])) * pw;
  const y = (v: number, s: (typeof series)[number]) =>
    T + (1 - (v - s.min) / Math.max(0.001, s.max - s.min)) * ph;
  const timeOf = (clientX: number) =>
    range[0] +
    ((clientX - plot.current!.getBoundingClientRect().left - L) / pw) *
      (range[1] - range[0]);
  const global = (s: (typeof series)[number], t: number) =>
    s.offset + t / s.speed;
  const seekAt = (e: { clientX: number }) =>
    p.seek(clamp(timeOf(e.clientX), 0, p.scene.duration));
  const change = (s: (typeof series)[number], keys: Key[]) =>
    p.write(s.b, keys);
  function choose(ids: string[], add: boolean, toggle = false) {
    setChosen((old) =>
      add
        ? toggle && ids.length === 1 && old.includes(ids[0])
          ? old.filter((id) => id !== ids[0])
          : [...new Set([...old, ...ids])]
        : ids,
    );
    setFocus(undefined);
  }
  function dragKey(
    e: React.PointerEvent,
    s: (typeof series)[number],
    index: number,
    part?: "in" | "out",
  ) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setFocus({ id: s.id, index, segment: false });
    const r = plot.current!.getBoundingClientRect(),
      start = s.keys;
    let next: Key[] | undefined,
      raf = 0,
      pending: PointerEvent | undefined;
    const apply = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const g = clamp(timeOf(ev.clientX), 0, p.scene.duration);
      const t = (g - s.offset) * s.speed;
      const val = s.max - ((ev.clientY - r.top - T) / ph) * (s.max - s.min);
      next = start.slice();
      const k = (next[index] = { ...start[index] });
      const lo = next[index - 1]?.t ?? 0,
        hi = next[index + 1]?.t ?? s.duration;
      if (part)
        k[part] = [
          clamp(t, part === "in" ? lo : k.t, part === "out" ? hi : k.t),
          val,
        ];
      else {
        const tick = p.snap
          ? (Math.round(g * p.scene.fps) / p.scene.fps - s.offset) * s.speed
          : t;
        const nt = clamp(
          tick,
          lo + (index ? 1e-5 : 0),
          hi - (next[index + 1] ? 1e-5 : 0),
        );
        const nv = clamp(val, s.b.min, s.b.max),
          dt = nt - k.t,
          dv = nv - k.v;
        k.t = nt;
        k.v = nv;
        if (k.in) k.in = [clamp(k.in[0] + dt, lo, nt), k.in[1] + dv];
        if (k.out) k.out = [clamp(k.out[0] + dt, nt, hi), k.out[1] + dv];
      }
      setDraft({ id: s.id, keys: next });
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      pending = ev;
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (pending) {
            apply(pending);
            pending = undefined;
          }
        });
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      cancelAnimationFrame(raf);
      if (ev.type === "pointerup" && pending) apply(pending);
      if (next && ev.type === "pointerup") change(s, next);
      setDraft(undefined);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }
  function fadeDrag(e: React.PointerEvent, edge: "fadeIn" | "fadeOut") {
    if (!clip || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const patch = (ev: PointerEvent) => {
      const t = clamp(timeOf(ev.clientX) - clip.start, 0, clip.duration);
      return { [edge]: edge === "fadeIn" ? t : clip.duration - t };
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId === e.pointerId)
        setAudioDraft({ id: clip.id, patch: patch(ev) });
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setAudioDraft(undefined);
      if (ev.type === "pointerup") p.editClip(clip.id, patch(ev));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }
  function zoom(e: React.WheelEvent) {
    const span = range[1] - range[0],
      at = clamp(timeOf(e.clientX), range[0], range[1]);
    const next = clamp(
      span * Math.exp(e.deltaY * 0.0018),
      Math.min(0.1, p.scene.duration),
      p.scene.duration,
    );
    const start = clamp(
      at - ((at - range[0]) * next) / span,
      0,
      p.scene.duration - next,
    );
    setRange([start, start + next]);
  }
  const gain = active;
  const shapes = useMemo(
    () =>
      series.map((s) =>
        curveGeometry(
          s.keys,
          (range[0] - s.offset) * s.speed,
          (range[1] - s.offset) * s.speed,
          (t) => x(global(s, t)),
          (v) => y(v, s),
        ),
      ),
    [series, range, W, H],
  );
  const wavePath = useMemo(() => {
    if (!clipSource || !asset?.waveform?.length) return "";
    const wave = asset.waveform,
      n = Math.min(550, Math.floor(pw)),
      cy = T + ph * 0.55;
    return Array.from({ length: n }, (_, i) => {
      const t =
        clipSource.start + (clipSource.duration * i) / Math.max(1, n - 1);
      if (t < range[0] || t > range[1]) return "";
      const idx = Math.floor(
        (sourceTime(clipSource, t, asset.duration) /
          Math.max(0.001, asset.duration)) *
          wave.length,
      );
      const a = (wave[idx] || 0) * ph * 0.28;
      return (
        "M" +
        x(t).toFixed(1) +
        " " +
        (cy - a).toFixed(1) +
        "v" +
        (2 * a).toFixed(1)
      );
    }).join("");
  }, [clipSource, asset, range, W, H]);
  const envelope = useMemo(() => {
    if (!clip || !gain) return "";
    const c = { id: "", target: "Parameter" as const, keys: gain.keys };
    return Array.from({ length: 121 }, (_, i) => {
      const t = clip.start + (clip.duration * i) / 120;
      const level = c.keys.length
        ? clamp(sampleCurve(c, t - clip.start), 0, 1)
        : 1;
      return (
        (i ? "L" : "M") +
        x(t) +
        " " +
        y(
          fade(clip, Math.min(t, clip.start + clip.duration - 1e-7)) * level,
          gain,
        )
      );
    }).join(" ");
  }, [clip, gain, range, W, H]);
  const step =
    10 ** Math.floor(Math.log10(Math.max(0.0001, (range[1] - range[0]) / 7)));
  const tickStep = step * Math.ceil((range[1] - range[0]) / 7 / step);
  const ticks = Array.from(
    { length: Math.ceil((range[1] - range[0]) / tickStep) + 1 },
    (_, i) => Math.ceil(range[0] / tickStep) * tickStep + i * tickStep,
  ).filter((t) => t <= range[1] + 1e-7);
  const selectedSegment =
    focus && active && focus.index < active.keys.length - 1
      ? focus.index
      : undefined;
  const segmentOptions = useMemo(
    () =>
      active?.keys.slice(0, -1).map((k, i) => (
        <option key={i} value={i}>
          {fmt(global(active, k.t))} →{" "}
          {fmt(global(active, active.keys[i + 1].t))}s
        </option>
      )),
    [active],
  );
  return (
    <section className="curve-workspace" aria-label="曲线编辑器">
      <div className="curve-workspace-header">
        <div className="timeline-mode" aria-label="底部工作区">
          <button onClick={p.close}>时间线</button>
          <span>曲线</span>
        </div>
        <div className="curve-quick-presets" aria-label="常用插值预设">
          {curvePresets.filter(({ id }) =>
            ["hold", "linear", "easeIn", "easeOut", "smooth", "anticipate", "overshoot", "spring", "bounce"].includes(id)
          ).map((preset) => (
            <button
              key={preset.id}
              title={preset.label}
              disabled={!active || selectedSegment === undefined}
              onClick={() => {
                if (active && selectedSegment !== undefined)
                  change(active, applyCurvePreset(active.keys, [selectedSegment], preset.id));
              }}
            >
              {preset.label.split(" · ")[0]}
            </button>
          ))}
        </div>
        <button title="关闭关键帧编辑器" onClick={p.close}>
          <ArrowLeft size={14} /> 返回时间线
        </button>
      </div>
      <CurveChannelTree
        catalog={catalog}
        scene={p.scene}
        time={p.time}
        currentObject={p.binding.layerId}
        seedId={id}
        colors={selectedColors}
        choose={choose}
        record={p.record}
        value={p.value}
      />
      <div className="curve-plot-wrap">
        <div className="curve-top">
          <strong>{active?.b.name || "选择左侧属性以显示曲线"}</strong>
          {series.length > 1 && <small>{series.length} 条 · 按各自范围</small>}
          <label className="graph-autokey">
            <input
              type="checkbox"
              checked={p.autoKey}
              onChange={p.toggleAutoKey}
            />
            自动关键帧
          </label>
          <button
            title="显示整个时间范围"
            onClick={() => setRange([0, p.scene.duration])}
          >
            <Focus size={14} />
          </button>
          <button
            title="聚焦当前曲线"
            onClick={() => {
              const times = series.flatMap((s) =>
                s.keys.map((k) => global(s, k.t)),
              );
              if (clip) times.push(clip.start, clip.start + clip.duration);
              if (times.length) {
                const a = Math.min(...times),
                  b = Math.max(...times),
                  pad = Math.max(0.1, (b - a) * 0.12);
                setRange([
                  Math.max(0, a - pad),
                  Math.min(p.scene.duration, Math.max(a + 0.1, b + pad)),
                ]);
              }
            }}
          >
            聚焦
          </button>
          <button
            title="在播放头记录关键帧"
            disabled={!active}
            onClick={() => active && p.record(active.b)}
          >
            <Plus size={14} />
          </button>
        </div>
        <svg
          ref={plot}
          className="curve-plot"
          viewBox={`0 0 ${W} ${H}`}
          onWheel={zoom}
          onPointerDown={(e) => {
            if (e.button === 0) seekAt(e);
          }}
          onDoubleClick={(e) => {
            if (
              !active ||
              e.clientX < plot.current!.getBoundingClientRect().left + L
            )
              return;
            const t = clamp(
              (timeOf(e.clientX) - active.offset) * active.speed,
              0,
              active.duration,
            );
            const v = clamp(
              active.max -
                ((e.clientY - plot.current!.getBoundingClientRect().top - T) /
                  ph) *
                  (active.max - active.min),
              active.b.min,
              active.b.max,
            );
            const k = clone(active.keys),
              same = k.findIndex((k) => Math.abs(k.t - t) < 1e-5);
            if (same >= 0) k[same].v = v;
            else k.push({ t, v, mode: "bezier" });
            k.sort((a, b) => a.t - b.t);
            change(active, k);
            setFocus({
              id: active.id,
              index: k.findIndex((k) => Math.abs(k.t - t) < 1e-5),
              segment: false,
            });
          }}
        >
          <defs>
            <clipPath id="graph-bounds">
              <rect x={L} y={T} width={pw} height={ph} />
            </clipPath>
          </defs>
          {Array.from({ length: 5 }, (_, i) => i / 4).map((i) => (
            <g key={i}>
              <line
                className="graph-grid"
                x1={L}
                x2={W - R}
                y1={T + i * ph}
                y2={T + i * ph}
              />
              <text x={L - 6} y={T + i * ph + 3} textAnchor="end">
                {active ? fmt(active.max - i * (active.max - active.min)) : ""}
              </text>
            </g>
          ))}
          {ticks.map((t) => (
            <g key={t}>
              <line
                className="graph-grid"
                x1={x(t)}
                x2={x(t)}
                y1={T}
                y2={H - B}
              />
              <text x={x(t) + 3} y={14}>
                {fmt(t)}s
              </text>
            </g>
          ))}
          <g clipPath="url(#graph-bounds)">
            {clip && gain && asset && (
              <>
                <path className="graph-wave" d={wavePath} />
                <path className="graph-envelope" d={envelope} />
                {(["fadeIn", "fadeOut"] as const).map((edge) => (
                  <circle
                    key={edge}
                    className="graph-fade-point"
                    data-fade={edge}
                    cx={x(
                      edge === "fadeIn"
                        ? clip.start + clip.fadeIn
                        : clip.start + clip.duration - clip.fadeOut,
                    )}
                    cy={y(clip.weight, gain)}
                    r="6"
                    onPointerDown={(e) => fadeDrag(e, edge)}
                  >
                    <title>{edge === "fadeIn" ? "拖动淡入" : "拖动淡出"}</title>
                  </circle>
                ))}
              </>
            )}
            {series.map((s, index) => {
              const shape = shapes[index],
                selected = focus?.id === s.id ? focus : undefined;
              const indices = selected
                ? [
                    selected.index,
                    ...(selected.segment ? [selected.index + 1] : []),
                  ]
                : [];
              return (
                <g
                  key={s.id}
                  stroke={s.color}
                  fill={s.color}
                  data-plot-channel={s.id}
                >
                  {!s.keys.length && (
                    <line
                      className="graph-base"
                      x1={L}
                      x2={W - R}
                      y1={y(s.base, s)}
                      y2={y(s.base, s)}
                    />
                  )}
                  <path
                    d={shape.path}
                    fill="none"
                    strokeWidth="1.8"
                    pointerEvents="none"
                  />
                  {selected?.segment && (
                    <path
                      d={shape.segments.get(selected.index) || ""}
                      fill="none"
                      strokeWidth="3.4"
                      pointerEvents="none"
                    />
                  )}
                  <path
                    d={shape.path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="11"
                    data-curve-path
                    pointerEvents="stroke"
                    onDoubleClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      const i = segmentAt(
                        s.keys,
                        (timeOf(e.clientX) - s.offset) * s.speed,
                      );
                      if (i >= 0)
                        setFocus({ id: s.id, index: i, segment: true });
                    }}
                  />
                  <path d={shape.glyphs} pointerEvents="none" />
                  <path
                    d={shape.targets}
                    className="graph-key-targets"
                    fill="transparent"
                    stroke="none"
                    data-key-targets
                    onPointerDown={(e) => {
                      const rect = plot.current!.getBoundingClientRect(),
                        px = e.clientX - rect.left,
                        py = e.clientY - rect.top;
                      let best = Infinity,
                        i = -1;
                      for (const q of shape.points) {
                        const dist = Math.hypot(q.x - px, q.y - py);
                        if (dist < best) {
                          best = dist;
                          i = q.i;
                        }
                      }
                      if (i >= 0) dragKey(e, s, i);
                    }}
                  />
                  {indices.map((i) => {
                    const k = s.keys[i];
                    if (!k) return null;
                    const xx = x(global(s, k.t)),
                      yy = y(k.v, s);
                    return (
                      <g key={i}>
                        <path
                          d={diamond(xx, yy, 5)}
                          className="graph-key selected"
                          pointerEvents="none"
                        />
                        {(["in", "out"] as const).map((h) => {
                          const n = s.keys[i + (h === "in" ? -1 : 1)];
                          if (!n || (h === "in" ? n.mode : k.mode) !== "bezier")
                            return null;
                          const c = k[h] ?? [k.t + (n.t - k.t) / 3, k.v],
                            hx = x(global(s, c[0])),
                            hy = y(c[1], s);
                          return (
                            <g key={h}>
                              <line
                                x1={xx}
                                x2={hx}
                                y1={yy}
                                y2={hy}
                                opacity=".65"
                                pointerEvents="none"
                              />
                              <circle
                                cx={hx}
                                cy={hy}
                                r="4.5"
                                className="graph-key-handle"
                                onPointerDown={(e) => dragKey(e, s, i, h)}
                              />
                            </g>
                          );
                        })}
                      </g>
                    );
                  })}
                </g>
              );
            })}
            <line
              className="graph-playhead"
              x1={x(p.time)}
              x2={x(p.time)}
              y1={T}
              y2={H - B}
            />
          </g>
        </svg>
      </div>
      <aside className="curve-inspector">
        <div className="curve-top">
          <strong>曲线属性</strong>
        </div>
        {active && (
          <>
            <label>
              曲线段
              <select
                aria-label="选择曲线段"
                value={selectedSegment ?? ""}
                onChange={(e) =>
                  setFocus(
                    e.target.value === ""
                      ? undefined
                      : {
                          id: active.id,
                          index: +e.target.value,
                          segment: true,
                        },
                  )
                }
              >
                <option value="">点击曲线段</option>
                {segmentOptions}
              </select>
            </label>
            <label>
              插值预设
              <select
                aria-label="曲线预设"
                disabled={selectedSegment === undefined}
                value=""
                onChange={(e) => {
                  if (e.target.value && selectedSegment !== undefined)
                    change(
                      active,
                      applyCurvePreset(
                        active.keys,
                        [selectedSegment],
                        e.target.value as PresetId,
                      ),
                    );
                }}
              >
                <option value="">选择预设…</option>
                {curvePresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            {key && focus && (
              <>
                <label>
                  关键帧时间
                  <input
                    aria-label="曲线关键帧时间"
                    type="number"
                    step={1 / p.scene.fps}
                    value={fmt(global(active, key.t))}
                    onChange={(e) => {
                      const keys = clone(active.keys),
                        i = focus.index,
                        k = keys[i],
                        low = (keys[i - 1]?.t ?? -1e-5) + 1e-5,
                        high =
                          (keys[i + 1]?.t ?? active.duration + 1e-5) - 1e-5;
                      const t = clamp(
                          (+e.target.value - active.offset) * active.speed,
                          low,
                          high,
                        ),
                        dt = t - k.t;
                      k.t = t;
                      if (k.in) k.in[0] = clamp(k.in[0] + dt, low, t);
                      if (k.out) k.out[0] = clamp(k.out[0] + dt, t, high);
                      change(active, keys);
                    }}
                  />
                </label>
                <label>
                  关键帧数值
                  <input
                    aria-label="曲线关键帧数值"
                    type="number"
                    step="any"
                    value={fmt(key.v)}
                    onChange={(e) => {
                      const keys = clone(active.keys),
                        k = keys[focus.index],
                        v = clamp(+e.target.value, active.b.min, active.b.max),
                        dv = v - k.v;
                      k.v = v;
                      if (k.in) k.in[1] += dv;
                      if (k.out) k.out[1] += dv;
                      change(active, keys);
                    }}
                  />
                </label>
                <button
                  className="wide-button"
                  onClick={() => {
                    change(
                      active,
                      active.keys.filter((_, i) => i !== focus.index),
                    );
                    setFocus(undefined);
                  }}
                >
                  删除选中关键帧
                </button>
              </>
            )}
          </>
        )}
        {clip && (
          <div className="graph-audio-fields">
            <b>片段音量</b>
            {(
              [
                ["weight", "音量", 1],
                ["fadeIn", "淡入秒数", clip.duration],
                ["fadeOut", "淡出秒数", clip.duration],
              ] as const
            ).map(([k, label, max]) => (
              <label key={k}>
                {label}
                <input
                  aria-label={"曲线 " + label}
                  type="number"
                  min="0"
                  max={max}
                  step=".01"
                  value={fmt(clip[k])}
                  onChange={(e) =>
                    p.editClip(clip.id, { [k]: clamp(+e.target.value, 0, max) })
                  }
                />
              </label>
            ))}
            <label>
              渐变形状
              <select
                aria-label="音频渐变形状"
                value={clip.fadeCurve}
                onChange={(e) =>
                  p.editClip(clip.id, {
                    fadeCurve: e.target.value as SceneClip["fadeCurve"],
                  })
                }
              >
                <option value="linear">线性</option>
                <option value="equalPower">等功率</option>
              </select>
            </label>
          </div>
        )}
      </aside>
    </section>
  );
}
