import { clamp, sampleCurve } from "../engine";
import type { Key } from "../types";
import { importShaderRecipe, validateShaderRecipe, type ShaderPass, type ShaderRecipe } from "./stylize";
import { compilePixel, identityPixel, type PixelProgram } from "./pixel-expression";
import { validateCodeShader, type CodeShader } from "../../backend/shader-format.mjs";

type Port = "number" | "color" | "image" | "pose" | "curve" | "pass" | "pixel" | "shader";
type Input = string | number | Key[] | ShaderPass | PixelProgram | CodeShader;
export const identityShader: CodeShader = {
  format:"framestudio-glsl",version:1,name:"GLSL",enabled:true,parameters:{},
  passes:[{id:"finish",scale:1,source:"vec4 shade(vec2 uv) { return source(uv); }"}],
};
type Socket = { type: Port; value: Input; min?: number; max?: number };
const numeric = (value: number, min: number, max: number): Socket => ({type:"number", value, min, max});
const image = {type:"image", value:"$source"} as const;
const color = {type:"color", value:"#ffc695"} as const;
const pose = {type:"pose", value:"$identity"} as const;
const define = (label: string, output: Port, inputs: Record<string, Socket>) => ({label, output, inputs});

export const graphOps = {
  alpha: define("透明蒙版", "image", {image}),
  highlights: define("提取高光", "image", {image, threshold:numeric(.72,0,1), softness:numeric(.18,.01,1)}),
  blur: define("扩散模糊", "image", {image, radius:numeric(12,0,32)}),
  colorize: define("蒙版着色", "image", {image, color, opacity:numeric(.7,0,1)}),
  over: define("叠合", "image", {top:image, bottom:image}),
  mix: define("混合", "image", {a:image,b:image, amount:numeric(.5,0,1)}),
  exposure: define("曝光", "image", {image, stops:numeric(0,-4,4)}),
  ripple: define("波纹位移", "image", {image, amplitude:numeric(4,0,24), period:numeric(90,8,400), rate:numeric(1,-8,8)}),
  pixel: define("自定义像素", "image", {image, value:numeric(1,-64,64), maxShift:numeric(24,0,64), program:{type:"pixel",value:identityPixel}}),
  glsl: define("GLSL 着色器", "image", {image, shader:{type:"shader",value:identityShader}}),
  legacy: define("旧版着色器", "image", {image, pass:{type:"pass",value:{op:"film",amount:1,scale:1,dark:"#141022",light:"#fff5df"}}}),
  enter: define("入场进度", "number", {duration:numeric(.6,.01,10), delay:numeric(.045,0,.5)}),
  exit: define("退场进度", "number", {duration:numeric(.4,.01,10), delay:numeric(0,0,.5)}),
  wave: define("周期信号", "number", {rate:numeric(1,0,12), min:numeric(0,-128,128), max:numeric(1,-128,128)}),
  ease: define("曲线取样", "number", {
    progress:numeric(1,0,1),
    curve:{type:"curve",value:[{t:0,v:0,mode:"linear"},{t:1,v:1,mode:"linear"}]},
  }),
  transform: define("文字变换", "pose", {
    progress:numeric(1,-2,3), x:numeric(0,-240,240), y:numeric(34,-240,240),
    scale:numeric(.55,.05,3), opacity:numeric(0,0,1), angle:numeric(0,-180,180),
  }),
  combine: define("叠加文字变换", "pose", {a:pose,b:pose}),
};
export type GraphOp = keyof typeof graphOps;
export type GraphParameter = { label: string; value: number; min: number; max: number };
export type GraphNode = {id:string; op:GraphOp; inputs:Record<string,Input>; x:number; y:number};
export type EffectGraph = {
  format:"framestudio-effect"; version:1; kind:"post"|"text"; name:string;
  nodes:GraphNode[]; output:string; parameters:Record<string,GraphParameter>;
  scope?:"glyph"|"block";
};

