import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import { _electron as electron } from "playwright";
import { emptyScene, layer, addVisual } from "../src/theater/schema.ts";

const root = process.cwd(),
  patch = process.argv.includes("--patch"),
  full = process.argv.includes("--full");
const tag = patch ? "patch-" : full ? "full-" : "";
let executablePath, args, appRoot;
if (patch || full) {
  const copy = path.join(
    os.tmpdir(),
    "FrameStudio-2.4-" + tag + "qa-" + Date.now(),
  );
  await fs.cp(
    path.join(
      root,
      "release",
      patch ? "FrameStudio-2.3.0-portable" : "FrameStudio-2.4.0-portable",
    ),
    copy,
    { recursive: true },
  );
  appRoot = path.join(copy, "resources/app");
  if (patch) {
    const old = emptyScene();
    old.name = "旧版工程验证";
    addVisual(old, layer("text", "保留的文字"));
    const f = path.join(appRoot, "data/autosave-scene.json"),
      raw = JSON.stringify(old);
    await fs.writeFile(f, raw);
    for (const [name, bytes] of Object.entries(
      unzipSync(await fs.readFile("release/FrameStudio_2.4_轻量更新补丁.zip")),
    )) {
      assert.ok(!name.includes("/data/") && !name.includes("/tools/"));
      const dest = path.resolve(copy, name);
      assert.ok(dest.startsWith(copy + path.sep));
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, bytes);
    }
    assert.equal(await fs.readFile(f, "utf8"), raw);
  }
  executablePath = path.join(copy, patch ? "帧间.exe" : "FrameStudio.exe");
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
  '{"appearance":"light"}',
);
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
const view = p.locator(".scene-view-toolbar"),
  manager = p.locator(".manager-tabs");
const wait = (ms = 120) => p.waitForTimeout(ms);
const load = async (s) => p.evaluate(async (s) => theater.loadScene(s), s);
const sample = async (points, t = 0) =>
  p.evaluate(
    ({ points, t }) => {
      const r = theater.renderer,
        s = theater.scene;
      r.renderAt(s, t, true);
      const c = document.createElement("canvas");
      c.width = s.width;
      c.height = s.height;
      const g = c.getContext("2d");
      g.drawImage(r.app.view, 0, 0);
      r.invalidate();
      return points.map(([x, y]) =>
        Array.from(g.getImageData(x, y, 1, 1).data),
      );
    },
    { points, t },
  );
const drag = async (x, y, dx, dy) => {
  await p.mouse.move(x, y);
  await p.mouse.down();
  await p.mouse.move(x + dx, y + dy, { steps: 7 });
  await p.mouse.up();
};
const handle = async (name, shiftX = 0) => {
  const a = p.locator(
    'g[data-handle="' + name + '"] circle[fill="transparent"]',
  );
  await a.waitFor();
  const b = await a.boundingBox();
  return { x: b.x + b.width / 2 + shiftX, y: b.y + b.height / 2 };
};
const update = async (id, patch) =>
  p.evaluate(
    ({ id, patch }) =>
      theater.change((s) =>
        Object.assign(
          s.layers.find((l) => l.id === id),
          patch,
        ),
      ),
    { id, patch },
  );
