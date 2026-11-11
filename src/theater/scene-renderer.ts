import { StudioRenderer, postFragment } from "../renderer";
import { Project } from "../types";
import { lensFragment, gaussianSettings } from "./lens-blur";
import { media } from "../api";
import {
  Layer,
  Scene,
  SceneEffects,
  sceneEffects,
  MAX_SCENE_LIGHTS,
} from "./schema";
import { worldLights, lightUniforms, normalize } from "./lighting";
import { sceneVertex, sceneFragment } from "./lighting-shader";
import { depthOrder, planeQuad, type DepthPolygon } from "./depth-order";
import { titlePose } from "./text-motion";
import { lookFragment, neutralLook } from "./model-look";
import { shaderOpIndex, stylizeFragment, validateShaderRecipe, type ShaderRecipe } from "./stylize";
import { graphOrder, type EffectGraph } from "./effect-graph";
import { checkedGraph, graphFilter } from "./effect-graph-shader";
import { GraphText } from "./effect-graph-text";
import { CodeShaderRuntime } from "./code-shader";
import { HybridGraphRuntime } from "./hybrid-graph";
import { shapeSvg } from "./shape";
import type { CodeShader } from "../../backend/shader-format.mjs";
import type { GizmoAxis, OverlayFrame } from "./ViewportOverlay";
import { pivotOf, selectionRoots } from "./viewport-selection";
import { clippedStroke, planeRay } from "./view-occlusion";
import {
  Orbit,
  Vec3,
  NEAR,
  cameraPoint,
  clipNear,
  orbitProjection,
  outputProjection,
  point3,
  projectView,
  viewportFocal,
} from "./viewport";
import {
  animatedCamera,
  animatedLayer,
  dofBlur,
  layerAlpha,
  layerVisible,
  modelProject,
  spatialLayer,
  textAt,
  visualClip,
  localLayerTime,
  sampleKeys,
  worldMatrix,
} from "./scene-engine";
const neutralPreprocess = sceneEffects();
const checkedRecipes = new WeakMap<object, ShaderRecipe | null>();
function checkedRecipe(recipe?: ShaderRecipe) {
  if (!recipe || typeof recipe !== "object") return null;
  if (!checkedRecipes.has(recipe)) {
    try { checkedRecipes.set(recipe, validateShaderRecipe(recipe)); }
    catch { checkedRecipes.set(recipe, null); }
  }
  return checkedRecipes.get(recipe);
}
const effectFragment = postFragment
  .replace(
    "uniform float pixelScale;",
    "uniform float pixelScale; uniform float effectMix;",
  )
  .replace(
    " gl_FragColor=vec4(clamp(color,0.0,1.0)*a+back*(1.0-a),a+backA*(1.0-a));",
    " gl_FragColor=mix(src,vec4(clamp(color,0.0,1.0)*a+back*(1.0-a),a+backA*(1.0-a)),effectMix);",
  );