const token = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const hex = /^#[0-9a-f]{6}$/i;
const safeId = (id: unknown): id is string =>
  typeof id === "string" && token.test(id) && !Object.hasOwn(Object.prototype,id);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("需要 JSON 对象");
  return value as Record<string, unknown>;
}
function number(value: unknown, min: number, max: number, field: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw Error(field + " 的数值超出范围");
  return value;
}
export function validateCurveKeys(value: unknown, normalized = false): Key[] {
  if (!Array.isArray(value) || !value.length || value.length > 4096) throw Error("曲线需要 1–4096 个关键帧");
  const keys: Key[] = value.map((item, i) => {
    const k = object(item);
    if (k.mode !== "linear" && k.mode !== "step" && k.mode !== "inverse" && k.mode !== "bezier")
      throw Error("未知曲线插值");
    const key: Key = {t:number(k.t,0,normalized ? 1 : 86400,"关键帧时间"),v:number(k.v,-1e9,1e9,"关键帧值"),mode:k.mode};
    for (const handle of ["in","out"] as const) {
      const point = k[handle];
      if (point === undefined) continue;
      if (!Array.isArray(point) || point.length !== 2) throw Error("无效的贝塞尔手柄");
      key[handle] = [number(point[0],-86400,86400,"手柄时间"),number(point[1],-1e9,1e9,"手柄值")];
    }
    if (i && (value[i-1] as Key).t >= key.t) throw Error("关键帧时间必须严格递增");
    return key;
  });
  if (normalized && (keys[0].t !== 0 || keys.at(-1)!.t !== 1 || keys.length > 64))
    throw Error("缓动曲线需要以 0 开始并在 1 结束，最多 64 个关键帧");
  return keys;
}

export function graphReferenceType(ref: string, graph: EffectGraph): Port | undefined {
  if (ref === "$source") return graph.kind === "post" ? "image" : undefined;
  if (ref === "$identity") return graph.kind === "text" ? "pose" : undefined;
  if (ref.startsWith("$params.") && Object.hasOwn(graph.parameters, ref.slice(8))) return "number";
  if (ref.startsWith("@")) {
    const node = graph.nodes.find(n => n.id === ref.slice(1));
    if (node) return graphOps[node.op].output;
  }
}

export function graphOrder(graph: EffectGraph, output = graph.output, stop?: ReadonlySet<string>) {
  const order: GraphNode[] = [], active = new Set<string>(), done = new Set<string>();
  const nodes = new Map(graph.nodes.map(n => [n.id,n]));
  function visit(ref: Input) {
    if (typeof ref !== "string" || !ref.startsWith("@")) return;
    if (stop?.has(ref)) return;
    const id = ref.slice(1);
    if (done.has(id)) return;
    if (active.has(id)) throw Error("节点连线形成循环");
    const node = nodes.get(id);
    if (!node) throw Error("找不到节点 " + id);
    active.add(id);
    for (const input of Object.values(node.inputs)) visit(input);
    active.delete(id);
    done.add(id);
    order.push(node);
  }
  visit(output);
  return order;
}

