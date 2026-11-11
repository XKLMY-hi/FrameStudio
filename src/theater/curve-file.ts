import type { Key } from "../types";
import { validateCurveKeys } from "./effect-graph";

export type CurveFile = {format:"framestudio-curve"; version:1; kind:"keys"|"ease"; name:string; keys:Key[]};
export function curveFile(kind: CurveFile["kind"], name: string, keys: Key[]): CurveFile {
  return {format:"framestudio-curve",version:1,kind,name,keys};
}
export function importCurveFile(text: string): CurveFile {
  if (text.length > 524288) throw Error("曲线文件最多 512 KB");
  const data = JSON.parse(text);
  if (data?.format !== "framestudio-curve" || data.version !== 1 ||
      (data.kind !== "keys" && data.kind !== "ease")) throw Error("需要 FrameStudio 曲线 JSON");
  const keys = validateCurveKeys(data.keys,data.kind === "ease");
  return curveFile(data.kind,typeof data.name === "string" ? data.name.slice(0,80) : "导入曲线",keys);
}
function mapKey(k: Key, time: (t:number)=>number, value: (v:number)=>number): Key {
  const point = (p: [number,number]): [number,number] => [time(p[0]),value(p[1])];
  return {t:time(k.t),v:value(k.v),mode:k.mode,...(k.in ? {in:point(k.in)} : {}),...(k.out ? {out:point(k.out)} : {})};
}
export function segmentEase(keys: Key[], index: number) {
  const [a,b] = keys.slice(index,index+2), duration = b?.t-a?.t, span = b?.v-a?.v;
  if (!a || !b || duration <= 0 || span === 0) throw Error("请选择起止值不同的曲线段");
  const t = (v:number)=>(v-a.t)/duration, v = (value:number)=>(value-a.v)/span;
  const start = mapKey(a,t,v), end = mapKey(b,t,v);
  delete start.in;
  delete end.out;
  end.mode = "linear";
  return [start,end];
}
export function applyEase(keys: Key[], index: number, ease: Key[]) {
  const a = keys[index], b = keys[index+1];
  if (!a || !b || b.t <= a.t) throw Error("请先选中要应用的曲线段");
  if (ease[0].v !== 0 || ease.at(-1)!.v !== 1) throw Error("缓动预设的起止值需为 0 和 1");
  const next = ease.map(k => mapKey(k,t=>a.t+(b.t-a.t)*t,v=>a.v+(b.v-a.v)*v));
  const first = next[0], last = next.at(-1)!;
  first.in = a.in;
  last.out = b.out;
  last.mode = b.mode;
  return [...keys.slice(0,index),...next,...keys.slice(index+2)];
}
