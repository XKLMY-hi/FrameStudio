# FrameStudio 着色器配方

选中图层，在「场景后处理 → 风格化着色器」里导入 `.fshader.json`。也可以新建后处理层，调节同组位于它下方的合成画面。选中的配方随 `.livemg` 保存，并用于预览和导出。风格强度可以打关键帧。「导出配方」可把当前样式保存为独立文件。

[虹膜胶片示例](examples/iris-film.fshader.json) 可直接导入。一个配方的结构如下。

```json
{
  "format": "framestudio-shader",
  "version": 1,
  "name": "午夜双色",
  "passes": [
    { "op": "duotone", "amount": 0.85, "dark": "#141630", "light": "#ffd5e3" }
  ]
}
```

文件最大 16 KB，名称最多 80 个字符。每个配方含一至四道 GPU 处理，按数组顺序执行。每道处理可设置 `amount`（0–1，默认 1）、`scale`（0.5–48，默认 1），以及 `dark` 和 `light`（六位十六进制颜色）。

| `op` | 处理效果 | 参数用途 |
|---|---|---|
| `ink` | 赛璐璐色阶和墨线 | `scale` 调整边缘采样，`dark` 设置墨色 |
| `halftone` | 黑白漫画网点 | `scale` 调整网点间距，`dark` 和 `light` 设置墨色与纸色 |
| `vhs` | RGB 色差、扫描线和噪点 | `scale` 调整色差位移 |
| `duotone` | 按亮度映射为双色 | `dark` 和 `light` 设置暗部与亮部 |
| `neon` | 发光轮廓式调色 | `scale` 调整轮廓宽度，`light` 设置边缘色 |
| `film` | 胶片颗粒和染色 | `scale` 调整颗粒尺寸，两种颜色设置染色 |
| `pixel` | 像素块和色阶量化 | `scale` 调整像素块尺寸 |
| `matrix` | 自定义 RGB 变换 | 必填 `matrix`，九个数按 R、G、B 输出行排列。可选 `bias`，三个偏移值，默认全零。系数和偏移范围 −4 到 4 |

配方操作在 FrameStudio 中预定义。格式只接受参数与操作的组合，GLSL、HLSL、外部纹理和脚本需另行移植。所有风格处理保留原画面的 Alpha。轮廓、扫描线和颗粒在预览与导出都按画布尺度采样，颗粒和 VHS 扰动随时间线求值。

素材精修和风格处理使用项目自己的 GPU 实现。局部对比度锐化参考了 [AMD FidelityFX CAS](https://gpuopen.com/fidelityfx-cas/)，高光保护参考了 [Khronos PBR Neutral 的高光压缩思路](https://github.com/KhronosGroup/ToneMapping/tree/main/PBR_Neutral)，网点、扫描线和色差的设计参考了 [pmndrs/postprocessing 的公开效果目录](https://github.com/pmndrs/postprocessing)。素材精修针对带 Alpha 的 SDR 模型纹理。
