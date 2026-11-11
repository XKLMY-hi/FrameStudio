import type { Key } from "../types";
import { validateCurveKeys, validateEffectGraph } from "./effect-graph";
import { neutralLook } from "./model-look";
import { defaultLight, sceneEffects, transform, type Layer, type ModelResource, type SceneEffects, type SceneLight } from "./schema";
import { validateShaderRecipe } from "./stylize";
import { isTitleMotion } from "./text-motion";
import { validateCodeShader } from "../../backend/shader-format.mjs";

type Curves = Record<string,Key[]>;
type Text = NonNullable<Layer["text"]>;
type Surface = NonNullable<Layer["surface"]>;
export type Appearance = {
  post: {effects:SceneEffects; surface?:Surface; receiveLight?:boolean; curves:Curves};
  text: {style:Omit<Text,"value">; curves:Curves};
  model: NonNullable<ModelResource["preprocess"]>;
  light: {light:Omit<SceneLight,"targets">; transform:Layer["transform"]; curves:Curves};
};
export type AppearanceKind = keyof Appearance;

function record(value: unknown): Record<string,unknown> {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw Error("需要有效的效果参数对象");
  return value as Record<string,unknown>;
}
function number(v:unknown,min:number,max:number,name:string) {
  if (typeof v!=="number" || !Number.isFinite(v) || v<min || v>max) throw Error(name+" 的数值超出范围");
  return v;
}
function color(v:unknown,name:string) {
  if (typeof v!=="string" || !/^#[0-9a-f]{6}$/i.test(v)) throw Error(name+" 需要 #RRGGBB 颜色");
  return v;
}
function numericFields<T extends Record<string,number>>(value: unknown, defaults:T, bounds: Partial<Record<keyof T,[number,number]>> = {}) {
  const src = record(value), result = {...defaults};
  for (const key of Object.keys(defaults) as (keyof T & string)[]) {
    const [lo,hi] = bounds[key] ?? [-1e5,1e5];
    if (src[key]!==undefined) result[key] = number(src[key],lo,hi,key) as T[typeof key];
  }
  return result;
}
function effects(value: unknown): SceneEffects {
  const e = record(value), d = sceneEffects();
  const {outlineColor,glowColor,lightColor,lightType,blurMode,bokeh,stylize,stylizeMix,graph,graphValues,codeShader,...defaults} = d;
  const out: SceneEffects = {
    ...numericFields(e,defaults,{outline:[0,64],blur:[0,128],bloom:[0,8],glow:[0,8],
      brightness:[0,8],contrast:[0,8],saturation:[0,8],lightX:[-8,8],lightY:[-8,8],
      lightIntensity:[0,16],rim:[0,8],gloss:[0,8]}),
    outlineColor:color(e.outlineColor??outlineColor,"描边"),
    glowColor:color(e.glowColor??glowColor,"发光"),
    lightColor:color(e.lightColor??lightColor,"光色"),
    lightType:e.lightType==="point"||e.lightType==="area"||e.lightType==="sun" ? e.lightType : lightType,
    blurMode:e.blurMode==="lens" ? "lens" : blurMode,
    bokeh:number(e.bokeh??bokeh,0,4,"散景"),
    stylizeMix:number(e.stylizeMix??1,0,1,"风格强度"),
  };
  if (e.stylize) out.stylize = validateShaderRecipe(e.stylize);
  if (e.codeShader) out.codeShader = validateCodeShader(e.codeShader);
  if (e.graph) {
    out.graph = validateEffectGraph(e.graph);
    if (out.graph.kind!=="post") throw Error("需要后处理节点配方");
  }
  return out;
}

const transformKeys = Object.keys(transform());
function channelAllowed(kind: AppearanceKind, channel:string) {
  if (kind==="post") return /^(effects\.(outline|glow|bloom|brightness|contrast|saturation|blur|bokeh|lightX|lightY|lightIntensity|rim|gloss|stylizeMix)|surface\.(roughness|specular|rim|bump)|postGraph\.[A-Za-z][\w-]{0,31})$/.test(channel);
  if (kind==="text") return channel==="reveal" || /^textGraph\.[A-Za-z][\w-]{0,31}$/.test(channel);
  return kind==="light" && (transformKeys.includes(channel) || /^light\.(intensity|range|decay|width|height|specular|rim)$/.test(channel));
}
export function appearanceCurves(layer: Layer, kind: AppearanceKind) {
  return Object.fromEntries(Object.entries(layer.animation).filter(([channel,keys])=>keys.length && channelAllowed(kind,channel)));
}
export function setAppearanceCurves(layer: Layer, kind: AppearanceKind, curves:Curves) {
  for (const channel of Object.keys(layer.animation))
    if (channelAllowed(kind,channel)) delete layer.animation[channel];
  Object.assign(layer.animation,curves);
}
export function textAppearance(layer: Layer): Appearance["text"] {
  const {value,...style} = layer.text!;
  return {style,curves:appearanceCurves(layer,"text")};
}
export function textAnimationFile(layer: Layer) {
  return {format:"framestudio-appearance",version:1,kind:"text",data:textAppearance(layer)};
}
export function applyTextAnimation(layer: Layer, value: unknown) {
  if (!layer.text) throw Error("目标不是文本图层");
  const preset=parseAppearance(typeof value==="string" ? value : JSON.stringify(value),"text");
  layer.text={value:layer.text.value,...preset.style};
  setAppearanceCurves(layer,"text",preset.curves);
}
export function lightAppearance(layer: Layer): Appearance["light"] {
  const {targets,...light} = layer.light!;
  return {light,transform:layer.transform,curves:appearanceCurves(layer,"light")};
}
function readCurves(kind: AppearanceKind,value:unknown) {
  const entries = Object.entries(record(value ?? {}));
  if (entries.length>80) throw Error("效果预设最多 80 条曲线");
  return Object.fromEntries(entries.filter(([id])=>channelAllowed(kind,id))
    .map(([id,keys])=>[id,validateCurveKeys(keys)]));
}

export function parseAppearance<K extends AppearanceKind>(text:string,kind:K): Appearance[K] {
  if (text.length>524288) throw Error("效果预设最多 512 KB");
  const raw = record(JSON.parse(text));
  if (raw.format!=="framestudio-appearance" || raw.version!==1 || raw.kind!==kind)
    throw Error("效果预设类型与当前对象不匹配");
  const data = record(raw.data);
  let result: Appearance[AppearanceKind];
  switch (kind) {
    case "post": {
      result = {effects:effects(data.effects),curves:readCurves(kind,data.curves)};
      if (typeof data.receiveLight==="boolean") result.receiveLight = data.receiveLight;
      if (data.surface) result.surface = numericFields(data.surface,{roughness:.55,specular:.25,rim:.25,bump:0},
        {roughness:[.01,1],specular:[0,4],rim:[0,4],bump:[0,1]});
      break;
    }
    case "model": {
      result = {enabled:data.enabled!==false,effects:effects(data.effects)};
      if (data.look) result.look = numericFields(data.look,{...neutralLook},
        {exposure:[-2,2],detail:[0,1],rolloff:[0,1],edgeCleanup:[0,1],diffusion:[0,1]});
      break;
    }
    case "light": {
      const l = record(data.light);
      const type = l.type==="area"||l.type==="sun"||l.type==="ambient" ? l.type : "point";
      const {color:defaultColor,targets:_targets,type:_type,...defaults} = defaultLight(type);
      result = {light:{type,color:color(l.color??defaultColor,"光源颜色"),
        ...numericFields(l,defaults,{intensity:[0,16],range:[1,50000],decay:[.01,8],width:[1,20000],height:[1,20000],rim:[0,8],specular:[0,8]})},
        transform:numericFields(data.transform??{},transform()),
        curves:readCurves(kind,data.curves)};
      break;
    }
    case "text": {
      const t = record(data.style), animation = typeof t.animation==="string" ? t.animation : "";
      const style: Omit<Text,"value"> = {
        fontFamily:typeof t.fontFamily==="string" && t.fontFamily.length<=200 ? t.fontFamily : "Microsoft YaHei",
        fontSize:number(t.fontSize??48,1,400,"字号"),fill:color(t.fill??"#ffffff","文字颜色"),
        align:t.align==="left"||t.align==="right" ? t.align : "center",
        stroke:color(t.stroke??"#30303a","描边颜色"),strokeWidth:number(t.strokeWidth??0,0,32,"描边宽度"),
        animation:isTitleMotion(animation)||animation==="typewriter"||animation==="fade"||animation==="typewriter-fade" ? animation : "none",
        charsPerSecond:number(t.charsPerSecond??12,1,100,"打字速度"),
        entranceDuration:number(t.entranceDuration??.55,.01,10,"入场时长"),
        exitDuration:number(t.exitDuration??.35,.01,10,"退场时长"),
        motionAmount:number(t.motionAmount??.75,0,1,"动效幅度"),
      };
      if (typeof t.exit==="string" && isTitleMotion(t.exit)) style.exit = t.exit;
      if (t.graph) {
        style.graph = validateEffectGraph(t.graph);
        if (style.graph.kind!=="text") throw Error("需要文字动效节点配方");
      }
      result = {style,curves:readCurves(kind,data.curves)};
      break;
    }
    default: throw Error("未知效果预设类型");
  }
  return result as Appearance[K];
}
