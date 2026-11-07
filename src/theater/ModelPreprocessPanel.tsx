import React from "react";
import { ModelResource, SceneEffects, sceneEffects } from "./schema";
export function ModelPreprocessPanel({
  resource,
  onChange,
}: {
  resource?: ModelResource;
  onChange: (value: NonNullable<ModelResource["preprocess"]>) => void;
}) {
  if (!resource)
    return <p className="empty-state">先导入或选择一个模型素材。</p>;
  const e = resource.preprocess?.effects || sceneEffects(),
    enabled = resource.preprocess?.enabled !== false;
  const set = (id: keyof SceneEffects, value: any) =>
    onChange({ enabled, effects: { ...e, [id]: value } });
  return (
    <div className="preprocess-panel">
      <h3>{resource.name}</h3>
      <p className="property-note">
        素材级基础质感，作用于使用此素材的所有实例。此预览不含场景光源、实例后处理和调整层。
      </p>
      <label className="toggle-line">
        <input
          aria-label="启用模型预处理"
          type="checkbox"
          checked={enabled}
          onChange={(v) => onChange({ enabled: v.target.checked, effects: e })}
        />
        启用预处理（关闭可对比原始效果）
      </label>
      {(
        [
          ["brightness", "亮度", 0.2, 2],
          ["contrast", "对比度", 0.2, 2],
          ["saturation", "饱和度", 0, 2],
          ["bloom", "泛光", 0, 2],
          ["glow", "边缘发光", 0, 2],
          ["outline", "描边宽度", 0, 12],
          ["blur", "基础模糊", 0, 32],
        ] as const
      ).map(([id, name, min, max]) => (
        <label className="preprocess-value" key={id} data-preprocess-param={id}>
          <span>{name}</span>
          <input
            aria-label={"预处理 " + name}
            type="range"
            min={min}
            max={max}
            step=".01"
            value={e[id]}
            onChange={(v) => set(id, +v.target.value)}
          />
          <input
            aria-label={"预处理 " + name + " 数值"}
            type="number"
            min={min}
            max={max}
            step=".01"
            value={e[id]}
            onChange={(v) =>
              set(id, Math.max(min, Math.min(max, +v.target.value)))
            }
          />
        </label>
      ))}
      <label className="color-field">
        描边颜色
        <input
          aria-label="预处理描边颜色"
          type="color"
          value={e.outlineColor}
          onChange={(v) => set("outlineColor", v.target.value)}
        />
      </label>
      <label className="color-field">
        发光颜色
        <input
          aria-label="预处理发光颜色"
          type="color"
          value={e.glowColor}
          onChange={(v) => set("glowColor", v.target.value)}
        />
      </label>
      <button
        className="wide-button"
        onClick={() => onChange({ enabled: true, effects: sceneEffects() })}
      >
        重置此素材的预处理
      </button>
      <p className="hint">
        渲染顺序：模型预处理 → 场景光照 → 实例后处理 → 图层组 /
        调整层。原始模型文件保持原样，设置随 .livemg 保存。
      </p>
    </div>
  );
}
