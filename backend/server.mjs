import http from "node:http";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import os from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { saveLivemg, openLivemg, volumeEnvelope } from "./livemg.mjs";
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".gif": "image/gif",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};
function inside(root, p) {
  const resolved = path.resolve(root, p);
  if (resolved !== root && !resolved.startsWith(root + path.sep))
    throw Error("路径超出项目目录");
  return resolved;
}
async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
async function walk(dir, prefix = "") {
  let out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const rel = prefix + e.name;
    if (e.isDirectory())
      out.push(...(await walk(path.join(dir, e.name), rel + "/")));
    else out.push(rel);
  }
  return out;
}
async function bytes(req, limit = 512 * 1024 * 1024) {
  let n = 0;
  const data = [];
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw Error("文件超过 512 MB 限制");
    data.push(c);
  }
  return Buffer.concat(data);
}
async function json(req) {
  return JSON.parse((await bytes(req, 32 * 1024 * 1024)).toString() || "{}");
}
function launch(exe, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => {
      err = (err + c).slice(-16000);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(Error(err || `进程退出 ${code}`)),
    );
  });
}
export async function createStudioServer({
  root,
  port = 0,
  token = randomBytes(24).toString("hex"),
} = {}) {
  root = path.resolve(root);
  const data = path.join(root, "data"),
    models = path.join(data, "models"),
    audio = path.join(data, "audio"),
    exports = path.join(data, "exports"),
    jobs = new Map();
  await Promise.all(
    [models, audio, exports].map((p) => fs.mkdir(p, { recursive: true })),
  );
  const ffmpeg = path.join(root, "tools", "ffmpeg.exe");
  const rhfiles = await walk(path.join(root, "tools", "rhubarb")).catch(
    () => [],
  );
  const rhubarb = rhfiles.find((p) => p.endsWith("rhubarb.exe"));
  let rhRuntime = null;
  if (rhubarb) {
    const asciiTemp = [
      os.tmpdir(),
      process.env.PUBLIC && path.join(process.env.PUBLIC, "Live2DPocketCache"),
    ]
      .filter(Boolean)
      .find((p) => /^[\x00-\x7F]+$/.test(p));
    if (asciiTemp) {
      rhRuntime = path.join(
        asciiTemp,
        "live2d-pocket-runtime",
        "rhubarb-1.14.0",
      );
      await fs.mkdir(rhRuntime, { recursive: true });
      const original = path.dirname(
        path.join(root, "tools", "rhubarb", rhubarb),
      );
      if (!(await exists(path.join(rhRuntime, "rhubarb.exe")))) {
        await fs.cp(path.join(original, "res"), path.join(rhRuntime, "res"), {
          recursive: true,
        });
        await fs.copyFile(
          path.join(original, "LICENSE.md"),
          path.join(rhRuntime, "LICENSE.md"),
        );
        await fs.copyFile(
          path.join(original, "rhubarb.exe"),
          path.join(rhRuntime, "rhubarb.exe"),
        );
      }
    }
  }
  async function modelList() {
    const result = [];
    for (const e of await fs.readdir(models, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const files = (await walk(path.join(models, e.name))).filter((p) =>
        /\.model3\.json$/i.test(p),
      );
      if (files.length)
        result.push({
          id: e.name,
          name: e.name === "demo" ? "银灰大衣 · 示例模型" : e.name,
          files: files.map((p) => ({ path: p, name: path.basename(p) })),
        });
    }
    return result;
  }
  async function unpack(buffer, prefix) {
    const files = unzipSync(buffer);
    let size = 0;
    for (const [k, v] of Object.entries(files)) {
      size += v.length;
      if (size > 768 * 1024 * 1024) throw Error("解压后文件过大");
      if (k.endsWith("/")) continue;
      const target = inside(prefix, k.replaceAll("\\", "/"));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, v);
    }
    return files;
  }
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (v, status = 200) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(v));
    };
    try {
      if (
        req.headers.host &&
        !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host)
      )
        return send({ error: "无效的本地来源" }, 403);
      if (
        req.headers.origin &&
        !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.origin)
      )
        return send({ error: "仅允许本地应用请求" }, 403);
      const authorized =
        url.searchParams.get("token") === token ||
        req.headers.authorization === `Bearer ${token}` ||
        (req.headers.cookie || "")
          .split(";")
          .some((c) => c.trim() === `studio_session=${token}`);
      if (authorized)
        res.setHeader(
          "Set-Cookie",
          `studio_session=${token}; HttpOnly; SameSite=Strict; Path=/`,
        );
      if (
        (url.pathname.startsWith("/api/") ||
          url.pathname.startsWith("/media/")) &&
        !authorized
      )
        return send({ error: "本地会话已失效，请重新打开工具" }, 401);
      if (url.pathname === "/api/info")
        return send({
          models: await modelList(),
          rhubarb: !!rhubarb,
          ffmpeg: await exists(ffmpeg),
          dataDir: data,
        });
      if (url.pathname === "/api/preferences") {
        const file = path.join(data, "preferences.json");
        if (req.method === "POST") {
          const { appearance } = JSON.parse(
            (await bytes(req, 4096)).toString("utf8"),
          );
          if (!["light", "dark", "system"].includes(appearance))
            return send({ error: "无效外观设置" }, 400);
          await fs.writeFile(file, JSON.stringify({ appearance }), "utf8");
          return send({ appearance });
        }
        try {
          return send(JSON.parse(await fs.readFile(file, "utf8")));
        } catch {
          return send({ appearance: "system" });
        }
      }
      if (url.pathname === "/api/model-import" && req.method === "POST") {
        const name = decodeURIComponent(
          req.headers["x-file-name"] || "model.zip",
        )
          .replace(/[^\p{L}\p{N}_. -]/gu, "_")
          .slice(0, 70);
        const id = name.replace(/\.zip$/i, "") + "-" + randomUUID().slice(0, 6),
          dest = inside(models, id);
        await fs.mkdir(dest, { recursive: true });
        await unpack(await bytes(req), dest);
        const list = await modelList();
        const entry = list.find((m) => m.id === id);
        if (!entry)
          throw Error("压缩包内未找到 .model3.json，请导出运行时模型");
        return send(entry);
      }
      if (url.pathname === "/api/model-catalog") {
        const id = url.searchParams.get("id"),
          file = url.searchParams.get("file");
        const modelRoot = inside(models, id),
          filename = inside(modelRoot, file);
        const model = JSON.parse(await fs.readFile(filename, "utf8"));
        const parent = path.dirname(filename),
          assets = [];
        for (const [group, entries] of Object.entries(
          model.FileReferences?.Motions || {},
        )) {
          for (const [n, entry] of entries.entries()) {
            const abs = inside(
              modelRoot,
              path.relative(modelRoot, path.resolve(parent, entry.File)),
            );
            try {
              assets.push({
                name: group + (entries.length > 1 ? " " + (n + 1) : ""),
                json: JSON.parse(await fs.readFile(abs, "utf8")),
                source: entry.File,
                fadeIn: entry.FadeInTime,
                fadeOut: entry.FadeOutTime,
              });
            } catch {}
          }
        }
        for (const entry of model.FileReferences?.Expressions || []) {
          try {
            assets.push({
              name: entry.Name,
              json: JSON.parse(
                await fs.readFile(
                  inside(
                    modelRoot,
                    path.relative(modelRoot, path.resolve(parent, entry.File)),
                  ),
                  "utf8",
                ),
              ),
              source: entry.File,
            });
          } catch {}
        }
        return send({ model, assets });
      }
      if (url.pathname === "/api/media-import" && req.method === "POST") {
        const name = decodeURIComponent(
            req.headers["x-file-name"] || "media.png",
          ),
          ext = path.extname(name).toLowerCase();
        if (
          ![".png", ".jpg", ".jpeg", ".webp", ".svg", ".ttf", ".otf"].includes(
            ext,
          )
        )
          throw Error("支持 PNG/JPEG/WebP 图像和 TTF/OTF 字体");
        const id = randomUUID(),
          relative = "media/" + id + ext,
          dest = inside(data, relative);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, await bytes(req));
        return send({
          id,
          name,
          path: relative,
          kind: [".ttf", ".otf"].includes(ext) ? "font" : "image",
          duration: 0,
          fontFamily: "LiveMG_" + id.replaceAll("-", ""),
        });
      }
      if (url.pathname === "/api/scene-autosave" && req.method === "POST") {
        const p = await json(req);
        await fs.writeFile(
          path.join(data, "autosave-scene.json"),
          JSON.stringify(p),
        );
        return send({ ok: true });
      }
      if (url.pathname === "/api/scene-autosave")
        return send(
          JSON.parse(
            await fs
              .readFile(path.join(data, "autosave-scene.json"), "utf8")
              .catch(() => "null"),
          ),
        );
      if (url.pathname === "/api/audio-analyze" && req.method === "POST") {
        const a = await json(req),
          wav = inside(data, a.path);
        if (!rhubarb || !rhRuntime) throw Error("离线口型引擎不可用");
        const id = randomUUID(),
          work = inside(rhRuntime, "jobs/" + id);
        await fs.mkdir(work, { recursive: true });
        try {
          const input = path.join(work, "input.wav"),
            out = path.join(work, "cues.json");
          await launch(ffmpeg, [
            "-y",
            "-v",
            "error",
            "-i",
            wav,
            "-ac",
            "1",
            "-ar",
            "16000",
            input,
          ]);
          await launch(
            path.join(rhRuntime, "rhubarb.exe"),
            [
              "-r",
              "phonetic",
              "-f",
              "json",
              "-o",
              out,
              "--extendedShapes",
              "GHX",
              input,
            ],
            rhRuntime,
          );
          const result = JSON.parse(await fs.readFile(out, "utf8"));
          return send({
            cues: result.mouthCues,
            analysis: "Rhubarb / Phonetic 离线嘴型",
          });
        } finally {
          await fs.rm(inside(rhRuntime, "jobs/" + id), {
            recursive: true,
            force: true,
          });
        }
      }
      if (url.pathname === "/api/audio-import" && req.method === "POST") {
        const id = randomUUID(),
          ext = path
            .extname(
              decodeURIComponent(req.headers["x-file-name"] || "audio.wav"),
            )
            .replace(/[^.a-zA-Z0-9]/g, "");
        const source = path.join(audio, id + ".source" + ext),
          wav = path.join(audio, id + ".wav");
        await fs.writeFile(source, await bytes(req));
        await launch(ffmpeg, [
          "-y",
          "-v",
          "error",
          "-i",
          source,
          "-ac",
          "2",
          "-ar",
          "48000",
          "-c:a",
          "pcm_s16le",
          wav,
        ]);
        const wave = Buffer.alloc(4096),
          waveHandle = await fs.open(wav, "r");
        try {
          await waveHandle.read(wave, 0, wave.length, 0);
        } finally {
          await waveHandle.close();
        }
        let dataBytes = 0;
        for (let offset = 12; offset + 8 <= wave.length;) {
          const size = wave.readUInt32LE(offset + 4);
          if (wave.toString("ascii", offset, offset + 4) === "data") {
            dataBytes = size;
            break;
          }
          offset += 8 + size + (size % 2);
        }
        const duration = dataBytes / 192000;
        if (!Number.isFinite(duration) || duration <= 0 || duration > 3600)
          throw Error("音频时长须在 0 至 3600 秒内");
        const raw = path.join(audio, id + ".pcm");
        await launch(ffmpeg, [
          "-y",
          "-v",
          "error",
          "-i",
          wav,
          "-ac",
          "1",
          "-ar",
          "16000",
          "-f",
          "s16le",
          "-acodec",
          "pcm_s16le",
          raw,
        ]);
        const samples = await fs.readFile(raw);
        const waveform = [],
          step = Math.max(2, Math.floor(samples.length / 1000 / 2) * 2);
        for (let o = 0; o < samples.length; o += step) {
          let max = 0;
          for (let j = o; j < Math.min(o + step, samples.length - 1); j += 2)
            max = Math.max(max, Math.abs(samples.readInt16LE(j)) / 32768);
          waveform.push(max);
        }
        await fs.unlink(raw);
        let cues = [],
          analysis =
            url.searchParams.get("analyze") === "0"
              ? "未生成口型"
              : "RMS 音量分析（后备）";
        if (rhubarb && url.searchParams.get("analyze") !== "0") {
          const work = rhRuntime ? inside(rhRuntime, "jobs/" + id) : null;
          try {
            let input = wav,
              exe = path.join(root, "tools", "rhubarb", rhubarb),
              cuePath = path.join(audio, id + ".json");
            if (work) {
              await fs.mkdir(work, { recursive: true });
              input = path.join(work, "input.wav");
              cuePath = path.join(work, "cues.json");
              exe = path.join(rhRuntime, "rhubarb.exe");
              await launch(ffmpeg, [
                "-y",
                "-v",
                "error",
                "-i",
                wav,
                "-ac",
                "1",
                "-ar",
                "16000",
                input,
              ]);
            }
            await launch(
              exe,
              [
                "-r",
                "phonetic",
                "-f",
                "json",
                "-o",
                cuePath,
                "--extendedShapes",
                "GHX",
                input,
              ],
              path.dirname(exe),
            );
            cues = JSON.parse(await fs.readFile(cuePath, "utf8")).mouthCues;
            analysis = "Rhubarb / Phonetic 离线嘴型";
          } catch (e) {
            analysis += " · Rhubarb 未完成";
          } finally {
            if (work)
              await fs.rm(inside(rhRuntime, "jobs/" + id), {
                recursive: true,
                force: true,
              });
          }
        }
        if (!cues.length && url.searchParams.get("analyze") !== "0") {
          for (let i = 0; i < waveform.length; i++)
            cues.push({
              start: (i * duration) / waveform.length,
              end: ((i + 1) * duration) / waveform.length,
              value:
                waveform[i] < 0.035
                  ? "X"
                  : waveform[i] > 0.35
                    ? "D"
                    : waveform[i] > 0.15
                      ? "C"
                      : "B",
            });
        }
        return send({
          id,
          name: decodeURIComponent(req.headers["x-file-name"] || "音频"),
          duration,
          audioPath: `audio/${id}.wav`,
          waveform,
          cues,
          analysis,
        });
      }
      if (url.pathname === "/api/autosave" && req.method === "POST") {
        const p = await json(req);
        await fs.writeFile(path.join(data, "autosave.json"), JSON.stringify(p));
        return send({ ok: true });
      }
      if (url.pathname === "/api/autosave")
        return send(
          JSON.parse(
            await fs
              .readFile(path.join(data, "autosave.json"), "utf8")
              .catch(() => "null"),
          ),
        );
      if (url.pathname === "/api/project-save" && req.method === "POST") {
        if (url.searchParams.get("format") === "livemg") {
          const input = await json(req);
          const zip = await saveLivemg(
            input.project || input,
            data,
            input.thumbnail,
          );
          res.writeHead(200, { "Content-Type": "application/zip" });
          return res.end(zip);
        }
        const p = await json(req),
          files = { "project.json": strToU8(JSON.stringify(p)) };
        const mr = inside(models, p.modelId);
        for (const f of await walk(mr))
          files["model/" + f] = new Uint8Array(
            await fs.readFile(inside(mr, f)),
          );
        for (const a of p.assets || []) {
          if (a.audioPath)
            files[a.audioPath] = new Uint8Array(
              await fs.readFile(inside(data, a.audioPath)),
            );
        }
        const zip = zipSync(files, { level: 1 });
        res.writeHead(200, { "Content-Type": "application/zip" });
        return res.end(zip);
      }
      if (url.pathname === "/api/project-open" && req.method === "POST") {
        if (url.searchParams.get("format") === "livemg") {
          const body = await bytes(req);
          const contents = unzipSync(body);
          if (contents["manifest.json"])
            return send(await openLivemg(body, data));
          const old = JSON.parse(
            new TextDecoder().decode(
              contents["project.json"] || new Uint8Array(),
            ),
          );
          if (old.version !== 1) throw Error("未知工程格式");
          const id = "legacy-" + randomUUID().slice(0, 8);
          for (const [n, v] of Object.entries(contents)) {
            if (n.startsWith("model/")) {
              const dest = inside(path.join(models, id), n.slice(6));
              await fs.mkdir(path.dirname(dest), { recursive: true });
              await fs.writeFile(dest, v);
            } else if (n.startsWith("audio/")) {
              const dest = inside(data, n);
              await fs.mkdir(path.dirname(dest), { recursive: true });
              await fs.writeFile(dest, v);
            }
          }
          old.modelId = id;
          return send(old);
        }
        const files = unzipSync(await bytes(req));
        if (!files["project.json"]) throw Error("不是帧间工程文件");
        const p = JSON.parse(new TextDecoder().decode(files["project.json"]));
        if (
          p.version !== 1 ||
          !Array.isArray(p.assets) ||
          !Array.isArray(p.tracks)
        )
          throw Error("工程版本不支持");
        const id = "project-" + randomUUID().slice(0, 8);
        let size = 0;
        for (const [k, v] of Object.entries(files)) {
          size += v.length;
          if (size > 768 * 1024 * 1024) throw Error("工程过大");
          if (k.startsWith("model/")) {
            const target = inside(path.join(models, id), k.slice(6));
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, v);
          } else if (k.startsWith("audio/")) {
            const target = inside(audio, k.slice(6));
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, v);
          }
        }
        p.modelId = id;
        return send(p);
      }
      if (url.pathname === "/api/export-start" && req.method === "POST") {
        const a = await json(req);
        if (!["mp4", "hevc", "gif", "webm", "prores", "png"].includes(a.format))
          throw Error("未知输出格式");
        if (
          ![a.width, a.height, a.fps, a.duration].every(Number.isFinite) ||
          a.width < 64 ||
          a.height < 64 ||
          a.width > 3840 ||
          a.height > 3840 ||
          a.fps < 1 ||
          a.fps > 60 ||
          a.duration <= 0 ||
          a.duration > 3600
        )
          throw Error("导出尺寸或时长超出范围");
        const id = randomUUID(),
          dir = path.join(exports, id);
        await fs.mkdir(path.join(dir, "frames"), { recursive: true });
        jobs.set(id, {
          ...a,
          id,
          dir,
          next: 0,
          total: Math.ceil(a.fps * a.duration),
          status: "frames",
        });
        return send({ id, total: Math.ceil(a.fps * a.duration) });
      }
      const frameMatch = /^\/api\/export-frame\/([\w-]+)\/(\d+)$/.exec(
        url.pathname,
      );
      if (frameMatch && req.method === "POST") {
        const job = jobs.get(frameMatch[1]);
        if (!job || job.status !== "frames") throw Error("导出任务不存在");
        const index = Number(frameMatch[2]);
        if (index !== job.next || index >= job.total)
          throw Error("导出帧序号不一致");
        const buf = await bytes(req, 64 * 1024 * 1024);
        if (
          buf.length < 24 ||
          buf.toString("hex", 0, 8) !== "89504e470d0a1a0a" ||
          buf.readUInt32BE(16) !== job.width ||
          buf.readUInt32BE(20) !== job.height
        )
          throw Error("PNG 帧尺寸无效");
        await fs.writeFile(
          path.join(job.dir, "frames", String(index).padStart(6, "0") + ".png"),
          buf,
        );
        job.next++;
        return send({ ok: true });
      }
      if (url.pathname === "/api/export-finish" && req.method === "POST") {
        const { id } = await json(req),
          job = jobs.get(id);
        if (!job || job.next !== job.total) throw Error("帧未上传完整");
        job.status = "encoding";
        const output = path.join(
          job.dir,
          job.format === "png"
            ? "frames.zip"
            : job.format === "prores"
              ? "animation.mov"
              : job.format === "mp4" || job.format === "hevc"
                ? "animation.mp4"
                : job.format === "gif"
                  ? "animation.gif"
                  : "animation.webm",
        );
        const args = [
          "-y",
          "-v",
          "error",
          "-framerate",
          String(job.fps),
          "-i",
          path.join(job.dir, "frames", "%06d.png"),
        ];
        let n = 0,
          filters = [],
          labels = [];
        for (const a of job.format === "gif" ? [] : job.audio || []) {
          if (!a.path) continue;
          n++;
          if (a.loop) args.push("-stream_loop", "-1");
          args.push("-i", inside(data, a.path));
          let speed = Math.max(0.25, Math.min(4, a.speed || 1));
          const tempo = [];
          while (speed > 2) {
            tempo.push("atempo=2");
            speed /= 2;
          }
          while (speed < 0.5) {
            tempo.push("atempo=0.5");
            speed /= 0.5;
          }
          tempo.push("atempo=" + speed);
          if (a.volumeSamples?.length) {
            const input = n,
              env = ++n,
              envPath = path.join(job.dir, "gain-" + env + ".wav");
            await volumeEnvelope(envPath, a.duration, a.volumeSamples);
            args.push("-i", envPath);
            filters.push(
              `[${input}:a]atrim=start=${Math.max(0, a.trimIn || 0)}:duration=${a.duration * a.speed},asetpts=PTS-STARTPTS,${tempo.join(",")},aformat=channel_layouts=stereo[voice${input}];[${env}:a]pan=stereo|c0=c0|c1=c0[gain${env}];[voice${input}][gain${env}]amultiply,adelay=${Math.round(a.start * 1000)}|${Math.round(a.start * 1000)}[a${env}]`,
            );
            labels.push(`[a${env}]`);
            continue;
          }
          filters.push(
            `[${n}:a]atrim=start=${Math.max(0, a.trimIn || 0)}:duration=${Math.max(0, a.duration * a.speed)},asetpts=PTS-STARTPTS,${tempo.join(",")},volume=${Math.max(0, Math.min(1, a.weight ?? 1))},afade=t=in:d=${Math.max(0, a.fadeIn || 0)},afade=t=out:st=${Math.max(0, a.duration - (a.fadeOut || 0))}:d=${Math.max(0, a.fadeOut || 0)},adelay=${Math.round(a.start * 1000)}|${Math.round(a.start * 1000)}[a${n}]`,
          );
          labels.push(`[a${n}]`);
        }
        if (labels.length) {
          filters.push(
            labels.join("") +
              `amix=inputs=${labels.length}:normalize=0,apad,atrim=0:${job.duration}[audio]`,
          );
          args.push(
            "-filter_complex",
            filters.join(";"),
            "-map",
            "0:v",
            "-map",
            "[audio]",
          );
        } else args.push("-an");
        if (job.format === "png") {
          const files = {};
          for (const f of await walk(path.join(job.dir, "frames")))
            files[f] = new Uint8Array(
              await fs.readFile(path.join(job.dir, "frames", f)),
            );
          await fs.writeFile(output, zipSync(files, { level: 0 }));
        } else {
          if (job.format === "mp4" || job.format === "hevc") {
            args.push(
              "-c:v",
              job.format === "mp4" ? "libx264" : "libx265",
              "-preset",
              "fast",
              "-crf",
              job.format === "mp4" ? "20" : "24",
              "-pix_fmt",
              "yuv420p",
              "-vf",
              "pad=ceil(iw/2)*2:ceil(ih/2)*2",
              "-c:a",
              "aac",
              "-b:a",
              "192k",
              "-movflags",
              "+faststart",
            );
            if (job.format === "hevc")
              args.push(
                "-tag:v",
                "hvc1",
                "-x265-params",
                "log-level=error:pools=2",
              );
          } else if (job.format === "gif") {
            args.push(
              "-vf",
              "split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a",
              "-loop",
              "0",
            );
          } else if (job.format === "webm")
            args.push(
              "-c:v",
              "libvpx-vp9",
              "-pix_fmt",
              "yuva420p",
              "-auto-alt-ref",
              "0",
              "-b:v",
              "0",
              "-crf",
              "22",
              "-deadline",
              "good",
              "-cpu-used",
              "4",
              "-c:a",
              "libopus",
            );
          else
            args.push(
              "-c:v",
              "prores_ks",
              "-profile:v",
              "4444",
              "-pix_fmt",
              "yuva444p10le",
              "-alpha_bits",
              "16",
              "-c:a",
              "pcm_s16le",
            );
          args.push("-t", String(job.duration), output);
          await launch(ffmpeg, args);
        }
        job.status = "done";
        return send({
          path: output,
          url: `/media/exports/${id}/${path.basename(output)}?token=${token}`,
          frames: job.total,
        });
      }
      if (url.pathname === "/api/export-cancel" && req.method === "POST") {
        const { id } = await json(req),
          j = jobs.get(id);
        if (j) j.status = "cancelled";
        return send({ ok: true });
      }
      if (url.pathname.startsWith("/media/")) {
        const filename = inside(
          data,
          decodeURIComponent(url.pathname.slice(7)),
        );
        const stat = await fs.stat(filename);
        if (!stat.isFile()) throw Error("文件不存在");
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
        if (range) {
          const start = Number(range[1]),
            end = Math.min(
              stat.size - 1,
              range[2] ? Number(range[2]) : stat.size - 1,
            );
          if (start > end) {
            res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
            return res.end();
          }
          res.writeHead(206, {
            "Content-Type":
              mime[path.extname(filename)] || "application/octet-stream",
            "Accept-Ranges": "bytes",
            "Content-Range": `bytes ${start}-${end}/${stat.size}`,
            "Content-Length": end - start + 1,
          });
          return createReadStream(filename, { start, end }).pipe(res);
        }
        res.writeHead(200, {
          "Accept-Ranges": "bytes",
          "Content-Type":
            mime[path.extname(filename)] || "application/octet-stream",
          "Content-Length": stat.size,
          "Cache-Control": "no-store",
        });
        return createReadStream(filename).pipe(res);
      }
      if (url.pathname.startsWith("/api/"))
        return send({ error: "接口不存在" }, 404);
      const filename = inside(
        path.join(root, "dist"),
        decodeURIComponent(
          url.pathname === "/" ? "index.html" : url.pathname.slice(1),
        ),
      );
      const stat = await fs.stat(filename);
      res.writeHead(200, {
        "Content-Type":
          mime[path.extname(filename)] || "application/octet-stream",
        "Content-Length": stat.size,
      });
      createReadStream(filename).pipe(res);
    } catch (e) {
      if (!res.headersSent) send({ error: e.message }, 400);
      else res.end();
    }
  });
  server.requestTimeout = 0;
  server.keepAliveTimeout = 65000;
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    server,
    port: address.port,
    token,
    url: `http://127.0.0.1:${address.port}/?token=${token}`,
  };
}
