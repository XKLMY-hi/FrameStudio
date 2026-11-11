import type { CodeShader } from "../../backend/shader-format.mjs";
import { current, isDraft } from "immer";
import { emptyGraph, graphNode, graphOps, legacyGraph, validateEffectGraph, type EffectGraph, type GraphNode, type GraphOp } from "./effect-graph";
import type { Scene } from "./schema";

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("需要对象");
  return value as Record<string, unknown>;
};

export function currentPostGraph(scene: Scene, target: string) {
  const effects = scene.layers.find(layer => layer.id === target)?.effects;
  const graph = target === "output" ? scene.outputGraph : effects?.graph;
  const shader = target === "output" ? scene.outputShader : effects?.codeShader;
  const recipe = effects?.stylize;
  const current = graph ?? (recipe ? legacyGraph(recipe) : emptyGraph("post", target === "output" ? "成片后处理" : "图层后处理"));
  return shader ? appendShader(current, shader) : current;
}

export function postRevision(scene: Scene, target: string) {
  const layer = scene.layers.find(l => l.id === target);
  const json = JSON.stringify(target === "output" ? [scene.outputGraph, scene.outputShader] :
    [layer?.effects.graph, layer?.effects.codeShader, layer?.effects.stylize]);
  let hash = 2166136261;
  for (let i = 0; i < json.length; i++) hash = Math.imul(hash ^ json.charCodeAt(i),16777619);
  return json.length + ":" + (hash >>> 0).toString(16);
}

function position(graph: EffectGraph) {
  const previous = graph.nodes.find(n => "@" + n.id === graph.output);
  const free = (x: number, y: number) => graph.nodes.every(n =>
    Math.abs(n.x - x) >= 180 || n.y + 48 + Object.keys(n.inputs).length * 25 <= y || y + 210 <= n.y);
  if (previous && previous.x < 4540 && free(previous.x + 192,previous.y)) return [previous.x + 192,previous.y];
  for (let i = 0; i < 64; i++) {
    const x = 180 + i % 4 * 192, y = 64 + Math.floor(i / 4) * 220;
    if (free(x,y)) return [x,y];
  }
  return [180,Math.min(4800,Math.max(...graph.nodes.map(n=>n.y)) + 220)];
}

export function appendShader(graph: EffectGraph, shader: CodeShader) {
  let count = 1;
  while (graph.nodes.some(n => n.id === "glsl" + count)) count++;
  const id = "glsl" + count, [x,y] = position(graph);
  return validateEffectGraph({ ...graph, output: "@" + id, nodes: [
    ...graph.nodes, graphNode(id, "glsl", x, y, { image: graph.output, shader }),
  ] });
}

export function editEffectGraph(base: EffectGraph, edits: unknown): EffectGraph {
  if (!Array.isArray(edits) || !edits.length || edits.length > 24) throw Error("节点编辑需要 1–24 项操作");
  const graph = structuredClone(isDraft(base) ? current(base) : base);
  const get = (id: unknown): GraphNode => {
    const node = graph.nodes.find(n => n.id === id);
    if (!node) throw Error("找不到节点 " + String(id).slice(0, 32));
    return node;
  };
  for (const value of edits) {
    const e = record(value);
    switch (e.op) {
      case "add": {
        if (typeof e.id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(e.id) || graph.nodes.some(n => n.id === e.id))
          throw Error("新增节点 ID 无效或重复");
        if (typeof e.type !== "string" || !Object.hasOwn(graphOps, e.type)) throw Error("未知节点类型");
        const [x,y] = position(graph);
        const type = e.type as GraphOp;
        const inputs = record(e.inputs ?? {});
        for (const key of Object.keys(inputs))
          if (!Object.hasOwn(graphOps[type].inputs,key)) throw Error("未知节点输入 " + key);
        graph.nodes.push(graphNode(e.id,type,x,y,inputs as GraphNode["inputs"]));
        break;
      }
      case "connect":
      case "set": {
        const node = get(e.id);
        if (typeof e.port !== "string" || !Object.hasOwn(graphOps[node.op].inputs,e.port))
          throw Error("找不到节点输入");
        if (e.op === "connect" && (typeof e.value !== "string" || !/^[@$]/.test(e.value))) throw Error("需要输出引用");
        if (e.value === undefined || e.value === null) throw Error("缺少节点输入值");
        node.inputs[e.port] = e.value as GraphNode["inputs"][string];
        break;
      }
      case "output":
        if (typeof e.value !== "string") throw Error("需要输出引用");
        graph.output = e.value;
        break;
      case "remove": {
        const node = get(e.id), ref = "@" + node.id;
        graph.nodes = graph.nodes.filter(n => n !== node);
        if (graph.output === ref) graph.output = graph.kind === "post" ? "$source" : "$identity";
        for (const other of graph.nodes)
          for (const [key, input] of Object.entries(other.inputs))
            if (input === ref) other.inputs[key] = graphOps[other.op].inputs[key].value;
        break;
      }
      default: throw Error("未知节点操作 " + String(e.op).slice(0, 32));
    }
  }
  return validateEffectGraph(graph);
}

export const editPostGraph = editEffectGraph;
export function editAgentGraph(base:EffectGraph, edits:unknown) {
  if (!Array.isArray(edits)) return editEffectGraph(base,edits);
  const additions=edits.filter(e=>e?.op==="add" && e.type==="glsl");
  const newId=additions[0]?.id;
  if (base.kind!=="post" || additions.length!==1 || typeof newId!=="string" ||
      edits.some(e=>e?.op==="output" || e?.value==="@"+newId ||
        Object.values(e?.inputs ?? {}).includes("@"+newId))) return editEffectGraph(base,edits);
  return editEffectGraph(base,[
    ...edits.map(e=>e===additions[0] ? {...e,inputs:{image:base.output,...e.inputs}} : e),
    {op:"output",value:"@"+newId},
  ]);
}

export function writePostGraph(scene: Scene, target: string, graph: EffectGraph) {
  if (target === "output") {
    scene.outputGraph = graph;
    delete scene.outputShader;
  } else {
    const effects = scene.layers.find(l => l.id === target)!.effects;
    effects.graph = graph;
    delete effects.codeShader;
  }
}
