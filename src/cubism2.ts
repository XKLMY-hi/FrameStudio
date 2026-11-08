import { media } from "./api";

export const isCubism2File = (file: string) =>
  /(?:^|[/.])model\.json$/i.test(file.split(/[?#]/, 1)[0]);

export function lipParameters(file: string, assets: { expression?: { id: string }[] }[] = []) {
  if (!isCubism2File(file)) return { lipOpen: "ParamMouthOpenY", lipForm: "ParamMouthForm" };
  const ids = new Set(assets.flatMap((asset) => asset.expression?.map((p) => p.id) ?? []));
  return {
    lipOpen: "PARAM_MOUTH_OPEN_Y",
    lipForm: ids.has("PARAM_MOUTH_FORM_01") && !ids.has("PARAM_MOUTH_FORM")
      ? "PARAM_MOUTH_FORM_01" : "PARAM_MOUTH_FORM",
  };
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => { script.remove(); resolve(); };
    script.onerror = () => { script.remove(); reject(Error(src)); };
    document.head.append(script);
  });
}

let pending: Promise<any> | undefined;
export function cubism2() {
  return pending ??= (async () => {
    try {
      await loadScript(media("runtime/live2d.min.js"));
      if (!(window as any).Live2DModelWebGL) throw Error();
    } catch {
      throw Error("旧版模型需要 Cubism 2.1 Web 运行库。请将 live2d.min.js 放在程序数据目录的 runtime 文件夹。");
    }
    await loadScript("/vendor/cubism2.min.js");
    const adapter = window.PIXI.live2dLegacy;
    if (!adapter?.Live2DModel) throw Error("Cubism 2.1 渲染适配器加载失败");
    adapter.config.logLevel = 3;
    return adapter;
  })().catch((error) => {
    pending = undefined;
    throw error;
  });
}

export function cubism2Settings(adapter: any, settings: object, url: string) {
  const source = new adapter.Cubism2ModelSettings({ ...settings, url });
  const model = new URL(url);
  const folder = model.pathname.split("/").slice(0, 4).join("/") + "/";
  source.replaceFiles((ref: string) => {
    if (!ref) return ref;
    const asset = new URL(ref.replaceAll("\\", "/"), model);
    if (asset.origin !== model.origin || !asset.pathname.startsWith(folder))
      throw Error("旧版模型引用了模型目录之外的文件");
    return asset.href;
  });
  return source;
}

export class Cubism2Pose {
  readonly raw: {
    parameters: {
      ids: string[];
      values: Float32Array;
      defaultValues: Float32Array;
      minimumValues: Float32Array;
      maximumValues: Float32Array;
    };
  };
  private indices: number[] = [];
  private parameterIndex = new Map<string, number>();
  private partDefaults: number[];

  constructor(private core: any, private adapter: any, private pose: any) {
    // These are the parameter IDs and part definitions of the 2.1 Web runtime.
    // The SDK also appends virtual parameters for absent IDs with unbounded limits.
    const context = core.getModelContext();
    if (!Array.isArray(context._$pb) || !Array.isArray(context._$F2))
      throw Error("Cubism 2.1 Web 运行库版本不兼容");
    const ids: string[] = [];
    const min: number[] = [], max: number[] = [], defaults: number[] = [];
    context._$pb.forEach((id: { id: string } | undefined, index: number) => {
      if (!id) return;
      const lo = context.getParamMin(index), hi = context.getParamMax(index);
      if (lo === -1000000 && hi === 1000000 && !id.id.startsWith("VISIBLE:")) return;
      this.parameterIndex.set(id.id, ids.length);
      this.indices.push(index);
      ids.push(id.id);
      min.push(lo);
      max.push(hi);
      defaults.push(core.getParamFloat(index));
    });
    this.raw = { parameters: {
      ids, values: new Float32Array(defaults), defaultValues: new Float32Array(defaults),
      minimumValues: new Float32Array(min), maximumValues: new Float32Array(max),
    } };
    this.partDefaults = context._$F2.map((_: unknown, i: number) => core.getPartsOpacity(i));
  }

  resetParts() {
    this.partDefaults.forEach((value, index) => this.core.setPartsOpacity(index, value));
  }

  setParameterValueById(id: string, value: number) {
    const index = this.parameterIndex.get(id);
    if (index !== undefined) this.raw.parameters.values[index] = value;
  }

  setPartOpacityById(id: string, value: number) {
    const index = this.core.getPartsDataIndex(id);
    if (index >= 0) this.core.setPartsOpacity(index, value);
  }

  private applyParameters() {
    const { values } = this.raw.parameters;
    this.indices.forEach((index, i) => this.core.setParamFloat(index, values[i]));
  }

  createPhysics(data: unknown) {
    const physics = new this.adapter.Live2DPhysics(this.core, data);
    let elapsed = 0;
    return {
      evaluate: (_model: unknown, dt: number) => {
        this.applyParameters();
        physics.update(elapsed);
        elapsed += dt * 1000;
        const { values } = this.raw.parameters;
        this.indices.forEach((index, i) => { values[i] = this.core.getParamFloat(index); });
      },
    };
  }

  update() {
    this.applyParameters();
    this.pose?.update(500);
    this.core.update();
  }
}
