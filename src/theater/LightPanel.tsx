import React from "react";
import { Layer, Scene, SceneLight, MAX_SCENE_LIGHTS } from "./schema";
export function LightPanel({
  scene,
  layer,
  onChange,
  onScene,
  onValue,
  onKey,
}: {
  scene: Scene;
  layer: Layer;
  onChange: (patch: Partial<SceneLight>) => void;
  onScene: (value: NonNullable<Scene["lighting"]>) => void;
  onValue: (channel: string, value: number) => void;
  onKey: (channel: string) => void;
}) {
  const c = layer.light!,
    env = scene.lighting || {
      enabled: true,
      ambient: 0.7,
      color: "#ffffff",
      exposure: 1,
    };
  return (
    <div className="light-panel">
      <p className="property-note">
        场景空组件 ·
        同时照亮接收此光源的对象。图标和范围线仅用于编辑，不会导出。
      </p>
      <label className="stack-field">
        光源类型
        <select
          aria-label="光源类型"
          value={c.type}
          onChange={(e) => onChange({ type: e.target.value as any })}
        >
          <option value="point">点光源</option>
          <option value="area">面光源</option>
          <option value="sun">日光 / 平行光</option>
          <option value="ambient">环境光</option>
        </select>
      </label>
      <label className="color-field">
        灯光颜色
        <input
          aria-label="场景灯光颜色"
          type="color"
          value={c.color}
          onInput={(e) => onChange({ color: e.currentTarget.value })}
          onChange={(e) => onChange({ color: e.target.value })}
        />
      </label>
      {(
        [
          ["intensity", "强度", 0, 8],
          ...(c.type === "point" || c.type === "area"
            ? [
                ["range", "照射范围", 10, 20000],
                ["decay", "衰减", 0.25, 4],
              ]
            : []),
          ...(c.type === "area"
            ? [
                ["width", "发光面宽度", 1, 10000],
                ["height", "发光面高度", 1, 10000],
              ]
            : []),
          ["specular", "高光贡献", 0, 2],
          ["rim", "轮廓光贡献", 0, 2],
        ] as [keyof SceneLight, string, number, number][]
      ).map(([id, name, min, max]) => (
        <label className="light-value" key={id}>
          <span>
            {name}
            <button
              title={"记录光源 " + name + " 关键帧"}
              className={layer.animation["light." + id]?.length ? "keyed" : ""}
              onClick={() => onKey("light." + id)}
            >
              ◇
            </button>
          </span>
          <input
            aria-label={"场景光源 " + name}
            type="number"
            min={min}
            max={max}
            step=".01"
            value={Number(Number(c[id]).toFixed(3))}
            onChange={(e) =>
              onValue(
                "light." + id,
                Math.max(min, Math.min(max, +e.target.value)),
              )
            }
          />
        </label>
      ))}
      <details>
        <summary>影响对象（留空表示全部接收光照的对象）</summary>
        {scene.layers
          .filter((l) =>
            ["model", "image", "text", "color", "group"].includes(l.kind),
          )
          .map((l) => (
            <label className="toggle-line" key={l.id}>
              <input
                aria-label={"灯光影响 " + l.name}
                type="checkbox"
                checked={c.targets.includes(l.id)}
                onChange={(e) =>
                  onChange({
                    targets: e.target.checked
                      ? [...c.targets, l.id]
                      : c.targets.filter((id) => id !== l.id),
                  })
                }
              />
              {l.name}
            </label>
          ))}
      </details>
      <details>
        <summary>
          场景环境光（全局） · {scene.layers.filter((l) => l.light).length}/
          {MAX_SCENE_LIGHTS} 光源
        </summary>
        <label className="toggle-line">
          <input
            aria-label="启用场景照明"
            type="checkbox"
            checked={env.enabled}
            onChange={(e) => onScene({ ...env, enabled: e.target.checked })}
          />
          启用场景照明
        </label>
        <label className="stack-field">
          环境亮度
          <input
            aria-label="场景环境亮度"
            type="number"
            min="0"
            max="2"
            step=".05"
            value={env.ambient}
            onChange={(e) =>
              onScene({
                ...env,
                ambient: Math.max(0, Math.min(2, +e.target.value)),
              })
            }
          />
        </label>
        <label className="color-field">
          环境颜色
          <input
            type="color"
            value={env.color}
            onChange={(e) => onScene({ ...env, color: e.target.value })}
          />
        </label>
        <label className="stack-field">
          场景曝光
          <input
            aria-label="场景照明曝光"
            type="number"
            min=".05"
            max="4"
            step=".05"
            value={env.exposure}
            onChange={(e) =>
              onScene({
                ...env,
                exposure: Math.max(0.05, Math.min(4, +e.target.value)),
              })
            }
          />
        </label>
      </details>
      <p className="hint">
        位置、深度、旋转与强度可设关键帧。面光和日光沿本地 +Z 方向发射，可用 X/Y
        旋转调整方向。按模型平面法线计算照明，暂不投射模型间阴影。
      </p>
    </div>
  );
}
