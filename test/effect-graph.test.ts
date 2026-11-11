import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEase, curveFile, importCurveFile, segmentEase } from "../src/theater/curve-file";
import {
  emptyGraph, evaluateTextGraph, graphNode, graphOrder, graphPresets, importEffectGraph, validateEffectGraph,
} from "../src/theater/effect-graph";
import { graphShader } from "../src/theater/effect-graph-shader";
import type { Key } from "../src/types";
import { appearanceCurves, parseAppearance, setAppearanceCurves } from "../src/theater/appearance-preset";
import { layer, sceneEffects } from "../src/theater/schema";

test("effect files keep branch wiring and reject cycles and excessive sampling", () => {
  const halo = graphPresets("post")[0];
  assert.deepEqual(importEffectGraph(JSON.stringify(halo),"post"),halo);
  assert.match(graphShader(halo,halo.output).fragment,/a\+node2\(uv\)\*\(1.0-a.a\)/);
  const loop = structuredClone(halo);
  loop.nodes[0].inputs.image = loop.output;
  assert.throws(() => validateEffectGraph(loop),/循环/);
  const blur = emptyGraph("post");
  blur.nodes = [graphNode("a","blur",0,0),graphNode("b","blur",0,0,{image:"@a"})];
  blur.output = "@b";
  assert.throws(() => validateEffectGraph(blur),/采样预算/);
  const scan = graphPresets("post")[2];
  assert.match(graphShader(scan,scan.output).fragment,/vec4 result=clamp/);
  assert.throws(() => importEffectGraph(JSON.stringify(scan).replace('"sin"','"texture2D"'),"post"),/像素表达式/);
});

test("text graph samples its own timeline with per-glyph delay and reusable easing", () => {
  const graph = graphPresets("text")[0], order = graphOrder(graph);
  const first = evaluateTextGraph(graph,order,.26,1,0,4);
  const fourth = evaluateTextGraph(graph,order,.26,1,3,4);
  assert.ok(first.y < fourth.y);
  assert.ok(evaluateTextGraph(graph,order,.36,1,0,4).scale > 1);
  assert.equal(evaluateTextGraph(graph,order,3,1,3,4).alpha,1);
});

test("curve JSON round-trips handles and maps a segment without editing its neighbors", () => {
  const keys: Key[] = [
    {t:0,v:3,mode:"bezier",in:[0,2],out:[1,4]},
    {t:2,v:5,mode:"linear",in:[1.5,5],out:[2.5,6]},
    {t:3,v:9,mode:"step",in:[2.7,9]},
  ];
  assert.deepEqual(importCurveFile(JSON.stringify(curveFile("keys","example",keys))).keys,keys);
  const ease = importCurveFile(JSON.stringify(curveFile("ease","example",segmentEase(keys,0))));
  const shifted = applyEase(keys,1,ease.keys);
  assert.deepEqual(shifted[0],keys[0]);
  assert.deepEqual(shifted[1].in,keys[1].in);
  assert.equal(shifted[1].t,2);
  assert.equal(shifted[2].v,9);
  assert.equal(shifted[2].mode,"step");
});

test("appearance presets keep graph controls and replace only their own effect curves", () => {
  const actor = layer("model","actor");
  const keys: Key[] = [{t:0,v:0,mode:"linear"},{t:1,v:12,mode:"linear"}];
  actor.effects.graph = graphPresets("post")[0];
  actor.animation = {x:keys,"postGraph.radius":keys,"effects.blur":keys};
  const preset = parseAppearance(JSON.stringify({format:"framestudio-appearance",version:1,kind:"post",
    data:{effects:{...sceneEffects(),graph:actor.effects.graph},curves:appearanceCurves(actor,"post")}}),"post");
  assert.deepEqual(preset.effects.graph,actor.effects.graph);
  assert.deepEqual(preset.curves,{"postGraph.radius":keys,"effects.blur":keys});
  setAppearanceCurves(actor,"post",{"postGraph.radius":keys});
  assert.deepEqual(actor.animation,{x:keys,"postGraph.radius":keys});
});