export function validateEffectGraph(value: unknown): EffectGraph {
  const raw = object(value);
  if (raw.format !== "framestudio-effect" || raw.version !== 1 ||
      (raw.kind !== "post" && raw.kind !== "text")) throw Error("需要第 1 版 FrameStudio 效果配方");
  if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 80) throw Error("名称需为 1–80 个字符");
  if (!Array.isArray(raw.nodes) || raw.nodes.length > 24) throw Error("最多 24 个节点");
  if (raw.nodes.filter(n => n && typeof n === "object" && (n as GraphNode).op === "glsl").length > 3)
    throw Error("每个图最多 3 个 GLSL 节点");
  if (typeof raw.output !== "string") throw Error("需要设置输出");
  const graph: EffectGraph = {format:raw.format,version:raw.version,kind:raw.kind,name:raw.name.trim(),
    nodes:[], output:raw.output,parameters:{}};
  if (graph.kind === "text") graph.scope = raw.scope === "glyph" ? "glyph" : "block";
  const params = Object.entries(object(raw.parameters ?? {}));
  if (params.length > 12) throw Error("最多 12 个公开参数");
  for (const [id, value] of params) {
    if (!safeId(id)) throw Error("无效的参数 ID");
    const p = object(value), min = number(p.min,-1024,1024,id), max = number(p.max,min,1024,id);
    if (typeof p.label !== "string" || p.label.length > 40) throw Error("无效的参数名称");
    graph.parameters[id] = {label:p.label, min,max,value:number(p.value,min,max,id)};
  }
  const ids = new Set<string>();
  for (const item of raw.nodes) {
    const n = object(item);
    if (!safeId(n.id) || ids.has(n.id) || typeof n.op !== "string" || !Object.hasOwn(graphOps,n.op))
      throw Error("未知节点或重复的节点 ID");
    const op = n.op as GraphOp;
    if (!opsFor(graph.kind).includes(op)) throw Error("节点与配方类型不匹配");
    ids.add(n.id);
    const sockets = object(n.inputs);
    const inputs: Record<string,Input> = {};
    for (const [key, spec] of Object.entries(graphOps[op].inputs)) {
      const field = n.id + "." + key, v = sockets[key] ?? spec.value;
      if (typeof v === "string" && (v.startsWith("@") || v.startsWith("$"))) inputs[key] = v;
      else if (spec.type === "number") inputs[key] = number(v,spec.min!,spec.max!,field);
      else if (spec.type === "color" && typeof v === "string" && hex.test(v)) inputs[key] = v;
      else if (spec.type === "curve") inputs[key] = validateCurveKeys(v,true);
      else if (spec.type === "pass") inputs[key] = validateShaderRecipe({name:"legacy",passes:[v]}).passes[0];
      else if (spec.type === "shader") inputs[key] = validateCodeShader(v);
      else if (spec.type === "pixel") {
        compilePixel(v);
        const {offset,rgba} = v as PixelProgram;
        inputs[key] = {offset,rgba};
      }
      else throw Error("无效的输入 " + field);
    }
    graph.nodes.push({id:n.id,op,inputs,x:number(n.x ?? 0,0,4800,"节点 X"),y:number(n.y ?? 0,0,4800,"节点 Y")});
  }
  for (const node of graph.nodes) {
    for (const [key, input] of Object.entries(node.inputs))
      if (typeof input === "string" && (input.startsWith("@") || input.startsWith("$")) &&
          graphReferenceType(input,graph) !== graphOps[node.op].inputs[key].type)
        throw Error("连线类型不匹配 " + node.id + "." + key);
    const order = graphOrder(graph,"@" + node.id);
    if (graph.kind === "post" && !order.every(n => n.op === "legacy"))
      validateSamples(order,"@" + node.id);
  }
  if (graphReferenceType(graph.output,graph) !== (graph.kind === "post" ? "image" : "pose"))
    throw Error("输出类型与配方不匹配");
  return graph;
}

// Estimate expanded pixel work before a nested sampling graph is compiled.
function validateSamples(nodes: GraphNode[], output: string) {
  const cost = new Map<string, number>([["$source",1]]);
  for (const n of nodes) {
    const read = (key: string) => cost.get(String(n.inputs[key])) ?? 0;
    const samples = n.op === "blur" ? 13 * read("image") :
      n.op === "legacy" ? 5 * read("image") : n.op === "over" ? read("top") + read("bottom") :
      n.op === "mix" ? read("a") + read("b") : n.op === "glsl" ? 1 : read("image");
    cost.set("@" + n.id,samples);
  }
  if ((cost.get(output) ?? 0) > 64) throw Error("采样预算不足，请减少串联的模糊或取样节点");
}

