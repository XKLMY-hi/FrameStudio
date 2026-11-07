import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Scene } from "./schema";
import { readProperty, type Binding } from "./properties";
import { buildPropertyCatalog, type PropertyNode } from "./property-catalog";
import { dragBox, editable, type Box } from "./viewport-selection";

type Props = {
  catalog: ReturnType<typeof buildPropertyCatalog>;
  scene: Scene;
  time: number;
  currentObject: string;
  seedId?: string;
  colors: ReadonlyMap<string, string>;
  choose: (ids: string[], additive: boolean, toggle?: boolean) => void;
  record: (b: Binding) => void;
  value: (b: Binding, value: number) => void;
};

export function CurveChannelTree({
  catalog,
  scene,
  time,
  currentObject,
  seedId,
  colors,
  choose,
  record,
  value,
}: Props) {
  const [search, setSearch] = useState("");
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  const list = useRef<HTMLDivElement>(null),
    marquee = useRef<HTMLDivElement>(null);
  const defaults = useMemo(() => {
    const ids = new Set<string>();
    let object: string | undefined = currentObject
      ? "object:" + currentObject
      : undefined;
    while (object) {
      ids.add(object);
      object = catalog.parents.get(object);
    }
    if (currentObject)
      ids.add(
        "group:" +
          currentObject +
          (currentObject === "@camera" ? ":相机" : ":变换"),
      );
    return ids;
  }, [catalog, currentObject]);
  const seedPath = useMemo(() => {
    const path: string[] = [];
    if (seedId)
      for (
        let parent = catalog.parents.get(seedId);
        parent;
        parent = catalog.parents.get(parent)
      )
        path.push(parent);
    return path.join("\n");
  }, [catalog, seedId]);
  useEffect(() => {
    if (!seedPath) return;
    setFolds((f) => ({
      ...f,
      ...Object.fromEntries(seedPath.split("\n").map((id) => [id, true])),
    }));
  }, [seedId, seedPath]);
  const canEdit = useMemo(
    () => new Map(scene.layers.map((l) => [l.id, editable(scene, l)])),
    [scene],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase(),
      result: { node: PropertyNode; depth: number; open: boolean }[] = [];
    const matches = new Set<string>();
    const match = (n: PropertyNode): boolean => {
      const child = n.children.map(match).some(Boolean);
      const ok =
        n.label.toLowerCase().includes(q) ||
        !!n.property?.channel.toLowerCase().includes(q) ||
        child;
      if (ok) matches.add(n.id);
      return ok;
    };
    if (q) catalog.roots.forEach(match);
    const visit = (node: PropertyNode, depth: number, showAll = false) => {
      if (q && !showAll && !matches.has(node.id)) return;
      const open = !!q || (folds[node.id] ?? defaults.has(node.id));
      result.push({ node, depth, open });
      if (open) {
        const all = showAll || (!!q && node.label.toLowerCase().includes(q));
        node.children.forEach((n) => visit(n, depth + 1, all));
      }
    };
    catalog.roots.forEach((n) => visit(n, 0));
    return result;
  }, [catalog, search, folds, defaults]);
  useEffect(() => {
    if (!seedId) return;
    const el = [
      ...(list.current?.querySelectorAll<HTMLElement>("[data-curve-channel]") ||
        []),
    ].find((el) => el.dataset.curveChannel === seedId);
    el?.scrollIntoView({ block: "nearest" });
  }, [seedId, rows.length]);

  function boxSelect(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("input,[data-tree-control]")) return;
    const id = target.closest<HTMLElement>("[data-curve-channel]")?.dataset
      .curveChannel;
    const el = e.currentTarget,
      rect = el.getBoundingClientRect();
    const start = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    let box: Box | undefined;
    const v = marquee.current!;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      if (
        !box &&
        Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 5
      )
        return;
      box = dragBox(start, {
        x: ev.clientX - rect.left,
        y: ev.clientY - rect.top,
      });
      Object.assign(v.style, {
        display: "block",
        left: box.x + "px",
        top:
          rect.top -
          v.parentElement!.getBoundingClientRect().top +
          box.y +
          "px",
        width: box.w + "px",
        height: box.h + "px",
      });
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      v.style.display = "none";
      if (ev.type === "pointercancel") return;
      if (box) {
        const top = rect.top + box.y,
          bottom = top + box.h;
        const selected = [
          ...el.querySelectorAll<HTMLElement>("[data-curve-channel]"),
        ]
          .filter((row) => {
            const r = row.getBoundingClientRect();
            return (
              r.bottom > Math.max(rect.top, top) &&
              r.top < Math.min(rect.bottom, bottom)
            );
          })
          .map((row) => row.dataset.curveChannel!);
        choose(selected, e.shiftKey || e.ctrlKey);
      } else if (id) choose([id], e.shiftKey || e.ctrlKey, true);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }
  return (
    <aside className="curve-channels">
      <input
        aria-label="搜索曲线通道"
        placeholder="搜索对象 / 参数"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div
        className="curve-channel-scroll"
        ref={list}
        role="tree"
        aria-label="曲线通道"
        onPointerDown={boxSelect}
      >
        {rows.map(({ node, depth, open }) => {
          const prop = node.property,
            indent = Math.min(8, depth) * 12;
          if (!prop)
            return (
              <div
                key={node.id}
                role="treeitem"
                aria-level={depth + 1}
                aria-expanded={node.children.length ? open : undefined}
              >
                <button
                  className={
                    "curve-tree-branch curve-tree-branch--" +
                    node.kind +
                    (node.hidden ? " muted" : "")
                  }
                  data-tree-control
                  data-tree-node={node.id}
                  aria-label={node.label}
                  style={{ paddingLeft: 7 + indent }}
                  onClick={() => setFolds((f) => ({ ...f, [node.id]: !open }))}
                  title={node.label + (node.locked ? " · 已锁定" : "")}
                >
                  <span className="tree-chevron">
                    {node.children.length ? (open ? "▾" : "▸") : ""}
                  </span>
                  <span className="tree-label">{node.label}</span>
                  <small>
                    {node.locked ? "▣ " : ""}
                    {node.info || ""}
                  </small>
                </button>
              </div>
            );
          const data = readProperty(scene, prop, time),
            color = colors.get(node.id);
          const disabled = canEdit.get(prop.layerId) === false;
          return (
            <div
              key={node.id}
              role="treeitem"
              aria-level={depth + 1}
              aria-selected={!!color}
              className={"curve-tree-property" + (color ? " active" : "")}
              data-curve-channel={node.id}
              style={{ paddingLeft: indent + 6 }}
            >
              <button
                data-tree-control
                title={"记录 " + prop.name + " 关键帧"}
                className={
                  "curve-tree-key" + (data.keys.length ? " keyed" : "")
                }
                disabled={disabled}
                onClick={() => {
                  choose([node.id], false);
                  record(prop);
                }}
              >
                {data.keys.length ? "◆" : "◇"}
              </button>
              <button
                className="curve-tree-name"
                title={prop.channel}
                onClick={(e) => {
                  if (e.detail === 0)
                    choose([node.id], e.ctrlKey || e.shiftKey, true);
                }}
              >
                <i style={{ background: color || "transparent" }} />
                {node.label}
              </button>
              <input
                aria-label={prop.layerId + " " + prop.channel + " 曲线数值"}
                title={String(Number(data.value.toFixed(5)))}
                disabled={disabled}
                type="number"
                step="any"
                min={prop.min}
                max={prop.max}
                value={Number(data.value.toFixed(4))}
                onChange={(e) => {
                  if (Number.isFinite(e.target.valueAsNumber))
                    value(
                      prop,
                      Math.min(
                        prop.max,
                        Math.max(prop.min, e.target.valueAsNumber),
                      ),
                    );
                }}
              />
            </div>
          );
        })}
        {!rows.length && <p className="hint">没有匹配的对象或属性</p>}
      </div>
      <div
        ref={marquee}
        className="curve-channel-box"
        style={{ display: "none" }}
      />
    </aside>
  );
}
