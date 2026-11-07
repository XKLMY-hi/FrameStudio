import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { _electron as electron } from "playwright";
import { emptyScene, layer, addVisual } from "../src/theater/schema.ts";

const root = process.cwd();
const patch = process.argv.includes("--patch");
const full = process.argv.includes("--full");
let executablePath, args;
if (patch) {
  const fullCopy=path.join(os.tmpdir(),"FrameStudio-2.3-patch-qa-"+Date.now());
  await fs.cp(path.join(root,"release/FrameStudio-2.2.0-portable"),fullCopy,{recursive:true});
  const draft = path.join(fullCopy, "resources/app/data/autosave-scene.json");
  const oldScene=emptyScene();
  oldScene.name="2.2 原有草稿";
  addVisual(oldScene,layer("text","原有文本图层"));
  await fs.writeFile(draft,JSON.stringify(oldScene));
  const before = await fs.readFile(draft);
  for (const [name, bytes] of Object.entries(
    unzipSync(await fs.readFile("release/帧间_2.3_轻量更新补丁.zip")),
  )) {
    assert.ok(!name.includes("/data/") && !name.includes("/tools/"));
    const dest = path.resolve(fullCopy, name);
    assert.ok(dest.startsWith(fullCopy + path.sep));
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, bytes);
  }
  assert.deepEqual(await fs.readFile(draft), before);
  executablePath = path.join(fullCopy, "帧间.exe");
  args = [];
} else if (full) {
  const copy = path.join(os.tmpdir(), "FrameStudio-2.3-full-qa-" + Date.now());
  await fs.cp(path.join(root, "release/FrameStudio-2.3.0-portable"), copy, {
    recursive: true,
  });
  executablePath = path.join(copy, "帧间.exe");
  args = [];
} else {
  const { appRoot } = JSON.parse(
    await fs.readFile("qa/theater-smoke-report.json", "utf8"),
  );
  assert.ok(path.resolve(appRoot).startsWith(path.join(root, "qa") + path.sep));
  for (const d of ["dist", "backend", "electron"])
    await fs.cp(path.join(root, d), path.join(appRoot, d), { recursive: true });
  await fs.writeFile(
    path.join(appRoot, "data/autosave-scene.json"),
    JSON.stringify(emptyScene()),
  );
  executablePath = path.join(root, "node_modules/electron/dist/electron.exe");
  args = [appRoot];
}
const app = await electron.launch({
  executablePath,
  args,
  env: { ...process.env, STUDIO_TEST_MODE: "" },
});
const p = await app.firstWindow(),
  errors = [],
  out = { patch, full };
const suffix = patch ? "patch-" : full ? "full-" : "";
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const toolbar = p.locator(".scene-view-toolbar");
const canvas = p.locator(".scene-canvas");
const orbit = () => p.evaluate(() => theater.renderer.viewportOrbit);
const delay = () => p.waitForTimeout(120);
const shot = async (t = 0.75) =>
  p.evaluate((t) => {
    const r = theater.renderer;
    r.renderAt(theater.scene, t, true);
    const result = {
      image: r.app.view.toDataURL(),
      grid: r.grid.visible,
      guides: r.guides.visible,
    };
    r.invalidate();
    return result;
  }, t);
const pose = (ids) =>
  p.evaluate(
    (ids) =>
      ids.map((id) => {
        const core =
          theater.renderer.nodes.get(id).runtime.model.internalModel.coreModel;
        return core.getParameterValueById("ParamAngleX");
      }),
    ids,
  );
const click = async (name, scope = p) =>
  scope.getByRole("button", { name, exact: true }).click();
