import { useRef, useState } from "react";
import { Diamond, Download, Upload } from "lucide-react";
import { download } from "../api";
import type { SceneEffects } from "./schema";
import { importShaderRecipe, shaderOperations, shaderPresets, type ShaderRecipe } from "./stylize";

export function ShaderControls({ effects, onRecipe, amount, onAmount, onKey, keyed }: {
  effects: SceneEffects;
  onRecipe: (recipe: ShaderRecipe | undefined) => void;
  amount: number;
  onAmount: (value: number) => void;
  onKey: () => void;
  keyed: boolean;
}) {
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const recipe = effects.stylize;
  const selected = recipe
    ? shaderPresets.find(p => JSON.stringify(p.recipe) === JSON.stringify(recipe))?.id ?? "imported"
    : "";
  return (
    <section className="shader-controls" aria-label="风格化着色器">
      <h3>风格化着色器</h3>
      <label className="stack-field">
        着色器预设
        <select value={selected} onChange={e => {
          setError("");
          onRecipe(shaderPresets.find(p => p.id === e.target.value)?.recipe);
        }}>
          <option value="">无</option>
          {shaderPresets.map(({ id, recipe }) => <option key={id} value={id}>{recipe.name}</option>)}
          {selected === "imported" && <option value="imported">{recipe?.name}（自定义）</option>}
        </select>
      </label>
      {recipe && (
        <>
          <div className="shader-amount">
            <label>
              <span>风格强度 <small>{Math.round(amount * 100)}%</small></span>
              <input aria-label="风格强度" type="range" min={0} max={1} step={.01} value={amount}
                onChange={e => onAmount(+e.target.value)} />
            </label>
            <button className={keyed ? "active" : ""} title="记录风格强度关键帧" onClick={onKey}><Diamond size={14} /></button>
          </div>
          <p className="property-note">
            {Array.isArray(recipe.passes) && recipe.passes.map(p => shaderOperations[p.op]).filter(Boolean).join(" → ")}
          </p>
        </>
      )}
      <div className="shader-actions">
        <button onClick={() => input.current?.click()}><Upload size={14} /> 导入着色器</button>
        <button disabled={!recipe} onClick={() => {
          if (!recipe) return;
          const file = JSON.stringify({ format: "framestudio-shader", version: 1, ...recipe }, null, 2);
          download(new Blob([file], { type: "application/json" }), "FrameStudio.fshader.json");
        }}><Download size={14} /> 导出配方</button>
      </div>
      <input ref={input} hidden type="file" accept=".json,.fshader" aria-label="着色器配方文件" onChange={async e => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        if (!file) return;
        try {
          if (file.size > 16384) throw Error("着色器配方不能超过 16 KB");
          onRecipe(importShaderRecipe(await file.text()));
          setError("");
        } catch (err) {
          setError(err instanceof SyntaxError ? "着色器文件不是有效的 JSON" : (err as Error).message);
        }
      }} />
      {error && <p className="shader-error" role="alert">{error}</p>}
    </section>
  );
}
