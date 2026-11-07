export const shaderOperations = {
  ink: "墨线",
  halftone: "漫画网点",
  vhs: "录像带",
  duotone: "双色调",
  neon: "霓虹边缘",
  film: "胶片颗粒",
  pixel: "像素画",
  matrix: "RGB 矩阵",
} as const;

type Operation = keyof typeof shaderOperations;
export type ShaderPass = {
  op: Operation;
  amount: number;
  scale: number;
  dark: string;
  light: string;
  matrix?: number[];
  bias?: number[];
};
export type ShaderRecipe = { name: string; passes: ShaderPass[] };
type Preset = { id: string; recipe: ShaderRecipe };

const pass = (op: Operation, amount: number, scale: number, dark = "#141022", light = "#fff5df"): ShaderPass =>
  ({ op, amount, scale, dark, light });
export const shaderPresets: Preset[] = [
  { id: "cel", recipe: { name: "赛璐璐 · 墨线", passes: [pass("ink", .85, 1.25)] } },
  { id: "manga", recipe: { name: "黑白漫画 · 网点纸", passes: [pass("halftone", .9, 6, "#131313", "#faf9f2")] } },
  { id: "vhs", recipe: { name: "复古 VHS · 色差扫描", passes: [pass("vhs", .82, 3.4)] } },
  { id: "neon", recipe: { name: "赛博霓虹 · 描边", passes: [pass("neon", .88, 2.1, "#160a35", "#57e9ff")] } },
  { id: "film", recipe: { name: "暖调胶片 · 颗粒", passes: [pass("film", .6, 2, "#212642", "#ffdaaf")] } },
  { id: "duo", recipe: { name: "双色海报 · 靛蓝玫瑰", passes: [pass("duotone", 1, 1, "#1c143d", "#ffc8b7")] } },
  { id: "pixel", recipe: { name: "街机像素 · 降色阶", passes: [pass("pixel", 1, 6)] } },
  { id: "noir", recipe: { name: "黑色电影 · 银盐", passes: [pass("duotone", .94, 1, "#0a0b13", "#e7e8ed"), pass("film", .35, 1, "#1d2031", "#e5e6ed")] } },
];

