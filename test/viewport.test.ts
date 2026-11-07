import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyScene, layer, addVisual } from "../src/theater/schema";
import { projectPoint, worldMatrix } from "../src/theater/scene-engine";
import {
  cameraPoint,
  clipNear,
  fitOrbit,
  orbitPan,
  orbitProjection,
  outputProjection,
  point3,
  projectView,
  viewportFocal,
} from "../src/theater/viewport";

test("output projection agrees with the scene camera, including depth and non-spatial layers", () => {
  const s = emptyScene(),
    l = layer("color", "plane");
  l.is3D = true;
  Object.assign(l.transform, { x: 40, y: -80, z: 320, rotationY: 35 });
  Object.assign(s.camera, { x: 16, y: 22, z: 170, zoom: 1.35 });
  const m = worldMatrix(s, l, 0);
  for (const useCamera of [true, false]) {
    const expected = projectPoint(
      m,
      15,
      -65,
      useCamera ? s.camera : { ...s.camera, x: 0, y: 0, z: 0, zoom: 1 },
    );
    const v = outputProjection(s.camera, useCamera),
      actual = projectView(cameraPoint(point3(m, 15, -65), v), v);
    assert.ok(
      Math.abs(actual.x - expected.x) < 1e-10 &&
        Math.abs(actual.y - expected.y) < 1e-10,
    );
  }
});

test("side and top views reveal depth and focus fits the selected scene object", () => {
  const s = emptyScene(),
    l = layer("color", "plane");
  l.is3D = true;
  l.transform.z = 480;
  l.transform.x = 200;
  addVisual(s, l);
  const focal = viewportFocal(s),
    o = fitOrbit(s, 0, "side", l.id),
    v = orbitProjection(o, focal);
  assert.deepEqual(o.target, [200, 0, 480]);
  assert.ok(Math.abs(projectView(cameraPoint(o.target, v), v).x) < 1e-9);
  assert.notEqual(
    projectView(cameraPoint([200, 0, 0], v), v).x,
    projectView(cameraPoint(o.target, v), v).x,
  );
  const p = orbitPan(o, 24, -17, focal),
    pv = orbitProjection(p, focal);
  const moved = projectView(cameraPoint(o.target, pv), pv);
  assert.ok(Math.abs(moved.x - 24) < 1e-9 && Math.abs(moved.y + 17) < 1e-9);
  const top = orbitProjection(fitOrbit(s, 0, "top"), focal);
  assert.ok(
    Math.abs(
      cameraPoint([0, 0, 0], top)[2] - cameraPoint([0, 0, 480], top)[2],
    ) < 1e-8,
  );
});

test("near-plane clipping preserves visible pick polygons without projecting behind the eye", () => {
  assert.deepEqual(
    clipNear(
      [
        [-20, 0, 0],
        [40, 0, 40],
      ],
      false,
    ),
    [
      [10, 0, 20],
      [40, 0, 40],
    ],
  );
  const poly = clipNear([
    [-10, -10, -40],
    [10, -10, 60],
    [10, 10, 60],
    [-10, 10, -40],
  ]);
  assert.equal(poly.length, 4);
  assert.ok(poly.every((p) => p[2] >= 20));
  assert.deepEqual(
    clipNear(
      [
        [0, 0, -100],
        [1, 1, 0],
      ],
      false,
    ),
    [],
  );
});