const drag = async (x, y, dx, dy, button = "left") => {
  await p.mouse.move(x, y);
  await p.mouse.down({ button });
  await p.mouse.move(x + dx, y + dy, { steps: 6 });
  await p.mouse.up({ button });
};
try {
  await p.waitForFunction(() => window.theater?.ready, null, {
    timeout: 90000,
  });
  assert.ok((await p.title()).includes("2.3"));
  if(patch){
    assert.equal(await p.evaluate(()=>theater.scene.name),"2.2 原有草稿");
    assert.equal(await p.evaluate(()=>theater.scene.layers[0].name),"原有文本图层");
    out.patchPreservesData=true;
  }
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
  const sceneCamera = await p.evaluate(() => theater.scene.camera);
  await p.evaluate(() => theater.seek(0.75));
  await delay();
  const cameraFrame = await shot();
  await click("三维预览", toolbar);
  await p.waitForFunction(
    () => theater.renderer.orbitEnabled && theater.renderer.grid.visible,
  );
  const box = await canvas.boundingBox(),
    x = box.x + box.width * 0.53,
    y = box.y + box.height * 0.48;
  const initial = await orbit();
  await drag(x, y, 62, -35);
  const turned = await orbit();
  assert.notEqual(turned.yaw, initial.yaw);
  assert.notEqual(turned.pitch, initial.pitch);
  await drag(x, y, 36, 18, "middle");
  assert.notDeepEqual((await orbit()).target, turned.target);
  const dist = (await orbit()).distance;
  await p.mouse.move(x, y);
  await p.mouse.wheel(0, -280);
  await p.waitForFunction(
    (d) => theater.renderer.viewportOrbit.distance < d,
    dist,
  );
  await click("侧视");
  assert.equal((await orbit()).yaw, Math.PI / 2);
  await click("俯视");
  assert.equal((await orbit()).pitch, -Math.PI / 2);
  await click("透视");
  await p.waitForFunction(() =>
    theater.renderer.hits.some((h) => h.id === "@camera"),
  );
  const views = await p.evaluate(() =>
    [...theater.renderer.nodes.values()]
      .filter((n) => n.runtime && n.mesh)
      .map((n) => ({
        orbit: n.mesh.shader.uniforms.uOrbit,
        lamps: n.mesh.shader.uniforms.uLightCount,
      })),
  );
  assert.deepEqual(views, [
    { orbit: 1, lamps: 2 },
    { orbit: 1, lamps: 2 },
  ]);
  await p.getByTitle("放大预览", { exact: true }).click();
  await p.waitForFunction(() => !!document.querySelector(".viewport-expanded"));
  assert.ok(await p.getByLabel("场景预览进度", { exact: true }).isVisible());
  await p.keyboard.press("Escape");
  assert.equal(await p.locator(".viewport-expanded").count(), 0);
  await p.evaluate((id) => theater.selectLayer(id), actors[0]);
  await p.getByTitle("聚焦选中对象（F）", { exact: true }).click();
  assert.equal((await orbit()).target[0], -220);
  await p.getByTitle("适配全场（Shift+F）", { exact: true }).click();
  await delay();
  await p.screenshot({ path: "qa/v23-" + suffix + "viewport.png" });
  const exact = await shot();
  assert.equal(exact.image, cameraFrame.image);
  assert.equal(exact.guides, false);
  assert.equal(exact.grid, false);
  assert.deepEqual(await p.evaluate(() => theater.scene.camera), sceneCamera);
  assert.equal(await canvas.locator("canvas").count(), 1);
  const lamp = await p.evaluate(() => {
    const r = theater.renderer,
      l = theater.scene.layers.filter((l) => l.light).at(-1),
      h = r.hits.find((h) => h.id === l.id);
    const rect = r.host.getBoundingClientRect(),
      scale = rect.width / r.app.screen.width;
    return {
      id: l.id,
      x: rect.left + (h.points.reduce((sum, p) => sum + p.x, 0) / 4) * scale,
      y: rect.top + (h.points.reduce((sum, p) => sum + p.y, 0) / 4) * scale,
      original: l.transform.x,
    };
  });
  await p.keyboard.down("Alt");
  await drag(lamp.x, lamp.y, 22, 12);
  await p.keyboard.up("Alt");
  assert.ok(
    Math.abs(
      (await p.evaluate(
        (id) => theater.scene.layers.find((l) => l.id === id).transform.x,
        lamp.id,
      )) - lamp.original,
    ) > 1,
  );
  await p.keyboard.press("Control+z");
  assert.equal(
    await p.evaluate(
      (id) => theater.scene.layers.find((l) => l.id === id).transform.x,
      lamp.id,
    ),
    lamp.original,
  );
  out.navigation = true;
  out.cameraExportIdentical = true;
  console.log("VIEWPORT_NAVIGATION_PASS");

  // The same two controllers run under the editor view and the output camera.
  await p.evaluate(() => theater.seek(0.55));
  await delay();
  const first = await pose(actors);
  await p.locator(".scene-transport .play-round").click();
  const start = await p.evaluate(() => ({
    n: theater.renderer.frameCount,
    t: performance.now(),
  }));
  await p.waitForTimeout(1450);
  const end = await p.evaluate(() => ({
    n: theater.renderer.frameCount,
    t: performance.now(),
  }));
  await p.locator(".scene-transport .play-round").click();
  await delay();
  assert.ok((await pose(actors)).every((a, i) => Math.abs(a - first[i]) > 1));
  out.viewportFps = ((end.n - start.n) * 1000) / (end.t - start.t);
  const idle = await p.evaluate(() => theater.renderer.frameCount);
  await p.waitForTimeout(400);
  assert.equal(await p.evaluate(() => theater.renderer.frameCount), idle);
  out.pauseRenders = 0;

  // A short action with longer per-curve fades previously disappeared.
  const asset = {
    id: "qa-short",
    name: "短动作试听",
    kind: "motion",
    duration: 0.12,
    fps: 30,
    curves: [
      {
        id: "ParamAngleX",
        target: "Parameter",
        fadeIn: 1,
        fadeOut: 1,
        keys: [
          { t: 0, v: -24, mode: "linear" },
          { t: 0.12, v: 24, mode: "linear" },
        ],
      },
    ],
  };
  await p.evaluate((id) => {
    theater.change((s) => {
      s.layers.find((l) => l.id === id).visible = false;
    });
    theater.seek(0.75);
  }, actors[0]);
  const hiddenFrame = await shot();
  await p.evaluate(({ asset, id }) => theater.previewMotion(asset, id), {
    asset,
    id: actors[0],
  });
  await p.getByTitle("播放试听", { exact: true }).waitFor({ timeout: 8000 });
  assert.equal(await p.getByText("独立试听", { exact: true }).count(), 1);
  assert.ok((await pose([actors[0]]))[0] > 23.9);
  assert.equal(await p.evaluate(() => theater.time), 0.75);
  await p.getByTitle("上一帧", { exact: true }).click();
  await delay();
  const stepped = (await pose([actors[0]]))[0];
  assert.ok(stepped > 8 && stepped < 13, stepped);
  await p.getByLabel("动作试听速度", { exact: true }).selectOption("0.25");
  await p.getByTitle("循环试听", { exact: true }).click();
  await p.getByTitle("播放试听", { exact: true }).click();
  await p.waitForTimeout(500);
  await p.getByTitle("暂停试听", { exact: true }).click();
  assert.equal((await shot()).image, hiddenFrame.image);
  await p.screenshot({ path: "qa/v23-" + suffix + "audition.png" });
  await p.getByTitle("结束试听并恢复场景", { exact: true }).click();
  assert.equal(
    await p.evaluate(
      (id) => theater.scene.layers.find((l) => l.id === id).visible,
      actors[0],
    ),
    false,
  );
  assert.equal(await p.evaluate(() => theater.time), 0.75);
  out.shortMotion = {
    holdEnd: true,
    step: stepped,
    loop: true,
    hiddenActor: true,
    outputUnchanged: true,
  };
  console.log("AUDITION_CONTROLS_PASS", out.shortMotion);
  await p.evaluate((id) => {
    theater.change((s) => {
      s.layers.find((l) => l.id === id).visible = true;
    });
    theater.selectLayer(id);
  }, actors[0]);
  const assetId = await p.evaluate((id) => {
    const s = theater.scene,
      l = s.layers.find((l) => l.id === id);
    return s.models
      .find((m) => m.id === l.model.resourceId)
      .assets.find(
        (a) =>
          a.kind === "motion" &&
          a.duration > 1 &&
          a.curves.some(
            (c) =>
              c.id === "ParamAngleX" &&
              c.keys.some((k) => Math.abs(k.v - c.keys[0].v) > 5),
          ),
      )?.id;
  }, actors[0]);
  assert.ok(assetId);
  await click("动作", p.locator(".theater-library"));
  await p.locator('.motion-card[data-motion-id="' + assetId + '"]').click();
  await p.getByLabel("动作试听进度", { exact: true }).waitFor();
  assert.equal(
    await p.evaluate(() => theater.renderer.motionPreview.layerId),
    actors[0],
  );
  await p.getByTitle("结束试听并恢复场景", { exact: true }).click();
  out.realCatalogAudition = true;
  await click("模型预处理", toolbar);
  await p.waitForFunction(() => {
    const r = theater.renderer,
      n = r.nodes.get(theater.displayScene.layers.at(-1).id);
    return (
      theater.displayScene.id === "@preprocessing" &&
      n?.mesh?.shader.uniforms.uOrbit === 0
    );
  });
  await click("返回场景", toolbar);
  await p.waitForFunction(
    (id) => theater.renderer.nodes.get(id).mesh.shader.uniforms.uOrbit === 1,
    actors[0],
  );
  await click("成片", toolbar);
  await p.waitForFunction(() => !theater.renderer.orbitEnabled);
  if (process.argv.includes("--encode")) {
    await click("三维预览", toolbar);
    await p.evaluate(() =>
      theater.change((s) => {
        s.width = 640;
        s.height = 360;
        s.fps = 8;
        s.duration = 0.5;
        s.workArea = { start: 0, end: 0.5, loop: false };
        for (const l of s.layers) {
          l.transform.x *= 0.65;
          l.transform.y *= 0.65;
          if (l.model) l.transform.scaleX = l.transform.scaleY = 0.65;
          if (l.light) l.animation = {};
        }
        for (const track of s.tracks)
          for (const c of track.clips) {
            c.start = 0;
            c.duration = 0.5;
          }
      }),
    );
    await click("导出");
    await p.getByRole("button", { name: "WebM VP9", exact: false }).click();
    const response = p.waitForResponse(
      (r) => r.url().includes("/api/export-finish"),
      { timeout: 120000 },
    );
    await click("开始导出");
    const encoded = await (await response).json();
    assert.equal(encoded.frames, 4);
    assert.ok(encoded.path);
    await fs.copyFile(encoded.path, "qa/v23-camera-export.webm");
    out.encodedFrames = encoded.frames;
  }
  assert.deepEqual(errors, []);
  out.noConsoleErrors = true;
  out.frameHash = createHash("sha256").update(exact.image).digest("hex");
  await fs.writeFile(
    "qa/v23-" + suffix + "viewport-report.json",
    JSON.stringify(out, null, 2),
  );
  console.log("VIEWPORT_V23_PASS", JSON.stringify(out));
} catch (e) {
  await p
    .screenshot({ path: "qa/v23-" + suffix + "failure.png" })
    .catch(() => {});
  console.log("ERRORS", errors);
  throw e;
} finally {
  await app.close();
}