const rgb = (h: string) =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
type Node = {
  mesh: any;
  rt?: any;
  runtime?: StudioRenderer;
  texture?: any;
  shapeTexture?: any;
  shapeKey?: string;
  shapeLoad?: Promise<void>;
  text?: any;
  textKey?: string;
  textFrame?: string;
  textGroup?: any;
  textMask?: any;
  textEchoes?: any[];
  graphic?: any;
  size?: string;
  source?: string;
  modelDeps?: unknown[];
  modelP?: Project;
  defaults?: number[];
  filter?: any;
  blur?: any;
  lens?: any;
  stylizers?: any[];
  graphFilter?: ReturnType<typeof graphFilter>;
  graphText?: GraphText;
  graphPreview?: string;
  lookFilter?: any;
  group?: any;
  wrap?: any;
  pre?: Node;
  preprocess?: unknown;
  gizmoText?: any;
  depthRT?: any;
  depthMeshes?: ({ mesh: any; filtered: boolean } | undefined)[];
  mirrorDepth?: Pick<Node, "depthRT" | "depthMeshes">;
  alphaMask?: { texture: any; bucket: number; pixels: Uint8Array };
};
type Hit = { id: string; points: { x: number; y: number }[]; z: number };
export type ViewSnapshot = {
  host: HTMLElement;
  width: number;
  height: number;
  scale: number;
  hits: Hit[];
  pickHits: Hit[];
  projection: ReturnType<typeof outputProjection>;
  frame: {x:number;y:number;w:number;h:number};
  spatial: boolean;
};
export type MirrorView = {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  view: { panX: number; panY: number; zoom: number };
  spatial: boolean;
  orbit?: Orbit;
  onOverlay: (frame: OverlayFrame) => void;
  key?: string;
  snapshot?: ViewSnapshot;
};
type Surface = {
  l: Layer;
  n: Node;
  quad: ReturnType<typeof planeQuad>;
  projection: ReturnType<typeof outputProjection>;
  alpha: number;
};
export class SceneRenderer {
  graphPreview?: { source: EffectGraph; output: string };
  shaderPreview?: { sceneId: string; target: string; graph: EffectGraph };
  readonly codeShaders: CodeShaderRuntime;
  private readonly hybrid: HybridGraphRuntime;
  private effectSize = [1, 1];
  private effectTime = 0;
  app: any;
  host: HTMLElement;
  nodes = new Map<string, Node>();
  composition: any;
  matte: any;
  guides: any;
  grid: any;
  gridKey = "";
  orbit?: Orbit;
  orbitEnabled = false;
  showGrid = true;
  showCamera = true;
  checker: any;
  depthStage: any;
  onOverlay?: (frame: OverlayFrame) => void;
  overlayKey = "";
  dark = false;
  private guideAccent = 0x1b1b1b;
  checkerCanvas: HTMLCanvasElement;
  revision = 0;
  lastScene?: Scene;
  lastT = -1;
  dirty = true;
  busy = false;
  previewLimit = 960;
  selected = "";
  selectedIds: string[] = [];
  snapshot?: ViewSnapshot;
  modelScale?: number;
  sharedBuffer?: [number, number];
  mirroring = false;
  maskRT?: any;
  maskSprite?: any;
  view = { panX: 0, panY: 0, zoom: 1 };
  hits: Hit[] = [];
  pickHits: Hit[] = [];
  frame = { x: 0, y: 0, w: 0, h: 0 };
  scale = 1;
  loading = new Set<string>();
  loadedFonts = new Set<string>();
  onLoad?: () => void;
  frameCount = 0;
  motionPreview?: {
    layerId: string;
    project: Project;
    time: number;
    stage?: Scene;
    orbit?: Orbit;
  };
  exportBackground?: string;
  exportFill: any;
  exactFrame = false;
  private compositeTexture?: any;
  private compositeSprite?: any;
  private compositeSource?: HTMLCanvasElement;
  constructor(host: HTMLElement) {
    this.host = host;
    const P = window.PIXI;
    this.app = new P.Application({
      width: 800,
      height: 500,
      resolution: 1,
      antialias: true,
      autoStart: false,
      backgroundAlpha: 0,
      preserveDrawingBuffer: true,
    });
    this.app.stop();
    this.codeShaders = new CodeShaderRuntime(this.app.renderer);
    this.hybrid = new HybridGraphRuntime(this.codeShaders);
    host.append(this.app.view);
    this.app.view.setAttribute("aria-label", "小剧场场景画布");
    this.matte = new P.Container();
    this.exportFill = new P.Graphics();
    this.composition = new P.Container();
    this.guides = new P.Graphics();
    this.grid = new P.Graphics();
    this.depthStage = new P.Container();
    const c = document.createElement("canvas");
    this.checkerCanvas = c;
    c.width = c.height = 20;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 20, 20);
    ctx.fillStyle = "#e4e4e4";
    ctx.fillRect(0, 0, 10, 10);
    ctx.fillRect(10, 10, 10, 10);
    this.checker = new P.TilingSprite(P.Texture.from(c), 1, 1);
    this.matte.addChild(this.checker);
    this.app.stage.addChild(
      this.exportFill,
      this.matte,
      this.grid,
      this.composition,
      this.guides,
    );
  }
  invalidate() {
    this.dirty = true;
  }
  textureAlpha(n: Node, texture: any, u: number, v: number, bucket: number) {
    if (!texture?.baseTexture) return 0;
    if (
      !n.alphaMask ||
      n.alphaMask.texture !== texture ||
      n.alphaMask.bucket !== bucket
    ) {
      const P = window.PIXI;
      this.maskRT ??= P.RenderTexture.create({
        width: 32,
        height: 32,
        resolution: 1,
      });
      this.maskSprite ??= new P.Sprite();
      this.maskSprite.texture = texture;
      this.maskSprite.width = 32;
      this.maskSprite.height = 32;
      this.app.renderer.render(this.maskSprite, {
        renderTexture: this.maskRT,
        clear: true,
      });
      n.alphaMask = {
        texture,
        bucket,
        pixels: this.app.renderer.extract.pixels(this.maskRT),
      };
    }
    return (
      n.alphaMask.pixels[
        (Math.min(31, Math.floor(v * 32)) * 32 +
          Math.min(31, Math.floor(u * 32))) *
          4 +
          3
      ] / 255
    );
  }
  setAppearance(dark: boolean, accent: number) {
    if (Number.isFinite(accent) && this.guideAccent !== accent) {
      this.guideAccent = accent;
      this.invalidate();
    }
    if (this.dark === dark) return;
    this.dark = dark;
    const ctx = this.checkerCanvas.getContext("2d")!;
    ctx.fillStyle = dark ? "#2a2a2a" : "#ffffff";
    ctx.fillRect(0, 0, 20, 20);
    ctx.fillStyle = dark ? "#202020" : "#e4e4e4";
    ctx.fillRect(0, 0, 10, 10);
    ctx.fillRect(10, 10, 10, 10);
    this.checker.texture.baseTexture.update();
    this.gridKey = "";
    this.invalidate();
  }
  get viewportOrbit() {
    return this.orbitEnabled
      ? (this.motionPreview?.orbit ?? this.orbit)
      : undefined;
  }
  renderViews(s: Scene, t: number, mirror?: MirrorView) {
    if (!mirror) {
      this.renderAt(s, t);
      return;
    }
    const estimate = (host: HTMLElement, zoom: number) => {
      const { width, height } = host.getBoundingClientRect();
      const res = Math.min(1, this.previewLimit / Math.max(1, width, height));
      return Math.max(
        0.1,
        Math.min((width - 60) / s.width, (height - 60) / s.height) * res * zoom,
      );
    };
    this.modelScale = Math.max(
      estimate(this.host, this.orbitEnabled ? 1 : this.view.zoom),
      estimate(mirror.host, mirror.spatial ? 1 : mirror.view.zoom),
    );
    const dimensions = (host: HTMLElement) => {
      const { width, height } = host.getBoundingClientRect(),
        res = Math.min(1, this.previewLimit / Math.max(1, width, height));
      return [
        Math.max(1, Math.round(width * res)),
        Math.max(1, Math.round(height * res)),
      ];
    };
    const main = dimensions(this.host),
      alt = dimensions(mirror.host);
    this.sharedBuffer = [Math.max(main[0], alt[0]), Math.max(main[1], alt[1])];
    const old = {
      host: this.host,
      view: this.view,
      orbit: this.orbit,
      orbitEnabled: this.orbitEnabled,
      onOverlay: this.onOverlay,
      overlayKey: this.overlayKey,
      snapshot: this.snapshot,
      frameCount: this.frameCount,
    };
    try {
      this.host = mirror.host;
      this.view = mirror.view;
      this.orbit = mirror.orbit;
      this.orbitEnabled = mirror.spatial;
      this.onOverlay = mirror.onOverlay;
      this.overlayKey = mirror.key || "";
      this.mirroring = true;
      this.renderAt(s, t);
      mirror.key = this.overlayKey;
      mirror.snapshot = this.snapshot;
      const cv = mirror.canvas,
        w = mirror.snapshot!.width,
        h = mirror.snapshot!.height;
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
      const ctx = cv.getContext("2d")!;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(this.app.view, 0, 0, w, h);
    } catch (e) {
      this.sharedBuffer = undefined;
      this.modelScale = undefined;
      throw e;
    } finally {
      Object.assign(this, old);
      this.mirroring = false;
    }
    try {
      this.renderAt(s, t);
    } finally {
      this.modelScale = undefined;
      this.sharedBuffer = undefined;
    }
  }
  setViewportOrbit(orbit: Orbit) {
    if (this.motionPreview?.stage) this.motionPreview.orbit = orbit;
    else this.orbit = orbit;
    this.invalidate();
  }
  needsRender(s: Scene, t: number) {
    const rendered = this.motionPreview?.stage ?? s;
    return (
      this.dirty ||
      s !== this.lastScene ||
      Math.abs(t - this.lastT) > 1e-7 ||
      rendered.layers.some(
        (l) =>
          layerVisible(rendered, l, t) &&
          (this.nodes.get(l.id)?.runtime?.warming ||
            this.nodes.get(l.id)?.runtime?.dirty),
      )
    );
  }
  private resourceQueue=Promise.resolve();
  ensure(s:Scene,retain?:Scene) {
    const task=this.resourceQueue.then(()=>this.ensureResources(s,retain));
    this.resourceQueue=task.catch(()=>{});
    return task;
  }
  private async ensureResources(s: Scene, retain?: Scene) {
    const P = window.PIXI;
    const ids = new Set([...s.layers,...(retain?.layers ?? [])].map((l) => l.id));
    for (const [id, n] of this.nodes)
      if (
        !ids.has(id) &&
        !(
          id.startsWith("@preprocess:") &&
          s.models.some((r) => "@preprocess:" + r.id === id)
        )
      ) {
        n.runtime?.destroy();
        n.shapeTexture?.destroy(true);
        n.mesh?.destroy({ children: false });
        n.rt?.destroy(true);
        n.depthRT?.destroy(true);
        for (const piece of n.depthMeshes || []) piece?.mesh.destroy();
        n.mirrorDepth?.depthRT?.destroy(true);
        for (const piece of n.mirrorDepth?.depthMeshes || [])
          piece?.mesh.destroy();
        if (n.textEchoes) for (const echo of n.textEchoes) echo.destroy();
        n.textGroup?.destroy({ children: true });
        n.filter?.destroy();
        n.blur?.destroy();
        n.lens?.destroy();
        for (const filter of n.stylizers ?? []) filter.destroy();
        n.graphFilter?.filter.destroy();
        n.graphText?.destroy();
        n.pre?.filter?.destroy();
        n.pre?.blur?.destroy();
        n.pre?.lens?.destroy();
        n.pre?.lookFilter?.destroy();
        for (const filter of n.pre?.stylizers ?? []) filter.destroy();
        n.pre?.graphFilter?.filter.destroy();
        n.gizmoText?.destroy();
        this.nodes.delete(id);
      }
    await Promise.all(
      s.layers.map(async (l) => {
        let n = this.nodes.get(l.id);
        if (!n) {
          n = { mesh: null };
          this.nodes.set(l.id, n);
        }
        if (l.kind === "model" && l.model) {
          const resource = s.models.find((r) => r.id === l.model!.resourceId);
          if (!resource) return;
          const path=resource.modelId+"/"+resource.file;
          const textures=Object.fromEntries(Object.entries(resource.textureOverrides??{}).flatMap(([index,id])=>{
            const asset=s.assets.find(a=>a.id===id && a.kind==="image");
            return asset ? [[index,new URL(media(asset.path),location.href).href]] : [];
          }));
          const source=path+"|"+JSON.stringify(textures);
          if (n.source !== source && !this.loading.has(l.id)) {
            this.loading.add(l.id);
            try {
              n.runtime?.destroy();
              const r = new StudioRenderer(undefined, this.app);
              n.runtime = r;
              await r.load(
                new URL(media("models/" + path), location.href).href,textures,
              );
              n.defaults = r.params.map((p) => p.default);
              n.source = source;
              n.modelDeps = undefined;
            } finally {
              this.loading.delete(l.id);
              this.invalidate();
              this.onLoad?.();
            }
          }
        }
        if (l.kind === "image") {
          const a = s.assets.find((a) => a.id === l.assetId);
          if (a && n.source !== a.path) {
            n.source = a.path;
            n.texture = await P.Texture.fromURL(media(a.path));
            this.invalidate();
          }
        }
        if (l.kind==="color" && l.shape) {
          const key=JSON.stringify([l.shape,l.width,l.height]);
          const node=n, shape=l.shape;
          if(node.shapeKey!==key) {
            node.shapeKey=key;
            node.shapeLoad=(async()=>{
              const image=new Image();
              image.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(shapeSvg(shape,l.width,l.height));
              await image.decode();
              if(node.shapeKey!==key || this.nodes.get(l.id)!==node) return;
              node.shapeTexture?.destroy(true);
              node.shapeTexture=P.Texture.from(image);
              this.invalidate();
            })().catch(e=>{
              if(node.shapeKey!==key || this.nodes.get(l.id)!==node) return;
              node.shapeKey=undefined;
              throw e;
            });
          }
          await node.shapeLoad;
        }
      }),
    );
    for (const a of s.assets.filter((a) => a.kind === "font")) {
      if (this.loadedFonts.has(a.path)) continue;
      try {
        const font = new FontFace(a.fontFamily!, `url("${media(a.path)}")`);
        await font.load();
        document.fonts.add(font);
        this.loadedFonts.add(a.path);
        for (const n of this.nodes.values()) n.textKey = undefined;
        this.invalidate();
      } catch {}
    }
  }
  makeMesh(n: Node, l: Layer, texture: any) {
    const P = window.PIXI,
      key = l.width + "x" + l.height;
    if (!n.mesh) {
      const geometry = new P.Geometry()
        .addAttribute("aVertexPosition", new Float32Array(8), 2)
        .addAttribute(
          "aTextureCoord",
          new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
          2,
        )
        .addIndex([0, 1, 2, 0, 2, 3]);
      const shader = P.Shader.from(sceneVertex, sceneFragment, {
        uModel: new Float32Array(16),
        uCamera: new Float32Array(4),
        uViewRotation: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
        uOrbit: 0,
        uClipDepth: 0,
        uFocal: 1200,
        uSampler: texture,
        uAlpha: 1,
        uLighting: 0,
        uLightCount: 0,
        uTexel: [1, 1],
        uViewPosition: [0, 0, -1200],
        uPlaneRight: [1, 0, 0],
        uPlaneUp: [0, 1, 0],
        uMaterial: [0.55, 0.25, 0.25, 0],
        uAmbient: [1, 1, 1, 0.7],
        uExposure: 1,
        uLightPos: new Float32Array(MAX_SCENE_LIGHTS * 4),
        uLightColor: new Float32Array(MAX_SCENE_LIGHTS * 4),
        uLightDir: new Float32Array(MAX_SCENE_LIGHTS * 4),
        uLightRight: new Float32Array(MAX_SCENE_LIGHTS * 4),
        uLightUp: new Float32Array(MAX_SCENE_LIGHTS * 4),
        uLightParams: new Float32Array(MAX_SCENE_LIGHTS * 4),
      });
      n.mesh = new P.Mesh(geometry, shader);
      n.mesh.state.culling = false;
    }
    if (n.size !== key) {
      n.mesh.geometry
        .getBuffer("aVertexPosition")
        .update(
          new Float32Array([
            -l.width / 2,
            -l.height / 2,
            l.width / 2,
            -l.height / 2,
            l.width / 2,
            l.height / 2,
            -l.width / 2,
            l.height / 2,
          ]),
        );
      n.size = key;
    }
    n.mesh.shader.uniforms.uSampler = texture;
    return n.mesh;
  }
  effects(
    n: Node,
    e: SceneEffects,
    strength: number,
    scale: number,
    extraBlur = 0,
    dofMode: "gaussian" | "lens" = "lens",
  ) {
    const P = window.PIXI,
      filters = [];
    const enabled =
      e.outline > 0 ||
      e.glow > 0 ||
      e.bloom > 0 ||
      e.brightness !== 1 ||
      e.contrast !== 1 ||
      e.saturation !== 1 ||
      e.lightType !== "off";
    if (enabled) {
      if (!n.filter) n.filter = new P.Filter(undefined, effectFragment, {});
      Object.assign(n.filter.uniforms, {
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
        pixelScale: scale,
        effectMix: strength,
      });
      filters.push(n.filter);
    }
    const blur =
      (e.blurMode === "lens" ? 0 : e.blur * strength) * scale +
      (dofMode === "gaussian" ? extraBlur * scale : 0);
    if (blur > 0.15) {
      const settings = gaussianSettings(blur, this.exactFrame);
      if (!n.blur)
        n.blur = new P.filters.BlurFilter(blur, settings.quality, 1, 15);
      n.blur.quality = settings.quality;
      n.blur.blur = blur;
      filters.push(n.blur);
    }
    const lensRadius =
      ((e.blurMode === "lens" ? e.blur * strength : 0) +
        (dofMode === "lens" ? extraBlur : 0)) *
      scale;
    if (lensRadius > 0.15) {
      if (!n.lens)
        n.lens = new P.Filter(undefined, lensFragment, {
          radius: lensRadius,
          samples: 32,
          highlight: 0,
        });
      n.lens.padding = Math.ceil(lensRadius + 2);
      n.lens.resolution = 1;
      Object.assign(n.lens.uniforms, {
        radius: lensRadius,
        samples: this.exactFrame ? 64 : 32,
        highlight: e.bokeh ?? 0.25,
      });
      filters.push(n.lens);
    }
    const checked = checkedGraph(e.graph);
    const graph = checked?.kind === "post" ? checked : null;
    const output = (!this.exactFrame && this.graphPreview?.source === e.graph ? this.graphPreview?.output : undefined) ?? graph?.output;
    const order = graph && output ? graphOrder(graph,output) : [];
    const recipe = graph
      ? order.length && order.every(node => node.op === "legacy")
        ? { name:graph.name, passes:order.map(node => node.inputs.pass as ShaderRecipe["passes"][number]) }
        : null
      : checkedRecipe(e.stylize);
    const mix = Math.min(1, Math.max(0, (Number.isFinite(e.stylizeMix) ? e.stylizeMix! : 1) * strength));
    if (recipe && mix > 0) {
      n.stylizers ??= [];
      recipe.passes.forEach((pass, i) => {
        if (pass.amount === 0) return;
        const filter = n.stylizers![i] ??= new P.Filter(undefined, stylizeFragment, {});
        const matrix = pass.matrix ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
        Object.assign(filter.uniforms, {
          mode: shaderOpIndex(pass.op), mixAmount: pass.amount * mix,
          pixelScale: scale, effectScale: pass.scale, frameTime: this.effectTime,
          darkColor: rgb(pass.dark), lightColor: rgb(pass.light),
          rowR: matrix.slice(0, 3), rowG: matrix.slice(3, 6), rowB: matrix.slice(6), bias: pass.bias ?? [0, 0, 0],
        });
        filters.push(filter);
      });
    }
    if (graph && output && output !== "$source" && !recipe && mix > 0) {
      if (order.some(node => node.op === "glsl"))
        filters.push(this.hybrid.filter(n,graph,output,this.effectTime,mix,scale,this.effectSize,e.graphValues));
      else {
        n.graphFilter = graphFilter(n.graphFilter,graph,output,this.effectTime,mix,scale,e.graphValues);
        filters.push(n.graphFilter.filter);
      }
    }
    const shader = this.codeShaders.filter(n, e.codeShader, this.effectTime, this.effectSize[0], this.effectSize[1], strength);
    if (shader) filters.push(shader);
    return filters.length ? filters : null;
  }
  poseModel(
    n: Node,
    l: Layer,
    s: Scene,
    t: number,
    exact: boolean,
    scale: number,
  ) {
    if (!n.runtime?.model || !n.defaults || this.loading.has(l.id)) return null;
    const r = n.runtime,
      resource = s.models.find((a) => a.id === l.model!.resourceId);
    const relevant = s.tracks.flatMap((tr) => [
      tr.muted,
      tr.solo,
      ...tr.clips.filter(
        (c) =>
          c.layerId === l.id || (c.kind === "audio" && c.lipTarget === l.id),
      ),
    ]);
    const audition =
      !exact && this.motionPreview?.layerId === l.id
        ? this.motionPreview
        : undefined;
    const deps = [
      l.model,
      resource?.assets,
      resource?.file,
      resource?.modelId,
      s.duration,
      audition?.project,
      ...relevant,
    ];
    const changed =
      !n.modelDeps ||
      deps.length !== n.modelDeps.length ||
      deps.some((v, i) => v !== n.modelDeps![i]);
    if (changed) {
      r.resetPhysics();
      n.modelP = audition?.project || modelProject(s, l);
      n.modelDeps = deps;
      r.params.forEach(
        (p, i) => (p.default = l.model!.baseValues[p.id] ?? n.defaults![i]),
      );
    }
    const limit = exact ? 4096 : 900,
      quality = Math.min(exact ? 1.6 : 1.25, Math.max(0.4, scale)),
      factor = Math.min(quality, limit / Math.max(l.width, l.height)),
      w = Math.max(32, Math.ceil(l.width * factor)),
      h = Math.max(32, Math.ceil(l.height * factor));
    const resized = !n.rt || n.rt.width !== w || n.rt.height !== h;
    const preprocessing =
      resource?.preprocess?.enabled === false
        ? neutralPreprocess
        : resource?.preprocess?.effects || neutralPreprocess;
    const look = resource?.preprocess?.enabled === false ? undefined : resource?.preprocess?.look;
    const graphPreview = !exact && this.graphPreview?.source === preprocessing.graph ? this.graphPreview?.output : undefined;
    const preChanged = n.preprocess !== resource?.preprocess || n.graphPreview !== graphPreview;
    if (resized) {
      n.rt?.destroy(true);
      n.rt = window.PIXI.RenderTexture.create({
        width: w,
        height: h,
        resolution: 1,
      });
    }
    if (
      changed ||
      resized ||
      preChanged ||
      r.needsRender(n.modelP!, audition?.time ?? t) ||
      exact
    ) {
      r.updatePose(n.modelP!, audition?.time ?? t, exact);
      const b = r.bounds,
        k = Math.min((w * 0.96) / b.w, (h * 0.96) / b.h);
      r.model.pivot.set(b.x + b.w / 2, b.y + b.h / 2);
      r.model.scale.set(k);
      r.model.position.set(w / 2, h / 2);
      r.model.rotation = 0;
      n.pre = n.pre || { mesh: null };
      const preFilters = this.effects(n.pre, preprocessing, 1, factor) ?? [];
      if (look) {
        const safe = { ...neutralLook };
        for (const id of Object.keys(safe) as (keyof typeof safe)[]) {
          if (Number.isFinite(look[id])) {
            const [min, max] = id === "exposure" ? [-2, 2] : [0, 1];
            safe[id] = Math.max(min, Math.min(max, look[id]));
          }
        }
        if (Object.values(safe).some(v => v !== 0)) {
          n.pre.lookFilter ??= new window.PIXI.Filter(undefined, lookFragment, {});
          Object.assign(n.pre.lookFilter.uniforms, safe, { pixelScale: factor });
          preFilters.unshift(n.pre.lookFilter);
        }
      }
      r.stage.filters = preFilters.length ? preFilters : null;
      r.stage.filterArea = new window.PIXI.Rectangle(0, 0, w, h);
      this.app.renderer.render(r.stage, { renderTexture: n.rt, clear: true });
      n.preprocess = resource?.preprocess;
      n.graphPreview = graphPreview;
    }
    return n.rt;
  }
  textTexture(n: Node, l: Layer, s: Scene, t: number) {
    const P = window.PIXI,
      value = textAt(s, l, t),
      style = l.text!,
      {graph: graphDefinition,...textStyle} = style,
      key = JSON.stringify([value, textStyle, l.width, l.height]);
    if (n.textKey !== key) {
      if (!n.text) {
        n.text = new P.Text("", {});
        n.text.anchor.set(.5);
        n.textGroup = new P.Container();
        n.textGroup.addChild(n.text);
      }
      n.text.text = value;
      n.text.style = new P.TextStyle({
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fill: style.fill,
        align: style.align,
        stroke: style.stroke,
        strokeThickness: style.strokeWidth,
        lineHeight: style.fontSize * 1.35,
        wordWrap: true,
        wordWrapWidth: Math.max(20, l.width - 20),
        breakWords: true,
        padding: 10,
      });
      if (!n.rt || n.rt.width !== l.width || n.rt.height !== l.height) {
        n.rt?.destroy(true);
        n.rt = P.RenderTexture.create({
          width: Math.max(1, l.width),
          height: Math.max(1, l.height),
          resolution: 1,
        });
      }
      n.textKey = key;
      n.textFrame = undefined;
    }
    const clip = visualClip(s, l.id, t);
    const local = localLayerTime(s,l,t);
    const remaining = clip ? (clip.start + clip.duration - t) * Math.abs(clip.speed) : Infinity;
    const graph = checkedGraph(graphDefinition);
    if (graph?.kind === "text") {
      const overrides = Object.fromEntries(Object.entries(graph.parameters).map(([id,p]) =>
        [id,sampleKeys(l.animation["textGraph."+id],local,p.value)]));
      const output = (!this.exactFrame && this.graphPreview?.source === style.graph ? this.graphPreview?.output : undefined) ?? graph.output;
      n.graphText ??= new GraphText();
      return n.graphText.render(this.app.renderer,n.rt,graph,output,key,value,n.text.style,l.width,l.height,local,remaining,overrides);
    }
    if (n.graphText) {
      n.graphText.destroy();
      n.graphText = undefined;
      n.textFrame = undefined;
    }
    const pose = titlePose(
      style.animation, style.exit, local, remaining,
      style.fontSize, style.entranceDuration, style.exitDuration, style.motionAmount,
    );
    const frame = JSON.stringify(pose);
    if (n.textFrame === frame) return n.rt;
    n.textFrame = frame;
    n.text.scale.set(1);
    const w = n.text.width, h = n.text.height;
    const x = style.align === "center" ? l.width / 2 : style.align === "right" ? l.width - w / 2 - 10 : w / 2 + 10;
    const y = Math.max(0, (l.height - h) / 2) + h / 2;
    n.text.position.set(x + pose.x, y + pose.y);
    n.text.scale.set(pose.scale);
    n.text.rotation = pose.angle;
    n.text.alpha = pose.alpha;
    if (pose.reveal < 1) {
      if (!n.textMask) {
        n.textMask = new P.Graphics();
        n.textGroup.addChild(n.textMask);
      }
      n.textMask.clear().beginFill(0xffffff)
        .drawRect(x - w / 2, 0, Math.max(0.001, w * pose.reveal), l.height).endFill();
      n.text.mask = n.textMask;
    } else if (n.textMask) {
      n.text.mask = null;
      n.textMask.clear();
    }
    if (pose.echo > .05 && !n.textEchoes) {
      n.textEchoes = [0xff456c, 0x30e6ff].map(tint => {
        const sprite = new P.Sprite(n.text.texture);
        sprite.anchor.set(.5);
        sprite.tint = tint;
        n.textGroup.addChildAt(sprite, 0);
        return sprite;
      });
    }
    n.textEchoes?.forEach((echo, i) => {
      echo.visible = pose.echo > .05;
      echo.position.set(n.text.x + (i ? 1 : -1) * pose.echo, n.text.y);
      echo.scale.set(pose.scale);
      echo.rotation = pose.angle;
      echo.alpha = Math.min(.58, pose.echo / 16) * pose.alpha;
      echo.mask = n.text.mask;
    });
    this.app.renderer.render(n.textGroup, { renderTexture: n.rt, clear: true });
    return n.rt;
  }
  renderAt(s: Scene, t: number, exact = false, capture = false, omitShaderDraft = false,
    output?: {maxEdge?:number;composite?:HTMLCanvasElement}) {
    const source = s;
    const audition =
      !exact && !capture && !output && s.id !== "@preprocessing" ? this.motionPreview : undefined;
    if (audition?.stage) s = audition.stage;
    const orbit =
      !exact && !capture && !output && s.id !== "@preprocessing" ? this.viewportOrbit : undefined;
    this.exactFrame = exact;
    this.effectTime = t;
    this.effectSize = [s.width, s.height];
    const shaderPreview = !exact && !omitShaderDraft && this.shaderPreview?.sceneId === source.id ? this.shaderPreview : undefined;
    const P = window.PIXI;
    let w: number, h: number, scale: number, cx: number, cy: number;
    if (exact || capture || output) {
      const limit=output?.maxEdge ?? (capture ? 360 : Infinity);
      scale = Math.min(1, limit / Math.max(s.width, s.height));
      w = Math.max(1, Math.round(s.width * scale));
      h = Math.max(1, Math.round(s.height * scale));
      cx = w / 2;
      cy = h / 2;
    } else {
      const rect = this.host.getBoundingClientRect(),
        res = Math.min(
          1,
          this.previewLimit / Math.max(1, rect.width, rect.height),
        );
      w = Math.max(1, Math.round(rect.width * res));
      h = Math.max(1, Math.round(rect.height * res));
      scale =
        Math.max(0.001,Math.min((w - 60 * res) / s.width, (h - 60 * res) / s.height)) *
        (orbit ? 1 : this.view.zoom);
      cx = w / 2 + (orbit ? 0 : this.view.panX * res);
      cy = h / 2 + (orbit ? 0 : this.view.panY * res);
    }
    const [bufferW, bufferH] =
      !exact && !output && this.sharedBuffer ? this.sharedBuffer : [w, h];
    if (this.app.screen.width !== bufferW || this.app.screen.height !== bufferH)
      this.app.renderer.resize(bufferW, bufferH);
    this.app.stage.scale.set(bufferW / w, bufferH / h);
    this.scale = scale;
    this.frame = {
      x: cx - (s.width * scale) / 2,
      y: cy - (s.height * scale) / 2,
      w: s.width * scale,
      h: s.height * scale,
    };
    this.matte.visible = !exact && !capture && !output && !orbit;
    this.exportFill.clear();
    this.exportFill.visible = exact && !!this.exportBackground;
    if (this.exportFill.visible)
      this.exportFill
        .beginFill(parseInt(this.exportBackground!.slice(1), 16), 1)
        .drawRect(0, 0, w, h)
        .endFill();
    this.guides.visible = !exact && !capture && !output;
    this.checker.position.set(this.frame.x, this.frame.y);
    this.checker.width = this.frame.w;
    this.checker.height = this.frame.h;
    this.composition.position.set(cx, cy);
    this.composition.scale.set(scale);
    this.composition.removeChildren();
    this.hits = [];
    this.pickHits = [];
    const camera = animatedCamera(s, t);
    const view = orbit
      ? orbitProjection(orbit, viewportFocal(s))
      : outputProjection(camera);
    const onScreen = (p: Vec3) => {
      const q = projectView(p, view);
      return { x: cx + q.x * scale, y: cy + q.y * scale };
    };
    const at = (m: number[], x = 0, y = 0) => {
      const p = cameraPoint(point3(m, x, y), view);
      return p[2] < NEAR ? undefined : onScreen(p);
    };
    const line = (g: any, a: Vec3, b: Vec3) => {
      const pts = clipNear([cameraPoint(a, view), cameraPoint(b, view)], false);
      if (pts.length !== 2) return;
      const [p, q] = pts.map(onScreen);
      g.moveTo(p.x, p.y).lineTo(q.x, q.y);
    };
    this.grid.visible = !!orbit && this.showGrid;
    const gridKey = orbit
      ? JSON.stringify([orbit, w, h, s.width, s.height, scale])
      : "";
    if (orbit && this.showGrid && gridKey !== this.gridKey) {
      this.gridKey = gridKey;
      this.grid.clear();
      const step =
        10 ** Math.floor(Math.log10(Math.max(s.width, s.height) / 8));
      const x0 = Math.round(orbit.target[0] / step) * step,
        z0 = Math.round(orbit.target[2] / step) * step;
      const extent =
        step * Math.max(12, Math.min(35, Math.ceil(orbit.distance / step)));
      const floor = s.height / 2;
      this.grid.lineStyle(
        1,
        this.dark ? 0x707070 : 0xa0a0a0,
        this.dark ? 0.4 : 0.31,
      );
      for (let i = -extent; i <= extent; i += step) {
        line(
          this.grid,
          [x0 + i, floor, z0 - extent],
          [x0 + i, floor, z0 + extent],
        );
        line(
          this.grid,
          [x0 - extent, floor, z0 + i],
          [x0 + extent, floor, z0 + i],
        );
      }
      this.grid.lineStyle(1.5, 0xcb637c, 0.65);
      line(this.grid, [x0 - extent, floor, 0], [x0 + extent, floor, 0]);
      this.grid.lineStyle(1.5, 0x647fce, 0.65);
      line(this.grid, [0, floor, z0 - extent], [0, floor, z0 + extent]);
    }
    const lights = worldLights(s, t);
    const matrices = new Map<string, number[]>();
    const matrixFor = (l: Layer) => {
      let m = matrices.get(l.id);
      if (!m) {
        m = worldMatrix(s, l, t);
        matrices.set(l.id, m);
      }
      return m;
    };
    for (const n of this.nodes.values())
      if (n.gizmoText) n.gizmoText.visible = false;
    const pickPolygon = (item: Surface, vertices: Surface["quad"]) => {
      const points = clipNear(
        vertices.map((v) => cameraPoint(v.position, item.projection)),
      );
      return {
        id: item.l.id,
        z: vertices[0].position[2],
        points: points.map((p) => {
          const q = projectView(p, item.projection);
          return { x: cx + q.x * scale, y: cy + q.y * scale };
        }),
      };
    };
    const slots = new Map<Node, number>(),
      shaded = new Set<Node>();
    const opaquePlanes: Surface[] = [];
    const addPiece = (container: any, piece: DepthPolygon<Surface>) => {
      const { item, vertices, split } = piece,
        { n, l } = item;
      const hit = pickPolygon(item, vertices);
      if (hit.points.length < 3) return;
      this.pickHits.push(hit);
      if (!split) {
        container.addChild(n.mesh);
        return;
      }
      const filtered = !!n.mesh.filters?.length;
      const cache = this.mirroring ? (n.mirrorDepth ??= {}) : n;
      if (filtered && !shaded.has(n)) {
        if (
          !cache.depthRT ||
          cache.depthRT.width !== w ||
          cache.depthRT.height !== h
        ) {
          cache.depthMeshes = cache.depthMeshes?.map((piece) => {
            if (!piece?.filtered) return piece;
            piece.mesh.destroy();
            return undefined;
          });
          cache.depthRT?.destroy(true);
          cache.depthRT = P.RenderTexture.create({
            width: w,
            height: h,
            resolution: 1,
          });
        }
        this.depthStage.position.set(cx, cy);
        this.depthStage.scale.set(scale);
        this.depthStage.addChild(n.mesh);
        const area = n.mesh.filterArea;
        n.mesh.filterArea = new P.Rectangle(0, 0, w, h);
        this.app.renderer.render(this.depthStage, {
          renderTexture: cache.depthRT,
          clear: true,
        });
        this.depthStage.removeChild(n.mesh);
        n.mesh.filterArea = area;
        shaded.add(n);
      }
      const slot = slots.get(n) || 0;
      slots.set(n, slot + 1);
      const pool = (cache.depthMeshes ??= []);
      let entry = pool[slot];
      if (!entry || entry.filtered !== filtered) {
        entry?.mesh.destroy();
        const geometry = new P.MeshGeometry();
        const shader = filtered
          ? new P.MeshMaterial(cache.depthRT)
          : n.mesh.shader;
        entry = pool[slot] = { mesh: new P.Mesh(geometry, shader), filtered };
      }
      const positions = filtered
        ? hit.points.flatMap((p) => [(p.x - cx) / scale, (p.y - cy) / scale])
        : vertices.flatMap((v) => [v.x, v.y]);
      const uvs = filtered
        ? hit.points.flatMap((p) => [p.x / w, p.y / h])
        : vertices.flatMap((v) => [v.x / l.width + 0.5, v.y / l.height + 0.5]);
      const indices = [];
      for (let i = 1; i < positions.length / 2 - 1; i++)
        indices.push(0, i, i + 1);
      entry.mesh.geometry
        .getBuffer("aVertexPosition")
        .update(new Float32Array(positions));
      entry.mesh.geometry
        .getBuffer("aTextureCoord")
        .update(new Float32Array(uvs));
      entry.mesh.geometry.getIndex().update(new Uint16Array(indices));
      container.addChild(entry.mesh);
    };
    const forceStack = (l: Layer) => {
      const seen = new Set<string>();
      let p: Layer | undefined = l;
      while (p && !seen.has(p.id)) {
        if (p.depthMode === "stack") return true;
        seen.add(p.id);
        p = s.layers.find((v) => v.id === p!.parentId);
      }
      return false;
    };
    const childrenOf = (parentId: string | null, seen: Set<string>): Layer[] =>
      s.layers
        .filter(
          (l) =>
            l.parentId === parentId && !seen.has(l.id) && layerVisible(s, l, t),
        )
        .flatMap((l) => {
          const n = this.nodes.get(l.id);
          return l.kind === "group" &&
            n &&
            !this.effects(n, animatedLayer(s, l, t).effects, 1, scale)
            ? childrenOf(l.id, new Set([...seen, l.id]))
            : [l];
        });
    const compose = (parentId: string | null, seen = new Set<string>()) => {
      let container = new P.Container();
      let run: DepthPolygon<Surface>[] = [];
      const flush = () => {
        if (!run.length) return;
        for (const piece of depthOrder(run, view.origin))
          addPiece(container, piece);
        run = [];
      };
      for (const original of childrenOf(parentId, seen)) {
        if (seen.has(original.id) || !layerVisible(s, original, t)) continue;
        const l = animatedLayer(s, original, t),
          n = this.nodes.get(l.id);
        if (!n) continue;
        const effects = shaderPreview?.target === l.id ? { ...l.effects, graph: shaderPreview.graph, codeShader: undefined } : l.effects;
        const alpha = layerAlpha(s, original, t);
        if (alpha <= 0) continue;
        if (l.kind === "adjustment") {
          flush();
          if (!n.wrap) n.wrap = new P.Container();
          n.wrap.removeChildren();
          n.wrap.addChild(container);
          n.wrap.filters = this.effects(n, effects, alpha, scale);
          n.wrap.filterArea = new P.Rectangle(0, 0, bufferW, bufferH);
          const next = new P.Container();
          next.addChild(n.wrap);
          container = next;
          continue;
        }
        if (l.kind === "group") {
          flush();
          const child = compose(l.id, new Set([...seen, l.id]));
          child.filters = this.effects(n, effects, 1, scale);
          child.filterArea = new P.Rectangle(0, 0, bufferW, bufferH);
          container.addChild(child);
          continue;
        }
        if (l.kind === "audio" || l.kind === "light") continue;
        let texture: any;
        if (l.kind === "model")
          texture = this.poseModel(
            n,
            original,
            s,
            t,
            exact,
            (this.modelScale ?? scale) *
              Math.max(l.transform.scaleX, l.transform.scaleY),
          );
        else if (l.kind === "image") texture = n.texture;
        else if (l.kind === "text") texture = this.textTexture(n, l, s, t);
        else if (l.kind === "color" && l.shape) texture=n.shapeTexture;
        else if (l.kind === "color") {
          if (!n.texture || n.source !== l.color) {
            n.texture = P.Texture.WHITE;
            n.source = l.color;
          }
          texture = n.texture;
        }
        if (!texture) continue;
        const mesh = this.makeMesh(n, l, texture),
          matrix = matrixFor(original),
          spatial = spatialLayer(s, original),
          projection =
            orbit || spatial ? view : outputProjection(camera, false);
        Object.assign(mesh.shader.uniforms, {
          uModel: new Float32Array(matrix),
          uCamera: new Float32Array([...projection.origin, projection.zoom]),
          uViewRotation: new Float32Array(projection.rotation),
          uFocal: projection.focal,
          uOrbit: orbit ? 1 : 0,
          uClipDepth: orbit || spatial ? 1 : 0,
          uAlpha: alpha,
          ...lightUniforms(s, l, lights),
          uTexel: [
            2 / Math.max(1, texture.width),
            2 / Math.max(1, texture.height),
          ],
          uViewPosition: projection.origin,
          uPlaneRight: normalize(matrix.slice(0, 3)),
          uPlaneUp: normalize(matrix.slice(4, 7)),
        });
        mesh.tint =
          l.kind === "color" && !l.shape ? P.utils.string2hex(l.color || "#fff") : 0xffffff;
        // A premultiplied color texture carries its own tint; generic mesh shaders do not use Sprite tint.
        if (l.kind === "color" && !l.shape) {
          if (!n.graphic || n.graphic._color !== l.color) {
            const cv = document.createElement("canvas");
            cv.width = cv.height = 2;
            const ctx = cv.getContext("2d")!;
            ctx.fillStyle = l.color || "#fff";
            ctx.fillRect(0, 0, 2, 2);
            n.texture = P.Texture.from(cv);
            n.graphic = { _color: l.color };
            mesh.shader.uniforms.uSampler = n.texture;
          }
        }
        mesh.blendMode = {
          normal: P.BLEND_MODES.NORMAL,
          add: P.BLEND_MODES.ADD,
          multiply: P.BLEND_MODES.MULTIPLY,
          screen: P.BLEND_MODES.SCREEN,
        }[l.blend];
        mesh.filters = this.effects(
          n,
          effects,
          1,
          scale,
          spatial && !orbit ? dofBlur(matrix[14], camera) : 0,
          camera.blurMode || "lens",
        );
        mesh.filterArea = new P.Rectangle(0, 0, bufferW, bufferH);
        const quad = planeQuad(matrix, l.width, l.height),
          item = { l, n, quad, projection, alpha };
        const hit = pickPolygon(item, quad);
        if (hit.points.length < 3) continue;
        this.hits.push(hit);
        if (
          spatial &&
          s.depthOcclusion !== false &&
          !forceStack(original) &&
          l.blend === "normal" &&
          alpha > 0.55
        )
          opaquePlanes.push(item);
        if (
          spatial &&
          s.depthOcclusion !== false &&
          !forceStack(original) &&
          l.blend === "normal"
        )
          run.push({ item, vertices: quad });
        else {
          flush();
          addPiece(container, { item, vertices: quad });
        }
      }
      flush();
      return container;
    };
    if (output?.composite) {
      if (this.compositeSource!==output.composite) {
        this.compositeTexture?.destroy(true);
        this.compositeTexture=P.Texture.from(output.composite);
        this.compositeSource=output.composite;
      }
      this.compositeTexture.baseTexture.update();
      this.compositeSprite ??= new P.Sprite();
      this.compositeSprite.texture=this.compositeTexture;
      this.compositeSprite.position.set(-s.width/2,-s.height/2);
      this.compositeSprite.width=s.width;
      this.compositeSprite.height=s.height;
      this.composition.addChild(this.compositeSprite);
    } else this.composition.addChild(compose(null));
    const frameX = bufferW / w, frameY = bufferH / h;
    const frame = this.frame;
    const draft = shaderPreview?.target === "output" ? shaderPreview.graph : undefined;
    const outputGraph = checkedGraph(draft ?? source.outputGraph);
    const graphOutput = (!exact && this.graphPreview?.source === (draft ?? source.outputGraph) ? this.graphPreview?.output : undefined) ?? outputGraph?.output;
    const resolution = exact ? 1 : Math.min(1, this.previewLimit / Math.max(frame.w * frameX, frame.h * frameY));
    let finalFilter = null;
    if (!orbit && s.id !== "@preprocessing" && scale > 0) {
      if (outputGraph?.kind === "post" && graphOutput && graphOutput !== "$source") {
        finalFilter = this.hybrid.filter(this.composition,outputGraph,graphOutput,t,1,scale,this.effectSize);
        finalFilter.autoFit = false;
        finalFilter.resolution = resolution;
        finalFilter.padding = 0;
      } else if (!draft) {
        finalFilter = this.codeShaders.filter(this.composition,source.outputShader,t,s.width,s.height,1,false,resolution);
      }
    }
    this.composition.filters = finalFilter ? [finalFilter] : null;
    this.composition.filterArea = finalFilter
      ? new P.Rectangle(frame.x * frameX, frame.y * frameY, frame.w * frameX, frame.h * frameY)
      : null;
    this.guides.clear();
    if (!exact && !capture && !output) {
      if (!orbit)
        this.guides
          .lineStyle(1, this.dark ? 0x999999 : 0x707070, 0.8)
          .drawRect(this.frame.x, this.frame.y, this.frame.w, this.frame.h);
      else if (this.showCamera) {
        const eye = outputProjection(camera).origin;
        const hw = s.width / (2 * camera.zoom),
          hh = s.height / (2 * camera.zoom);
        const frame: Vec3[] = [
          [-hw, -hh],
          [hw, -hh],
          [hw, hh],
          [-hw, hh],
        ].map(([x, y]) => [x + camera.x, y + camera.y, camera.z]);
        this.guides.lineStyle(1, this.guideAccent, 0.65);
        for (let i = 0; i < 4; i++) {
          line(this.guides, frame[i], frame[(i + 1) % 4]);
          line(this.guides, eye, frame[i]);
        }
        const p = cameraPoint(eye, view);
        if (p[2] >= NEAR) {
          const q = onScreen(p);
          this.guides
            .beginFill(this.guideAccent, 0.9)
            .drawRoundedRect(q.x - 11, q.y - 7, 22, 14, 3)
            .endFill();
          this.hits.push({
            id: "@camera",
            z: eye[2],
            points: [
              [-14, -11],
              [14, -11],
              [14, 11],
              [-14, 11],
            ].map(([x, y]) => ({ x: q.x + x, y: q.y + y })),
          });
        }
      }
      for (const light of lights) {
        const l = s.layers.find((l) => l.id === light.id),
          n = this.nodes.get(light.id);
        if (!l || !n) continue;
        const point = at(matrixFor(l));
        if (!point) continue;
        const x = point.x,
          y = point.y,
          r = 10;
        const color = parseInt(light.config.color.slice(1), 16);
        this.guides
          .lineStyle(1.5, color, 0.95)
          .beginFill(this.dark ? 0x3c3c3c : 0x565656, 0.85)
          .drawCircle(x, y, r)
          .endFill();
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          this.guides
            .moveTo(x + Math.cos(a) * 13, y + Math.sin(a) * 13)
            .lineTo(x + Math.cos(a) * 17, y + Math.sin(a) * 17);
        }
        if (light.config.type === "area") {
          const m = matrixFor(l),
            hw = light.config.width / 2,
            hh = light.config.height / 2,
            points = [
              [-hw, -hh],
              [hw, -hh],
              [hw, hh],
              [-hw, hh],
            ].map(([a, b]) => point3(m, a, b));
          this.guides.lineStyle(1, color, 0.6);
          for (let i = 0; i < 4; i++)
            line(this.guides, points[i], points[(i + 1) % 4]);
        }
        if (light.config.type === "sun" || light.config.type === "area") {
          const m = matrixFor(l),
            end = [...m];
          for (let i = 0; i < 3; i++) end[12 + i] += light.direction[i] * 180;
          this.guides.lineStyle(2, color, 0.8);
          line(this.guides, point3(m), point3(end));
        }
        if (!n.gizmoText) {
          n.gizmoText = new P.Text("", {
            fontFamily: "Microsoft YaHei",
            fontSize: 11,
            fill: this.dark ? 0xf0f0f0 : 0x4b4b4b,
          });
          this.guides.addChild(n.gizmoText);
        }
        n.gizmoText.visible = true;
        n.gizmoText.style.fill = this.dark ? 0xf0f0f0 : 0x4b4b4b;
        n.gizmoText.text = l.name;
        n.gizmoText.position.set(x + 20, y - 8);
        this.hits.push({
          id: l.id,
          z: light.position[2],
          points: [
            { x: x - 14, y: y - 14 },
            { x: x + 14, y: y - 14 },
            { x: x + 14, y: y + 14 },
            { x: x - 14, y: y + 14 },
          ],
        });
      }
      const ids = this.selectedIds.length ? this.selectedIds : [this.selected];
      const hit = this.hits.find((h) => h.id === this.selected);
      for (const h of this.hits.filter((h) => ids.includes(h.id))) {
        this.guides
          .lineStyle(1.5, this.guideAccent, 1)
          .drawPolygon(h.points.flatMap((p) => [p.x, p.y]));
      }
      if (this.onOverlay) {
        const frame: OverlayFrame = { rotation: view.rotation };
        let key = "";
        const roots = selectionRoots(s, ids).filter((l) =>
          layerVisible(s, l, t),
        );
        const multi = roots.length > 1;
        const layer = roots[0];
        const cam = this.selected === "@camera";
        const permitted = s.id !== "@preprocessing" && !audition?.stage;
        if (
          permitted &&
          (cam ||
            (layer &&
              layerVisible(s, layer, t) &&
              !layer.locked &&
              !["audio", "adjustment"].includes(layer.kind)))
        ) {
          const spatial = cam || roots.some((l) => l.is3D);
          const proj =
            orbit || cam || (layer && spatialLayer(s, layer))
              ? view
              : outputProjection(camera, false);
          const position = cam
            ? orbit
              ? outputProjection(camera).origin
              : ([camera.x, camera.y, camera.z] as Vec3)
            : multi
              ? pivotOf(s, roots, t)
              : point3(matrixFor(layer!));
          const rect = this.host.getBoundingClientRect(),
            rx = rect.width / w,
            ry = rect.height / h;
          const p = cameraPoint(position, proj);
          if (p[2] >= NEAR) {
            const pp = projectView(p, proj);
            const center = {
              x: (cx + pp.x * scale) * rx,
              y: (cy + pp.y * scale) * ry,
            };
            const parent = multi
              ? undefined
              : s.layers.find((l) => l.id === layer?.parentId);
            const pm = parent
              ? matrixFor(parent)
              : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
            const planes =
              !cam && spatial
                ? opaquePlanes.map((item) => ({
                    item,
                    quad: item.quad.map((v) => cameraPoint(v.position, proj)),
                  }))
                : [];
            const bucket = Math.floor((audition?.time ?? t) * 8);
            const visibleAt = (x: number, y: number, depth: number) => {
              if (depth < NEAR) return false;
              const ray: Vec3 = [
                (x / rx - cx) / (scale * proj.focal * proj.zoom),
                (y / ry - cy) / (scale * proj.focal * proj.zoom),
                1,
              ];
              return !planes.some(({ item, quad }) => {
                const hit = planeRay(quad, ray);
                return (
                  !!hit &&
                  hit.depth < depth - 2 &&
                  item.alpha *
                    this.textureAlpha(
                      item.n,
                      item.n.mesh.shader.uniforms.uSampler,
                      hit.u,
                      hit.v,
                      item.l.model ? bucket : 0,
                    ) >
                    0.55
                );
              });
            };
            key = JSON.stringify([
              this.selected,
              roots.map((l) => l.id),
              center,
              p,
              pm,
              proj.rotation,
              proj.focal,
              proj.zoom,
              scale,
              rx,
              ry,
              spatial,
              hit?.points,
              planes.map(({ item, quad }) => [item.l.id, item.alpha, quad]),
              planes.length ? bucket : 0,
            ]);
            if (key !== this.overlayKey) {
              const basis = [0, 4, 8].map((i) => {
                const q = cameraPoint(
                  position.map((v, a) => v + pm[i + a]) as Vec3,
                  proj,
                );
                return q.map((v, a) => v - p[a]) as Vec3;
              });
              const directions: [number, number][] = [];
              const axes = (["x", "y", "z"] as const).map(
                (axis, i): GizmoAxis => {
                  const q = projectView(
                    p.map((v, a) => v + basis[i][a]) as Vec3,
                    proj,
                  );
                  let dx = (q.x - pp.x) * scale * rx,
                    dy = (q.y - pp.y) * scale * ry;
                  let pixels = Math.hypot(dx, dy);
                  const distinct = (x: number, y: number) =>
                    directions.every(
                      ([a, b]) =>
                        (x * a + y * b) / Math.max(0.001, Math.hypot(x, y)) <
                        0.88,
                    );
                  if (pixels < 0.055 || !distinct(dx, dy)) {
                    const preferred: [number, number] =
                      i === 0 ? [1, 0] : i === 1 ? [0, 1] : [0.64, -0.77];
                    [dx, dy] =
                      [
                        preferred,
                        [0.7, -0.7],
                        [1, 0],
                        [0, 1],
                        [-0.7, -0.7],
                        [-1, 0],
                        [0, -1],
                      ].find(([x, y]) => distinct(x, y)) || preferred;
                    pixels = Math.max(
                      0.08,
                      ((proj.focal * proj.zoom) / p[2]) * scale * rx,
                    );
                  }
                  const len = Math.hypot(dx, dy);
                  directions.push([dx / len, dy / len]);
                  const u = normalize(basis[(i + 1) % 3]),
                    v = normalize(basis[(i + 2) % 3]);
                  const worldRadius =
                    p[2] / (proj.focal * proj.zoom * scale * rx);
                  const ring = clippedStroke(
                    Array.from({ length: 49 }, (_, j) => {
                      const a = (j * Math.PI) / 24,
                        c = Math.cos(a),
                        s = Math.sin(a);
                      const x = center.x + (u[0] * c + v[0] * s) * 48,
                        y = center.y + (u[1] * c + v[1] * s) * 48;
                      return {
                        x,
                        y,
                        visible: visibleAt(
                          x,
                          y,
                          p[2] + (u[2] * c + v[2] * s) * 48 * worldRadius,
                        ),
                      };
                    }),
                  );
                  const axisZ = normalize(basis[i])[2];
                  const line = planes.length
                    ? Array.from({ length: 14 }, (_, j) => {
                        const radius = (j * 53) / 13,
                          x = center.x + (dx / len) * radius,
                          y = center.y + (dy / len) * radius;
                        return {
                          x,
                          y,
                          visible: visibleAt(
                            x,
                            y,
                            p[2] + axisZ * radius * worldRadius,
                          ),
                        };
                      })
                    : undefined;
                  return {
                    axis,
                    dx: dx / len,
                    dy: dy / len,
                    pixels,
                    ring,
                    line: line ? clippedStroke(line) : undefined,
                    tip: line?.at(-1)?.visible,
                  };
                },
              );
              const corners =
                !cam &&
                !multi &&
                hit &&
                ["model", "image", "color", "text"].includes(layer!.kind)
                  ? hit.points
                      .map((p) => ({ x: p.x * rx, y: p.y * ry }))
                      .filter((q) => visibleAt(q.x, q.y, p[2]))
                  : [];
              frame.gizmo = {
                id: this.selected,
                ids: roots.map((l) => l.id),
                pivot: position,
                pivotVisible: visibleAt(center.x, center.y, p[2]),
                center,
                axes,
                corners,
                camera: cam,
                spatial,
              };
            }
          }
        }
        if (!key || key !== this.overlayKey) this.onOverlay(frame);
        this.overlayKey = key;
      }
    }
    this.app.renderer.render(this.app.stage);
    this.snapshot = {
      host: this.host,
      width: w,
      height: h,
      scale,
      hits: this.hits,
      pickHits: this.pickHits,
      projection: view,
      frame: this.frame,
      spatial: !!orbit,
    };
    this.lastScene = source;
    this.lastT = t;
    this.dirty = false;
    this.frameCount++;
  }
  pick(
    clientX: number,
    clientY: number,
    s: Scene,
    viewport = this.snapshot,
    includeLocked = false,
  ) {
    if (!viewport) return "";
    const rect = viewport.host.getBoundingClientRect(),
      x = ((clientX - rect.left) * viewport.width) / rect.width,
      y = ((clientY - rect.top) * viewport.height) / rect.height;
    const guides = viewport.hits.filter(
      (h) =>
        h.id === "@camera" ||
        s.layers.find((l) => l.id === h.id)?.kind === "light",
    );
    for (const hit of [...viewport.pickHits, ...guides].reverse()) {
      const l = s.layers.find((l) => l.id === hit.id);
      if (l?.locked && !includeLocked) continue;
      let inside = false;
      const p = hit.points;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++)
        if (
          p[i].y > y !== p[j].y > y &&
          x < ((p[j].x - p[i].x) * (y - p[i].y)) / (p[j].y - p[i].y) + p[i].x
        )
          inside = !inside;
      if (inside) return hit.id;
    }
    return "";
  }
  screenDelta(dx: number, dy: number) {
    const r = this.host.getBoundingClientRect();
    return {
      x: (dx * this.app.screen.width) / r.width / this.scale,
      y: (dy * this.app.screen.height) / r.height / this.scale,
    };
  }
  png(): Promise<Blob> {
    return new Promise((resolve, reject) =>
      this.app.view.toBlob(
        (b: Blob) => (b ? resolve(b) : reject(Error("画布读取失败"))),
        "image/png",
      ),
    );
  }
  captureShaderPreview(scene: Scene, t: number, omitShaderDraft = false) {
    try {
      this.renderAt(scene, t, false, true, omitShaderDraft);
      return this.app.view.toDataURL("image/jpeg", 0.78) as string;
    } finally {
      this.invalidate();
    }
  }
  probePostGraph(graph: EffectGraph) {
    for (const node of graph.nodes)
      if (node.op === "glsl") this.codeShaders.probe(node.inputs.shader as CodeShader);
    if (graph.output === "$source") return;
    const P = window.PIXI;
    const sprite = new P.Sprite(P.Texture.WHITE);
    const surface = P.RenderTexture.create({ width: 32, height: 24 });
    sprite.width = 32;
    sprite.height = 24;
    try {
      sprite.filters = [this.hybrid.filter(sprite,graph,graph.output,0,1,1,[32,24])];
      this.app.renderer.render(sprite,{renderTexture:surface,clear:true});
      this.app.renderer.extract.pixels(surface);
    } finally {
      sprite.destroy();
      surface.destroy(true);
      this.invalidate();
    }
  }
  destroy() {
    for (const n of this.nodes.values()) {
      n.shapeTexture?.destroy(true);
      n.runtime?.destroy();
      n.rt?.destroy(true);
      n.graphFilter?.filter.destroy();
      n.pre?.graphFilter?.filter.destroy();
      n.graphText?.destroy();
      n.depthRT?.destroy(true);
      for (const piece of n.depthMeshes || []) piece?.mesh.destroy();
      n.mirrorDepth?.depthRT?.destroy(true);
      for (const piece of n.mirrorDepth?.depthMeshes || [])
        piece?.mesh.destroy();
    }
    this.compositeTexture?.destroy(true);
    this.compositeSprite?.destroy();
    this.maskRT?.destroy(true);
    this.codeShaders.destroy();
    this.app.destroy(true);
  }
}
