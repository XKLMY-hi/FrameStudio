import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { produce } from "immer";
import { unzipSync, zipSync } from "fflate";
import {
  emptyScene,
  layer,
  addVisual,
  sceneClip,
  track,
} from "../src/theater/schema";
import { duplicateTree, modelProject } from "../src/theater/scene-engine";
import { saveLivemg, openLivemg } from "../backend/livemg.mjs";
test("duplicating an Immer draft group copies controllers and remaps bound lips without copying resources", () => {
  const s = emptyScene(),
    g = layer("group", "group"),
    a = layer("model", "actor"),
    v = layer("audio", "voice");
  a.model = {
    resourceId: "r",
    physics: false,
    baseValues: {},
    keys: [],
    parameterMap: {},
    groupOverrides: {},
    lipOpen: "ParamMouthOpenY",
    lipForm: "ParamMouthForm",
  };
  a.parentId = v.parentId = g.id;
  s.layers.push(g, v);
  addVisual(s, a);
  const t = track("voice"),
    c = sceneClip("audio", v.id, "voice", "voice");
  c.lipTarget = a.id;
  c.lipEnabled = true;
  t.clips.push(c);
  s.tracks.push(t);
  let id = "";
  const out = produce(s, (d) => {
    id = duplicateTree(d, g.id);
  });
  const actor = out.layers.find(
      (l) => l.parentId === id && l.kind === "model",
    )!,
    voice = out.layers.find((l) => l.parentId === id && l.kind === "audio")!;
  assert.ok(actor && voice);
  assert.notEqual(actor.id, a.id);
  assert.notEqual(actor.model, a.model);
  assert.equal(actor.model!.resourceId, "r");
  assert.equal(
    out.tracks.flatMap((t) => t.clips).find((c) => c.layerId === voice.id)!
      .lipTarget,
    actor.id,
  );
  assert.equal(s.layers.length, 3);
});
test("muting audio volume leaves the independent lip controller active", () => {
  const s = emptyScene(),
    a = layer("model", "actor");
  a.model = {
    resourceId: "r",
    physics: false,
    baseValues: {},
    keys: [],
    parameterMap: {},
    groupOverrides: {},
    lipOpen: "ParamMouthOpenY",
    lipForm: "ParamMouthForm",
  };
  s.models = [
    { id: "r", name: "r", modelId: "r", file: "a.model3.json", assets: [] },
  ];
  addVisual(s, a);
  s.assets.push({
    id: "v",
    name: "v",
    kind: "audio",
    path: "audio.wav",
    duration: 1,
    cues: [{ start: 0, end: 1, value: "A" }],
  });
  const c = sceneClip("audio", "audio", "v", "v");
  Object.assign(c, {
    lipEnabled: true,
    lipTarget: a.id,
    weight: 0,
    lipWeight: 0.8,
  });
  s.tracks.push({ ...track("voice"), clips: [c] });
  assert.equal(
    modelProject(s, a)
      .tracks.flatMap((t) => t.clips)
      .find((c) => c.assetId.startsWith("lip:"))!.weight,
    0.8,
  );
});
test(".livemg packs unique models and media, remaps on reopen, rejects damaged or unlisted resources", async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "livemg-test-")),
    s = emptyScene();
  await fs.mkdir(path.join(dir, "models/demo"), { recursive: true });
  await fs.mkdir(path.join(dir, "media"), { recursive: true });
  await fs.writeFile(path.join(dir, "models/demo/a.model3.json"), "{}");
  await fs.writeFile(path.join(dir, "media/a.wav"), "fake audio");
  s.models = [
    {
      id: "r1",
      name: "one",
      modelId: "demo",
      file: "a.model3.json",
      assets: [],
    },
    {
      id: "r2",
      name: "two",
      modelId: "demo",
      file: "a.model3.json",
      assets: [],
    },
  ];
  s.assets = [
    { id: "a", name: "voice", kind: "audio", path: "media/a.wav", duration: 1 },
  ];
  const bytes = await saveLivemg(s, dir);
  const files = unzipSync(bytes);
  assert.equal(
    Object.keys(files).filter((k) => k.startsWith("models/")).length,
    1,
  );
  const opened = await openLivemg(bytes, dir);
  assert.notEqual(opened.models[0].modelId, "demo");
  assert.equal(opened.models[0].modelId, opened.models[1].modelId);
  assert.notEqual(opened.assets[0].path, "media/a.wav");
  files["assets/media/a.wav"] = new TextEncoder().encode("corrupt");
  await assert.rejects(openLivemg(zipSync(files), dir), /损坏/);
  const added = unzipSync(bytes);
  added["models/demo/extra.js"] = new Uint8Array([1]);
  await assert.rejects(openLivemg(zipSync(added), dir), /未校验/);
});
