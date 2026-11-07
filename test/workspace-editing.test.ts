import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCurvePreset } from "../src/theater/curve-presets";
import type { Key } from "../src/types";
import { emptyScene, layer } from "../src/theater/schema";
import {
  selectionRoots,
  groupTransform,
  pivotOf,
  boxHits,
} from "../src/theater/viewport-selection";
import { clippedStroke, planeRay } from "../src/theater/view-occlusion";

test("segment presets preserve neighboring handles and support ordinary bounce keys", () => {
  const keys: Key[] = [
    { t: 0, v: 0, mode: "bezier", out: [0.2, 0.1] },
    { t: 1, v: 1, mode: "linear", in: [0.8, 0.9] },
    { t: 2, v: 2, mode: "bezier", out: [2.3, 2] },
    { t: 3, v: 3, mode: "linear", in: [2.8, 3] },
  ];
  const r = applyCurvePreset(keys, [1], "bounce");
  assert.deepEqual(r[0], keys[0]);
  assert.deepEqual(r[1].in, keys[1].in);
  assert.deepEqual(r.at(-2)?.out, keys[2].out);
  assert.deepEqual(r.at(-1), keys.at(-1));
  assert.equal(r.length, 8);
  assert.equal(keys.length, 4);
  assert.ok(r.every((k, i) => i === 0 || k.t > r[i - 1].t));
});
test("multi transform uses the spatial midpoint and does not move a selected child twice", () => {
  const s = emptyScene(),
    a = layer("group", "a"),
    child = layer("model", "child"),
    b = layer("model", "b");
  a.is3D = true;
  a.transform.x = -100;
  child.parentId = a.id;
  b.transform.x = 100;
  s.layers = [a, child, b];
  const roots = selectionRoots(s, [a.id, child.id, b.id]);
  assert.deepEqual(
    roots.map((l) => l.id),
    [a.id, b.id],
  );
  const pivot = pivotOf(s, roots, 0);
  assert.deepEqual(pivot, [0, 0, 0]);
  const scale = groupTransform(s, roots, 0, pivot, { scale: [2, 2, 2] });
  assert.deepEqual(
    scale.map((x) => x.values.x),
    [-200, 200],
  );
  const rotate = groupTransform(s, roots, 0, pivot, { axis: "z", angle: 90 });
  assert.ok(
    Math.abs(rotate[0].values.y + 100) < 1e-8 &&
      Math.abs(rotate[1].values.y - 100) < 1e-8,
  );
});
test("marquee rejects bounding-box-only intersections, and depth gaps break gizmo strokes", () => {
  assert.equal(
    boxHits({ x: 2.4, y: 2.2, w: 1, h: 1 }, [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 0, y: 3 },
    ]),
    false,
  );
  assert.equal(
    boxHits({ x: 1, y: 1, w: 1, h: 1 }, [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 0, y: 3 },
    ]),
    true,
  );
  assert.deepEqual(
    planeRay(
      [
        [-5, -5, 50],
        [5, -5, 50],
        [5, 5, 50],
        [-5, 5, 50],
      ],
      [0, 0, 1],
    ),
    { depth: 50, u: 0.5, v: 0.5 },
  );
  assert.match(
    clippedStroke(
      [true, true, false, true, true].map((visible, x) => ({
        x,
        y: 0,
        visible,
      })),
    ),
    /^M.*L.*M.*L/,
  );
});
