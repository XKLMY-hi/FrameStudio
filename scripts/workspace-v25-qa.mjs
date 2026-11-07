import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import { _electron as electron } from "playwright";
import {
  emptyScene,
  layer,
  addVisual,
  sceneClip,
  track,
} from "../src/theater/schema.ts";

const root = process.cwd(),
  patch = process.argv.includes("--patch"),
  full = process.argv.includes("--full");
const tag = patch ? "patch-" : full ? "full-" : "";
let appRoot, executablePath, args;
if (patch || full) {
  const copy = path.join(
    os.tmpdir(),
    "FrameStudio-2.5-" + tag + "qa-" + Date.now(),
  );
  await fs.cp(
    path.join(
      root,
      "release",
      patch ? "FrameStudio-2.4.0-portable" : "FrameStudio-2.5.0-portable",
    ),
    copy,
    { recursive: true },
  );
  appRoot = path.join(copy, "resources/app");
  if (patch) {
    const old = emptyScene();
    old.name = "2.4 草稿保留";
    addVisual(old, layer("text", "原有图层"));
    const f = path.join(appRoot, "data/autosave-scene.json"),
      raw = JSON.stringify(old);
    await fs.writeFile(f, raw);
    for (const [name, bytes] of Object.entries(
      unzipSync(await fs.readFile("release/FrameStudio_2.5_轻量更新补丁.zip")),
    )) {
      assert.ok(!name.includes("/data/") && !name.includes("/tools/"));
      const target = path.resolve(copy, name);
      assert.ok(target.startsWith(copy + path.sep));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes);
    }
    assert.equal(await fs.readFile(f, "utf8"), raw);
  }
  executablePath = path.join(copy, "FrameStudio.exe");
  args = [];
} else {
  ({ appRoot } = JSON.parse(
    await fs.readFile("qa/theater-smoke-report.json", "utf8"),
  ));
  assert.ok(appRoot.startsWith(path.join(root, "qa") + path.sep));
  for (const d of ["dist", "backend", "electron"])
    await fs.cp(path.join(root, d), path.join(appRoot, d), { recursive: true });
  await fs.writeFile(
    path.join(appRoot, "data/autosave-scene.json"),
    JSON.stringify(emptyScene()),
  );
  executablePath = path.join(root, "node_modules/electron/dist/electron.exe");
  args = [appRoot];
}
await fs.writeFile(
  path.join(appRoot, "data/preferences.json"),
  '{"appearance":"dark"}',
);
const wav = Buffer.alloc(44 + 32000);
wav.write("RIFF", 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(16000, 24);
wav.writeUInt32LE(32000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(32000, 40);
for (let i = 0; i < 16000; i++)
  wav.writeInt16LE(
    Math.round(Math.sin((i * Math.PI * 440) / 16000) * 2000),
    44 + i * 2,
  );
await fs.mkdir(path.join(appRoot, "data/assets"), { recursive: true });
await fs.writeFile(path.join(appRoot, "data/assets/qa-tone.wav"), wav);
const app = await electron.launch({
  executablePath,
  args,
  env: { ...process.env, STUDIO_TEST_MODE: "" },
});
const p = await app.firstWindow(),
  errors = [],
  out = { patch, full };
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const click = (name, scope = p) =>
  scope.getByRole("button", { name, exact: true }).click();
const view = p.locator(".viewport-pane").first(),
  mirror = p.locator(".mirror-pane");
const wait = () => p.waitForTimeout(170);
const drag = async (x, y, dx, dy, button = "left") => {
  await p.mouse.move(x, y);
  await p.mouse.down({ button });
  await p.mouse.move(x + dx, y + dy, { steps: 6 });
  await p.mouse.up({ button });
};
const center = async (id, second = false) =>
  p.evaluate(
    ({ id, second }) => {
      const v = second ? theater.secondView : theater.renderer.snapshot,
        h = v.hits.find((h) => h.id === id),
        r = v.host.getBoundingClientRect();
      const x =
          r.left +
          ((h.points.reduce((s, p) => s + p.x, 0) / h.points.length) *
            r.width) /
            v.width,
        y =
          r.top +
          ((h.points.reduce((s, p) => s + p.y, 0) / h.points.length) *
            r.height) /
            v.height;
      for (const dy of [0, -16, 16, -32, 32, -48, 48])
        for (const dx of [0, -8, 8, -16, 16]) {
          if (
            theater.renderer.pick(x + dx, y + dy, theater.scene, v, true) === id
          )
            return { x: x + dx, y: y + dy };
        }
      throw Error("no visible pick point for " + id);
    },
    { id, second },
  );
const handle = async (name, scope = view) => {
  const e = scope.locator(
    'g[data-handle="' + name + '"] circle[fill="transparent"]',
  );
  const b = await e.boundingBox();
  assert.ok(b, name);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const film=()=>p.evaluate(()=>{
  const r=theater.renderer;r.renderAt(theater.scene,.75,true);
  const png=r.app.view.toDataURL();r.invalidate();return png;
});
try {
  await p.waitForFunction(() => window.theater?.ready, null, {
    timeout: 90000,
  });
  assert.equal(await p.title(), "FrameStudio 2.5");
  if (patch) {
    assert.equal(await p.evaluate(() => theater.scene.name), "2.4 草稿保留");
    out.draftPreserved = true;
  }
  const old = await p.evaluate(() => theater.scene.models[0]?.modelId);
  await p
    .locator('input[accept=".livemg,.l2dstudio"]')
    .setInputFiles(path.join(root, "qa/场景灯光与模型预处理.livemg"));
  await p.waitForFunction(
    (old) =>
      theater.ready &&
      theater.scene.models[0]?.modelId !== old &&
      theater.scene.layers.filter((l) => l.model).length === 2 &&
      theater.renderer.loading.size === 0 &&
      theater.scene.layers
        .filter((l) => l.model)
        .every((l) => theater.renderer.nodes.get(l.id)?.runtime?.model),
    old,
    { timeout: 90000 },
  );
  const ids = await p.evaluate(() =>
    theater.scene.layers.filter((l) => l.model).map((l) => l.id),
  );
  await p.evaluate(() => {
    theater.change((s) => {
      s.duration = 30;
    });
    theater.seek(0.75);
  });
  const scroller = p.locator(".scene-timeline-scroll");
  await scroller.evaluate((el) => (el.scrollLeft = 240));
  const scroll = await scroller.boundingBox(),
    pointer = 500;
  const before = await scroller.evaluate(
    (el, x) =>
      (el.scrollLeft + x - 340) /
      Number(document.querySelector(".timeline-zoom").value),
    pointer,
  );
  await p.mouse.move(scroll.x + pointer, scroll.y + 50);
  await p.keyboard.down("Alt");
  await p.mouse.wheel(0, -300);
  await p.keyboard.up("Alt");
  await wait();
  const after = await scroller.evaluate(
    (el, x) =>
      (el.scrollLeft + x - 340) /
      Number(document.querySelector(".timeline-zoom").value),
    pointer,
  );
  assert.ok(Math.abs(before - after) < 0.04, { before, after });
  out.timelineAnchor = true;
  await p.evaluate(() =>
    theater.change((s) => {
      s.duration = 2;
      s.workArea = { start: 0, end: 2, loop: true };
    }),
  );
  const originalFilm=await film();
  await p.getByTitle("预览分区", { exact: true }).click();
  await click("左右拆分");
  await p.waitForFunction(
    () =>
      theater.secondView?.hits.some((h) => h.id === "@camera") ||
      theater.secondView?.hits.length >= 2,
  );
  assert.equal(await p.locator(".viewport-panes canvas").count(), 2);
  assert.equal(
    await p.getByLabel("第二预览类型", { exact: true }).inputValue(),
    "space",
  );
  const sep = await p
    .getByRole("separator", { name: "预览分隔条" })
    .boundingBox();
  const width = (await view.boundingBox()).width;
  await drag(sep.x + 2, sep.y + 40, 85, 0);
  await wait();
  assert.ok((await view.boundingBox()).width > width + 30);
  const box = await mirror.locator(".scene-canvas").boundingBox();
  const basis = await p.evaluate(() => theater.secondView.projection.rotation);
  await drag(box.x + 70, box.y + 105, 45, 12, "middle");
  await wait();
  assert.notDeepEqual(
    await p.evaluate(() => theater.secondView.projection.rotation),
    basis,
  );
  const snapshot = () =>
    p.evaluate(() => [
      theater.renderer.app.view.toDataURL(),
      document.querySelector(".mirror-canvas canvas").toDataURL(),
    ]);
  const a = await snapshot();
  assert.notEqual(a[0], a[1]);
  await p.locator(".scene-transport .play-round").click();
  await p.waitForTimeout(650);
  await p.locator(".scene-transport .play-round").click();
  await wait();
  const b = await snapshot();
  assert.ok(a.every((v, i) => v !== b[i]));
  assert.equal(
    await p.evaluate(
      () =>
        [...theater.renderer.nodes.values()].filter((n) => n.runtime).length,
    ),
    2,
  );
  out.splitSharedModels = true;
  await p.evaluate(() => theater.seek(0.75));
  assert.equal(await film(),originalFilm);
  out.outputUnchanged=true;
  await wait();
  for (const second of [false, true]) {
    const at = await center(ids[0], second);
    await p.mouse.click(at.x, at.y, { button: "right" });
    await p.getByRole("menuitem", { name: "锁定", exact: true }).click();
    assert.equal(
      await p.evaluate(
        (id) => theater.scene.layers.find((l) => l.id === id).locked,
        ids[0],
      ),
      true,
    );
    await p.mouse.click(at.x, at.y, { button: "right" });
    await p.getByRole("menuitem", { name: "解锁", exact: true }).click();
  }
  out.contextBothViews = true;
  await p.evaluate(() =>
    theater.change((s) => {
      for (const l of s.layers) if (l.light) l.visible = false;
    }),
  );
  await wait();
  const bounds = await p.evaluate((ids) => {
    const v = theater.renderer.snapshot,
      r = v.host.getBoundingClientRect(),
      pts = v.hits.filter((h) => ids.includes(h.id)).flatMap((h) => h.points);
    return {
      l: r.left + (Math.min(...pts.map((p) => p.x)) * r.width) / v.width,
      r: r.left + (Math.max(...pts.map((p) => p.x)) * r.width) / v.width,
      t: r.top + (Math.min(...pts.map((p) => p.y)) * r.height) / v.height,
      b: r.top + (Math.max(...pts.map((p) => p.y)) * r.height) / v.height,
    };
  }, ids);
  const pane = await view.locator(".scene-canvas").boundingBox();
  const x = Math.max(pane.x + 3, bounds.l - 12),
    y = Math.max(pane.y + 3, bounds.t - 9);
  await p.keyboard.down("Shift");
  await drag(
    x,
    y,
    Math.min(pane.x + pane.width - 3, bounds.r + 8) - x,
    Math.min(pane.y + pane.height - 3, bounds.b + 9) - y,
  );
  await p.keyboard.up("Shift");
  assert.deepEqual(
    new Set(await p.evaluate(() => theater.selectedObjects)),
    new Set(ids),
  );
  const coordinates = () =>
    p.evaluate(
      (ids) =>
        ids.map(
          (id) => theater.scene.layers.find((l) => l.id === id).transform.x,
        ),
      ids,
    );
  const tx = await coordinates(),
    h = await handle("move-x");
  await drag(h.x, h.y, 30, 0);
  const shifted = await coordinates();
  assert.ok(
    shifted[0] > tx[0] + 5 &&
      Math.abs(shifted[0] - tx[0] - (shifted[1] - tx[1])) < 1e-6,
  );
  await p.keyboard.press("Control+z");
  assert.deepEqual(await coordinates(), tx);
  out.multiEdit = true;
  await p.screenshot({ path: "qa/v25-" + tag + "workspace.png" });
  await p.getByTitle("预览分区", { exact: true }).click();
  await click("上下拆分");
  assert.ok(await p.locator(".viewport-panes.stack").isVisible());
  await p.getByTitle("关闭第二预览", { exact: true }).click();
  await p.evaluate((id) => {
    theater.change((s) => {
      const l = s.layers.find((l) => l.id === id);
      l.animation.x = [
        { t: 0, v: -220, mode: "linear" },
        { t: 1, v: -130, mode: "linear" },
        { t: 1.8, v: -215, mode: "linear" },
      ];
      l.animation.y = [
        { t: 0, v: 0, mode: "linear" },
        { t: 1, v: 35, mode: "linear" },
      ];
    });
    theater.selectProperty({ layerId: id, channel: "x" });
  }, ids[0]);
  await click("关键帧", p.locator(".scene-transport"));
  const graph = p.locator(".curve-workspace");
  assert.equal(await graph.locator("[data-segment]").count(), 2);
  await p.getByLabel("选择曲线段", { exact: true }).selectOption("1");
  await p.getByLabel("曲线预设", { exact: true }).selectOption("overshoot");
  const keys = await p.evaluate(
    (id) => theater.scene.layers.find((l) => l.id === id).animation.x,
    ids[0],
  );
  assert.equal(keys[0].mode, "linear");
  assert.equal(keys[1].mode, "bezier");
  assert.ok(keys[2].in);
  const rows = await graph.locator("[data-curve-channel]").evaluateAll((els) =>
    els.slice(0, 2).map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + 8, y: r.top + r.height / 2 };
    }),
  );
  await drag(rows[0].x, rows[0].y, 20, rows[1].y - rows[0].y);
  assert.ok(
    await graph.getByText("2 条 · 按各自范围", { exact: true }).isVisible(),
  );
  assert.equal(await graph.locator("[data-segment]").count(), 3);
  await p.screenshot({ path: "qa/v25-" + tag + "curves.png" });
  out.curveSegmentAndBox = true;
  const audio = layer("audio", "音频测试"),
    clip = sceneClip("audio", audio.id, "qa-audio", "音频测试", 0.2, 1),
    tr = track("音频");
  tr.clips.push(clip);
  await p.evaluate(
    ({ audio, tr, clip }) => {
      theater.change((s) => {
        s.layers.push(audio);
        s.tracks.push(tr);
        s.assets.push({
          id: "qa-audio",
          name: "测试波形",
          kind: "audio",
          path: "assets/qa-tone.wav",
          duration: 1,
          waveform: Array.from(
            { length: 120 },
            (_, i) => Math.abs(Math.sin(i * 0.1)) * 0.8,
          ),
        });
      });
      theater.selectClips([clip.id]);
    },
    { audio, tr, clip },
  );
  await graph.locator(".graph-wave").waitFor({state:"visible"});
  await p.getByLabel("曲线 淡入秒数", { exact: true }).fill(".25");
  assert.equal(
    await p.evaluate(
      (id) =>
        theater.scene.tracks.flatMap((t) => t.clips).find((c) => c.id === id)
          .fadeIn,
      clip.id,
    ),
    0.25,
  );
  await p
    .getByLabel("音频渐变形状", { exact: true })
    .selectOption("equalPower");
  const fadePoint=await graph.locator('[data-fade="fadeIn"]').boundingBox();
  await drag(fadePoint.x+fadePoint.width/2,fadePoint.y+fadePoint.height/2,-24,0);
  const fadeIn=await p.evaluate(id=>theater.scene.tracks.flatMap(t=>t.clips).find(c=>c.id===id).fadeIn,clip.id);
  assert.ok(fadeIn>.1&&fadeIn<.25);
  await p.getByTitle("在播放头记录关键帧", { exact: true }).click();
  assert.ok(
    await p.evaluate(
      (id) =>
        theater.scene.tracks.flatMap((t) => t.clips).find((c) => c.id === id)
          .gainKeys.length > 0,
      clip.id,
    ),
  );
  out.audioUnified = true;
  await p.screenshot({path:"qa/v25-"+tag+"audio.png"});
  await p.getByTitle("关闭关键帧编辑器", { exact: true }).click();
  const s = emptyScene();
  s.width = 640;
  s.height = 360;
  const back = layer("color", "后平面"),
    front = layer("color", "前遮挡");
  for (const l of [back, front]) {
    l.is3D = true;
    l.width = 480;
    l.height = 260;
    addVisual(s, l);
  }
  front.transform.z = -330;
  front.color = "#374771";
  await p.evaluate(async (s) => theater.loadScene(s), s);
  await p.evaluate((id) => theater.selectLayer(id), back.id);
  await wait();
  assert.equal(await view.locator('g[data-handle="move-x"] circle').count(), 0);
  await p.evaluate(
    (id) =>
      theater.change((s) => {
        s.layers.find((l) => l.id === id).visible = false;
      }),
    front.id,
  );
  await wait();
  assert.ok((await view.locator('g[data-handle="move-x"] circle').count()) > 0);
  out.occludedHandle = true;
  assert.deepEqual(errors, []);
  await fs.writeFile(
    "qa/v25-" + tag + "report.json",
    JSON.stringify(out, null, 2),
  );
  console.log("WORKSPACE_V25_PASS", JSON.stringify(out));
} catch (e) {
  await p.screenshot({ path: "qa/v25-" + tag + "failure.png" }).catch(() => {});
  console.log("ERRORS", errors);
  throw e;
} finally {
  await app.close();
}
