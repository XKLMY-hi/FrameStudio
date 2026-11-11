import React, { useSyncExternalStore } from "react";
import type { Vec3 } from "./viewport";

export type Axis = "x" | "y" | "z";
export type GizmoTool = "move" | "rotate" | "scale";
export type Handle = Axis | "uniform";
type Point = { x: number; y: number };
export type GizmoAxis = {
  axis: Axis;
  dx: number;
  dy: number;
  pixels: number;
  ring: string;
  line?: string;
  tip?: boolean;
};
export type OverlayFrame = {
  rotation: number[];
  gizmo?: {
    id: string;
    ids: string[];
    pivot: Vec3;
    pivotVisible?: boolean;
    center: Point;
    axes: GizmoAxis[];
    corners: Point[];
    camera: boolean;
    spatial: boolean;
  };
};
const initial: OverlayFrame = { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
export function viewportStore() {
  let value = initial,
    key = "";
  const listeners = new Set<() => void>();
  return {
    read: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish: (next: OverlayFrame) => {
      const k = JSON.stringify(next);
      if (k === key) return;
      value = next;
      key = k;
      listeners.forEach((fn) => fn());
    },
  };
}
const colors = { x: "#ef6579", y: "#68ba76", z: "#589af8" };
const toolNames = { move: "移动", rotate: "旋转", scale: "缩放" };
export function ViewportOverlay({
  store,
  tool,
  begin,
  orient,
}: {
  store: ReturnType<typeof viewportStore>;
  tool: GizmoTool;
  begin: (
    e: React.PointerEvent,
    mode: GizmoTool,
    handle: Handle,
    gizmo: NonNullable<OverlayFrame["gizmo"]>,
  ) => void;
  orient: (axis: Axis, sign: number) => void;
}) {
  const { rotation, gizmo } = useSyncExternalStore(store.subscribe, store.read);
  const ends = (["x", "y", "z"] as const)
    .flatMap((axis, i) =>
      [-1, 1].map((sign) => {
        const [x, y, z] = rotation.slice(i * 3, i * 3 + 3);
        const face = Math.hypot(x, y) < 0.13;
        return {
          axis,
          sign,
          x: 48 + x * 29 * sign + (face ? (sign < 0 ? -9 : 9) : 0),
          y: 48 + y * 29 * sign,
          z: z * sign,
        };
      }),
    )
    .sort((a, b) => b.z - a.z);
  const center = gizmo?.center,
    mode = gizmo?.camera ? "move" : tool;
  return (
    <div className="viewport-overlay">
      <svg
        className="view-axis-widget"
        viewBox="0 0 96 96"
        aria-label="视图方位"
      >
        <circle cx="48" cy="48" r="38" className="view-axis-disc" />
        {ends
          .filter((e) => e.sign === 1)
          .map((e) => (
            <line
              key={e.axis}
              x1="48"
              y1="48"
              x2={e.x}
              y2={e.y}
              stroke={colors[e.axis]}
              strokeWidth="2"
            />
          ))}
        {ends.map((e) => (
          <g
            key={e.axis + e.sign}
            className="viewport-handle"
            role="button"
            tabIndex={0}
            aria-label={
              (e.sign < 0 ? "负" : "正") + e.axis.toUpperCase() + "轴视图"
            }
            onPointerDown={(ev) => ev.stopPropagation()}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                ev.stopPropagation();
                orient(e.axis, e.sign);
              }
            }}
            onClick={() => orient(e.axis, e.sign)}
          >
            <circle cx={e.x} cy={e.y} r="11" fill="transparent" />
            <circle
              cx={e.x}
              cy={e.y}
              r={e.sign > 0 ? 9 : 7}
              fill={e.sign > 0 ? colors[e.axis] : "var(--view-axis-fill)"}
              stroke={colors[e.axis]}
              strokeWidth="1.5"
            />
            <text
              x={e.x}
              y={e.y + 3.2}
              textAnchor="middle"
              fill={e.sign > 0 ? "#181320" : colors[e.axis]}
            >
              {e.sign > 0 ? e.axis.toUpperCase() : "−"}
            </text>
          </g>
        ))}
      </svg>
      {gizmo && center && (
        <svg className="transform-gizmo" data-layer-id={gizmo.id} aria-label="变换控制器">
          {gizmo.corners.map((p, i) => (
            <g
              key={i}
              className="viewport-handle"
              data-handle={"corner-" + i}
              role="button"
              aria-label={"等比缩放角点 " + (i + 1)}
              onPointerDown={(e) => begin(e, "scale", "uniform", gizmo)}
            >
              <circle cx={p.x} cy={p.y} r="15" fill="transparent" />
              <rect
                x={p.x - 5}
                y={p.y - 5}
                width="10"
                height="10"
                rx="2"
                className="gizmo-corner"
              />
            </g>
          ))}
          {gizmo.axes
            .filter((a) =>
              mode === "scale"
                ? a.axis !== "z"
                : gizmo.spatial ||
                  (mode === "rotate" ? a.axis === "z" : a.axis !== "z"),
            )
            .map((a) => {
              const x = center.x + a.dx * 53,
                y = center.y + a.dy * 53,
                color = colors[a.axis];
              return (
                <g
                  key={a.axis}
                  className="viewport-handle"
                  data-handle={mode + "-" + a.axis}
                  role="button"
                  aria-label={
                    toolNames[mode] + " " + a.axis.toUpperCase() + "轴"
                  }
                  onPointerDown={(e) => begin(e, mode, a.axis, gizmo)}
                >
                  {mode === "rotate" ? (
                    <>
                      <path
                        d={a.ring}
                        fill="none"
                        stroke="transparent"
                        strokeWidth="19"
                        pointerEvents="stroke"
                      />
                      <path
                        data-agent-anchor
                        d={a.ring}
                        fill="none"
                        stroke={color}
                        strokeWidth="2.5"
                      />
                    </>
                  ) : (
                    <>
                      {a.line === undefined ? (
                        <>
                          <line
                            x1={center.x}
                            y1={center.y}
                            x2={x}
                            y2={y}
                            stroke="transparent"
                            strokeWidth="18"
                          />
                          <line
                            x1={center.x}
                            y1={center.y}
                            x2={x}
                            y2={y}
                            stroke={color}
                            strokeWidth="2.5"
                          />
                        </>
                      ) : (
                        <>
                          <path
                            d={a.line}
                            fill="none"
                            stroke="transparent"
                            strokeWidth="18"
                            pointerEvents="stroke"
                          />
                          <path
                            d={a.line}
                            fill="none"
                            stroke={color}
                            strokeWidth="2.5"
                            pointerEvents="stroke"
                          />
                        </>
                      )}
                      {a.tip !== false && (
                        <>
                          <circle data-agent-anchor cx={x} cy={y} r="14" fill="transparent" />
                          {mode === "scale" ? (
                            <rect
                              x={x - 5}
                              y={y - 5}
                              width="10"
                              height="10"
                              rx="2"
                              fill={color}
                            />
                          ) : (
                            <path
                              d={`M ${x + a.dx * 5} ${y + a.dy * 5} L ${x - a.dx * 7 - a.dy * 6} ${y - a.dy * 7 + a.dx * 6} L ${x - a.dx * 7 + a.dy * 6} ${y - a.dy * 7 - a.dx * 6} Z`}
                              fill={color}
                            />
                          )}
                          <text
                            x={x + a.dx * 11}
                            y={y + a.dy * 11 + 3}
                            textAnchor="middle"
                            fill={color}
                          >
                            {a.axis.toUpperCase()}
                          </text>
                        </>
                      )}
                    </>
                  )}
                </g>
              );
            })}
          {gizmo.pivotVisible !== false && (
            <circle
              cx={center.x}
              cy={center.y}
              r="3.5"
              className="gizmo-origin"
            />
          )}
          {mode === "scale" && gizmo.pivotVisible !== false && (
            <g
              className="viewport-handle"
              data-handle="scale-uniform"
              role="button"
              aria-label="等比缩放"
              onPointerDown={(e) => begin(e, "scale", "uniform", gizmo)}
            >
              <circle data-agent-anchor cx={center.x} cy={center.y} r="15" fill="transparent" />
              <circle
                cx={center.x}
                cy={center.y}
                r="7"
                className="gizmo-corner"
              />
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
