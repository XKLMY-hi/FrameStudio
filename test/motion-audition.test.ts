import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyScene, layer, addVisual } from "../src/theater/schema";
import { layerVisible } from "../src/theater/scene-engine";
import {
  advanceAudition,
  auditionProject,
  auditionSample,
  type AuditionState,
} from "../src/theater/motion-audition";
import { evaluate } from "../src/engine";
import type { Asset, Param } from "../src/types";

const asset: Asset = {
  id: "motion",
  kind: "motion",
  name: "short",
  fps: 30,
  duration: 0.08,
  curves: [
    {
      target: "Parameter",
      id: "ParamAngleX",
      fadeIn: 1,
      fadeOut: 1,
      keys: [
        { t: 0, v: -12, mode: "linear" },
        { t: 0.08, v: 24, mode: "linear" },
      ],
    },
  ],
};
function sceneWithActor() {
  const s = emptyScene(),
    l = layer("model", "actor");
  l.model = {
    resourceId: "res",
    physics: false,
    parameterMap: {},
    groupOverrides: {},
    baseValues: {},
    keys: [],
    lipOpen: "",
    lipForm: "",
  };
  s.models.push({
    id: "res",
    name: "source",
    modelId: "demo",
    file: "model.model3.json",
    assets: [asset],
  });
  addVisual(s, l, 1, 2);
  return { s, l };
}
test("audition bypasses preset curve fades, holds the final frame and preserves the source", () => {
  const { s, l } = sceneWithActor();
  const a = auditionProject(s, l, asset, 1.25);
  const p: Param = {
    id: "ParamAngleX",
    name: "Angle X",
    min: -30,
    max: 30,
    default: 0,
    group: "body",
  };
  assert.equal(a.stage, undefined);
  assert.equal(evaluate(a.project, [p], 0).parameters[p.id], -12);
  assert.ok(
    evaluate(a.project, [p], auditionSample(0.08, 0.08)).parameters[p.id] >
      23.99,
  );
  assert.equal(asset.curves[0].fadeIn, 1);
  assert.equal(a.project.duration, 0.08);
});
test("out-of-range and hidden actors audition using the original controller without changing scene visibility", () => {
  const { s, l } = sceneWithActor();
  l.visible = false;
  const before = JSON.stringify(s);
  const { stage } = auditionProject(s, l, asset, 0);
  assert.ok(stage && layerVisible(stage, stage.layers[0], 0));
  assert.equal(stage.layers[0].id, l.id);
  assert.equal(JSON.stringify(s), before);
});
test("audition advances at chosen speed, pauses on end and loops through exact duration", () => {
  const a: AuditionState = {
    id: "a",
    name: "a",
    fps: 30,
    time: 0.9,
    duration: 1,
    playing: true,
    loop: false,
    speed: 0.5,
    isolated: false,
  };
  const end = advanceAudition(a, 0.5);
  assert.equal(end.time, 1);
  assert.equal(end.playing, false);
  assert.equal(advanceAudition(end, 1), end);
  const loop = advanceAudition({ ...a, loop: true }, 0.5);
  assert.ok(Math.abs(loop.time - 0.15) < 1e-9 && loop.playing);
});
