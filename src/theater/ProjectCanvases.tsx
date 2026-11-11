import { FolderOpen, Plus, Trash2 } from "lucide-react";
import type { Montage } from "./montage";

type Props = {
  project: Montage;
  current: string;
  disabled: boolean;
  open: (id: string) => void;
  importCanvas: () => void;
  edit: (edits: unknown) => void;
};

export function ProjectCanvases({project, current, disabled, open, importCanvas, edit}: Props) {
  const used = new Set(project.clips.map(clip=>clip.canvasId));
  return (
    <div className="project-canvases" aria-label="项目画布">
      <div className="montage-actions">
        <button disabled={disabled} onClick={()=>edit([{op:"add_canvas"}])}><Plus size={14}/> 新建画布</button>
        <button disabled={disabled} onClick={importCanvas}><FolderOpen size={14}/> 导入 .livemg</button>
      </div>
      {project.canvases.map(({id,scene},index)=>(
        <article key={id} data-canvas-id={id} data-current={current===id}>
          <button className="montage-source" onClick={()=>open(id)} disabled={disabled} title="打开独立画布">
            <span className="deck-source-index" aria-hidden="true">{String(index+1).padStart(2,"0")}</span>
            <span>{scene.name}<small>{scene.duration.toFixed(2)} s · {used.has(id) ? "已编排" : "未加入总时间线"}</small></span>
          </button>
          <button disabled={disabled} aria-label={"加入总时间线 "+scene.name} title="加入总时间线末尾"
            onClick={()=>edit([{op:"add_clip",canvasId:id}])}><Plus size={15}/></button>
          <button disabled={disabled || project.canvases.length<2} aria-label={"移除画布 "+scene.name} title="移除画布及其所有片段"
            onClick={()=>edit([{op:"remove_canvas",id}])}><Trash2 size={14}/></button>
        </article>
      ))}
    </div>
  );
}
