import React, { useRef, useMemo } from "react";
import { Curve, Key, Param } from "./types";
import { clamp, sampleCurve } from "./engine";
type Props = {
  curve?: Curve;
  duration: number;
  param?: Param;
  time: number;
  selected: number;
  onSelect: (i: number) => void;
  onChange: (c: Curve) => void;
  onSeek: (t: number) => void;
};
export function CurveEditor({
  curve,
  duration,
  param,
  time,
  selected,
  onSelect,
  onChange,
  onSeek,
}: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const W = 760,
    H = 190,
    L = 50,
    R = 18,
    T = 18,
    B = 27;
  const values = curve?.keys.flatMap((k) => [
    k.v,
    k.in?.[1] ?? k.v,
    k.out?.[1] ?? k.v,
  ]) || [0, 1];
  const min = param?.min ?? Math.min(...values) - 0.1,
    max = param?.max ?? Math.max(...values) + 0.1,
    range = Math.max(0.01, max - min),
    d = Math.max(0.1, duration);
  const x = (t: number) => L + (t / d) * (W - L - R),
    y = (v: number) => H - B - ((v - min) / range) * (H - T - B);
  const point = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return {
      t: clamp(
        ((((e.clientX - r.left) * W) / r.width - L) / (W - L - R)) * d,
        0,
        d,
      ),
      v: clamp(
        ((H - B - ((e.clientY - r.top) * H) / r.height) / (H - T - B)) * range +
          min,
        min,
        max,
      ),
    };
  };
  function drag(e: React.PointerEvent, index: number, handle?: "in" | "out") {
    e.stopPropagation();
    e.preventDefault();
    if (!curve) return;
    onSelect(index);
    const initial = structuredClone(curve);
    let current = initial;
    const move = (ev: PointerEvent) => {
      const p = point(ev),
        next = structuredClone(initial),
        k = next.keys[index];
      if (handle) {
        k[handle] = [
          clamp(
            p.t,
            handle === "in" ? (next.keys[index - 1]?.t ?? 0) : k.t,
            handle === "out" ? (next.keys[index + 1]?.t ?? d) : k.t,
          ),
          p.v,
        ];
      } else {
        const low = index ? next.keys[index - 1].t + 0.0001 : 0,
          high =
            index < next.keys.length - 1 ? next.keys[index + 1].t - 0.0001 : d;
        const dt = clamp(p.t, low, high) - k.t,
          dv = p.v - k.v;
        k.t += dt;
        k.v = p.v;
        if (k.in) k.in = [k.in[0] + dt, k.in[1] + dv];
        if (k.out) k.out = [k.out[0] + dt, k.out[1] + dv];
      }
      current = next;
      onChange(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onChange(current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  const poly = useMemo(()=>curve
    ? Array.from({ length: 500 }, (_, i) => {
        const t = (i * d) / 499;
        return `${x(t)},${y(sampleCurve(curve, t))}`;
      }).join(" ")
    : "",[curve,d,min,max]);
  return (
    <div className="curve-editor">
      <div className="curve-heading">
        <span>
          参数曲线 <b>{param?.name || curve?.id || "选择参数以编辑"}</b>
        </span>
        <span>拖动菱形移动关键帧 · 贝塞尔圆点调整手柄 · 双击添加</span>
      </div>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        onDoubleClick={(e) => {
          if (!curve) return;
          const p = point(e);
          const c = structuredClone(curve);
          c.keys.push({ t: p.t, v: p.v, mode: "bezier" });
          c.keys.sort((a, b) => a.t - b.t);
          onChange(c);
          onSelect(c.keys.findIndex((k) => k.t === p.t));
        }}
        onPointerDown={(e) => onSeek(point(e).t)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line
              x1={L}
              x2={W - R}
              y1={y(min + v * range)}
              y2={y(min + v * range)}
              className="grid-line"
            />
            <text x={L - 9} y={y(min + v * range) + 4} textAnchor="end">
              {(min + v * range).toFixed(1)}
            </text>
          </g>
        ))}
        {Array.from({ length: 7 }, (_, i) => (i * d) / 6).map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={T} y2={H - B} className="grid-line" />
            <text x={x(v)} y={H - 8} textAnchor="middle">
              {v.toFixed(2)}s
            </text>
          </g>
        ))}
        <line
          x1={x(time)}
          x2={x(time)}
          y1={T}
          y2={H - B}
          stroke="#eec47c"
          strokeDasharray="3 4"
        />
        <polyline points={poly} fill="none" stroke="#aab7ff" strokeWidth="2" />
        {curve?.keys.map((k, i) => (
          <g key={i}>
            {i === selected &&
              (["in", "out"] as const).map((h) => {
                let c = k[h];
                const neighbor =
                  h === "out" ? curve.keys[i + 1] : curve.keys[i - 1];
                const isBezier =
                  h === "out"
                    ? k.mode === "bezier"
                    : neighbor?.mode === "bezier";
                if (!neighbor || !isBezier) return null;
                c = c ?? [k.t + (neighbor.t - k.t) / 3, k.v];
                return (
                  <g key={h}>
                    <line
                      x1={x(k.t)}
                      y1={y(k.v)}
                      x2={x(c[0])}
                      y2={y(c[1])}
                      stroke="#c5bcff"
                    />
                    <circle
                      cx={x(c[0])}
                      cy={y(c[1])}
                      r="4"
                      fill="#171a22"
                      stroke="#c5bcff"
                      onPointerDown={(e) => drag(e, i, h)}
                    />
                  </g>
                );
              })}
            <rect
              x={x(k.t) - 4}
              y={y(k.v) - 4}
              width="8"
              height="8"
              transform={`rotate(45 ${x(k.t)} ${y(k.v)})`}
              fill={selected === i ? "#eec47c" : "#aab7ff"}
              onPointerDown={(e) => drag(e, i)}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
