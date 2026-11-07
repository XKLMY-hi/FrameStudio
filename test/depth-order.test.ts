import { test } from "node:test";
import assert from "node:assert/strict";
import { depthOrder, planeQuad } from "../src/theater/depth-order";
import { transform } from "../src/theater/schema";
import { transformMatrix } from "../src/theater/scene-engine";
import { orbitRotate, orbitProjection } from "../src/theater/viewport";

const quad = (name: string, rotationY: number, z = 0) => ({
  item: name,
  vertices: planeQuad(
    transformMatrix({ ...transform(), rotationY, z }),
    300,
    200,
  ),
});
test("crossing planes split at the intersection and exchange occlusion when viewed from behind", () => {
  const red = quad("red", 35),
    blue = quad("blue", -35);
  const front = depthOrder([red, blue], [0, 0, -1200]);
  assert.deepEqual(
    front.map((p) => p.item),
    ["red", "blue", "red"],
  );
  assert.ok(front[0].split && front[2].split);
  assert.ok(front[0].vertices.every((v) => v.x <= 1e-7));
  assert.ok(front[2].vertices.every((v) => v.x >= -1e-7));
  const rear = depthOrder([red, blue], [0, 0, 1200]);
  assert.deepEqual(rear[0].vertices, front[2].vertices);
  assert.deepEqual(rear[2].vertices, front[0].vertices);
});
test("parallel surfaces use depth while coplanar surfaces preserve stack order", () => {
  const near = quad("near", 0, -200),
    far = quad("far", 0, 220);
  assert.deepEqual(
    depthOrder([near, far], [0, 0, -1200]).map((p) => p.item),
    ["far", "near"],
  );
  assert.deepEqual(
    depthOrder([near, quad("tie", 0, -200)], [0, 0, -1200]).map((p) => p.item),
    ["near", "tie"],
  );
});
test("dragging right orbits the camera to the left of the focus", () => {
  const orbit = orbitRotate(
    { target: [0, 0, 0], distance: 1000, yaw: 0, pitch: 0 },
    45,
    0,
  );
  assert.ok(orbit.yaw > 0);
  assert.ok(orbitProjection(orbit, 1000).origin[0] < 0);
});
