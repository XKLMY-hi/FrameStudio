import { Project, Param } from "./types";
import { classify, evaluate, evaluationContext } from "./engine";
import {cubismMemoryGuard,CubismMemoryGuard} from './cubism-memory';
declare global {
  interface Window {
    PIXI: any;
    Live2DCubismCore: any;
    studioDesktop?: {
      setAppearance?: (appearance:string)=>void;
      reveal: (p: string) => Promise<void>;
      saveFile?: (
        name: string,
        bytes: ArrayBuffer,
      ) => Promise<{ canceled: boolean; path?: string }>;
      saveExport?: (
        p: string,
        name: string,
      ) => Promise<{ canceled: boolean; path?: string }>;
    };
    studio: any;
  }
}
export const postFragment = `
precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize;
uniform float outline; uniform vec3 outlineColor; uniform float glow; uniform vec3 glowColor;
uniform float bloom; uniform float brightness; uniform float contrast; uniform float saturation;
uniform float lightType; uniform vec2 lightPosition; uniform float lightIntensity; uniform vec3 lightColor;
uniform float rim; uniform float gloss; uniform float pixelScale;
void main(){
 vec2 uv=vTextureCoord;vec4 src=texture2D(uSampler,uv);float a=src.a;
 vec3 color=a>0.001?src.rgb/a:vec3(0.0);float mx=a;float mn=a;float soft=0.0;vec3 bright=vec3(0.0);
 for(int i=0;i<12;i++){
  float angle=float(i)*6.2831853/12.0;vec2 d=vec2(cos(angle),sin(angle));
  if(outline>0.0 || rim>0.0){float nearA=texture2D(uSampler,uv+d*max(outline*pixelScale,1.0)*inputSize.zw).a;mx=max(mx,nearA);mn=min(mn,nearA);}
  if(glow>0.0){vec4 nearC=texture2D(uSampler,uv+d*(4.0+glow*15.0)*pixelScale*inputSize.zw);soft+=nearC.a/12.0;}
  if(bloom>0.0){vec4 b=texture2D(uSampler,uv+d*(3.0+bloom*9.0)*pixelScale*inputSize.zw);bright+=max(b.rgb-vec3(.55*b.a),0.0)/12.0;}
 }
 color=(color-.5)*contrast+.5;float l=dot(color,vec3(.2126,.7152,.0722));color=mix(vec3(l),color,saturation)*brightness;
 if(lightType>0.5){
  vec2 pos=uv*inputSize.xy;vec2 light=lightPosition*inputSize.xy;float dist=length((pos-light)/inputSize.yy);
  float power=lightType>2.5?1.0:lightType>1.5?max(0.0,1.0-dist*.65):1.0/(1.0+dist*dist*5.0);
  color+=lightColor*power*lightIntensity*.35;
  float edge=max(0.0,a-mn);float facing=clamp(dot(normalize(pos-light+vec2(.001)),vec2(-.6,-.8)),0.0,1.0);
  color+=lightColor*edge*rim*(.3+facing)*2.0;
  float stripe=exp(-pow((uv.x-lightPosition.x+(uv.y-lightPosition.y)*.4)*8.0,2.0));
  color+=lightColor*stripe*gloss*max(0.0,l-.25)*.45;
 }
 float edge=outline>0.0?max(0.0,mx-a):0.0;float halo=soft*glow*.6*(1.0-a);float ba=clamp(max(max(bright.r,bright.g),bright.b)*bloom,0.0,1.0);
 float backA=clamp(edge+halo+ba,0.0,1.0);vec3 back=outlineColor*edge+glowColor*halo+bright*bloom;
 gl_FragColor=vec4(clamp(color,0.0,1.0)*a+back*(1.0-a),a+backA*(1.0-a));
}`;
const labels: Record<string, string> = {
  ParamAngleX: "头部 · 左右",
  ParamAngleY: "头部 · 上下",
  ParamAngleZ: "头部 · 倾斜",
  ParamEyeLOpen: "左眼 · 开合",
  ParamEyeROpen: "右眼 · 开合",
  ParamEyeBallX: "视线 · 左右",
  ParamEyeBallY: "视线 · 上下",
  ParamMouthOpenY: "嘴部 · 开合",
  ParamMouthForm: "嘴部 · 形状",
  ParamBodyAngleX: "身体 · 左右",
  ParamBodyAngleY: "身体 · 上下",
  ParamBodyAngleZ: "身体 · 倾斜",
  ParamBreath: "呼吸",
  ParamBrowLY: "左眉 · 高度",
  ParamBrowRY: "右眉 · 高度",
  ParamCheek: "脸红",
};
function rgb(hex: string) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}
export class StudioRenderer {
  app: any;
  model: any;
  memoryGuard: CubismMemoryGuard;
  private detachMemory?:()=>void;
  params: Param[] = [];
  physicsData: any;
  physics: any;
  previewOverrides: Record<string, number> = {};
  bounds = { x: 0, y: 0, w: 1, h: 1 };
  lastT = -1;
  physicsTick = -1;
  physicsOffsets: Float32Array | undefined;
  partDefaults: Float32Array | undefined;
  modelGroups: any[] = [];
  loadSequence = 0;
  previewLimit = 720;
  dirty = true;
  warming = false;
  filter: any;
  lastProject: Project | undefined;
  contextProject: Project | undefined;
  context: ReturnType<typeof evaluationContext> | undefined;
  snapshots = new Map<
    number,
    { particles: any[]; offsets: Float32Array | undefined }
  >();
  warmTimer: ReturnType<typeof setTimeout> | undefined;
  warmGeneration = 0;
  warmGoal = 0;
  warmProject: Project | undefined;
  stage: any;
  ownsApp = true;
  constructor(host?: HTMLElement, sharedApp?: any) {
    const P = window.PIXI;
    P.live2d.config.logLevel = 3;
    this.memoryGuard=cubismMemoryGuard(window.Live2DCubismCore);
    this.app =
      sharedApp ||
      new P.Application({
        width: 640,
        height: 640,
        resolution: 1,
        autoDensity: false,
        autoStart: false,
        backgroundAlpha: 0,
        antialias: true,
        preserveDrawingBuffer: true,
        clearBeforeRender: true,
      });
    this.ownsApp = !sharedApp;
    this.stage = sharedApp ? new P.Container() : this.app.stage;
    this.app.stop();
    if (host) host.append(this.app.view);
    this.app.view.setAttribute("aria-label", "Live2D 透明画布");
  }
  async load(url: string) {
    const seq = ++this.loadSequence,
      P = window.PIXI;
    const settings = await fetch(url).then((r) => r.json());
    const model = await P.live2d.Live2DModel.from(url, {
      autoUpdate: false,
      autoInteract: false,
      motionPreload: "NONE",
    });
    if (seq !== this.loadSequence) {
      model.destroy();
      return this.params;
    }
    this.stage.removeChildren();
    this.detachMemory?.();
    this.model?.destroy();
    this.model = model;
    this.detachMemory=this.memoryGuard.track(model.internalModel.coreModel,()=>this.invalidate());
    this.modelGroups = settings.Groups || [];
    model.internalModel.motionManager.stopAllMotions();
    this.stage.addChild(model);
    const raw = model.internalModel.coreModel._model;
    this.partDefaults = raw.parts.opacities.slice();
    this.params = Array.from(raw.parameters.ids, (id: any, i: number) => ({
      id: String(id),
      name: labels[id] || String(id),
      min: raw.parameters.minimumValues[i],
      max: raw.parameters.maximumValues[i],
      default: raw.parameters.defaultValues[i],
      group: classify(id),
    }));
    if (settings.FileReferences?.DisplayInfo) {
      try {
        const json = await fetch(
          new URL(settings.FileReferences.DisplayInfo, url),
        ).then((r) => r.json());
        for (const p of this.params)
          p.name =
            json.Parameters?.find((x: any) => x.Id === p.id)?.Name || p.name;
      } catch {}
    }
    this.physicsData = null;
    if (settings.FileReferences?.Physics) {
      try {
        const u = new URL(settings.FileReferences.Physics, url);
        new URL(url).searchParams.forEach((v, k) => u.searchParams.set(k, v));
        this.physicsData = await fetch(u).then((r) => r.json());
      } catch {}
    }
    this.resetPhysics();
    const iw = model.internalModel.originalWidth,
      ih = model.internalModel.originalHeight;
    const scale = Math.min(
      this.app.screen.width / iw,
      this.app.screen.height / ih,
    );
    model.scale.set(scale);
    model.position.set(
      (this.app.screen.width - iw * scale) / 2,
      (this.app.screen.height - ih * scale) / 2,
    );
    model.internalModel.coreModel.update();
    this.stage.filters = null;
    this.app.renderer.render(this.stage);
    const w = this.app.screen.width,
      h = this.app.screen.height;
    const scan = document.createElement("canvas");
    scan.width = w;
    scan.height = h;
    const context = scan.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(this.app.view, 0, 0);
    const pixels = context.getImageData(0, 0, w, h).data;
    let left = w,
      top = h,
      right = 0,
      bottom = 0;
    for (let y = 0; y < h; y += 2)
      for (let x = 0; x < w; x += 2)
        if (pixels[(y * w + x) * 4 + 3] > 24) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
    this.bounds =
      right > left
        ? {
            x: (left - model.x) / scale,
            y: (top - model.y) / scale,
            w: (right - left) / scale,
            h: (bottom - top) / scale,
          }
        : { x: 0, y: 0, w: iw, h: ih };
    return this.params;
  }
  resetPhysics() {
    this.cancelWarm();
    this.physics = this.physicsData
      ? window.PIXI.live2d.CubismPhysics.create(
          structuredClone(this.physicsData),
        )
      : null;
    this.lastT = -1;
    this.physicsTick = -1;
    this.physicsOffsets = undefined;
    this.snapshots.clear();
    this.contextProject = undefined;
    this.dirty = true;
    this.warming = false;
  }
  invalidate() {
    this.dirty = true;
  }
  cancelWarm() {
    clearTimeout(this.warmTimer);
    this.warmTimer = undefined;
    this.warmGeneration++;
  }
  scheduleWarm(p: Project, target: number) {
    this.warmGoal = target;
    this.warmProject = p;
    if (this.warmTimer !== undefined) return;
    const generation = this.warmGeneration;
    const step = () => {
      this.warmTimer = undefined;
      if (generation !== this.warmGeneration || !this.model) return;
      const start = performance.now(),
        project = this.warmProject!;
      while (
        this.physicsTick < this.warmGoal &&
        performance.now() - start < 8
      ) {
        this.physicsTick++;
        this.pose(project, this.physicsTick / 60, 1 / 60);
        if (this.physicsTick % 60 === 0) this.snapshot();
      }
      this.warming = this.physicsTick < this.warmGoal;
      this.dirty = true;
      if (this.warming) this.warmTimer = setTimeout(step, 0);
    };
    this.warmTimer = setTimeout(step, 0);
  }
  needsRender(p: Project, t: number) {
    return (
      this.dirty ||
      this.warming ||
      p !== this.lastProject ||
      Math.abs(t - this.lastT) > 1e-7
    );
  }
  snapshot() {
    const particles = this.physics?._physicsRig?.particles;
    if (!particles) return;
    const state = particles.map((p: any) =>
      Object.fromEntries(
        Object.entries(p)
          .filter(
            ([, v]: any) =>
              typeof v === "number" ||
              (v && typeof v.x === "number" && typeof v.y === "number"),
          )
          .map(([k, v]: any) => [
            k,
            typeof v === "number" ? v : { x: v.x, y: v.y },
          ]),
      ),
    );
    this.snapshots.set(this.physicsTick, {
      particles: state,
      offsets: this.physicsOffsets?.slice(),
    });
    if (this.snapshots.size > 180) {
      const oldest = [...this.snapshots.keys()].find((k) => k !== 0);
      if (oldest !== undefined) this.snapshots.delete(oldest);
    }
  }
  restore(target: number) {
    this.cancelWarm();
    const tick = Math.max(
      -1,
      ...[...this.snapshots.keys()].filter((t) => t <= target),
    );
    const saved = this.snapshots.get(tick);
    this.physics = this.physicsData
      ? window.PIXI.live2d.CubismPhysics.create(this.physicsData)
      : null;
    this.physicsTick = saved ? tick : -1;
    this.physicsOffsets = saved?.offsets?.slice();
    if (saved) {
      const parts = this.physics._physicsRig.particles;
      saved.particles.forEach((s: any, i: number) => {
        for (const [k, v] of Object.entries(s)) {
          if (typeof v === "number") parts[i][k] = v;
          else Object.assign(parts[i][k], v);
        }
      });
    }
  }
  pose(p: Project, t: number, dt: number) {
    if (!this.model) return;
    const core = this.model.internalModel.coreModel;
    const raw = core._model;
    raw.parameters.values.set(raw.parameters.defaultValues);
    if (this.partDefaults) raw.parts.opacities.set(this.partDefaults);
    if (this.contextProject !== p) {
      this.context = evaluationContext(p, this.params);
      this.contextProject = p;
    }
    const ev = evaluate(p, this.params, t, this.context);
    Object.assign(ev.parameters, this.previewOverrides);
    for (let i = 0; i < this.params.length; i++) {
      const id = this.params[i].id;
      raw.parameters.values[i] = ev.parameters[id] ?? this.params[i].default;
    }
    if (ev.model.EyeBlink !== undefined)
      for (const id of this.modelGroups.find((g) => g.Name === "EyeBlink")
        ?.Ids || [])
        core.setParameterValueById(
          id,
          (ev.parameters[id] ?? 1) * ev.model.EyeBlink,
        );
    if (ev.model.LipSync !== undefined)
      for (const id of this.modelGroups.find((g) => g.Name === "LipSync")
        ?.Ids || [])
        core.setParameterValueById(
          id,
          (ev.parameters[id] ?? 0) + ev.model.LipSync,
        );
    for (const [id, v] of Object.entries(ev.parts))
      core.setPartOpacityById(id, v);
    if (p.physics && this.physics) {
      if (dt > 0) {
        const before = raw.parameters.values.slice();
        this.physics.evaluate(core, dt);
        this.physicsOffsets = raw.parameters.values.map(
          (v: number, i: number) => v - before[i],
        );
      } else if (this.physicsOffsets) {
        for (let i = 0; i < this.params.length; i++)
          raw.parameters.values[i] += this.physicsOffsets[i];
      }
    }
    this.model.alpha = ev.model.Opacity ?? 1;
  }
  updatePose(p: Project, t: number, exact = false) {
    if (!this.model) return;
    const target = Math.floor(t * 60 + 1e-7),
      start = performance.now();
    if (exact) this.cancelWarm();
    if (t < this.lastT - 1e-7 || this.physicsTick > target)
      this.restore(target);
    this.warming = false;
    if (p.physics && this.physics) {
      while (this.physicsTick < target) {
        if (!exact && performance.now() - start > 5) {
          this.warming = true;
          break;
        }
        this.physicsTick++;
        this.pose(p, this.physicsTick / 60, 1 / 60);
        if (this.physicsTick % 60 === 0) this.snapshot();
      }
      this.pose(p, t, 0);
      if (this.warming && !exact) this.scheduleWarm(p, target);
    } else this.pose(p, t, 0);
    this.model.internalModel.coreModel.update();
    this.lastT = t;
    this.lastProject = p;
    this.dirty = false;
  }
  renderAt(p: Project, t: number, exact = false) {
    if (!this.model) return;
    this.updatePose(p, t, exact);
    const ratio = exact
      ? 1
      : Math.min(1, this.previewLimit / Math.max(p.width, p.height));
    const width = Math.max(1, Math.round(p.width * ratio)),
      height = Math.max(1, Math.round(p.height * ratio));
    if (this.app.screen.width !== width || this.app.screen.height !== height)
      this.app.renderer.resize(width, height);
    const b = this.bounds,
      visibleH = p.view === "bust" ? b.h * 0.47 : b.h;
    const scale =
      Math.min((width - 80 * ratio) / b.w, (height - 70 * ratio) / visibleH) *
      p.transform.scale;
    this.model.pivot.set(b.x + b.w / 2, b.y + visibleH / 2);
    this.model.scale.set(scale);
    this.model.position.set(
      width / 2 + p.transform.x * width,
      height / 2 + p.transform.y * height,
    );
    this.model.rotation = (p.transform.rotation * Math.PI) / 180;
    const e = p.effects;
    const hasEffects =
      e.outline > 0 ||
      e.glow > 0 ||
      e.bloom > 0 ||
      e.brightness !== 1 ||
      e.contrast !== 1 ||
      e.saturation !== 1 ||
      e.lightType !== "off";
    if (hasEffects) {
      if (!this.filter) {
        this.filter = new window.PIXI.Filter(undefined, postFragment, {});
        this.filter.padding = 0;
      }
      if (this.stage.filters?.[0] !== this.filter)
        this.stage.filters = [this.filter];
      const u = this.filter.uniforms;
      if (this.filter._effects !== e || this.filter._ratio !== ratio) {
        Object.assign(u, {
          outline: e.outline,
          outlineColor: rgb(e.outlineColor),
          glow: e.glow,
          glowColor: rgb(e.glowColor),
          bloom: e.bloom,
          brightness: e.brightness,
          contrast: e.contrast,
          saturation: e.saturation,
          lightType: { off: 0, point: 1, area: 2, sun: 3 }[e.lightType],
          lightPosition: [e.lightX, e.lightY],
          lightIntensity: e.lightIntensity,
          lightColor: rgb(e.lightColor),
          rim: e.rim,
          gloss: e.gloss,
          pixelScale: ratio,
        });
        this.filter._effects = e;
        this.filter._ratio = ratio;
      }
      this.stage.filterArea = new window.PIXI.Rectangle(0, 0, width, height);
    } else if (this.stage.filters) this.stage.filters = null;
    this.app.renderer.render(this.stage);
  }
  png(): Promise<Blob> {
    return new Promise((resolve, reject) =>
      this.app.view.toBlob(
        (b: Blob) => (b ? resolve(b) : reject(Error("无法读取画布"))),
        "image/png",
      ),
    );
  }
  destroy() {
    this.loadSequence++;
    this.cancelWarm();
    this.detachMemory?.();
    this.model?.destroy();
    if (this.ownsApp) this.app.destroy(true);
    else this.stage.destroy({ children: false });
  }
}
