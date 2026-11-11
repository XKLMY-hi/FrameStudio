import { graphOrder, type EffectGraph } from "./effect-graph";
import { graphFilter } from "./effect-graph-shader";
import type { CodeShader } from "../../backend/shader-format.mjs";
import type { CodeShaderRuntime } from "./code-shader";

type Ordinary = { ref: string; read: string[]; state?: ReturnType<typeof graphFilter> };
type Code = { ref: string; input: string; shader: CodeShader; filter?: any };
type Step = Ordinary | Code;
type Pipeline = { graph: EffectGraph; output: string; filter: any; steps: Step[]; final: Ordinary };

export class HybridGraphRuntime {
  private cache = new WeakMap<object, Pipeline>();
  constructor(private shaders: CodeShaderRuntime) {}

  filter(owner: object, graph: EffectGraph, output: string, t: number, mix: number, scale: number,
    size: number[], overrides?: Record<string, number>) {
    let plan = this.cache.get(owner);
    if (!plan || plan.graph !== graph || plan.output !== output) {
      const filter = new window.PIXI.Filter();
      const steps: Step[] = [];
      const available = new Set(["$source"]);
      const glsl: string[] = [];
      for (const node of graphOrder(graph, output)) {
        if (node.op !== "glsl") continue;
        const input = String(node.inputs.image);
        if (!available.has(input)) {
          steps.push({ ref: input, read: glsl.slice() });
          available.add(input);
        }
        const ref = "@" + node.id;
        steps.push({ ref, input, shader: node.inputs.shader as CodeShader });
        available.add(ref);
        glsl.push(ref);
      }
      const pipeline = { graph, output, steps, filter, final: { ref: output, read: glsl } };
      filter.apply = (system: any, source: any, target: any, clear: number, state: any) =>
        this.draw(pipeline, system, source, target, clear, state);
      plan = pipeline;
      this.cache.set(owner, plan);
    }
    let padding = 0;
    for (const step of plan.steps) {
      if ("shader" in step) step.filter = this.shaders.filter(step, step.shader, t, size[0], size[1]);
      else {
        step.state = graphFilter(step.state, graph, step.ref, t, 1, scale, overrides, step.read);
        padding = Math.max(padding, step.state.filter.padding);
      }
    }
    const end = plan.final;
    end.state = graphFilter(end.state, graph, end.ref, t, mix, scale, overrides, end.read);
    plan.filter.padding = Math.max(padding, end.state.filter.padding);
    return plan.filter;
  }

  private draw(plan: Pipeline, system: any, source: any, target: any, clear: number, state: any) {
    const surfaces = new Map<string, any>([["$source", source]]);
    const borrowed: any[] = [];
    const mode = window.PIXI.CLEAR_MODES.CLEAR;
    const acquire = () => {
      const frame = state.sourceFrame;
      const rt = system.getOptimalFilterTexture(frame.width, frame.height, source.resolution);
      rt.filterFrame = frame;
      borrowed.push(rt);
      return rt;
    };
    const ordinary = (step: Ordinary, destination: any, clear: number) => {
      const filter = step.state!.filter;
      step.read.forEach((ref,i) => { filter.uniforms["graphInput" + i] = surfaces.get(ref); });
      system.applyFilter(filter, source, destination, clear);
    };
    try {
      for (const step of plan.steps) {
        if ("shader" in step) {
          const input = surfaces.get(step.input);
          if (!step.filter) surfaces.set(step.ref, input);
          else {
            const out = acquire();
            step.filter.apply(system, input, out, mode, state);
            surfaces.set(step.ref, out);
          }
        } else {
          const out = acquire();
          ordinary(step, out, mode);
          surfaces.set(step.ref, out);
        }
      }
      ordinary(plan.final, target, clear);
    } finally {
      for (const rt of borrowed) system.returnFilterTexture(rt);
    }
  }
}
