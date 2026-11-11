import { useLayoutEffect, useState, useSyncExternalStore, type RefObject } from "react";
import type { ViewSnapshot } from "./scene-renderer";

type Point = { x: number; y: number };
export type AgentFocus = { layerId?: string; label: string; handle?: string };
type Activity = { active: boolean; focus?: AgentFocus; step: number };

export function agentCanvasActivity() {
  let state: Activity = { active: false, step: 0 };
  let views: readonly ViewSnapshot[] = [];
  let queue: AgentFocus[] = [];
  let dwell: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const frameListeners = new Set<() => void>();
  const notify = () => listeners.forEach(fn => fn());
  function advance() {
    dwell = undefined;
    const focus = queue.shift();
    if (!focus || !state.active) return;
    state = { active: true, focus, step: state.step + 1 };
    notify();
    dwell = setTimeout(advance, 280);
  }
  return {
    read: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    frames: () => views,
    watchFrames(fn: () => void) {
      frameListeners.add(fn);
      return () => { frameListeners.delete(fn); };
    },
    publish(main?: ViewSnapshot, mirror?: ViewSnapshot) {
      views = [main, mirror].filter(v => v !== undefined);
      frameListeners.forEach(fn => fn());
    },
    turn(active: boolean, focus?: AgentFocus) {
      clearTimeout(dwell);
      dwell = undefined;
      queue = [];
      if (!active && !state.active) return;
      state = { active, focus: focus ?? state.focus, step: state.step + Number(active) };
      notify();
    },
    point(...targets: AgentFocus[]) {
      if (!state.active || !targets.length) return;
      queue = [...queue, ...targets].slice(-4);
      if (dwell === undefined) advance();
    },
  };
}

type Pose = Point & { id?: string; handle?: string; outline?: string; left?: boolean };
function locate(root: HTMLElement, views: readonly ViewSnapshot[], focus?: AgentFocus): Pose {
  const area = root.getBoundingClientRect();
  const target = focus?.layerId;
  const ordered = target === "output" ? views.filter(view => !view.spatial) : views;
  for (const view of ordered) {
    if (!target || !root.contains(view.host)) continue;
    const pane = view.host.getBoundingClientRect();
    if (!pane.width || !pane.height) continue;
    const x0 = pane.left - area.left, y0 = pane.top - area.top;
    const sx = pane.width / view.width, sy = pane.height / view.height;
    const box = view.frame;
    const hit = target === "output" || (target === "@camera" && !view.spatial) ? [
      {x:box.x,y:box.y}, {x:box.x+box.w,y:box.y},
      {x:box.x+box.w,y:box.y+box.h}, {x:box.x,y:box.y+box.h},
    ] : view.hits.find(h => h.id === target)?.points;
    const gizmo = view.host.querySelector('.transform-gizmo[data-layer-id="' + CSS.escape(target) + '"]');
    const anchor = focus?.handle && gizmo?.querySelector('[data-handle="' + CSS.escape(focus.handle) + '"] [data-agent-anchor]');
    let point: Point | undefined;
    const geometry = anchor ?? (!hit ? gizmo?.querySelector(".gizmo-origin") : undefined);
    if (geometry instanceof SVGGeometryElement) {
      const transform = geometry.getScreenCTM();
      if (transform) {
        const onHandle = geometry instanceof SVGCircleElement ? new DOMPoint(geometry.cx.baseVal.value, geometry.cy.baseVal.value)
          : geometry.getPointAtLength(geometry.getTotalLength() / 2);
        const screen = onHandle.matrixTransform(transform);
        point = { x: screen.x - pane.left, y: screen.y - pane.top };
      }
    }
    const handle = point && anchor ? focus?.handle : undefined;
    const polygon = hit?.map(p => ({ x: p.x * sx, y: p.y * sy }));
    if (!point && polygon?.length) {
      const xs = polygon.map(p => p.x), ys = polygon.map(p => p.y);
      const left = Math.max(0, Math.min(...xs)), right = Math.min(pane.width, Math.max(...xs));
      const top = Math.max(0, Math.min(...ys)), bottom = Math.min(pane.height, Math.max(...ys));
      if (left < right && top < bottom) point = { x: (left + right) / 2, y: (top + bottom) / 2 };
    }
    if (!point || point.x < 0 || point.y < 0 || point.x > pane.width || point.y > pane.height) continue;
    const x = Math.round(x0 + point.x), y = Math.round(y0 + point.y);
    const outline = polygon?.map(p => Math.round(x0 + Math.max(0, Math.min(pane.width,p.x))) + "," +
      Math.round(y0 + Math.max(0, Math.min(pane.height,p.y)))).join(" ");
    return { x, y, id: target, handle, outline, left: x > area.width - 140 };
  }
  return { x: Math.min(46, area.width / 3), y: Math.max(4, area.height - 52) };
}

export function AgentCursor({ activity, viewport }: {
  activity: ReturnType<typeof agentCanvasActivity>; viewport: RefObject<HTMLDivElement | null>;
}) {
  const { active, focus, step } = useSyncExternalStore(activity.subscribe, activity.read);
  const [pose, setPose] = useState<Pose>();
  useLayoutEffect(() => {
    const root = viewport.current;
    if (!root || !active) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const next = locate(root, activity.frames(), focus);
      setPose(old => old?.x === next.x && old.y === next.y && old.id === next.id &&
        old.handle === next.handle && old.outline === next.outline && old.left === next.left ? old : next);
    };
    const refresh = () => { if (!frame) frame = requestAnimationFrame(place); };
    place();
    const unsubscribe = activity.watchFrames(refresh);
    const resize = new ResizeObserver(refresh);
    resize.observe(root);
    return () => { cancelAnimationFrame(frame); unsubscribe(); resize.disconnect(); };
  }, [activity, active, focus, viewport]);
  if (!pose) return null;
  return <div className="studio-agent-canvas" data-active={active} aria-hidden="true">
    {pose.outline && <svg className="studio-agent-target"><polygon points={pose.outline}/></svg>}
    <div className="studio-agent-cursor" data-target={pose.id} data-target-handle={pose.handle} data-left={pose.left}
      style={{ transform: "translate3d(" + pose.x + "px," + pose.y + "px,0)" }}>
      {pose.id && <i key={step} className="studio-agent-landing"/>}
      <div className="studio-agent-pointer">
        <svg width="22" height="26" viewBox="0 0 22 26"><path d="M1 1L20 13L12 15L8 23Z"/></svg>
        <span>Agent <b>·</b> {focus?.label ?? "正在思考"}</span>
      </div>
    </div>
  </div>;
}
