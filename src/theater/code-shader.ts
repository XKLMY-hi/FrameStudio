import { validateCodeShader, type CodeShader } from "../../backend/shader-format.mjs";

const vertex = `
precision highp float;
attribute vec2 aVertexPosition;
uniform mat3 projectionMatrix;
uniform vec4 outputFrame;
varying vec2 vUv;
void main() {
  vUv = aVertexPosition;
  gl_Position = vec4((projectionMatrix * vec3(outputFrame.xy + vUv * outputFrame.zw, 1.0)).xy, 0.0, 1.0);
}`;

function fragment(shader: CodeShader, index: number) {
  const samplers = [["original", "source"], ["previous", "inputColor"],
    ...shader.passes.slice(0, index).map(({ id }) => [`pass_${id}`, `sample_${id}`])];
  return `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uTexel;
uniform float fsMix;
${Object.keys(shader.parameters).map(id => `uniform float p_${id};`).join("\n")}
vec4 fsStraight(vec4 c) { return c.a > 0.00001 ? vec4(c.rgb / c.a, c.a) : vec4(0.0); }
${samplers.map(([id, fn]) => `
uniform sampler2D fs_${id};
uniform vec4 fs_uv_${id};
vec4 fsRead_${id}(vec2 uv) {
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0);
  vec4 r = fs_uv_${id};
  return texture2D(fs_${id}, clamp(uv * r.xy, r.zw, max(r.zw, r.xy - r.zw)));
}
vec4 ${fn}(vec2 uv) { return fsStraight(fsRead_${id}(uv)); }
`).join("\n")}
#line 1
${shader.passes[index].source}
#line 16000
void main() {
  vec4 c = clamp(shade(vUv), 0.0, 1.0);
  c.rgb *= c.a;
  gl_FragColor = ${index === shader.passes.length - 1 ? "mix(fsRead_original(vUv), c, fsMix)" : "c"};
}`;
}

type Compiled = { parts: any[]; shader: CodeShader };
type Failure = { error: string };
const message = (err: unknown) => err instanceof Error ? err.message : String(err);

export class CodeShaderRuntime {
  private shaders = new Map<string, Compiled | Failure>();
  private bindings = new WeakMap<object, { compiled: Compiled; filter: any }>();
  private manifests = new WeakMap<object, Compiled | Failure>();

  constructor(private renderer: any) {}

