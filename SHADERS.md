# FrameStudio 着色器配方

## 代码着色器（.fsglsl.json）

从画布工具栏打开「代码着色器」，选择「画布最终输出」或某个图层。导入 [暖光舞台泛光示例](examples/stage-bloom.fsglsl.json) 或点「试用暖光泛光」，在画布查看结果，再选择「应用到工程」。每份 GLSL 封装为一个有图像输入和输出的节点。它可串联或分支，和高光、模糊、混合等节点一起使用。一个图最多容纳 3 个 GLSL 节点，每个着色器可以有多个通道。节点及参数随 `.livemg` 保存，节点图和单个着色器都可以导出为 JSON。

最终输出着色器接收已经完成三维遮挡、光照、景深和图层后处理的 RGBA 场景。它作用于成片视图和视频、PNG 序列的导出帧。工作区的网格、参考线、选框和透明棋盘独立绘制。导出到实色背景格式时，选定的底色在着色后的透明区域下方填充。三维编辑视图仍可直接查看场景结构。

```json
{
  "format": "framestudio-glsl",
  "version": 1,
  "name": "暖色调",
  "parameters": {
    "strength": { "label": "强度", "value": 0.5, "min": 0, "max": 1 }
  },
  "passes": [
    {
      "id": "tint",
      "source": "vec4 shade(vec2 uv) { vec4 c = source(uv); return vec4(mix(c.rgb, c.rgb * vec3(1.1, 0.9, 0.7), p_strength), c.a); }"
    }
  ]
}
```

- 使用 GLSL ES 1.00。每个通道提供 `vec4 shade(vec2 uv)`，可定义辅助函数。UV 从左上角开始，范围为 0–1。采样和返回值使用直通 Alpha。宿主负责预乘、合成和输出。
- `source(uv)` 采样效果之前的画面，`inputColor(uv)` 采样紧接上一道的输出，`sample_<id>(uv)` 可读取任意前置通道。越界采样返回透明像素。
- `uTime` 是时间线秒数。`uResolution` 是工程画布的像素尺寸，`uTexel` 是它的倒数。自定义浮点参数以 `p_<id>` 读取。
- 一个文件最多 64 KiB，允许 1–4 道通道。中间通道的 `scale` 可取 1、0.5 或 0.25，最后一道用 1。支持从 0 开始的常量上限整数 `for` 循环，组合循环预算为 128。着色器可使用宿主提供的通道纹理，暂未开放外部纹理和跨帧缓冲。

### 内置 Agent

桌面版右下角的「Agent」可以随时展开或收起。首次使用，在设置里填入 OpenAI 兼容 API 的基础地址、模型 ID 和 API 密钥。模型需要支持 Chat Completions 工具调用。密钥以明文保存在本机账户的 `%APPDATA%/FrameStudio/agent-config.json`，更换 API 地址后需填写对应的密钥。在原安装目录升级时，FrameStudio 会尝试迁移旧版加密配置。

