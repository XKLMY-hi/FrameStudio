export type Shape = {
  kind:"rect"|"ellipse"|"star"|"svg"|"expression";
  fill:string;stroke?:string;strokeWidth?:number;radius?:number;
  svg?:string; x?:unknown; y?:unknown; samples?:number; closed?:boolean;
};
export const defaultShape:Shape={kind:"rect",fill:"#8f8cff",radius:12};

const tags=new Set("svg g path rect circle ellipse line polyline polygon defs linearGradient radialGradient stop clipPath mask".split(" "));
const attributes=new Set("viewBox width height x y x1 x2 y1 y2 cx cy r rx ry d points fill fill-opacity fill-rule stroke stroke-width stroke-linecap stroke-linejoin stroke-opacity opacity transform gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity id clip-path clip-rule clipPathUnits mask maskUnits maskContentUnits fx fy fr preserveAspectRatio".split(" "));
const paint=(v:unknown)=>typeof v==="string" && /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|none|transparent)$/i.test(v);
export function sanitizeSvg(source:unknown) {
  if(typeof source!=="string" || source.length>100000 || /<!DOCTYPE|<!ENTITY|<\?/i.test(source))
    throw Error("SVG 无效或超过 100 KB");
  const doc=new DOMParser().parseFromString(source,"image/svg+xml");
  const root=doc.documentElement;
  if(root.localName!=="svg" || root.namespaceURI!=="http://www.w3.org/2000/svg" || doc.querySelector("parsererror"))
    throw Error("需要包含 SVG 命名空间的有效 <svg> 文档");
  const elements=[root,...Array.from(root.querySelectorAll("*"))];
  if(elements.length>800) throw Error("SVG 节点过多");
  for(const node of elements){
    if(!tags.has(node.localName) || node.namespaceURI!==root.namespaceURI) throw Error("SVG 包含不支持的元素 "+node.localName);
    for(const attr of Array.from(node.attributes)){
      if(attr.name==="xmlns" && node===root) continue;
      if(attr.namespaceURI || !attributes.has(attr.name) || /(?:javascript:|data:|https?:|@import)/i.test(attr.value) ||
        (/url\s*\(/i.test(attr.value) && !/^url\(#[\w.-]+\)$/.test(attr.value.trim())))
        throw Error("SVG 包含不支持的属性 "+attr.name);
    }
  }
  if(!root.hasAttribute("viewBox")){
    const w=parseFloat(root.getAttribute("width")??"100"),h=parseFloat(root.getAttribute("height")??"100");
    if(!(w>0 && h>0)) throw Error("SVG 宽高无效");
    root.setAttribute("viewBox","0 0 "+w+" "+h);
  }
  const view=root.getAttribute("viewBox")!.trim().split(/[ ,]+/).map(Number);
  if(view.length!==4 || view.some(v=>!Number.isFinite(v) || Math.abs(v)>1e6) || view[2]<=0 || view[3]<=0) throw Error("SVG viewBox 无效");
  root.removeAttribute("width");root.removeAttribute("height");
  return new XMLSerializer().serializeToString(root);
}

type Formula=(t:number)=>number;
function formula(v:unknown,budget={nodes:0},depth=0):Formula {
  if(++budget.nodes>96 || depth>12) throw Error("表达式过复杂");
  if(v==="t") return t=>t;
  if(v==="pi") return ()=>Math.PI;
  if(typeof v==="number" && Number.isFinite(v) && Math.abs(v)<=10000) return ()=>v;
  if(!Array.isArray(v)) throw Error("表达式需要常量、t、pi 或运算数组");
  const [op,a,b]=v;
  const one:Record<string,(x:number)=>number>={sin:Math.sin,cos:Math.cos,abs:Math.abs,sqrt:Math.sqrt};
  const two:Record<string,(x:number,y:number)=>number>={add:(x,y)=>x+y,sub:(x,y)=>x-y,mul:(x,y)=>x*y,div:(x,y)=>x/y,pow:Math.pow,min:Math.min,max:Math.max};
  const f=formula(a,budget,depth+1);
  if(typeof op==="string" && v.length===2 && Object.hasOwn(one,op)) return t=>one[op](f(t));
  if(typeof op==="string" && v.length===3 && Object.hasOwn(two,op)){
    const g=formula(b,budget,depth+1);return t=>two[op](f(t),g(t));
  }
  throw Error("未知表达式运算");
}
export function validateShape(input:unknown):Shape {
  if(!input || typeof input!=="object" || Array.isArray(input)) throw Error("需要图形对象");
  const v=input as Shape;
  if(!["rect","ellipse","star","svg","expression"].includes(v.kind)) throw Error("未知图形类型");
  if(!paint(v.fill) && v.kind!=="svg") throw Error("填色需要十六进制颜色或 none");
  if(v.stroke!==undefined && !paint(v.stroke)) throw Error("描边颜色无效");
  if(v.strokeWidth!==undefined && (!Number.isFinite(v.strokeWidth) || v.strokeWidth<0 || v.strokeWidth>100)) throw Error("描边宽度无效");
  if(v.radius!==undefined && (!Number.isFinite(v.radius) || v.radius<0 || v.radius>50)) throw Error("圆角需为 0–50");
  const result:Shape={kind:v.kind,fill:v.fill??"none",stroke:v.stroke,strokeWidth:v.strokeWidth,radius:v.radius};
  if(v.kind==="svg") result.svg=sanitizeSvg(v.svg);
  if(v.kind==="expression"){
    if(v.samples!==undefined && (!Number.isInteger(v.samples) || v.samples<8 || v.samples>512)) throw Error("表达式采样数需为 8–512");
    Object.assign(result,{x:v.x,y:v.y,samples:v.samples??144,closed:v.closed!==false});
    shapeSvg(result);
  }
  return result;
}
export function shapeSvg(shape:Shape,width=512,height=512) {
  const w=Math.max(1,Math.min(2048,Math.round(width))),h=Math.max(1,Math.min(2048,Math.round(height)));
  if(shape.kind==="svg"){
    const svg=sanitizeSvg(shape.svg);
    return svg.replace(/^<svg\b/,`<svg width="${w}" height="${h}"`);
  }
  const attrs=`fill="${paint(shape.fill)?shape.fill:"none"}" stroke="${paint(shape.stroke)?shape.stroke:"none"}" stroke-width="${Number.isFinite(shape.strokeWidth)?shape.strokeWidth:0}"`;
  let content:string;
  if(shape.kind==="ellipse") content=`<ellipse cx="50" cy="50" rx="48" ry="48" ${attrs}/>`;
  else if(shape.kind==="star"){
    const points=Array.from({length:10},(_,i)=>{
      const a=i*Math.PI/5-Math.PI/2,r=i%2?21:47;
      return `${50+Math.cos(a)*r},${50+Math.sin(a)*r}`;
    }).join(" ");
    content=`<polygon points="${points}" ${attrs}/>`;
  } else if(shape.kind==="expression"){
    const x=formula(shape.x),y=formula(shape.y),count=Math.min(512,Math.max(8,shape.samples??144));
    const points=Array.from({length:count+1},(_,i)=>{
      const t=i/count*2*Math.PI, a=x(t),b=y(t);
      if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a)>1e4||Math.abs(b)>1e4) throw Error("表达式产生无效坐标");
      return `${i?"L":"M"}${a.toFixed(3)},${b.toFixed(3)}`;
    }).join(" ");
    content=`<path d="${points}${shape.closed===false?"":" Z"}" ${attrs}/>`;
  } else content=`<rect x="1" y="1" width="98" height="98" rx="${Math.max(0,Math.min(50,shape.radius??0))}" ${attrs}/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 100 100" preserveAspectRatio="none">${content}</svg>`;
}
