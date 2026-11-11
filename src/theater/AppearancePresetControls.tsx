import { useRef, useState } from "react";
import { download } from "../api";
import { parseAppearance, type Appearance, type AppearanceKind } from "./appearance-preset";

export function AppearancePresetControls<K extends AppearanceKind>({kind,data,apply}: {
  kind:K; data:Appearance[K]; apply:(preset:Appearance[K])=>void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [error,setError] = useState("");
  return <section className="appearance-preset-controls" aria-label="效果设置 JSON">
    <div className="shader-actions">
      <button onClick={()=>file.current?.click()}>导入效果设置</button>
      <button onClick={()=>{
        const payload={format:"framestudio-appearance",version:1,kind,data};
        const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
        download(blob,"FrameStudio-"+kind+".fspreset.json");
      }}>导出效果设置</button>
    </div>
    <input ref={file} hidden type="file" accept=".json" aria-label="效果设置文件" onChange={async e=>{
      const chosen=e.currentTarget.files?.[0];e.currentTarget.value="";
      if (!chosen) return;
      try {
        if (chosen.size>524288) throw Error("效果预设最多 512 KB");
        apply(parseAppearance(await chosen.text(),kind));setError("");
      } catch(err) {setError(err instanceof SyntaxError ? "文件不是有效的 JSON" : (err as Error).message);}
    }}/>
    {error && <p className="shader-error" role="alert">{error}</p>}
  </section>;
}