使用 DeepSeek 时，点「使用 DeepSeek 预设」填入官方地址 `https://api.deepseek.com` 和默认模型 `deepseek-flash`，也可以选择 `deepseek-v4-pro`。填入自己的 DeepSeek API 密钥并保存。官方端点支持在设置中切换「深度思考」，工具调用的推理上下文会随同一会话传回服务端。更换地址、模型或思考模式时会开始新的对话。[DeepSeek API 说明](https://api-docs.deepseek.com/) · [思考模式与工具调用](https://api-docs.deepseek.com/guides/thinking_mode/)

「流式输出」默认开启。正文和 API 提供的推理文本会边生成边显示，「模型思考」和工具记录可折叠。工具记录显示参数、运行状态和结果摘要。若提供商明确拒绝流式请求，FrameStudio 会改用普通响应，也可在设置里关闭流式输出。[Chat Completions 流式事件](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events)

在对话里描述画面、镜头或动画。Agent 可以调整画布尺寸和时间设置，摆放已导入的模型与素材，编辑图层、镜头、灯光、文字、动作、关键帧、音频口型和节点图。Agent 会按需加载构图、时间线和效果技能，一轮可以持续调用工具。随时可点停止，已有草稿会留在画布。点击「应用草稿」一次写入工程，也可以丢弃。导出前先应用草稿；Agent 可以预设导出格式和范围。

API 请求包含对话和工具读取的工程信息。DeepSeek Flash 用户可在 Agent 设置中开启「允许将成片预览发送给模型」。打开后，Agent 调用渲染工具时可以收到缩小的成片 JPEG。关闭该选项会开始新对话。密钥和素材文件在本机管理。收起悬浮窗保留对话，切换工程会开始新对话。[DeepSeek 图像输入说明](https://api-docs.deepseek.com/guides/vision/)

### 接入本地 MCP

1. 启动 FrameStudio，在「代码着色器」中勾选「启用本地 MCP」。如果希望 Agent 看见像素结果，再勾选「允许 Agent 读取预览画面」。
2. 在 MCP 客户端添加名为 `framestudio-shaders` 的 stdio 服务。使用 Node.js 22+，命令为 `node`，参数为 `framestudio-mcp.mjs` 的绝对路径。从源码运行时，该脚本在 `backend/`，便携版中在 `resources/app/backend/`。脚本默认连接同一副本，可用 `--data-dir` 加绝对路径连接另一份正在运行的 FrameStudio。
3. 在 Agent 对话里描述画面。例如「给最终输出加一层暖色泛光，亮部有柔和外溢，透明背景保留。先预览，我确认后再应用。」也可在面板中直接应用或丢弃 Agent 草稿。

Codex CLI 配置示例

```powershell
codex mcp add framestudio-shaders -- node "C:\FrameStudio\resources\app\backend\framestudio-mcp.mjs"
```

| 工具 | 用途 |
|---|---|
| `shader_context` | 读取画布尺寸、播放头和可用的图层目标 |
| `shader_submit` | 提交完整 GLSL，试渲染并临时刷新画布 |
| `shader_status` | 读取编译信息、草稿状态和已获授权的预览帧 |
| `shader_apply` | 将通过试渲染的草稿应用到工程，可用编辑器撤销 |
| `shader_discard` | 丢弃临时预览 |
| `graph_read` | 读取指定目标的已应用节点图及版本标记 |
| `graph_edit` | 批量新增、删除、连线、设置输入与输出，返回草稿 ID |

`graph_edit` 可传入 `graph_read` 的版本标记，避免覆盖读取后发生的编辑。对一个草稿的多个操作请放在同一批，调用 `shader_status` 检查编译结果。旧的 `shader_submit` 会在当前输出后追加 GLSL 节点。

MCP 通过本机回环地址与 FrameStudio 通信。模型、贴图、音频和工程文件通过本地编辑器管理。画面分享默认关闭。启用后，Agent 可收到缩小的成片 JPEG，使用云端 Agent 时由客户端处理这张图。应用前的草稿独立于工程和导出。

## 效果节点与 JSON

「编辑节点」中可以拖动节点和连接端口。选择图像或文字姿态节点后可「中间预览」，「设为输出」会改变正式效果。导出节点组保存整个配方，在另一张图中插入时会连接到现有结果。双击属性面板中的数值输入后可编辑常量，也可把数值端口公开为滑块。

| 文件 | 用途 |
|---|---|
| `.fsfx.json` | 节点图。标识为 `framestudio-effect` 第 1 版，`kind` 为 `post` 或 `text` |
| `.fspreset.json` | 当前效果设置。标识为 `framestudio-appearance` 第 1 版，`kind` 为 `post`、`text`、`model` 或 `light` |
| `.fscurve.json` | 属性关键帧或缓动形状。标识为 `framestudio-curve` 第 1 版，`kind` 为 `keys` 或 `ease` |
| `.fshader.json` | 兼容旧版顺序着色器。在节点配方导入入口打开时会展开为一串节点 |

`nodes` 中每个节点有 `id`、`op`、`inputs`、`x`、`y`。`output` 选择正式输出。端口用 `@节点ID` 指向另一个节点的输出，用 `$params.参数ID` 引用公开参数。后处理的原画是 `$source`，文字的基础姿态是 `$identity`。参数在 `parameters` 中定义 `label`、`value`、`min`、`max`。布局坐标随 JSON 保存。

图像节点可对透明度和高光做提取、扩散、染色、叠合、混合、曝光及位移。「自定义像素」节点的 `program.offset` 定义两轴取样位移，`program.rgba` 定义取样后的四个颜色分量。表达式由数值、变量和操作数组组成，例如 `["mul","value",["sin",["add","y","time"]]]`。可用变量为 `x`、`y`、`u`、`v`、`time` 和 `value`，颜色表达式还可读取 `r`、`g`、`b`、`a`。运算包括 `add`、`sub`、`mul`、`div`、`min`、`max`、`sin`、`cos`、`abs`、`floor`、`fract`、`mix` 和 `clamp`。

文字图支持逐字或整段，连接入场、退场、周期信号、曲线取样和姿态。逐字模式适用于最多 160 个字素的标题，更长文本按整段处理。文字效果设置可复用当前字体、样式和动效。光源效果设置保存位置、变换、光照参数及相关关键帧，作用对象按当前工程选择。

缓动形状的时间范围为 0–1。完整属性关键帧使用来源通道的秒数和值，导入到当前选中的属性。节点图、实例参数和动画曲线随 `.livemg` 保存。导入会校验连接类型、循环和图像采样预算。

## 旧版着色器配方

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

旧版配方操作在 FrameStudio 中预定义，自定义 GLSL 使用 `.fsglsl.json`。旧版风格处理保留原画面的 Alpha。轮廓、扫描线和颗粒在预览与导出都按画布尺度采样，颗粒和 VHS 扰动随时间线求值。

素材精修和风格处理使用项目自己的 GPU 实现。局部对比度锐化参考了 [AMD FidelityFX CAS](https://gpuopen.com/fidelityfx-cas/)，高光保护参考了 [Khronos PBR Neutral 的高光压缩思路](https://github.com/KhronosGroup/ToneMapping/tree/main/PBR_Neutral)，网点、扫描线和色差的设计参考了 [pmndrs/postprocessing 的公开效果目录](https://github.com/pmndrs/postprocessing)。素材精修针对带 Alpha 的 SDR 模型纹理。