const shaderOps: GraphOp[] = ["alpha","highlights","blur","colorize","over","mix","exposure","ripple","pixel","legacy","glsl","wave","ease"];
const textOps: GraphOp[] = ["enter","exit","wave","ease","transform","combine"];
export const opsFor = (kind: EffectGraph["kind"]) => kind === "post" ? shaderOps : textOps;
export function emptyGraph(kind: EffectGraph["kind"], name = "自定义配方"): EffectGraph {
  return {format:"framestudio-effect",version:1,kind,name,nodes:[],parameters:{},
    output:kind === "post" ? "$source" : "$identity", ...(kind === "text" ? {scope:"glyph"} : {})};
}
export function graphNode(id: string, op: GraphOp, x: number, y: number, inputs: Record<string,Input> = {}): GraphNode {
  return {id,op,x,y,inputs:{...Object.fromEntries(Object.entries(graphOps[op].inputs).map(([key,s]) => [key,s.value])),...inputs}};
}
export function legacyGraph(recipe: ShaderRecipe) {
  const graph = emptyGraph("post",recipe.name);
  for (const [index, pass] of recipe.passes.entries()) {
    const id = "pass" + (index + 1);
    graph.nodes.push(graphNode(id,"legacy",200 + index * 198,40,{image:graph.output, pass}));
    graph.output = "@" + id;
  }
  return graph;
}
export function importEffectGraph(text: string, kind: EffectGraph["kind"]) {
  if (text.length > 262144) throw Error("效果配方最多 256 KB");
  const raw = object(JSON.parse(text));
  if (raw.format === "framestudio-glsl" && kind === "post") {
    const shader = validateCodeShader(raw);
    return validateEffectGraph({ ...emptyGraph("post",shader.name),output:"@glsl",
      nodes:[graphNode("glsl","glsl",180,64,{shader})] });
  }
  const graph = raw.format === "framestudio-shader" && kind === "post"
    ? legacyGraph(importShaderRecipe(text)) : validateEffectGraph(raw);
  if (graph.kind !== kind) throw Error("配方类型与当前工作区不匹配");
  return validateEffectGraph(graph);
}
export function graphNumber(graph: EffectGraph, node: GraphNode, key: string, signals: Map<string,number>, overrides?: Record<string,number>) {
  const input = node.inputs[key], spec = graphOps[node.op].inputs[key];
  const id = String(input).slice(8);
  const value = typeof input === "number" ? input : String(input).startsWith("$params.")
    ? overrides?.[id] ?? graph.parameters[id]?.value : signals.get(String(input));
  return clamp(Number.isFinite(value) ? value! : Number(spec.value), spec.min!, spec.max!);
}
export function easeValue(keys: Key[], progress: number) {
  return sampleCurve({id:"ease",target:"Parameter",keys},clamp(progress,0,1));
}

export const identityPose = {x:0,y:0,scale:1,alpha:1,angle:0};
type Pose = typeof identityPose;
export function evaluateSignals(graph: EffectGraph, order: GraphNode[], time: number, remaining = 0, glyph = 0, count = 1, overrides?: Record<string,number>) {
  const signals = new Map<string,number>();
  for (const n of order) {
    const num = (key: string) => graphNumber(graph,n,key,signals,overrides);
    let result: number;
    switch (n.op) {
      case "enter": result = clamp((time - glyph*num("delay"))/num("duration"),0,1); break;
      case "exit": result = clamp((remaining - (count-1-glyph)*num("delay"))/num("duration"),0,1); break;
      case "wave": result = num("min") + (num("max")-num("min"))*(.5-.5*Math.cos(2*Math.PI*time*num("rate"))); break;
      case "ease": result = easeValue(n.inputs.curve as Key[],num("progress")); break;
      default: continue;
    }
    signals.set("@"+n.id,result);
  }
  return signals;
}
export function evaluateTextGraph(graph: EffectGraph, order: GraphNode[], time: number, remaining: number, glyph: number, count: number, overrides?: Record<string,number>): Pose {
  const signals = evaluateSignals(graph,order,time,remaining,glyph,count,overrides);
  const poses = new Map<string,Pose>([["$identity",identityPose]]);
  for (const n of order) {
    const num = (key: string) => graphNumber(graph,n,key,signals,overrides);
    let result: Pose;
    switch (n.op) {
      case "transform": {
        const q = 1 - clamp(num("progress"),-2,3);
        result = {x:num("x")*q,y:num("y")*q,scale:Math.max(.02,1+(num("scale")-1)*q),
          alpha:clamp(1+(num("opacity")-1)*q,0,1),angle:num("angle")*q*Math.PI/180};
        break;
      }
      case "combine": {
        const a = poses.get(String(n.inputs.a))!, b = poses.get(String(n.inputs.b))!;
        result = {x:a.x+b.x,y:a.y+b.y,scale:a.scale*b.scale,alpha:a.alpha*b.alpha,angle:a.angle+b.angle};
        break;
      }
      default: continue;
    }
    poses.set("@"+n.id,result);
  }
  return poses.get(graph.output) ?? identityPose;
}

