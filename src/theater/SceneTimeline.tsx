import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import { produce } from "immer";
import {
  Play,
  Pause,
  SkipBack,
  Plus,
  Scissors,
  Copy,
  Trash2,
  Magnet,
  Flag,
  Repeat2,
  ChevronUp,
  ChevronDown,
  Lock,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Key, Param } from "../types";
import { clamp } from "../engine";
import { Scene, SceneClip } from "./schema";
import { motionProperties, propertyGroups } from "./property-catalog";
import {
  Binding,
  bindingId,
  clipsOf,
  propertiesOf,
  readProperty,
  movePropertyKey,
} from "./properties";
type Props = {
  visible?: boolean;
  parameterOnly?: boolean;
  scene: Scene;
  selectedLayerId: string;
  selectedBinding: Binding;
  paramsByLayer: Record<string, Param[]>;
  onSelectLayer: (id: string) => void;
  onBinding: (binding: Binding, index?: number) => void;
  onRecord: (binding: Binding) => void;
  onValue: (binding: Binding, value: number) => void;
  onWriteKeys: (binding: Binding, keys: Key[]) => void;
  onHeight: (n: number) => void;
  time: number;
  playing: boolean;
  selection: string[];
  zoom: number;
  snap: boolean;
  onSeek: (t: number) => void;
  onPlay: () => void;
  onChange: (s: Scene) => void;
  onSelect: (ids: string[]) => void;
  onDrop: (
    payload: any,
    track: string | undefined,
    t: number,
    targetLayerId?: string,
  ) => void;
  onZoom: (n: number) => void;
  onSnap: () => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: (ripple?: boolean) => void;
  onMarker: () => void;
  onCurve: (binding?: Binding) => void;
  autoKey: boolean;
  onToggleAutoKey: () => void;
};

export function formatTimecode(frame: number, fps: number) {
  const seconds = Math.floor(frame / fps);
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
    frame % fps,
  ].map((n) => String(n).padStart(2, "0")).join(":");
}