try {
  await p.waitForFunction(() => window.theater?.ready, null, {
    timeout: 90000,
  });
  assert.equal(await p.title(), "FrameStudio 2.4");
  if (patch) {
    assert.equal(await p.evaluate(() => theater.scene.name), "旧版工程验证");
    out.draftPreserved = true;
  }
  const s = emptyScene();
  s.width = 640;
  s.height = 360;
  s.duration = 2;
  s.workArea.end = 2;
  const group = layer("group", "深度测试组");
  s.layers.push(group);
  const red = layer("color", "红色平面"),
    blue = layer("color", "蓝色平面");
  for (const [l, color, angle] of [
    [red, "#ff0000", 35],
    [blue, "#0000ff", -35],
  ]) {
    l.is3D = true;
    l.width = 400;
    l.height = 260;
    l.color = color;
    l.transform.rotationY = angle;
    if (l === red) l.parentId = group.id;
    addVisual(s, l, 0, 2);
  }
  await load(s);
  const points = [
    [230, 180],
    [410, 180],
  ];
  out.crossing = await sample(points);
  assert.deepEqual(out.crossing, [
    [0, 0, 255, 255],
    [255, 0, 0, 255],
  ]);
  await p.evaluate(
    (id) =>
      theater.change(
        (s) => (s.layers.find((l) => l.id === id).effects.brightness = 0.65),
      ),
    red.id,
  );
  out.filtered = await sample(points);
  assert.deepEqual(out.filtered[0], [0, 0, 255, 255]);
  assert.ok(
    out.filtered[1][0] > 120 &&
      out.filtered[1][0] < 210 &&
      out.filtered[1][2] === 0,
    JSON.stringify(out.filtered),
  );
  await p.evaluate(
    (id) =>
      theater.change((s) => {
        const l = s.layers.find((l) => l.id === id);
        l.effects.brightness = 1;
        l.transform.opacity = 0.5;
      }),
    red.id,
  );
  out.alpha = await sample(points);
  assert.ok(
    out.alpha[1][0] > 115 &&
      out.alpha[1][0] < 140 &&
      out.alpha[1][2] > 115 &&
      out.alpha[1][3] === 255,
  );
  await p.evaluate(
    (id) =>
      theater.change(
        (s) => (s.layers.find((l) => l.id === id).depthMode = "stack"),
      ),
    blue.id,
  );
  out.layerStack = await sample(points);
  assert.deepEqual(out.layerStack, [
    [0, 0, 255, 255],
    [0, 0, 255, 255],
  ]);
  await p.evaluate(
    (id) =>
      theater.change((s) => {
        s.layers.find((l) => l.id === id).depthMode = "scene";
      }),
    blue.id,
  );
  await p.getByTitle("场景深度遮挡", { exact: true }).click();
  assert.equal(await p.evaluate(() => theater.scene.depthOcclusion), false);
  assert.deepEqual(await sample(points), out.layerStack);
  await p.getByTitle("场景深度遮挡", { exact: true }).click();
  console.log(
    "DEPTH_PIXELS_PASS",
    JSON.stringify({
      crossing: out.crossing,
      filtered: out.filtered,
      alpha: out.alpha,
    }),
  );
  await p.getByTitle("折叠组", { exact: true }).click();
  assert.equal(
    await p.getByLabel("图层名称 " + red.id, { exact: true }).count(),
    0,
  );
  await p.getByTitle("展开组", { exact: true }).click();
  assert.equal(
    await p.getByLabel("图层名称 " + red.id, { exact: true }).count(),
    1,
  );

  const c = emptyScene();
  c.width = 640;
  c.height = 360;
  const plane = layer("color", "相机推进样本");
  plane.color = "#ff0000";
  plane.is3D = true;
  plane.width = 100;
  plane.height = 140;
  addVisual(c, plane);
  await load(c);
  await click("成片相机");
  const cameraPixel = [
    [455, 180],
    [320, 180],
  ];
  assert.equal((await sample(cameraPixel))[0][3], 0);
  await p.getByRole("spinbutton", { name: "相机 Z", exact: true }).fill("1000");
  out.push = await sample(cameraPixel);
  assert.deepEqual(out.push, [
    [255, 0, 0, 255],
    [255, 0, 0, 255],
  ]);
  await p.getByRole("spinbutton", { name: "相机 Z", exact: true }).fill("1300");
  assert.equal((await sample(cameraPixel))[1][3], 0);
  await update(plane.id, { is3D: false });
  assert.deepEqual(await sample(cameraPixel), [
    [0, 0, 0, 0],
    [255, 0, 0, 255],
  ]);
  console.log("CAMERA_Z_PIXELS_PASS");

  const prev = await p.evaluate(() => theater.scene.models[0]?.modelId);
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
    prev,
    { timeout: 90000 },
  );
  const actors = await p.evaluate(() =>
    theater.scene.layers.filter((l) => l.model).map((l) => l.id),
  );
  await p.evaluate((id) => {
    theater.change((s) => {
      for (const l of s.layers) if (l.model) l.is3D = false;
    });
    theater.seek(0.75);
    theater.selectLayer("@camera");
  }, actors[0]);
  await click("让模型跟随相机");
  assert.ok(
    await p.evaluate(() =>
      theater.scene.layers.filter((l) => l.model).every((l) => l.is3D),
    ),
  );
  await p.evaluate((id) => theater.selectLayer(id), actors[0]);
  const base = await p.evaluate(
    (id) => theater.scene.layers.find((l) => l.id === id).transform,
    actors[0],
  );
  const h = await handle("move-x");
  await drag(h.x, h.y, 32, 0);
  const read = () =>
    p.evaluate(
      (id) => theater.scene.layers.find((l) => l.id === id).transform,
      actors[0],
    );
  assert.ok((await read()).x > base.x + 10);
  await p.keyboard.press("Control+z");
  assert.equal((await read()).x, base.x);
  const corner = await handle("corner-0", -11);
  await drag(corner.x, corner.y, -22, -18);
  assert.ok((await read()).scaleX > base.scaleX * 1.05);
  assert.equal((await read()).scaleX, (await read()).scaleY);
  await p.keyboard.press("Control+z");
  const tools = p.locator(".gizmo-toolbar");
  await click("旋转", tools);
  const ringPath=p.locator('g[data-handle="rotate-z"] path').last();
  await ringPath.waitFor();
  const ring=await ringPath.evaluate(el=>{
    const pos=el.getPointAtLength(el.getTotalLength()*.125);
    const p=new DOMPoint(pos.x,pos.y).matrixTransform(el.getScreenCTM());
    return {x:p.x,y:p.y,target:document.elementFromPoint(p.x,p.y)?.closest("[data-handle]")?.getAttribute("data-handle")};
  });
  assert.equal(ring.target,"rotate-z",JSON.stringify(ring));
  await drag(ring.x,ring.y,-22,25);
  assert.ok(Math.abs((await read()).rotation) > 10);
  await p.keyboard.press("Control+z");
  await click("移动", tools);
  await p.screenshot({ path: "qa/v24-" + tag + "gizmo.png" });
  await click("三维预览", view);
  await p.waitForFunction(() => theater.renderer.viewportOrbit);
  const box = await p.locator(".scene-canvas").boundingBox();
  const yaw = await p.evaluate(() => theater.renderer.viewportOrbit.yaw);
  await drag(box.x + 40, box.y + 100, 45, 0);
  assert.ok(
    await p.evaluate((y) => theater.renderer.viewportOrbit.yaw > y, yaw),
  );
  await click("正X轴视图");
  assert.equal(
    await p.evaluate(() => theater.renderer.viewportOrbit.yaw),
    -Math.PI / 2,
  );
  await click("透视");
  const z = await handle("move-z");
  const zline = await p
    .locator('g[data-handle="move-z"] line')
    .last()
    .evaluate((el) => [
      +el.getAttribute("x2") - +el.getAttribute("x1"),
      +el.getAttribute("y2") - +el.getAttribute("y1"),
    ]);
  await drag(z.x, z.y, zline[0] * 0.65, zline[1] * 0.65);
  assert.ok((await read()).z > base.z + 5);
  await p.keyboard.press("Control+z");
  assert.equal((await read()).z, base.z);
  out.gizmoBothViews = true;
  out.cornerHitOutsideGlyph = true;
  out.axisNavigation = true;
  await click("资产", manager);
  assert.equal(await p.locator(".layer-manager").isVisible(), false);
  assert.equal(await p.locator(".scene-asset-list").isVisible(), true);
  assert.equal(await p.getByTitle("创建独立模型容器").count(), 2);
  await p.getByLabel("搜索素材", { exact: true }).fill("黑发");
  assert.equal(await p.getByTitle("创建独立模型容器").count(), 1);
  await p.getByLabel("搜索素材", { exact: true }).fill("");
  await click("图层", manager);
  assert.equal(await p.locator(".scene-asset-list").isVisible(), false);
  out.tabsAndSearch = true;

  const appearance = p.getByLabel("外观", { exact: true });
  await appearance.selectOption("dark");
  await p.waitForFunction(
    () =>
      document.documentElement.dataset.theme === "dark" &&
      theater.renderer.dark,
  );
  await wait();
  const palette = await p.evaluate(() =>
    [
      ".theater-app",
      ".theater-library",
      ".theater-center",
      ".scene-timeline",
      ".scene-ruler-row",
    ].map((s) => getComputedStyle(document.querySelector(s)).backgroundColor),
  );
  for (const c of palette) {
    const rgb = c.match(/\d+/g)?.slice(0, 3).map(Number);
    assert.ok(
      rgb?.every((v) => v < 100),
      JSON.stringify(palette),
    );
  }
  assert.equal(
    JSON.parse(
      await fs.readFile(path.join(appRoot, "data/preferences.json"), "utf8"),
    ).appearance,
    "dark",
  );
  await p.screenshot({ path: "qa/v24-" + tag + "dark.png" });
  out.darkPalette = palette;
  out.preferencePersisted = true;
  if(full||process.argv.includes("--encode")){
    s.duration=.5;s.fps=8;s.workArea={start:0,end:.5,loop:false};
    for(const track of s.tracks)for(const clip of track.clips)clip.duration=.5;
    red.effects.brightness=.65;
    await load(s);
    await click("导出");
    await p.getByRole("button",{name:"WebM VP9",exact:false}).click();
    const response=p.waitForResponse(r=>r.url().includes("/api/export-finish"),{timeout:120000});
    await click("开始导出");
    const encoded=await (await response).json();
    assert.equal(encoded.frames,4,JSON.stringify(encoded));
    assert.ok(encoded.path);
    await fs.copyFile(encoded.path,"qa/v24-depth-export.webm");
    out.encodedFrames=encoded.frames;
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    "qa/v24-" + tag + "report.json",
    JSON.stringify(out, null, 2),
  );
  console.log("FRAMESTUDIO_V24_PASS", JSON.stringify(out));
} catch (e) {
  await p.screenshot({ path: "qa/v24-" + tag + "failure.png" }).catch(() => {});
  console.log("ERRORS", errors);
  throw e;
} finally {
  await app.close();
}