export function graphPresets(kind: EffectGraph["kind"]): EffectGraph[] {
  if (kind === "post") {
    const halo = emptyGraph(kind,"胶片 · 高光光晕");
    halo.parameters = {radius:{label:"光晕半径",value:15,min:0,max:32}, threshold:{label:"高光阈值",value:.68,min:0,max:1},
      glow:{label:"发光强度",value:.62,min:0,max:1}};
    halo.nodes = [
      graphNode("bright","highlights",180,30,{threshold:"$params.threshold"}),
      graphNode("diffuse","blur",370,30,{image:"@bright",radius:"$params.radius"}),
      graphNode("tint","colorize",560,30,{image:"@diffuse",opacity:"$params.glow"}),
      graphNode("composite","over",750,120,{top:"$source",bottom:"@tint"}),
    ];
    halo.output = "@composite";
    const ripple = emptyGraph(kind,"波纹 · 信号干扰");
    ripple.parameters = {amplitude:{label:"位移幅度",value:7,min:0,max:24}, rate:{label:"速度",value:1.4,min:0,max:8}};
    ripple.nodes = [graphNode("wave","ripple",210,70,{amplitude:"$params.amplitude",rate:"$params.rate"})];
    ripple.output = "@wave";
    const scan = emptyGraph(kind,"扫描 · 像素抖动");
    scan.parameters = {strength:{label:"抖动幅度",value:7,min:0,max:24}};
    scan.nodes = [graphNode("scan","pixel",210,70,{value:"$params.strength",program:{
      offset:[["mul","value",["sin",["add",["mul",["floor",["div","y",5]],1.7],["mul","time",15]]]],0],
      rgba:[["mul","r",["add",.89,["mul",.11,["sin",["mul","y",1.2]]]]],"g","b","a"],
    }})];
    scan.output="@scan";
    return [halo,ripple,scan];
  }
  const pop = emptyGraph(kind,"逐字错峰 · 回弹");
  pop.parameters = {duration:{label:"单字入场时长",value:.55,min:.01,max:4}, delay:{label:"字间延迟",value:.055,min:0,max:.5},
    height:{label:"起始位移",value:36,min:-120,max:120}};
  pop.nodes = [
    graphNode("enter","enter",30,50,{duration:"$params.duration",delay:"$params.delay"}),
    graphNode("bounce","ease",230,50,{progress:"@enter",curve:[
      {t:0,v:0,mode:"bezier",out:[.14,-.15]},
      {t:.66,v:1.16,mode:"bezier",in:[.39,1.16],out:[.78,1.16]},
      {t:1,v:1,mode:"linear",in:[.9,1]},
    ]}),
    graphNode("move","transform",430,50,{progress:"@bounce",y:"$params.height"}),
  ];
  pop.output = "@move";
  const drift = emptyGraph(kind,"整段 · 呼吸");
  drift.scope = "block";
  drift.nodes = [graphNode("wave","wave",40,50,{rate:.45,min:.25,max:1}),
    graphNode("move","transform",250,50,{progress:"@wave",opacity:.66,y:8,scale:.94})];
  drift.output = "@move";
  return [pop,drift];
}
