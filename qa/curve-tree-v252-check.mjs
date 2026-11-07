import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { _electron as electron } from "playwright";

const patch = process.argv.includes("--patch");
const copy = await fs.mkdtemp(path.join(os.tmpdir(), "framestudio-motion-tree-"));
await fs.cp(path.resolve("release", patch ? "FrameStudio-2.5.1-portable" : "FrameStudio-2.5.2-portable"), copy, { recursive: true });
const appRoot = path.join(copy, "resources", "app");
if (patch) {
  const draft = path.join(appRoot, "data", "autosave-scene.json");
  const saved = '{"name":"Existing QA draft"}';
  await fs.writeFile(draft, saved);
  for (const [name, bytes] of Object.entries(unzipSync(await fs.readFile("release/FrameStudio_2.5.2_轻量更新补丁.zip")))) {
    const target = path.resolve(copy, name);
    assert.ok(target.startsWith(copy + path.sep));
    assert.ok(!name.includes("/data/") && !name.includes("/tools/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  }
  assert.equal(await fs.readFile(draft, "utf8"), saved);
  await fs.unlink(draft);
}
await fs.writeFile(path.join(appRoot, "data", "preferences.json"), '{"appearance":"dark"}');
const app = await electron.launch({ executablePath: path.join(copy, "FrameStudio.exe"), env: { ...process.env, STUDIO_TEST_MODE: "" } });
try {
  const p = await app.firstWindow();
  assert.equal(await p.title(), "FrameStudio 2.5.2");
  await p.waitForFunction(() => window.theater?.ready && theater.scene.tracks.some(t => t.clips.some(c => c.kind === "motion")), null, { timeout: 90000 });
  const { actor, clip, name } = await p.evaluate(() => {
    const c = theater.scene.tracks.flatMap(t => t.clips).find(c => c.kind === "motion");
    theater.selectLayer(c.layerId);
    return { actor: c.layerId, clip: c.id, name: c.name };
  });
  await p.locator(".scene-transport").getByRole("button", { name: "关键帧", exact: true }).click();
  const curve = p.locator(".curve-workspace"), tree = curve.locator(".curve-channel-scroll");
  const row = id => tree.locator(`[data-tree-node="${id}"]`);
  const actions = row("clips:" + actor), motion = row("clip:" + clip), preset = row("preset:" + clip);
  assert.equal(await motion.count(), 0);
  await actions.click();
  await motion.click();
  const ordered = [row("object:@camera"), row("object:" + actor), actions, motion, preset];
  const boxes = await Promise.all(ordered.map(el => el.boundingBox()));
  assert.ok(boxes.every((box, i) => box && (!i || box.y >= boxes[i - 1].y + boxes[i - 1].height)), JSON.stringify(boxes));
  assert.equal(await motion.evaluate(el => getComputedStyle(el).position), "static");
  const indent = await Promise.all(ordered.slice(1).map(el => el.locator(".tree-label").evaluate(e => e.getBoundingClientRect().x)));
  assert.ok(indent.every((x, i) => !i || x > indent[i - 1]), JSON.stringify(indent));
  assert.equal(await curve.locator("[data-plot-channel]").count(), 0);
  if (!patch) await tree.screenshot({ path: "qa/v252-motion-tree.png" });
  await preset.click();
  const prop = tree.locator("[data-curve-channel]").first();
  await prop.locator(".curve-tree-name").click();
  await curve.locator("[data-plot-channel]").waitFor();
  assert.equal(await curve.locator("[data-plot-channel]").count(), 1);
  const scroll = await tree.evaluate((e, clip) => {
    const row = e.querySelector(`[data-tree-node="clip:${clip}"]`);
    e.scrollTop = 0;
    const initial = row.getBoundingClientRect().y;
    e.scrollTop = 40;
    return { movement: initial - row.getBoundingClientRect().y, amount: e.scrollTop };
  }, clip);
  assert.ok(scroll.amount > 0 && Math.abs(scroll.movement - scroll.amount) < 1, JSON.stringify(scroll));
  await actions.click();
  assert.equal(await motion.count(), 0);
  assert.equal(await preset.count(), 0);
  console.log(JSON.stringify({ patch, name, nested: true, scroll, collapse: true, selectedCurve: true }));
} finally {
  await app.close();
}
