import assert from "node:assert/strict";
import { test } from "node:test";
import { produce } from "immer";
import { addVisual, emptyScene, layer, sceneClip, track } from "../src/theater/schema";
import { copyLayerTrees, pasteLayerTrees, textAt } from "../src/theater/scene-engine";
import { titlePose } from "../src/theater/text-motion";
import { importShaderRecipe } from "../src/theater/stylize";

test("pasting a copied group preserves location and timing and remaps the selected tree's links", () => {
  const s = emptyScene(), group = layer("group", "容器"), actor = layer("model", "角色");
  const audio = layer("audio", "对白"), light = layer("light", "轮廓光");
  actor.parentId = audio.parentId = light.parentId = group.id;
  actor.transform.x = 123;
  actor.animation.x = [{ t: 1, v: 456, mode: "linear" }];
  light.light!.targets = [actor.id];
  addVisual(s, group);
  addVisual(s, actor, 2, 5);
  addVisual(s, audio);
  addVisual(s, light);
  const voice = sceneClip("audio", audio.id, "audio", "对白", 3, 2);
  voice.lipTarget = actor.id;
  const voiceTrack = track("对白");
  voiceTrack.clips.push(voice);
  s.tracks.push(voiceTrack);
  const copied = copyLayerTrees(s, [group.id, actor.id], 3);
  assert.deepEqual(copied.roots, [group.id]);
  actor.transform.x = 900;
  let ids: string[] = [];
  const next = produce(s, draft => { ids = pasteLayerTrees(draft, copied); });
  const children = next.layers.filter(l => l.parentId === ids[0]);
  const duplicate = children.find(l => l.kind === "model")!;
  const duplicateAudio = children.find(l => l.kind === "audio")!;
  assert.equal(children.length, 3);
  assert.equal(duplicate.transform.x, 123);
  assert.equal(duplicate.animation.x[0].v, 456);
  assert.deepEqual(children.find(l => l.light)?.light?.targets, [duplicate.id]);
  const clips = next.tracks.flatMap(t => t.clips);
  assert.equal(clips.find(c => c.layerId === duplicate.id)?.start, 2);
  assert.equal(clips.find(c => c.layerId === duplicateAudio.id && c.kind === "audio")?.lipTarget, duplicate.id);
});

test("title animation settles, can exit independently and reveals complete graphemes", () => {
  const s = emptyScene(), title = layer("text", "测试");
  title.text!.value = "👨‍👩‍👧‍👦春";
  title.text!.charsPerSecond = 1;
  addVisual(s, title);
  assert.equal(textAt(s, title, 1), "👨‍👩‍👧‍👦");
  assert.ok(titlePose("glitch", undefined, .1, 10, 64).echo > 0);
  assert.equal(titlePose("glitch", "wipe", 1, .35, 64).echo, 0);
  assert.equal(titlePose("glitch", "wipe", 1, .35, 64).reveal, 1);
  assert.equal(titlePose("glitch", "wipe", 1, 0, 64).reveal, 0);
});

test("shader import bounds execution to known GPU passes with valid parameters", () => {
  const input = { format: "framestudio-shader", version: 1, name: "验证" };
  const read = (passes: unknown[]) => importShaderRecipe(JSON.stringify({ ...input, passes }));
  const matrix = [0, 1, 0, 1, 0, 0, 0, 0, 1];
  assert.deepEqual(read([{ op: "matrix", matrix }]).passes[0].matrix, matrix);
  assert.throws(() => read([{ op: "glsl", code: "void main() {}" }]), /不支持/);
  assert.throws(() => read([{ op: "vhs", scale: 100000 }]), /scale/);
  assert.throws(() => read(Array(5).fill({ op: "ink" })), /1–4/);
});
