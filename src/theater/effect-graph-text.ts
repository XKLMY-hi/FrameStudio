import { evaluateTextGraph, graphOrder, type EffectGraph } from "./effect-graph";
import { titleCharacters } from "./text-motion";

export class GraphText {
  readonly stage = new window.PIXI.Container();
  private units: {text:any; x:number; y:number}[] = [];
  private layoutKey = "";
  private lastFrame = "";
  private graph?: EffectGraph;
  private output?: string;
  private order: ReturnType<typeof graphOrder> = [];

  render(renderer: any, target: any, graph: EffectGraph, output: string, layoutKey: string, value: string,
    style: any, width: number, height: number, time: number, remaining: number, overrides: Record<string,number>) {
    const P = window.PIXI;
    const key = graph.scope + layoutKey;
    if (key !== this.layoutKey) {
      for (const child of this.stage.removeChildren()) child.destroy();
      this.units = [];
      this.layoutKey = key;
      this.lastFrame = "";
      const add = (value: string, x: number, y: number) => {
        const text = new P.Text(value, style);
        text.anchor.set(.5);
        this.units.push({text,x,y});
        this.stage.addChild(text);
        return text;
      };
      if (graph.scope !== "glyph" || titleCharacters(value).length > 160) {
        const text = add(value,0,0), unit = this.units[0];
        unit.x = style.align === "center" ? width/2 : style.align === "right" ? width-text.width/2-10 : text.width/2+10;
        unit.y = Math.max(0,(height-text.height)/2)+text.height/2;
      } else {
        const metrics = P.TextMetrics.measureText(value,style);
        const ctx = document.createElement("canvas").getContext("2d")!;
        ctx.font = style.toFontString();
        const glyphStyle = style.clone();
        glyphStyle.wordWrap = false;
        const lineHeight = metrics.lineHeight;
        const top = Math.max(0,(height-metrics.lines.length*lineHeight)/2);
        for (const [index,line] of (metrics.lines as string[]).entries()) {
          const lineWidth = ctx.measureText(line).width;
          const left = style.align === "center" ? (width-lineWidth)/2 : style.align === "right" ? width-lineWidth-10 : 10;
          let prefix = "";
          for (const glyph of titleCharacters(line)) {
            prefix += glyph;
            const glyphWidth = ctx.measureText(glyph).width;
            const text = add(glyph,left+ctx.measureText(prefix).width-glyphWidth/2,top+(index+.5)*lineHeight);
            text.style = glyphStyle;
          }
        }
      }
    }
    if (this.graph !== graph || this.output !== output) {
      this.graph = graph;
      this.output = output;
      this.order = graphOrder(graph,output);
      this.lastFrame = "";
    }
    const instance = output === graph.output ? graph : {...graph,output};
    const poses = this.units.map((_,i) => evaluateTextGraph(instance,this.order,time,remaining,i,this.units.length,overrides));
    const frame = JSON.stringify(poses);
    if (frame !== this.lastFrame) {
      for (const [i,unit] of this.units.entries()) {
        const pose = poses[i];
        unit.text.position.set(unit.x+pose.x,unit.y+pose.y);
        unit.text.alpha = pose.alpha;
        unit.text.scale.set(pose.scale);
        unit.text.rotation = pose.angle;
      }
      renderer.render(this.stage,{renderTexture:target,clear:true});
      this.lastFrame = frame;
    }
    return target;
  }
  destroy() { this.stage.destroy({children:true}); }
}
