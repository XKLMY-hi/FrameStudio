import type { Param } from "../types";
import { bindingId, clipsOf, propertiesOf, type Property } from "./properties";
import type { Layer, Scene, SceneClip } from "./schema";

export const propertyGroups = [
  "变换",
  "光源",
  "模型参数",
  "材质",
  "文本",
  "音频",
  "效果",
] as const;

export function motionProperties(
  s: Scene,
  l: Layer,
  c: SceneClip,
  params: Param[],
): Property[] {
  const asset = s.models
    .find((r) => r.id === l.model?.resourceId)
    ?.assets.find((a) => a.id === c.assetId);
  if (!asset) return [];
  const byId = new Map(params.map((p) => [p.id, p]));
  return asset.curves.map((curve) => {
    const param = curve.target === "Parameter" ? byId.get(curve.id) : undefined;
    return {
      layerId: l.id,
      clipId: c.id,
      channel: "motion:" + curve.id,
      name: param?.name || curve.id,
      group: "预设参数",
      base: curve.keys[0]?.v ?? 0,
      min: param?.min ?? (curve.target === "PartOpacity" ? 0 : -10000),
      max: param?.max ?? (curve.target === "PartOpacity" ? 1 : 10000),
    };
  });
}

export type PropertyNode = {
  id: string;
  label: string;
  kind: "object" | "group" | "clip" | "property";
  children: PropertyNode[];
  property?: Property;
  info?: string;
  hidden?: boolean;
  locked?: boolean;
};
const leaf = (p: Property): PropertyNode => ({
  id: bindingId(p),
  label: p.name,
  kind: "property",
  children: [],
  property: p,
});
const group = (
  id: string,
  label: string,
  children: PropertyNode[],
): PropertyNode => ({ id, label, kind: "group", children, info: String(children.length) });

export function buildPropertyCatalog(
  s: Scene,
  paramsByLayer: Record<string, Param[]>,
) {
  const properties = new Map<string, Property>(),
    parents = new Map<string, string>();
  const children = new Map<string | null, Layer[]>();
  for (const l of s.layers) {
    if (!children.has(l.parentId)) children.set(l.parentId, []);
    children.get(l.parentId)!.push(l);
  }
  const seen = new Set<string>();
  const object = (l: Layer): PropertyNode => {
    seen.add(l.id);
    const params = paramsByLayer[l.id] || [];
    const specs = propertiesOf(s, l.id, params);
    const actions = clipsOf(s, l.id).filter(
      (c) => c.kind === "motion" || c.kind === "audio",
    );
    const branches: PropertyNode[] = [];
    if (actions.length) {
      const clips: PropertyNode[] = actions.map((c) => {
        const rows =
          c.kind === "motion"
            ? motionProperties(s, l, c, params)
            : specs.filter((p) => p.channel === "gain" && p.clipId === c.id);
        return {
          id: "clip:" + c.id,
          label: c.name,
          kind: "clip",
          info: Number(c.duration.toFixed(3)) + "s",
          hidden: !c.enabled,
          children:
            c.kind === "motion" && rows.length
              ? [group("preset:" + c.id, "预设参数", rows.map(leaf))]
              : rows.map(leaf),
        };
      });
      branches.push(
        group(
          "clips:" + l.id,
          l.kind === "audio" ? "音频片段" : "动作 / 表情",
          clips,
        ),
      );
    }
    for (const name of propertyGroups) {
      const list = specs.filter(
        (p) => p.group === name && p.channel !== "gain",
      );
      if (list.length)
        branches.push(
          group("group:" + l.id + ":" + name, name, list.map(leaf)),
        );
    }
    for (const sub of [...(children.get(l.id) || [])].reverse())
      if (!seen.has(sub.id)) branches.push(object(sub));
    return {
      id: "object:" + l.id,
      label: l.name,
      kind: "object",
      children: branches,
      info: l.is3D ? "3D" : l.kind === "model" ? "L2D" : undefined,
      hidden: !l.visible,
      locked: l.locked,
    };
  };
  const roots: PropertyNode[] = [
    {
      id: "object:@camera",
      label: "相机",
      kind: "object",
      children: [
        group(
          "group:@camera:相机",
          "相机",
          propertiesOf(s, "@camera").map(leaf),
        ),
      ],
    },
  ];
  for (const l of [...(children.get(null) || [])].reverse())
    if (!seen.has(l.id)) roots.push(object(l));
  // Imported scenes with a missing parent still expose their controls.
  for (const l of s.layers) if (!seen.has(l.id)) roots.push(object(l));
  function index(n: PropertyNode) {
    if (n.property) properties.set(n.id, n.property);
    for (const child of n.children) {
      parents.set(child.id, n.id);
      index(child);
    }
  }
  roots.forEach(index);
  return { roots, properties, parents };
}
