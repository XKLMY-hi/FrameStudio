import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ReferenceImage = {name:string;url:string};
export const maxReferenceImages=3;

function jpeg(canvas:HTMLCanvasElement) {
  let url=canvas.toDataURL("image/jpeg",.82);
  if(url.length>400000) url=canvas.toDataURL("image/jpeg",.58);
  if(url.length>400000) throw Error("参考图压缩后仍超过大小限制");
  return url;
}
export async function loadReference(file:File):Promise<ReferenceImage> {
  if(!/^image\/(?:png|jpeg|webp|gif|avif|bmp)$/i.test(file.type) || file.size>20*1024*1024)
    throw Error("参考图需要为 PNG、JPEG、WebP、GIF、AVIF 或 BMP，且不超过 20 MB");
  const bitmap=await createImageBitmap(file);
  try {
    const scale=Math.min(1,960/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement("canvas");
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));
    canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext("2d")!;
    ctx.fillStyle="#ffffff";ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    return {name:file.name,url:jpeg(canvas)};
  } finally {bitmap.close();}
}
type Point={x:number;y:number};
export function AgentReferenceEditor({image,close,apply}:{
  image:ReferenceImage;close:()=>void;apply:(image:ReferenceImage)=>void;
}) {
  const canvas=useRef<HTMLCanvasElement>(null);
  const source=useRef<HTMLImageElement>(undefined);
  const [ready,setReady]=useState(false);
  const [strokes,setStrokes]=useState<Point[][]>([]);
  const [error,setError]=useState("");
  const active=useRef<number>(undefined);
  function draw(lines:Point[][]){
    const el=canvas.current,img=source.current;
    if(!el || !img) return;
    const ctx=el.getContext("2d")!;
    ctx.drawImage(img,0,0,el.width,el.height);
    ctx.strokeStyle="#ff473e";ctx.fillStyle="#ff473e";
    ctx.lineWidth=Math.max(3,Math.max(el.width,el.height)/120);
    ctx.lineCap=ctx.lineJoin="round";
    for(const line of lines){
      const [first,...rest]=line;
      if(!first) continue;
      ctx.beginPath();
      if(!rest.length){ctx.arc(first.x,first.y,ctx.lineWidth/2,0,Math.PI*2);ctx.fill();continue;}
      ctx.moveTo(first.x,first.y);
      for(const point of rest) ctx.lineTo(point.x,point.y);
      ctx.stroke();
    }
  }
  useEffect(()=>{
    const img=new Image();
    img.onload=()=>{
      const el=canvas.current;
      if(!el) return;
      source.current=img;el.width=img.naturalWidth;el.height=img.naturalHeight;draw([]);setReady(true);
    };
    img.onerror=()=>setError("无法打开参考图");
    img.src=image.url;
    return ()=>{img.onload=null;img.onerror=null;source.current=undefined;};
  },[image]);
  useEffect(()=>draw(strokes),[strokes]);
  function point(e:React.PointerEvent<HTMLCanvasElement>){
    const el=e.currentTarget,box=el.getBoundingClientRect();
    return {x:(e.clientX-box.left)*el.width/box.width,y:(e.clientY-box.top)*el.height/box.height};
  }
  return createPortal(<div className="studio-json-backdrop">
    <div role="dialog" aria-modal="true" aria-label="标注参考图" className="studio-json-dialog studio-reference-dialog">
      <h2>标注参考图</h2>
      {!ready && !error && <p role="status">正在打开参考图…</p>}
      <canvas ref={canvas} aria-label="参考图画笔" data-ready={ready} onPointerDown={e=>{
        if(e.button!==0 || !source.current || active.current!==undefined || strokes.length>=100) return;
        e.currentTarget.setPointerCapture(e.pointerId);active.current=e.pointerId;
        const p=point(e);setStrokes(lines=>[...lines,[p]]);
      }} onPointerMove={e=>{
        if(active.current!==e.pointerId) return;
        const p=point(e);
        setStrokes(lines=>{const last=lines.at(-1);return last && last.length<4096 ? [...lines.slice(0,-1),[...last,p]] : lines;});
      }} onLostPointerCapture={()=>{active.current=undefined;}}/>
      {error && <p role="alert">{error}</p>}
      <div className="shader-actions">
        <button disabled={!strokes.length} onClick={()=>setStrokes(lines=>lines.slice(0,-1))}>撤销画笔</button>
        <button disabled={!strokes.length} onClick={()=>setStrokes([])}>清空标注</button>
        <button onClick={close}>取消</button>
        <button disabled={!ready} onClick={()=>{
          if(!source.current || !canvas.current) return;
          try {apply({...image,url:strokes.length ? jpeg(canvas.current) : image.url});}
          catch(e){setError(e instanceof Error ? e.message : String(e));}
        }}>完成标注</button>
      </div>
    </div>
  </div>,document.body);
}
