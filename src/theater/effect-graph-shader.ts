import { evaluateSignals, graphNumber, graphOps, graphOrder, validateEffectGraph, type EffectGraph, type GraphNode } from "./effect-graph";
import { shaderOpIndex, stylizeFragment, type ShaderPass } from "./stylize";
import { compilePixel } from "./pixel-expression";

const vec = (values: number[]) => "vec3(" + values.map(v => v.toFixed(7)).join(",") + ")";
const color = (hex: string) => vec([1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255));
const legacyHelpers = stylizeFragment.slice(stylizeFragment.indexOf("vec3 rgb"),stylizeFragment.indexOf("float edge"));
const legacyEdge = stylizeFragment.slice(stylizeFragment.indexOf("float edge"),stylizeFragment.indexOf("void main"));
const legacyBody = stylizeFragment.slice(stylizeFragment.indexOf("  vec4 src=at(vTextureCoord);")).trim().slice(0,-1);

export function graphShader(graph: EffectGraph, output: string, external: string[] = []) {
  const order = graphOrder(graph,output,new Set(external));
  const imageNodes = order.filter(n => graphOps[n.op].output === "image");
  const names = new Map(imageNodes.map((node,index) => ["@"+node.id,"node"+index]));
  names.set("$source","readSource");
  external.forEach((ref,i) => names.set(ref,"readInput"+i));
  const uniformNames: {name:string; node:GraphNode; key:string}[] = [];
  const code = imageNodes.map((node,index) => {
    const id = "node"+index;
    const read = (key: string) => names.get(String(node.inputs[key]))!;
    const num = (key: string) => {
      const name = id + "_" + key;
      uniformNames.push({name,node,key});
      return name;
    };
    const input = read("image");
    let body: string;
    switch (node.op) {
      case "alpha": body = `return vec4(${input}(uv).a);`; break;
      case "highlights": {
        const threshold = num("threshold");
        body = `vec4 c=${input}(uv); float a=c.a*smoothstep(${threshold},${threshold}+${num("softness")},luminance(rgb(c)));return vec4(a);`;
        break;
      }
      case "blur":
        body = `vec2 d=inputSize.zw*pixelScale*${num("radius")};
        vec4 c=${input}(uv)*4.0;
        c+=3.0*(${input}(uv+vec2(d.x,0.0))+${input}(uv-vec2(d.x,0.0))+${input}(uv+vec2(0.0,d.y))+${input}(uv-vec2(0.0,d.y)));
        c+=2.0*(${input}(uv+d)+${input}(uv-d)+${input}(uv+vec2(d.x,-d.y))+${input}(uv+vec2(-d.x,d.y)));
        c+=${input}(uv+vec2(d.x*2.0,0.0))+${input}(uv-vec2(d.x*2.0,0.0))+${input}(uv+vec2(0.0,d.y*2.0))+${input}(uv-vec2(0.0,d.y*2.0));
        return c/28.0;`;
        break;
      case "colorize": body = `float a=${input}(uv).a*${num("opacity")};return vec4(${color(String(node.inputs.color))}*a,a);`; break;
      case "over": body = `vec4 a=${read("top")}(uv);return a+${read("bottom")}(uv)*(1.0-a.a);`; break;
      case "mix": body = `return mix(${read("a")}(uv),${read("b")}(uv),${num("amount")});`; break;
      case "exposure":
        body = `vec4 c=${input}(uv);return vec4(min(vec3(c.a),c.rgb*exp2(${num("stops")})),c.a);`;
        break;
      case "ripple":
        body = `float y=uv.y*inputSize.y/max(pixelScale,.01);float shift=sin(6.2831853*(y/${num("period")}+frameTime*${num("rate")}))*${num("amplitude")};
          return ${input}(uv+vec2(shift*inputSize.z*pixelScale,0.0));`;
        break;
      case "pixel": {
        const expression = compilePixel(node.inputs.program), limit = num("maxShift");
        body = `vec2 pixel=(uv*inputSize.xy+outputFrame.xy)/max(pixelScale,.01);
          float control=${num("value")};
          vec2 offset=clamp(vec2(${expression.offset}),vec2(-${limit}),vec2(${limit}));
          vec4 src=${input}(uv+offset*inputSize.zw*pixelScale);
          vec3 sampled=rgb(src);float sampledAlpha=src.a;
          vec4 result=clamp(vec4(${expression.rgba}),0.0,1.0);
          return vec4(result.rgb*result.a,result.a);`;
        break;
      }
      case "legacy": {
        const pass = node.inputs.pass as ShaderPass;
        const matrix = pass.matrix ?? [1,0,0,0,1,0,0,0,1];
        const edge = legacyEdge.replace("float edge(vec3 c, vec2 d)", `float edge${index}(vec3 c, vec2 d, vec2 uv)`)
          .replaceAll("vTextureCoord","uv").replace(/\bat\(/g,input+"(");
        body = `float mode=${shaderOpIndex(pass.op).toFixed(1)}, mixAmount=${pass.amount.toFixed(7)}, effectScale=${pass.scale.toFixed(7)};
          vec3 darkColor=${color(pass.dark)}, lightColor=${color(pass.light)}, rowR=${vec(matrix.slice(0,3))}, rowG=${vec(matrix.slice(3,6))}, rowB=${vec(matrix.slice(6))}, bias=${vec(pass.bias ?? [0,0,0])};
          ` + legacyBody.replaceAll("vTextureCoord","uv").replace(/\bat\(/g,input+"(")
          .replace(/edge\(c,([^)]*)\)/g,`edge${index}(c,$1,uv)`)
          .replace("gl_FragColor=src; return;","return src;").replace("gl_FragColor=","return ");
        return edge + `vec4 ${id}(vec2 uv) { ${body} }`;
      }
      default: throw Error("无效图像节点");
    }
    return `vec4 ${id}(vec2 uv) { ${body} }`;
  });
  const fragment = `
precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
 ${external.map((_,i) => "uniform sampler2D graphInput" + i + ";").join("\n")}
uniform vec4 inputSize, inputClamp, outputFrame;
uniform float pixelScale, frameTime, graphMix;
${uniformNames.map(({name}) => "uniform float " + name + ";").join("\n")}
${legacyHelpers}
float safeDivide(float a,float b){return a/max(abs(b),.00001)*sign(b);}
vec4 readSource(vec2 uv) {
  vec2 halfPixel=inputSize.zw*.5;
  if(any(lessThan(uv,inputClamp.xy-halfPixel))||any(greaterThan(uv,inputClamp.zw+halfPixel))) return vec4(0.0);
  return texture2D(uSampler,clamp(uv,inputClamp.xy,inputClamp.zw));
}
${external.map((_,i) => `vec4 readInput${i}(vec2 uv) {
  vec2 h=inputSize.zw*.5;
  if(any(lessThan(uv,inputClamp.xy-h))||any(greaterThan(uv,inputClamp.zw+h))) return vec4(0.0);
  return texture2D(graphInput${i},clamp(uv,inputClamp.xy,inputClamp.zw));
}`).join("\n")}
${code.join("\n")}
void main(){ gl_FragColor=mix(readSource(vTextureCoord),${names.get(output)}(vTextureCoord),graphMix); }`;
  return {order, fragment, uniformNames};
}

const validated = new WeakMap<object,EffectGraph|null>();
export function checkedGraph(value?: EffectGraph) {
  if (!value || typeof value !== "object") return null;
  if (!validated.has(value)) {
    try { validated.set(value,validateEffectGraph(value)); }
    catch { validated.set(value,null); }
  }
  return validated.get(value)!;
}

type Compiled = ReturnType<typeof graphShader>;
type FilterState = { filter:any; compiled:Compiled; graph:EffectGraph; output:string };
export function graphFilter(previous: FilterState | undefined, graph: EffectGraph, output: string, time: number, mix: number, scale: number, overrides?: Record<string,number>, external?: string[]) {
  let state = previous;
  if (!state || state.graph !== graph || state.output !== output) {
    const compiled = graphShader(graph,output,external);
    let filter = state?.filter;
    if (!state || compiled.fragment !== state.compiled.fragment) {
      const uniforms = Object.fromEntries(compiled.uniformNames.map(({name}) => [name,0]));
      filter = new window.PIXI.Filter(undefined,compiled.fragment,{...uniforms,pixelScale:1,frameTime:0,graphMix:1});
      state?.filter.destroy();
    }
    state = { filter,compiled,graph,output };
  }
  const {filter,compiled} = state;
  const signals = evaluateSignals(graph,compiled.order,time,0,0,1,overrides);
  Object.assign(filter.uniforms,{pixelScale:scale,frameTime:time,graphMix:mix});
  let padding = 0;
  for (const {name,node,key} of compiled.uniformNames) {
    const value = graphNumber(graph,node,key,signals,overrides);
    filter.uniforms[name] = value;
    if (node.op === "blur" && key === "radius") padding += 2*value;
    if (node.op === "ripple" && key === "amplitude") padding += value;
    if (node.op === "pixel" && key === "maxShift") padding += value;
  }
  filter.padding = Math.ceil(padding * scale);
  return state;
}