function Timeline(p: Props) {
  const scroller = useRef<HTMLDivElement>(null),
    scrollAnchor = useRef<number | undefined>(undefined),
    [dragging, setDragging] = useState(false),
    label = 298,
    px = p.zoom,
    width = Math.max(700, p.scene.duration * px + 100);
  const actorTones = useMemo(
    () => new Map(p.scene.layers.filter((l) => l.kind === "model").map((l, i) => [l.id, i % 3])),
    [p.scene.layers],
  );
  const frame = Math.round(p.time * p.scene.fps);
  useEffect(() => {
    const el = scroller.current!;
    const wheel = (e: WheelEvent) => {
      if (!e.altKey) return;
      e.preventDefault();
      const at = Math.max(
        0,
        e.clientX - el.getBoundingClientRect().left - label,
      );
      const delta =
        e.deltaY *
        (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1);
      const next = clamp(px * Math.exp(-delta * 0.0017), 20, 200);
      if (next === px) return;
      scrollAnchor.current = ((el.scrollLeft + at) * next) / px - at;
      p.onZoom(next);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [px, p.onZoom]);
  useLayoutEffect(() => {
    if (scrollAnchor.current === undefined) return;
    scroller.current!.scrollLeft = scrollAnchor.current;
    scrollAnchor.current = undefined;
  }, [px]);
  const quantum = (t: number) =>
    p.snap ? Math.round(t * p.scene.fps) / p.scene.fps : t;
  function seek(e: React.PointerEvent) {
    const rect = e.currentTarget.getBoundingClientRect(),
      t0 = (e.clientX - rect.left) / px,
      x0 = e.clientX;
    p.onSeek(clamp(quantum(t0), 0, p.scene.duration));
    const move = (ev: PointerEvent) =>
      p.onSeek(
        clamp(quantum(t0 + (ev.clientX - x0) / px), 0, p.scene.duration),
      );
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  function drag(
    e: React.PointerEvent,
    c: SceneClip,
    trIndex: number,
    edge?: "left" | "right",
  ) {
    e.stopPropagation();
    if (
      p.scene.tracks[trIndex].locked ||
      p.scene.layers.find((l) => l.id === c.layerId)?.locked
    )
      return;
    e.preventDefault();
    const selected = e.shiftKey
      ? [...new Set([...p.selection, c.id])]
      : p.selection.includes(c.id)
        ? p.selection
        : [c.id];
    p.onSelect(selected);
    const original = p.scene,
      x0 = e.clientX,
      y0 = e.clientY;
    setDragging(true);
    let pending: PointerEvent | undefined,
      timer = 0;
    const apply = (ev: PointerEvent) => {
      let dt = quantum((ev.clientX - x0) / px);
      if (p.snap && !edge) {
        const target = c.start + dt,
          edges = [
            0,
            p.scene.workArea.start,
            p.scene.workArea.end,
            ...p.scene.markers.map((m) => m.t),
            ...p.scene.tracks
              .flatMap((t) => t.clips)
              .filter((v) => !selected.includes(v.id))
              .flatMap((v) => [v.start, v.start + v.duration]),
          ];
        const near = edges.find((v) => Math.abs(v - target) * px < 6);
        if (near !== undefined) dt = near - c.start;
      }
      const next = produce(original, (d) => {
        const tr = d.tracks[trIndex],
          a = tr.clips.find((v) => v.id === c.id)!;
        if (edge === "left") {
          dt = clamp(
            dt,
            -Math.min(a.start, a.trimIn / a.speed),
            a.duration - 1 / d.fps,
          );
          a.start += dt;
          a.trimIn += dt * a.speed;
          a.duration -= dt;
        } else if (edge === "right") {
          a.duration = Math.max(1 / d.fps, a.duration + dt);
        } else {
          const picked = d.tracks
              .flatMap((t) => t.clips)
              .filter((v) => selected.includes(v.id)),
            min = Math.min(...picked.map((v) => v.start));
          dt = Math.max(dt, -min);
          for (const v of picked) v.start += dt;
        }
        for (const t of d.tracks)
          for (const c of t.clips)
            d.duration = Math.max(d.duration, c.start + c.duration);
      });
      p.onChange(next);
    };
    const move = (ev: PointerEvent) => {
      pending = ev;
      if (!timer)
        timer = requestAnimationFrame(() => {
          timer = 0;
          if (pending) apply(pending);
        });
    };
    const up = () => {
      cancelAnimationFrame(timer);
      if (pending) apply(pending);
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const interval = px >= 90 ? 1 : px >= 45 ? 2 : 5;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({}),
    [animatedOnly, setAnimatedOnly] = useState(true),
    [filter, setFilter] = useState("");
  const specs = useMemo(
    () =>
      Object.fromEntries(
        ["@camera", ...p.scene.layers.map((l) => l.id)].map((id) => [
          id,
          propertiesOf(p.scene, id, p.paramsByLayer[id] || []),
        ]),
      ),
    [p.scene, p.paramsByLayer],
  );
  const isOpen = (id: string, fallback = false) => expanded[id] ?? fallback;
  const toggle = (id: string, fallback = false) =>
    setExpanded((v) => ({ ...v, [id]: !isOpen(id, fallback) }));
  const edit = (fn: (d: Scene) => void) => p.onChange(produce(p.scene, fn));
  function objectIds(id: string) {
    const ids = new Set([id]);
    let added = true;
    while (added) {
      added = false;
      for (const l of p.scene.layers)
        if (l.parentId && ids.has(l.parentId) && !ids.has(l.id)) {
          ids.add(l.id);
          added = true;
        }
    }
    return ids;
  }
  function objectSolo(id: string) {
    const ids = objectIds(id);
    return p.scene.tracks.some(
      (t) => t.solo && t.clips.some((c) => ids.has(c.layerId)),
    );
  }
  function toggleSolo(id: string) {
    const ids = objectIds(id),
      solo = !objectSolo(id);
    edit((d) => {
      for (const t of d.tracks)
        if (t.clips.some((c) => ids.has(c.layerId) || ids.has(c.lipTarget)))
          t.solo = solo;
    });
  }
  function keyDrag(e: React.PointerEvent, b: Binding, index: number) {
    e.stopPropagation();
    e.preventDefault();
    p.onBinding(b, index);
    const original = p.scene,
      info = readProperty(original, b, p.time),
      x = e.clientX,
      t = info.offset + info.keys[index].t / info.speed;
    p.onSeek(t);
    let moved = false,
      pending: PointerEvent | undefined,
      raf = 0;
    const apply = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - x) < 2 && !moved) return;
      moved = true;
      p.onChange(
        produce(original, (d) =>
          movePropertyKey(d, b, index, quantum(t + (ev.clientX - x) / px)),
        ),
      );
    };
    const move = (ev: PointerEvent) => {
      pending = ev;
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (pending) apply(pending);
        });
    };
    const up = () => {
      cancelAnimationFrame(raf);
      if (pending) apply(pending);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  const lane = (children: React.ReactNode, owner?: string) => (
    <div
      className="scene-track-lane"
      style={{ width, backgroundSize: `${px * interval}px 100%` }}
      onPointerDown={seek}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        try {
          p.onDrop(
            JSON.parse(e.dataTransfer.getData("theater")),
            undefined,
            Math.max(
              0,
              quantum(
                (e.clientX - e.currentTarget.getBoundingClientRect().left) / px,
              ),
            ),
            owner,
          );
        } catch {}
      }}
    >
      {children}
    </div>
  );
  const clipBar = (c: SceneClip, summary = false) => {
    const index = p.scene.tracks.findIndex((t) =>
        t.clips.some((v) => v.id === c.id),
      ),
      a = p.scene.assets.find((a) => a.id === c.assetId);
    return (
      <div
        key={c.id}
        data-clip-id={c.id}
        data-actor-tone={actorTones.get(c.layerId)}
        data-dialogue={c.kind === "audio" && c.lipEnabled ? true : undefined}
        className={`scene-clip ${c.kind} ${p.selection.includes(c.id) ? "selected" : ""} ${!c.enabled ? "disabled" : ""} ${summary ? "summary-clip" : ""}`}
        style={{ left: c.start * px, width: Math.max(9, c.duration * px) }}
        title={`${c.name} · ${c.duration.toFixed(6)} 秒`}
        onPointerDown={(e) => drag(e, c, index)}
      >
        <div
          className="clip-fade fade-in"
          style={{ width: Math.min(c.fadeIn, c.duration) * px }}
        />
        <div
          className="clip-fade fade-out"
          style={{ width: Math.min(c.fadeOut, c.duration) * px }}
        />
        {a?.waveform && (
          <svg
            className="waveform"
            viewBox="0 0 1000 32"
            preserveAspectRatio="none"
          >
            <path
              d={a.waveform
                .filter((_, i) => i % 4 === 0)
                .map(
                  (v, i) =>
                    `M${(i * 4000) / a.waveform!.length} ${16 - v * 14}v${v * 28}`,
                )
                .join("")}
              stroke="currentColor"
            />
          </svg>
        )}
        <span>{c.name}</span>
        <div
          className="trim-handle left"
          onPointerDown={(e) => drag(e, c, index, "left")}
        />
        <div
          className="trim-handle right"
          onPointerDown={(e) => drag(e, c, index, "right")}
        />
      </div>
    );
  };
  const propertyRows = (
    owner: string,
    group: string,
    depth: number,
    items = specs[owner] || [],
  ) => {
    const all = items.filter((q) => q.group === group),
      filtered = all.filter(
        (q) =>
          (!animatedOnly || readProperty(p.scene, q, p.time).keys.length) &&
          (!filter ||
            q.name.toLowerCase().includes(filter.toLowerCase()) ||
            q.channel.toLowerCase().includes(filter.toLowerCase())),
      ),
      id = owner + ":" + group + ":" + (items[0]?.clipId || ""),
      open = isOpen(id, !!p.parameterOnly);
    if (!all.length) return null;
    return (
      <React.Fragment key={id}>
        <div className="ae-row ae-group">
          <div
            className="scene-track-label"
            style={{ paddingLeft: 12 + depth * 14 }}
          >
            <button
              aria-label={`展开 ${owner} ${group}`}
              onClick={() => toggle(id, !!p.parameterOnly)}
            >
              {open ? "▾" : "▸"}
            </button>
            <span>{group}</span>
            <small>
              {all.filter((q) => readProperty(p.scene, q, p.time).keys.length)
                .length || ""}
            </small>
          </div>
          {lane(null)}
        </div>
        {open &&
          (!filtered.length ? (
            <div className="ae-row ae-property">
              <div className="scene-track-label ae-hint">
                无匹配动画属性；可关闭“仅动画”
              </div>
              {lane(null)}
            </div>
          ) : (
            filtered.map((q) => {
              const data = readProperty(p.scene, q, p.time),
                runtime = p.paramsByLayer[owner]?.find(
                  (v) => "param:" + v.id === q.channel,
                ),
                value = data.keys.length
                  ? data.value
                  : runtime
                    ? (p.scene.layers.find((l) => l.id === owner)?.model
                        ?.baseValues[runtime.id] ?? runtime.default)
                    : q.base;
              return (
                <div
                  key={bindingId(q)}
                  data-binding={bindingId(q)}
                  data-owner={owner}
                  data-channel={q.channel}
                  className={`ae-row ae-property ${bindingId(p.selectedBinding) === bindingId(q) ? "active-property" : ""}`}
                >
                  <div
                    className="scene-track-label"
                    style={{ paddingLeft: 18 + depth * 14 }}
                  >
                    <button
                      title={"记录 " + q.name + " 关键帧"}
                      className={data.keys.length ? "keyed" : ""}
                      onClick={() => p.onRecord(q)}
                    >
                      ◇
                    </button>
                    <button
                      className="property-name"
                      title={q.channel}
                      onClick={() => p.onBinding(q)}
                    >
                      {q.name}
                    </button>
                    <input
                      aria-label={owner + " " + q.channel + " 数值"}
                      type="number"
                      min={q.min}
                      max={q.max}
                      step=".01"
                      value={Number(value.toFixed(3))}
                      onFocus={() => p.onBinding(q)}
                      onChange={(e) => p.onValue(q, +e.target.value)}
                    />
                  </div>
                  {lane(
                    data.keys.map((k, i) => (
                      <button
                        key={i}
                        className="timeline-diamond"
                        aria-label={
                          owner + " " + q.channel + " 关键帧 " + (i + 1)
                        }
                        title={`${(data.offset + k.t / data.speed).toFixed(4)}s / ${k.v.toFixed(3)} · 拖动改时间；右键删除`}
                        style={{ left: (data.offset + k.t / data.speed) * px }}
                        onPointerDown={(e) => keyDrag(e, q, i)}
                        onDoubleClick={() => {
                          p.onBinding(q, i);
                          p.onCurve(q);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          const keys = structuredClone(data.keys);
                          keys.splice(i, 1);
                          p.onWriteKeys(q, keys);
                        }}
                      >
                        ◆
                      </button>
                    )),
                  )}
                </div>
              );
            })
          ))}
      </React.Fragment>
    );
  };
  const ancestors = new Set<string>();
  let ancestor = p.scene.layers.find(
    (l) => l.id === p.selectedLayerId,
  )?.parentId;
  while (ancestor && !ancestors.has(ancestor)) {
    ancestors.add(ancestor);
    ancestor = p.scene.layers.find((l) => l.id === ancestor)?.parentId;
  }
  const rows: React.ReactNode[] = [];
  const seen = new Set<string>();
  function objectRows(parentId: string | null, depth = 0) {
    for (const l of p.scene.layers
      .filter((l) => l.parentId === parentId)
      .reverse()) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      const folded = isOpen(
          l.id,
          l.id === p.selectedLayerId || ancestors.has(l.id),
        ),
        clips = clipsOf(p.scene, l.id),
        children = p.scene.layers.some((v) => v.parentId === l.id);
      if (
        filter &&
        !l.name.toLowerCase().includes(filter.toLowerCase()) &&
        !children &&
        !specs[l.id]?.some(
          (q) =>
            q.name.toLowerCase().includes(filter.toLowerCase()) ||
            q.channel.toLowerCase().includes(filter.toLowerCase()),
        )
      )
        continue;
      rows.push(
        <div
          className={`ae-row ae-object ${l.id === p.selectedLayerId ? "selected-object" : ""} ${!l.visible ? "hidden-object" : ""}`}
          data-object-id={l.id}
          data-layer-kind={l.kind}
          key={l.id}
        >
          <div
            className="scene-track-label"
            style={{ paddingLeft: 6 + depth * 14 }}
          >
            <button
              aria-label={"展开对象 " + l.name}
              onClick={() =>
                toggle(l.id, l.id === p.selectedLayerId || ancestors.has(l.id))
              }
            >
              {folded ? "▾" : "▸"}
            </button>
            <button
              title="显示 / 静音对象"
              onClick={() =>
                edit((d) => {
                  d.layers.find((v) => v.id === l.id)!.visible = !l.visible;
                })
              }
            >
              {l.visible ? "●" : "○"}
            </button>
            <button
              className="object-name"
              onClick={() => p.onSelectLayer(l.id)}
              title={l.name + " · " + l.id}
            >
              {l.name}
            </button>
            <small>{l.is3D ? "3D" : l.kind === "model" ? "L2D" : l.kind}</small>
            <button
              title="独奏对象及其子层"
              className={objectSolo(l.id) ? "active" : ""}
              onClick={() => toggleSolo(l.id)}
            >
              S
            </button>
            <button
              title="锁定对象"
              onClick={() =>
                edit((d) => {
                  d.layers.find((v) => v.id === l.id)!.locked = !l.locked;
                })
              }
            >
              {l.locked ? "▣" : "▫"}
            </button>
          </div>
          {lane(
            clips
              .filter((c) => c.kind === "visual" || c.kind === "audio")
              .map((c) => clipBar(c, true)),
            l.id,
          )}
        </div>,
      );
      if (!folded) continue;
      const actions = clips.filter(
        (c) => c.kind === "motion" || c.kind === "audio",
      );
      if (actions.length) {
        const cid = l.id + ":clips";
        rows.push(
          <div className="ae-row ae-group" key={cid}>
            <div
              className="scene-track-label"
              style={{ paddingLeft: 18 + depth * 14 }}
            >
              <button
                aria-label={"展开片段 " + l.name}
                onClick={() => toggle(cid, true)}
              >
                {isOpen(cid, true) ? "▾" : "▸"}
              </button>
              <span>{l.kind === "audio" ? "音频片段" : "动作 / 表情"}</span>
              <small>{actions.length}</small>
            </div>
            {lane(null, l.id)}
          </div>,
        );
        if (isOpen(cid, true))
          for (const c of actions) {
            const aid = c.id + ":curves",
              controlTrack = p.scene.tracks.find((t) =>
                t.clips.some((v) => v.id === c.id),
              )!,
              asset = p.scene.models
                .find((r) => r.id === l.model?.resourceId)
                ?.assets.find((a) => a.id === c.assetId);
            rows.push(
              <React.Fragment key={c.id}>
                <div className="ae-row ae-clip-row" data-clip-row={c.id}>
                  <div
                    className="scene-track-label"
                    style={{ paddingLeft: 28 + depth * 14 }}
                  >
                    {c.kind === "motion" && (
                      <button
                        aria-label={"展开动作参数 " + c.name}
                        onClick={() => toggle(aid)}
                      >
                        {isOpen(aid) ? "▾" : "▸"}
                      </button>
                    )}
                    <button
                      title="启用片段"
                      onClick={() =>
                        edit((d) => {
                          d.tracks
                            .flatMap((t) => t.clips)
                            .find((v) => v.id === c.id)!.enabled = !c.enabled;
                        })
                      }
                    >
                      {c.enabled ? "●" : "○"}
                    </button>
                    <button
                      className="property-name"
                      onClick={() => p.onSelect([c.id])}
                    >
                      {c.name}
                    </button>
                    <small>{c.duration.toFixed(3)}s</small>
                    <button
                      title="独奏片段"
                      className={controlTrack.solo ? "active" : ""}
                      onClick={() =>
                        edit((d) => {
                          d.tracks.find((t) => t.id === controlTrack.id)!.solo =
                            !controlTrack.solo;
                        })
                      }
                    >
                      S
                    </button>
                  </div>
                  {lane(clipBar(c), l.id)}
                </div>
                {isOpen(aid) &&
                  asset &&
                  propertyRows(
                    l.id,
                    "预设参数",
                    depth + 2,
                    motionProperties(
                      p.scene,
                      l,
                      c,
                      p.paramsByLayer[l.id] || [],
                    ),
                  )}
              </React.Fragment>,
            );
          }
      }
      for (const group of propertyGroups)
        rows.push(propertyRows(l.id, group, depth + 1));
      if (children) objectRows(l.id, depth + 1);
    }
  }
  if (p.parameterOnly) rows.push(propertyRows(p.selectedLayerId, "模型参数", 0));
  else objectRows(null);

  return (
    <section
      className={"scene-timeline ae-timeline " + (dragging ? "dragging" : "")}
      style={{ "--timeline-label": label + "px" } as React.CSSProperties}
    >
      <div
        className="timeline-resize"
        title="拖动调整时间线高度"
        onPointerDown={(e) => {
          e.preventDefault();
          const y = e.clientY,
            h = e.currentTarget.parentElement!.clientHeight;
          const move = (ev: PointerEvent) =>
            p.onHeight(
              clamp(h + y - ev.clientY, 210, window.innerHeight * 0.47),
            );
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      />
      <div className="scene-transport">
        <div>
          <div className="playback-group" aria-label="播放控制">
          <button
            title="回到工作区起点"
            onClick={() => p.onSeek(p.scene.workArea.start)}
          >
            <SkipBack size={16} />
          </button>
          <button
            className="primary play-round"
            title="播放 / 暂停（空格）"
            onClick={p.onPlay}
          >
            {p.playing ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <button
            title="循环工作区"
            className={p.scene.workArea.loop ? "active" : ""}
            onClick={() =>
              p.onChange(
                produce(p.scene, (d) => {
                  d.workArea.loop = !d.workArea.loop;
                }),
              )
            }
          >
            <Repeat2 size={16} />
          </button>
          </div>
          <div className="timecode-block">
            <span className="scene-nowclock" title={p.time.toFixed(3) + " 秒"}>{formatTimecode(frame, p.scene.fps)}</span>
            <small>帧 <span data-now-frame>{frame}</span> / {Math.round(p.scene.duration * p.scene.fps)} · {p.scene.fps} fps</small>
          </div>
          <label className="work-input">
            工作区
            <input
              type="number"
              min="0"
              step={1 / p.scene.fps}
              value={Number(p.scene.workArea.start.toFixed(3))}
              onChange={(e) =>
                p.onChange(
                  produce(p.scene, (d) => {
                    d.workArea.start = clamp(
                      +e.target.value,
                      0,
                      d.workArea.end - 1 / d.fps,
                    );
                  }),
                )
              }
            />
            <span>—</span>
            <input
              type="number"
              min="0"
              step={1 / p.scene.fps}
              value={Number(p.scene.workArea.end.toFixed(3))}
              onChange={(e) =>
                p.onChange(
                  produce(p.scene, (d) => {
                    d.workArea.end = clamp(
                      +e.target.value,
                      d.workArea.start + 1 / d.fps,
                      d.duration,
                    );
                  }),
                )
              }
            />
          </label>
        </div>
        <div>
          {!p.parameterOnly && <>
          <button title="分割（S）" onClick={p.onSplit}>
            <Scissors size={15} />
          </button>
          <button title="复制（Ctrl+D）" onClick={p.onDuplicate}>
            <Copy size={15} />
          </button>
          <button
            title="删除 / Shift 点击波纹删除"
            onClick={(e) => p.onDelete(e.shiftKey)}
          >
            <Trash2 size={15} />
          </button>
          <button title="标记（M）" onClick={p.onMarker}>
            <Flag size={15} />
          </button>
          </>}
          <button
            title="帧与边缘吸附"
            className={p.snap ? "active" : ""}
            onClick={p.onSnap}
          >
            <Magnet size={15} />
          </button>
          <label className="timeline-auto-key" title="调节参数时在播放头记录关键帧">
            <input type="checkbox" checked={p.autoKey} onChange={p.onToggleAutoKey}/> 自动关键帧
          </label>
          <div className="timeline-mode" aria-label="底部工作区">
            <span>时间线</span>
            <button onClick={() => p.onCurve()}>曲线</button>
          </div>
          <input
            aria-label="时间线缩放"
            className="timeline-zoom"
            type="range"
            min="20"
            max="200"
            value={px}
            onChange={(e) => p.onZoom(+e.target.value)}
          />
        </div>
      </div>
      <div className="ae-toolbar">
        <input
          aria-label={p.parameterOnly ? "搜索动作参数" : "搜索时间线对象或属性"}
          placeholder={p.parameterOnly ? "搜索动作参数" : "搜索对象 / 参数"}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={animatedOnly}
            onChange={(e) => setAnimatedOnly(e.target.checked)}
          />
          仅动画属性
        </label>
        <span>{p.parameterOnly ? "Alt＋滚轮缩放 · 双击关键帧打开曲线" : "Alt＋滚轮缩放 · 动作拖入指定对象 · 关键帧右键删除"}</span>
      </div>
      <div className="scene-timeline-scroll" ref={scroller}>
        <div className="scene-timeline-body" style={{ width: width + label }}>
          <div className="scene-ruler-row">
            <div className="scene-track-label ruler-label">
              {p.parameterOnly ? "模型参数" : "对象 / 属性"} · {p.scene.fps} FPS
            </div>
            <div className="scene-ruler" style={{ width }} onPointerDown={seek}>
              {Array.from(
                { length: Math.ceil(p.scene.duration / interval) + 1 },
                (_, i) => i * interval,
              ).map((t) => (
                <span style={{ left: t * px }} key={t}>
                  {t}s
                </span>
              ))}
              <div
                className="work-area"
                style={{
                  left: p.scene.workArea.start * px,
                  width: (p.scene.workArea.end - p.scene.workArea.start) * px,
                }}
              />
              {p.scene.markers.map((m) => (
                <button
                  key={m.id}
                  className="time-marker"
                  title={m.name}
                  style={{ left: m.t * px }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    p.onSeek(m.t);
                  }}
                >
                  <Flag size={11} />
                </button>
              ))}
            </div>
          </div>
          {!p.parameterOnly && <>
          <div className="ae-row ae-object">
            <div className="scene-track-label">
              <button aria-label="展开相机" onClick={() => toggle("@camera")}>
                {isOpen("@camera") ? "▾" : "▸"}
              </button>
              <button
                className="object-name"
                onClick={() => p.onSelectLayer("@camera")}
              >
                相机
              </button>
            </div>
            {lane(null)}
          </div>
          {isOpen("@camera") && propertyRows("@camera", "相机", 1)}
          </>}
          {rows}
          <div
            className="scene-playhead"
            data-zoom={px}
            data-label={label}
            style={{
              left: label + p.time * px,
              height: "100%",
            }}
          >
            <i />
          </div>
        </div>
      </div>
      <div className="scene-timeline-footer">
        <span>
          {p.parameterOnly ? "拖动关键帧改时间 · 双击查看曲线 · 右键删除关键帧" : "拖动 / 裁切 · Shift 多选 · S 分割 · Shift+Delete 波纹删除 · M 标记"}
        </span>
        <span>
          {p.parameterOnly ? "Live2D 动作参数" : p.scene.tracks.reduce((n, t) => n + t.clips.length, 0)+" 个片段"}
        </span>
      </div>
    </section>
  );
}
// Keep folds and scroll position mounted, without rebuilding rows behind curves.
export const SceneTimeline = React.memo(
  Timeline,
  (a, b) => a.visible === false && b.visible === false,
);