  private build(value: CodeShader): Compiled | Failure {
    const manifest = this.manifests.get(value);
    if (manifest) return manifest;
    const shader = validateCodeShader(value);
    const key = JSON.stringify([Object.keys(shader.parameters), shader.passes]);
    const cached = this.shaders.get(key);
    if (cached) {
      this.manifests.set(value, cached);
      return cached;
    }
    const P = window.PIXI;
    const parts: any[] = [];
    let result: Compiled | Failure;
    try {
      const gl = this.renderer.gl as WebGLRenderingContext;
      if (!gl || gl.isContextLost()) throw Error("WebGL 当前不可用");
      const vert = this.compile(gl, gl.VERTEX_SHADER, vertex);
      try {
        shader.passes.forEach(({ id }, index) => {
          const source = fragment(shader, index);
          try {
            const frag = this.compile(gl, gl.FRAGMENT_SHADER, source);
            const program = gl.createProgram()!;
            try {
              gl.attachShader(program, vert);
              gl.attachShader(program, frag);
              gl.linkProgram(program);
              if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program) || "链接失败");
            } finally {
              gl.deleteProgram(program);
              gl.deleteShader(frag);
            }
            const filter = new P.Filter(vertex, source);
            this.renderer.shader.bind(filter, true);
            parts.push(filter);
          } catch (err) {
            throw Error(`通道 ${id}\n${message(err)}`);
          }
        });
      } finally {
        gl.deleteShader(vert);
      }
      result = { parts, shader };
    } catch (err) {
      parts.forEach(part => part.destroy());
      result = { error: message(err).slice(0, 4000) };
    }
    this.shaders.set(key, result);
    this.manifests.set(value, result);
    return result;
  }

  private compile(gl: WebGLRenderingContext, type: number, source: string) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw Error(log || "GLSL 编译失败");
  }

  private draw(compiled: Compiled, uniforms: object, system: any, original: any, output: any, clear: number, frame: any) {
    const { parts, shader } = compiled;
    const intermediate: any[] = [];
    const setTexture = (part: any, name: string, texture: any) => {
      part.uniforms[`fs_${name}`] = texture;
      part.uniforms[`fs_uv_${name}`] = [
        frame.width / texture.width, frame.height / texture.height,
        0.5 / texture.baseTexture.realWidth, 0.5 / texture.baseTexture.realHeight,
      ];
    };
    try {
      parts.forEach((part, index) => {
        const last = index === parts.length - 1;
        const target = last ? output : system.getOptimalFilterTexture(
          frame.width, frame.height, original.resolution * shader.passes[index].scale,
        );
        if (!last) {
          target.filterFrame = frame;
          intermediate.push(target);
        }
        Object.assign(part.uniforms, uniforms);
        setTexture(part, "original", original);
        setTexture(part, "previous", index ? intermediate[index - 1] : original);
        for (let i = 0; i < index; i++)
          setTexture(part, `pass_${shader.passes[i].id}`, intermediate[i]);
        system.applyFilter(part, original, target, last ? clear : window.PIXI.CLEAR_MODES.CLEAR);
      });
    } finally {
      intermediate.forEach(rt => system.returnFilterTexture(rt));
    }
  }

  filter(owner: object, value: CodeShader | undefined, time: number, width: number, height: number, mix = 1, fit = true, resolution = 1) {
    if (!value || value.enabled === false || mix <= 0) return null;
    try {
      const result = this.build(value);
      if ("error" in result) return null;
      let binding = this.bindings.get(owner);
      if (binding?.compiled !== result) {
        const filter = new window.PIXI.Filter();
        filter.padding = 0;
        filter.apply = (system: any, input: any, output: any, clear: number, state: any) =>
          this.draw(result, filter.uniforms, system, input, output, clear, state.sourceFrame);
        binding = { compiled: result, filter };
        this.bindings.set(owner, binding);
      }
      const { filter } = binding;
      filter.autoFit = fit;
      filter.resolution = resolution;
      Object.assign(filter.uniforms, {
        uTime: time, uResolution: [width, height], uTexel: [1 / width, 1 / height], fsMix: mix,
      });
      for (const [id, p] of Object.entries(value.parameters ?? {}))
        filter.uniforms[`p_${id}`] = p.value;
      return filter;
    } catch {
      return null;
    }
  }

  probe(value: unknown) {
    const shader = validateCodeShader(value);
    const enabled = { ...shader, enabled: true };
    const result = this.build(enabled);
    if ("error" in result) throw Error(result.error);
    const P = window.PIXI;
    const surface = P.RenderTexture.create({ width: 32, height: 24 });
    const sprite = new P.Sprite(P.Texture.WHITE);
    sprite.width = 32;
    sprite.height = 24;
    try {
      sprite.filters = [this.filter(sprite, enabled, 0, 32, 24)];
      this.renderer.render(sprite, { renderTexture: surface, clear: true });
      this.renderer.extract.pixels(surface);
      if (this.renderer.gl.isContextLost()) throw Error("试渲染中 WebGL 上下文丢失");
    } finally {
      sprite.destroy();
      surface.destroy(true);
    }
    return shader;
  }

  private dispose(entry: Compiled) {
    entry.parts.forEach(part => part.destroy());
  }

  destroy() {
    for (const value of this.shaders.values()) if ("parts" in value) this.dispose(value);
    this.shaders.clear();
  }
}