const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("需要 JSON 对象");
  return v as Record<string, unknown>;
};
const number = (v: unknown, min: number, max: number, name: string) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    throw Error(`${name} 必须在 ${min} 到 ${max} 之间`);
  return v;
};
const color = (v: unknown, fallback: string) => {
  if (v === undefined) return fallback;
  if (typeof v !== "string" || !/^#[0-9a-f]{6}$/i.test(v)) throw Error("颜色需使用 #RRGGBB");
  return v;
};
const coefficients = (v: unknown, length: number, name: string) => {
  if (!Array.isArray(v) || v.length !== length) throw Error(`${name} 需要 ${length} 个数值`);
  return v.map(x => number(x, -4, 4, name));
};

// Both imported files and saved projects use the same bounded recipe.
export function validateShaderRecipe(value: unknown): ShaderRecipe {
  const r = record(value);
  if (typeof r.name !== "string" || !r.name.trim() || r.name.length > 80)
    throw Error("着色器名称需为 1–80 个字符");
  if (!Array.isArray(r.passes) || !r.passes.length || r.passes.length > 4)
    throw Error("着色器需要 1–4 道处理");
  return {
    name: r.name.trim(),
    passes: r.passes.map((value) => {
      const p = record(value);
      if (typeof p.op !== "string" || !Object.hasOwn(shaderOperations, p.op))
        throw Error("不支持的着色器操作");
      const step = pass(
        p.op as Operation,
        number(p.amount ?? 1, 0, 1, "amount"),
        number(p.scale ?? 1, .5, 48, "scale"),
        color(p.dark, "#141022"),
        color(p.light, "#fff5df"),
      );
      if (step.op === "matrix") {
        step.matrix = coefficients(p.matrix, 9, "matrix");
        step.bias = coefficients(p.bias ?? [0, 0, 0], 3, "bias");
      }
      return step;
    }),
  };
}

export function importShaderRecipe(text: string): ShaderRecipe {
  if (text.length > 16384) throw Error("着色器配方不能超过 16 KB");
  const file = record(JSON.parse(text));
  if (file.format !== "framestudio-shader" || file.version !== 1)
    throw Error("需要 framestudio-shader 第 1 版 JSON");
  return validateShaderRecipe(file);
}

export const shaderOpIndex = (op: Operation) => Object.keys(shaderOperations).indexOf(op);

// Colors enter and leave the filter in Pixi's premultiplied-alpha format.
export const stylizeFragment = `
precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize, inputClamp, outputFrame;
uniform float mode, mixAmount, pixelScale, effectScale, frameTime;
uniform vec3 darkColor, lightColor, rowR, rowG, rowB, bias;
vec4 at(vec2 q) { return texture2D(uSampler,clamp(q,inputClamp.xy,inputClamp.zw)); }
vec3 rgb(vec4 c) { return c.rgb / max(c.a,0.0001); }
float luminance(vec3 c) { return dot(c,vec3(0.2126,0.7152,0.0722)); }
float random(vec2 v) { return fract(sin(dot(v,vec2(12.9898,78.233)))*43758.5453); }
float edge(vec3 c, vec2 d) {
  vec4 a=at(vTextureCoord+d*vec2(1.0,0.0)), b=at(vTextureCoord-d*vec2(1.0,0.0));
  vec4 e=at(vTextureCoord+d*vec2(0.0,1.0)), f=at(vTextureCoord-d*vec2(0.0,1.0));
  float dx=luminance(mix(c,rgb(a),a.a)-mix(c,rgb(b),b.a));
  float dy=luminance(mix(c,rgb(e),e.a)-mix(c,rgb(f),f.a));
  float silhouette=length(vec2(a.a-b.a,e.a-f.a));
  return smoothstep(0.025,0.29,max(length(vec2(dx,dy)),silhouette*0.65));
}
void main() {
  vec4 src=at(vTextureCoord);
  if(src.a<0.0001) { gl_FragColor=src; return; }
  vec3 c=rgb(src), result=c;
  vec2 p=(vTextureCoord*inputSize.xy+outputFrame.xy)/max(pixelScale,0.01);
  vec2 d=inputSize.zw*pixelScale*effectScale;
  float y=luminance(c);
  if(mode<0.5) {
    vec3 bands=floor(c*5.0+0.5)/5.0;
    result=mix(bands,darkColor,edge(c,d)*0.9);
  } else if(mode<1.5) {
    vec2 grid=fract(vec2(p.x+p.y,p.y-p.x)/(1.4142*effectScale))-0.5;
    float dots=1.0-smoothstep(0.05,0.14,length(grid)-0.48*sqrt(clamp(1.0-y,0.0,1.0)));
    result=mix(lightColor,darkColor,max(dots,edge(c,d/effectScale)*0.7));
  } else if(mode<2.5) {
    float tape=floor(frameTime*12.0);
    float jitter=sin(floor(p.y/9.0)*0.9+tape*1.2)*0.65;
    vec4 a=at(vTextureCoord+vec2(d.x*(1.0+jitter),0.0));
    vec4 b=at(vTextureCoord-vec2(d.x,0.0));
    vec3 split=vec3(mix(c.r,rgb(a).r,a.a),c.g,mix(c.b,rgb(b).b,b.a));
    float line=0.82+0.18*sin(p.y*2.4);
    result=split*line+(random(floor(p)+tape)-0.5)*0.075;
  } else if(mode<3.5) {
    result=mix(darkColor,lightColor,smoothstep(0.0,1.0,y));
  } else if(mode<4.5) {
    result=mix(c*0.24+darkColor*0.65,lightColor,edge(c,d));
  } else if(mode<5.5) {
    float grain=random(floor(p/effectScale)+floor(frameTime*24.0))-0.5;
    result=c*0.84+mix(darkColor,lightColor,y)*0.16+grain*0.19;
  } else if(mode<6.5) {
    vec2 snapped=(floor(p/effectScale)+0.5)*effectScale;
    vec4 q=at(vTextureCoord+(snapped-p)*pixelScale*inputSize.zw);
    result=floor(mix(c,rgb(q),q.a)*7.0+0.5)/7.0;
  } else {
    result=vec3(dot(rowR,c),dot(rowG,c),dot(rowB,c))+bias;
  }
  gl_FragColor=vec4(mix(c,clamp(result,0.0,1.0),mixAmount)*src.a,src.a);
}`;
