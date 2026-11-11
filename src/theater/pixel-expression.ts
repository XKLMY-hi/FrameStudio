export type PixelProgram = { offset:[unknown,unknown]; rgba:[unknown,unknown,unknown,unknown] };
export const identityPixel: PixelProgram = {offset:[0,0],rgba:["r","g","b","a"]};

const globals: Record<string,string> = {x:"pixel.x",y:"pixel.y",u:"uv.x",v:"uv.y",time:"frameTime",value:"control"};
const channels: Record<string,string> = {r:"sampled.r",g:"sampled.g",b:"sampled.b",a:"sampledAlpha"};
const operators: Record<string,[number,(a:string[])=>string]> = {
  add:[2,([a,b])=>`(${a}+${b})`], sub:[2,([a,b])=>`(${a}-${b})`], mul:[2,([a,b])=>`(${a}*${b})`],
  div:[2,a=>`safeDivide(${a})`],
  min:[2,a=>`min(${a})`], max:[2,a=>`max(${a})`],
  sin:[1,a=>`sin(${a})`], cos:[1,a=>`cos(${a})`], abs:[1,a=>`abs(${a})`],
  floor:[1,a=>`floor(${a})`], fract:[1,a=>`fract(${a})`],
  mix:[3,a=>`mix(${a})`], clamp:[3,a=>`clamp(${a})`],
};

export function compilePixel(program: unknown) {
  if (!program || typeof program !== "object") throw Error("像素节点需要表达式对象");
  const {offset,rgba} = program as PixelProgram;
  if (!Array.isArray(offset) || offset.length!==2 || !Array.isArray(rgba) || rgba.length!==4)
    throw Error("像素表达式需包含两个位移和四个颜色分量");
  let count = 0;
  const compile = (expr: unknown,vars: Record<string,string>,depth = 0): string => {
    if (++count>64 || depth>8) throw Error("像素表达式过于复杂");
    if (typeof expr==="number" && Number.isFinite(expr) && Math.abs(expr)<=2048)
      return expr.toFixed(7);
    if (typeof expr==="string" && Object.hasOwn(vars,expr)) return vars[expr];
    if (Array.isArray(expr) && typeof expr[0]==="string" && Object.hasOwn(operators,expr[0])) {
      const [arity,emit] = operators[expr[0]];
      if (expr.length===arity+1) return `clamp(${emit(expr.slice(1).map(e=>compile(e,vars,depth+1)))},-1e6,1e6)`;
    }
    throw Error("无效的像素表达式或变量");
  };
  return {offset:offset.map(v=>compile(v,globals)),rgba:rgba.map(v=>compile(v,{...globals,...channels}))};
}
